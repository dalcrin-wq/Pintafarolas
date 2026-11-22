// El móvil de cada jugador: mando, lienzo y papeleta de voto.
import { login, db, ref, set, update, onValue, serverTimestamp, onDisconnect, serverNow } from "./firebase.js";
import { DrawPad } from "./pad.js";
import { $, $$, esc, normalize, safeImg, avatarHTML, sortedPlayers } from "./util.js";

const TITLE = "Garabatrola";
const MAX_PLAYERS = 10;
const ACCENTS = ["#e4572e", "#2e86de", "#17a34a", "#d946ef", "#f59e0b", "#0ea5a4"];

const app = $("#app");
const params = new URLSearchParams(location.search);
let code = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
let me = null, state = null, viewKey = "", unsub = null;
let pad = null, avatarTimer = null, sending = false, presenceHooked = false;

const meP = () => state?.players?.[me.uid];
const roomPath = (p = "") => ref(db, `rooms/${code}${p ? "/" + p : ""}`);

async function boot() {
  app.innerHTML = `<p class="loading">Conectando…</p>`;
  try {
    me = await login();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><p class="error">No he podido conectar. Revisa la conexión y recarga.</p></div>`;
    return;
  }
  code ? enterRoom() : showCodeForm();
}

function showCodeForm(err = "") {
  viewKey = "code";
  app.innerHTML = `
    <div class="card">
      <h1 class="logo small">${TITLE}</h1>
      <label>Código de sala <input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD"></label>
      ${err ? `<p class="error">${esc(err)}</p>` : ""}
      <button class="btn big" id="go">Entrar</button>
    </div>`;
  $("#go").onclick = () => {
    const c = $("#code").value.toUpperCase().replace(/[^A-Z]/g, "");
    if (c.length !== 4) return;
    code = c;
    history.replaceState(null, "", `?room=${code}`);
    enterRoom();
  };
}

function enterRoom() {
  unsub?.();
  unsub = onValue(roomPath(), (snap) => {
    state = snap.val();
    if (!state?.host) {
      unsub?.(); unsub = null;
      showCodeForm("Esa sala no existe o ya se ha cerrado.");
      return;
    }
    render();
  }, () => showCodeForm("No se ha podido abrir la sala."));
}

function hookPresence() {
  if (presenceHooked) return;
  presenceHooked = true;
  const conn = roomPath(`players/${me.uid}/connected`);
  onValue(ref(db, ".info/connected"), (s) => {
    if (s.val() !== true || !meP()) return;
    onDisconnect(conn).set(false);
    set(conn, true);
  });
}

/* ---------------- Vistas ---------------- */

function render() {
  const p = meP();
  const s = state;
  let key;
  if (!p) key = s.phase === "lobby" ? "join" : "locked";
  else {
    hookPresence();
    if (s.phase === "lobby") key = "lobby";
    else if (s.phase === "drawing") key = `drawing|${s.phaseId}|${s.drawings?.[me.uid] ? 1 : 0}`;
    else if (s.phase === "lying") key = `lying|${s.phaseId}|${s.lies?.[me.uid] ? 1 : 0}`;
    else if (s.phase === "voting") key = `voting|${s.phaseId}|${s.votes?.[me.uid] ? 1 : 0}`;
    else key = `${s.phase}|${s.phaseId}`;
  }
  if (key !== viewKey) {
    viewKey = key;
    pad = null;
    sending = false;
    build(key.split("|")[0]);
  }
  refresh();
}

function header() {
  const p = meP();
  return `<div class="me">${avatarHTML(p, "tiny")}<b>${esc(p?.name)}</b><span class="score" data-score></span></div>`;
}

function tools(colors) {
  return `
    <div class="tools">
      ${colors.map((c, i) => `<button class="swatch ${i === 0 ? "on" : ""} ${c === "#ffffff" ? "eraser" : ""}"
          data-color="${c}" style="background:${c}" aria-label="${c === "#ffffff" ? "Goma" : "Color"}"></button>`).join("")}
      <button class="tool" data-size>Trazo fino</button>
      <button class="tool" data-undo aria-label="Deshacer">↶</button>
      <button class="tool" data-clear aria-label="Borrar todo">🗑</button>
    </div>`;
}

function bindTools(p) {
  $$(".swatch").forEach((b) => b.onclick = () => {
    p.color = b.dataset.color;
    $$(".swatch").forEach((x) => x.classList.toggle("on", x === b));
  });
  const size = $("[data-size]");
  size.onclick = () => {
    const thick = p.width < 10;
    p.width = thick ? 16 : 6;
    size.textContent = thick ? "Trazo gordo" : "Trazo fino";
  };
  $("[data-undo]").onclick = () => p.undo();
  $("[data-clear]").onclick = () => p.clear();
}

function accentFor(uid, round) {
  let h = round || 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function card(html) {
  app.innerHTML = `${header()}<div class="card">${html}</div>`;
}

function build(kind) {
  const s = state;
  switch (kind) {
    case "join": return buildJoin();
    case "locked":
      app.innerHTML = `<div class="card"><h1 class="logo small">${TITLE}</h1>
        <p>La partida ya ha empezado. Espera a la siguiente y entra en cuanto vuelvan a la sala.</p></div>`;
      return;
    case "lobby": return buildLobby();
    case "drawing": return buildDrawing();
    case "lying": return buildLying();
    case "voting": return buildVoting();
    case "reveal": {
      const g = s.results?.gains?.[me.uid] || 0;
      return card(`<p class="big-emoji">👀</p><h2>Mira la pantalla</h2>
        <p class="muted">${g ? `Con este dibujo te llevas <b>+${g}</b> puntos.` : "Vamos a ver quién ha mentido mejor."}</p>`);
    }
    case "scores": {
      const pos = sortedPlayers(s).sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex((p) => p.uid === me.uid) + 1;
      return card(`<p class="big-emoji">📊</p><h2>Vas ${pos}º</h2><p class="muted">Mira la clasificación en la pantalla.</p>`);
    }
    case "end": {
      const pos = sortedPlayers(s).sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex((p) => p.uid === me.uid) + 1;
      return card(`<p class="big-emoji">${pos === 1 ? "🏆" : "🎨"}</p><h2>${pos === 1 ? "¡Has ganado!" : `Has quedado ${pos}º`}</h2>
        <p class="muted">${pos === 1 ? "Eres oficialmente la persona menos fiable de la sala." : "Para la próxima, miente con más convicción."}</p>
        <p class="muted">Si el anfitrión pulsa «Otra partida», volverás a la sala.</p>`);
    }
  }
}

function buildJoin() {
  app.innerHTML = `
    <div class="card">
      <h1 class="logo small">${TITLE}</h1>
      <p>Sala <b>${esc(code)}</b></p>
      <label>Tu nombre <input id="name" maxlength="12" autocomplete="off" value="${esc(localStorage.getItem("gt_name") || "")}"></label>
      <button class="btn big" id="join">Entrar</button>
      <p class="error" id="err"></p>
    </div>`;
  $("#join").onclick = async () => {
    const name = $("#name").value.trim();
    const err = $("#err");
    const others = sortedPlayers(state);
    if (!name) { err.textContent = "Ponte un nombre, aunque sea falso. Aquí se miente mucho."; return; }
    if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) { err.textContent = "Ese nombre ya está pillado."; return; }
    if (others.length >= MAX_PLAYERS) { err.textContent = "La sala está llena."; return; }
    try { localStorage.setItem("gt_name", name); } catch { /* da igual */ }
    $("#join").disabled = true;
    await set(roomPath(`players/${me.uid}`), {
      name, avatar: "", ready: false, score: 0, connected: true, joinedAt: serverTimestamp(),
    });
  };
}

function buildLobby() {
  card(`
    <h2>Dibuja tu cara</h2>
    <p class="muted">Mientras llega todo el mundo. Nadie espera parecido.</p>
    <canvas id="pad" class="pad"></canvas>
    ${tools(["#1b1b1b", "#e4572e", "#2e86de", "#f2c14e", "#ffffff"])}
    <button class="btn big" id="ready"></button>
    <button class="btn alt" id="start" hidden>Empezar partida</button>
    <p class="muted" id="lobby-msg"></p>`);
  pad = new DrawPad($("#pad"), { size: 240 });
  pad.setBase(safeImg(meP()?.avatar));
  bindTools(pad);
  pad.onChange = () => {
    clearTimeout(avatarTimer);
    avatarTimer = setTimeout(() => {
      update(roomPath(`players/${me.uid}`), { avatar: pad.isEmpty() ? "" : pad.toDataURL() });
    }, 300);
  };
  $("#ready").onclick = () => update(roomPath(`players/${me.uid}`), { ready: !meP().ready });
  $("#start").onclick = () => update(roomPath(), { startRequested: true });
}

function buildDrawing() {
  const s = state;
  const prompt = s.prompts?.[me.uid];
  if (!prompt) return card(`<h2>Esta ronda te toca mirar</h2><p class="muted">Has llegado tarde al reparto. En la próxima dibujas.</p>`);
  if (s.drawings?.[me.uid]) {
    return card(`<h2>¡Enviado!</h2><img class="thumb" src="${safeImg(s.drawings[me.uid])}" alt="">
      <p class="muted">Obra maestra entregada. Ahora a esperar a los lentos.</p>`);
  }
  card(`
    <p class="prompt-label">Dibuja esto (solo tú lo ves):</p>
    <p class="prompt">${esc(prompt)}</p>
    <div class="timer small" data-timer></div>
    <canvas id="pad" class="pad"></canvas>
    ${tools(["#1b1b1b", accentFor(me.uid, s.round), "#ffffff"])}
    <button class="btn big" id="send">Enviar dibujo</button>
    <p class="error" id="err"></p>`);
  pad = new DrawPad($("#pad"), { size: 360 });
  bindTools(pad);
  $("#send").onclick = () => sendDrawing(false);
}

function sendDrawing(auto) {
  if (sending || !pad) return;
  if (pad.isEmpty()) {
    if (!auto) $("#err").textContent = "Dibuja algo, artista. Aunque sea un churro.";
    return;
  }
  sending = true;
  set(roomPath(`drawings/${me.uid}`), pad.toDataURL()).catch(() => { sending = false; });
}

function buildLying() {
  const s = state;
  if (s.current?.artist === me.uid) {
    return card(`<p class="big-emoji">🤐</p><h2>Es tu obra maestra</h2>
      <p class="muted">Calla y disfruta mientras los demás se inventan qué es.</p>`);
  }
  if (s.lies?.[me.uid]) {
    return card(`<p class="big-emoji">😇</p><h2>Mentira enviada</h2><p class="muted">Ahora pon cara de póker.</p>`);
  }
  card(`
    <p class="prompt-label">¿Qué es este dibujo?</p>
    <img class="thumb" src="${safeImg(s.drawings?.[s.current?.artist])}" alt="">
    <p class="muted">Escribe un título falso pero creíble. Si adivinas la verdad, no vale: inventa otra cosa.</p>
    <input id="lie" maxlength="45" autocomplete="off" placeholder="Un pato con hipoteca…">
    <div class="timer small" data-timer></div>
    <button class="btn big" id="send">Enviar mentira</button>
    <p class="error" id="err"></p>`);
  $("#send").onclick = () => {
    const text = $("#lie").value.trim();
    const err = $("#err");
    if (!text) { err.textContent = "Escribe algo. El silencio no engaña a nadie."; return; }
    if (normalize(text) === normalize(s.current?.prompt)) {
      err.textContent = "¡Has acertado! Muy listo. Pero aquí se viene a mentir: escribe otra cosa.";
      return;
    }
    $("#send").disabled = true;
    set(roomPath(`lies/${me.uid}`), text).catch(() => { $("#send").disabled = false; });
  };
}

function buildVoting() {
  const s = state;
  if (s.current?.artist === me.uid) {
    return card(`<p class="big-emoji">🍿</p><h2>No votas tu propio dibujo</h2><p class="muted">Mira cómo lo destrozan.</p>`);
  }
  if (s.votes?.[me.uid]) {
    return card(`<p class="big-emoji">🗳️</p><h2>Voto enviado</h2><p class="muted">Crucemos los dedos.</p>`);
  }
  const opts = (s.options || []).filter((o) => !(o.authors || []).includes(me.uid));
  card(`
    <p class="prompt-label">¿Cuál es la verdad?</p>
    <div class="timer small" data-timer></div>
    <div class="vote-list">${opts.map((o) => `<button class="vote" data-id="${esc(o.id)}">${esc(o.text)}</button>`).join("")}</div>
    <p class="muted">Tu propia mentira no sale. Buen intento.</p>`);
  $$(".vote").forEach((b) => b.onclick = () => {
    $$(".vote").forEach((x) => { x.disabled = true; });
    b.classList.add("chosen");
    set(roomPath(`votes/${me.uid}`), b.dataset.id);
  });
}

/* ---------------- Actualizaciones sin reconstruir ---------------- */

function refresh() {
  const p = meP();
  if (!p) return;
  const sc = $("[data-score]");
  if (sc) sc.textContent = `${p.score || 0} pts`;
  if (state.phase !== "lobby") return;
  const ready = $("#ready");
  if (ready) {
    ready.textContent = p.ready ? "Ya no estoy listo" : "¡Estoy listo!";
    ready.classList.toggle("ghost", !!p.ready);
  }
  const ps = sortedPlayers(state).filter((x) => x.connected !== false);
  const vip = ps[0]?.uid === me.uid;
  const allReady = ps.length >= 2 && ps.every((x) => x.ready);
  const start = $("#start");
  if (start) { start.hidden = !vip; start.disabled = !allReady; }
  const msg = $("#lobby-msg");
  if (msg) {
    msg.textContent = allReady
      ? (vip ? "Todos listos. Tú decides cuándo empieza." : "Todos listos. Esperando a que empiece.")
      : `${ps.filter((x) => x.ready).length} de ${ps.length} listos.`;
  }
}

setInterval(() => {
  if (!state?.deadline) return;
  const secs = Math.max(0, Math.ceil((state.deadline - serverNow()) / 1000));
  const t = $("[data-timer]");
  if (t) {
    t.textContent = `${secs} s`;
    t.classList.toggle("hurry", secs <= 10);
  }
  // Se acabó el tiempo: enviamos lo que haya en el lienzo.
  if (secs === 0 && state.phase === "drawing" && pad && !state.drawings?.[me.uid]) sendDrawing(true);
}, 250);

boot();
