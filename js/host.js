// Pantalla grande (tele/ordenador). Es el árbitro: decide cuándo cambia cada fase.
import { login, db, ref, set, update, get, onValue, remove, serverTimestamp, serverNow } from "./firebase.js";
import { PROMPTS, SPICY_PROMPTS, HOUSE_LIES } from "./prompts.js";
import { Voice } from "./voice.js";
import { Music } from "./music.js";
import { $, esc, shuffle, normalize, randCode, safeImg, avatarHTML, sortedPlayers } from "./util.js";

export const TITLE = "Garabatrola";
const DEFAULTS = { pace: "normal", rounds: 2, spicy: false, canvas: "comodo", hideCode: false, music: true, voice: true };
// Ritmo: segundos para dibujar, mentir y votar.
const PACES = {
  normal: { draw: 75, lie: 40, vote: 25 },
  relajado: { draw: 100, lie: 55, vote: 35 },
  tranquilo: { draw: 130, lie: 75, vote: 45 },
};
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const REVEAL_STEP = 6000;
const REVEAL_INTRO = 3000;

const app = $("#app");
let settings = loadSettings();
let me = null, code = null, roomRef = null, state = null, unsub = null;
let viewKey = "", timer = null, advancedFor = -1;
let revealTimers = [], usedPrompts = new Set(), knownPlayers = new Map(), primed = false;
let cues = { pid: -1, half: false, last10: false }, lobbyQuietSince = Date.now(), lobbyNags = 0, wasReady = false;

function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("gt_settings") || "{}") }; }
  catch { s = { ...DEFAULTS }; }
  if (!PACES[s.pace]) s.pace = "normal";
  return s;
}
function roomSettings() {
  const p = PACES[settings.pace];
  return { drawTime: p.draw, lieTime: p.lie, voteTime: p.vote, rounds: settings.rounds, spicy: !!settings.spicy, canvas: settings.canvas };
}
function saveSettings() {
  try { localStorage.setItem("gt_settings", JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
}

// El navegador no deja sonar nada hasta el primer toque.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (settings.music) Music.start();
}
document.addEventListener("pointerdown", unlockAudio);

// Mando de la tele / teclado: flechas para moverse entre botones, Enter para elegir.
document.addEventListener("keydown", (e) => {
  unlockAudio();
  if (e.key === "Escape" && viewKey === "settings") { e.preventDefault(); showMenu(); return; }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const items = [...app.querySelectorAll("button, a[href]")].filter((b) => !b.disabled && b.offsetParent !== null);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  const step = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
  items[i < 0 ? 0 : (i + step + items.length) % items.length].focus();
});

// Botones fijos: pantalla completa y aviso para activar el sonido.
const fsBtn = $("#fullscreen");
if (fsBtn) {
  fsBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch?.(() => {});
  document.addEventListener("fullscreenchange", () => { fsBtn.textContent = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa"; });
}
const soundBtn = $("#sound-hint");
if (soundBtn) {
  soundBtn.onclick = () => { unlockAudio(); };
  setInterval(() => { soundBtn.hidden = audioUnlocked; }, 500);
}
Voice.setEnabled(settings.voice);

const nameOf = (uid) => state?.players?.[uid]?.name || "alguien";
const active = () => sortedPlayers(state).filter((p) => p.connected !== false);
const ranking = () => sortedPlayers(state).sort((a, b) => (b.score || 0) - (a.score || 0));
const winners = () => { const r = ranking(); const top = r[0]?.score || 0; return r.filter((p) => (p.score || 0) === top); };
const canStart = () => { const a = active(); return a.length >= MIN_PLAYERS && a.every((p) => p.ready); };

/* ---------------- Menú y ajustes ---------------- */

function showMenu() {
  leaveRoom();
  viewKey = "menu";
  app.innerHTML = `
    <section class="menu">
      <h1 class="logo">${TITLE}</h1>
      <p class="tagline">Si no sabes dibujar, aprende a mentir.</p>
      <div class="menu-buttons">
        <button class="btn big" id="play">Jugar</button>
        <button class="btn ghost" id="cfg">Ajustes</button>
      </div>
      <p class="hint">Pon esta pantalla en la tele. Los demás juegan con el móvil.</p>
      <p class="hint small">flechas para moverte · Enter para elegir</p>
    </section>`;
  $("#play").onclick = () => { unlockAudio(); Voice.say("menu"); createRoom(); };
  $("#cfg").onclick = () => { unlockAudio(); Voice.say("ajustes"); showSettings(); };
  $("#play").focus();
}

const SETTING_ROWS = [
  { key: "pace", label: "Ritmo", help: "Cuánto dura cada reloj: dibujar, mentir y votar.",
    options: [["normal", "Normal"], ["relajado", "Relajado"], ["tranquilo", "Tranquilo"]] },
  { key: "rounds", label: "Rondas", help: "Cada ronda, todo el mundo dibuja una frase.",
    options: [[1, "1"], [2, "2"], [3, "3"]] },
  { key: "spicy", label: "Frases gamberras", help: "Para adultos dispuestos a dibujar cosas difíciles de justificar.",
    options: [[false, "No"], [true, "Sí"]] },
  { key: "canvas", label: "Lienzo", help: "Clásico = sin deshacer ni goma: el error se queda, y de ahí sale media comedia.",
    options: [["comodo", "Cómodo"], ["clasico", "Clásico"]] },
  { key: "hideCode", label: "Ocultar código de sala", help: "Tapa el código y el QR en la sala, por si retransmites la partida.",
    options: [[false, "No"], [true, "Sí"]] },
  { key: "music", label: "Música", help: "", options: [[true, "Sí"], [false, "No"]] },
  { key: "voice", label: "Voz de Lola", help: "", options: [[true, "Sí"], [false, "No"]] },
];

function showSettings() {
  viewKey = "settings";
  const row = (r) => `
    <li class="setting">
      <div class="setting-text"><span class="setting-label">${r.label}</span>${r.help ? `<span class="setting-help">${r.help}</span>` : ""}</div>
      <div class="seg" role="group" aria-label="${r.label}">
        ${r.options.map(([v, t]) => `<button class="seg-btn ${settings[r.key] === v ? "on" : ""}" data-key="${r.key}" data-val='${JSON.stringify(v)}'>${t}</button>`).join("")}
      </div>
    </li>`;
  app.innerHTML = `
    <section class="panel settings">
      <h2>Ajustes</h2>
      <ul class="settings-list">${SETTING_ROWS.map(row).join("")}</ul>
      <button class="btn" id="back">Volver</button>
      <p class="credits">Escape también vuelve · los ajustes valen para la próxima sala · voz de Lola generada con ElevenLabs</p>
    </section>`;
  app.querySelectorAll(".seg-btn").forEach((b) => b.onclick = () => {
    settings[b.dataset.key] = JSON.parse(b.dataset.val);
    saveSettings();
    app.querySelectorAll(`.seg-btn[data-key="${b.dataset.key}"]`).forEach((x) => x.classList.toggle("on", x === b));
    if (b.dataset.key === "voice") Voice.setEnabled(settings.voice);
    if (b.dataset.key === "music") settings.music ? Music.start() : Music.stop();
  });
  $("#back").onclick = showMenu;
  app.querySelector(".seg-btn.on")?.focus();
}

/* ---------------- Sala ---------------- */

async function createRoom() {
  app.innerHTML = `<section class="menu"><p class="loading">Preparando la sala…</p></section>`;
  try {
    me = me || await login();
    let c = null;
    for (let i = 0; i < 10 && !c; i++) {
      const t = randCode();
      const s = await get(ref(db, `rooms/${t}/host`));
      if (!s.exists()) c = t;
    }
    if (!c) throw new Error("No encuentro un código libre");
    code = c;
    await set(ref(db, `rooms/${code}`), {
      host: me.uid, phase: "lobby", phaseId: 1, createdAt: serverTimestamp(),
      settings: roomSettings(),
    });
    sessionStorage.setItem("gt_room", code);
    listen();
    Voice.say("sala");
  } catch (e) {
    console.error(e);
    Voice.say("error");
    app.innerHTML = `<section class="menu"><p class="error">No he podido crear la sala: ${esc(e.message)}</p>
      <button class="btn" id="back">Volver</button></section>`;
    $("#back").onclick = showMenu;
  }
}

function listen() {
  roomRef = ref(db, `rooms/${code}`);
  unsub = onValue(roomRef, (snap) => {
    state = snap.val();
    if (!state) { code = null; showMenu(); return; }
    onState();
  });
}

function leaveRoom() {
  unsub?.(); unsub = null;
  clearTimeout(timer); clearReveal();
  if (roomRef) remove(roomRef).catch(() => {});
  state = null; code = null; roomRef = null;
  knownPlayers = new Map(); primed = false; advancedFor = -1;
  sessionStorage.removeItem("gt_room");
}

function onState() {
  announceJoins();
  const key = `${state.phase}|${state.phaseId}`;
  if (key !== viewKey) {
    viewKey = key;
    renderPhase();
    onEnterPhase();
  } else {
    updatePhase();
  }
  checkProgress();
}

function announceJoins() {
  for (const p of sortedPlayers(state)) {
    const online = p.connected !== false;
    if (!knownPlayers.has(p.uid)) {
      knownPlayers.set(p.uid, online);
      if (primed && state.phase === "lobby") Voice.say("entra");
      continue;
    }
    const was = knownPlayers.get(p.uid);
    knownPlayers.set(p.uid, online);
    if (primed && was !== online && state.phase !== "lobby") Voice.say(online ? "vuelve" : "desconecta");
  }
  primed = true;
}

/* ---------------- Máquina de fases ---------------- */

function setPhase(phase, extra = {}, seconds = null) {
  return update(roomRef, {
    phase,
    phaseId: (state?.phaseId || 0) + 1,
    deadline: seconds ? Math.round(serverNow() + seconds * 1000) : null,
    ...extra,
  });
}

function onEnterPhase() {
  armFromDeadline();
  switch (state.phase) {
    case "lobby": lobbyQuietSince = Date.now(); lobbyNags = 0; wasReady = false; break;
    case "drawing": {
      const r = state.round, total = state.settings?.rounds || 1;
      Voice.say(r === 1 ? "empieza" : r === total ? "ultima" : "dibujo", { interrupt: true });
      break;
    }
    case "lying": Voice.say("mentir", { interrupt: true }); break;
    case "voting": Voice.say("votar", { interrupt: true }); break;
    case "reveal": runReveal(); break;
    case "scores": Voice.say("marcador", { interrupt: true }); break;
    case "end": Voice.say(winners().length > 1 ? "empate" : "ganador", { interrupt: true }); break;
  }
}

// El temporizador sale de la base de datos, así que si recargas la tele no se pierde.
function armFromDeadline() {
  clearTimeout(timer);
  if (!state.deadline) return;
  const pid = state.phaseId;
  const grace = ["drawing", "lying", "voting"].includes(state.phase) ? 1500 : 0;
  const ms = Math.max(0, state.deadline - serverNow()) + grace;
  timer = setTimeout(() => { if (state && state.phaseId === pid) advance(); }, ms);
}

function checkProgress() {
  const s = state;
  const act = active().map((p) => p.uid);
  if (s.phase === "lobby" && s.startRequested) {
    update(roomRef, { startRequested: null });
    if (canStart()) startGame();
    return;
  }
  if (s.phase === "drawing" && act.length && act.every((u) => s.drawings?.[u])) {
    if (advancedFor !== s.phaseId && s.deadline && s.deadline - serverNow() > 10000) Voice.say("rapidos");
    advance();
  }
  const judges = act.filter((u) => u !== s.current?.artist);
  if (s.phase === "lying" && judges.every((u) => s.lies?.[u])) advance();
  if (s.phase === "voting" && judges.every((u) => s.votes?.[u])) advance();
}

async function advance() {
  if (!state || advancedFor === state.phaseId) return;
  advancedFor = state.phaseId;
  clearTimeout(timer);
  const s = state;
  try {
    switch (s.phase) {
      case "drawing": return await startJudging();
      case "lying": return await startVoting();
      case "voting": return await startReveal();
      case "reveal": return await nextDrawing(s.queue || []);
      case "scores":
        return await (s.round < (s.settings?.rounds || 1) ? startRound(s.round + 1) : setPhase("end"));
    }
  } catch (e) {
    console.error(e);
    advancedFor = -1;
  }
}

function startGame() {
  const upd = {};
  for (const p of sortedPlayers(state)) upd[`players/${p.uid}/score`] = 0;
  usedPrompts = new Set();
  return startRound(1, upd);
}

function startRound(n, extra = {}) {
  const all = state.settings?.spicy ? [...SPICY_PROMPTS, ...SPICY_PROMPTS, ...PROMPTS] : PROMPTS;
  const pool = [...new Set(shuffle(all.filter((p) => !usedPrompts.has(p))))];
  const prompts = {};
  active().forEach((p, i) => {
    const t = pool[i % pool.length];
    prompts[p.uid] = t;
    usedPrompts.add(t);
  });
  return setPhase("drawing", {
    ...extra, round: n, prompts,
    drawings: null, lies: null, votes: null, options: null, results: null,
    current: null, queue: null, judgeTotal: null,
  }, state.settings.drawTime);
}

function startJudging() {
  const queue = shuffle(Object.keys(state.drawings || {}).filter((u) => state.prompts?.[u]));
  return nextDrawing(queue, queue.length);
}

function nextDrawing(queue, judgeTotal = state.judgeTotal || queue.length) {
  if (!queue.length) {
    return setPhase("scores", { current: null, queue: null, lies: null, votes: null, options: null, results: null }, 9);
  }
  const artist = queue[0];
  return setPhase("lying", {
    current: { artist, prompt: state.prompts[artist], index: judgeTotal - queue.length + 1, total: judgeTotal },
    queue: queue.slice(1), judgeTotal,
    lies: null, votes: null, options: null, results: null,
  }, state.settings.lieTime);
}

function startVoting() {
  const s = state;
  const truth = s.current.prompt;
  const nt = normalize(truth);
  // Mentiras iguales se juntan en una sola opción con varios autores.
  const groups = new Map();
  for (const [uid, text] of Object.entries(s.lies || {})) {
    const n = normalize(text);
    if (!n || n === nt) continue;
    if (!groups.has(n)) groups.set(n, { text: String(text).slice(0, 60), authors: [] });
    groups.get(n).authors.push(uid);
  }
  const opts = [{ id: "t", text: truth, kind: "truth" }];
  let i = 0;
  for (const g of groups.values()) opts.push({ id: `l${i++}`, text: g.text, kind: "lie", authors: g.authors });
  // Si hay pocas opciones, la casa mete alguna mentira propia.
  const used = new Set(opts.map((o) => normalize(o.text)));
  const assigned = new Set(Object.values(s.prompts || {}));
  const house = shuffle([...HOUSE_LIES, ...PROMPTS.filter((p) => !assigned.has(p))]);
  for (let h = 0; opts.length < 3 && h < house.length; h++) {
    const n = normalize(house[h]);
    if (used.has(n)) continue;
    used.add(n);
    opts.push({ id: `h${h}`, text: house[h], kind: "house" });
  }
  return setPhase("voting", { options: shuffle(opts), votes: null }, s.settings.voteTime);
}

function startReveal() {
  const s = state;
  const artist = s.current.artist;
  const byId = Object.fromEntries((s.options || []).map((o) => [o.id, { ...o, voters: [] }]));
  for (const [uid, id] of Object.entries(s.votes || {})) {
    const o = byId[id];
    if (o && uid !== artist && !(o.authors || []).includes(uid)) o.voters.push(uid);
  }
  // Puntos: acertar la verdad +1000 (y +500 al artista por cada acierto); colar tu mentira +500 por víctima.
  const gains = {};
  const add = (u, n) => { gains[u] = (gains[u] || 0) + n; };
  for (const o of Object.values(byId)) {
    for (const v of o.voters) {
      if (o.kind === "truth") { add(v, 1000); add(artist, 500); }
      else if (o.kind === "lie") for (const a of o.authors || []) add(a, 500);
    }
  }
  const fooled = Object.values(byId)
    .filter((o) => o.kind !== "truth" && o.voters.length)
    .sort((a, b) => a.voters.length - b.voters.length);
  const seq = [...fooled, byId.t];
  const upd = {};
  for (const [u, n] of Object.entries(gains)) upd[`players/${u}/score`] = (s.players?.[u]?.score || 0) + n;
  return setPhase("reveal", { ...upd, results: { seq, gains } }, (REVEAL_INTRO + seq.length * REVEAL_STEP) / 1000 + 2);
}

function playAgain() {
  Voice.say("otra", { interrupt: true });
  const upd = {
    phase: "lobby", phaseId: state.phaseId + 1, deadline: null, round: null, prompts: null,
    drawings: null, lies: null, votes: null, options: null, results: null,
    current: null, queue: null, judgeTotal: null, startRequested: null,
  };
  for (const p of sortedPlayers(state)) {
    upd[`players/${p.uid}/ready`] = false;
    upd[`players/${p.uid}/score`] = 0;
  }
  advancedFor = -1;
  return update(roomRef, upd);
}

/* ---------------- Pantallas ---------------- */

function renderPhase() {
  clearReveal();
  switch (state.phase) {
    case "lobby": return renderLobby();
    case "drawing": return renderDrawing();
    case "lying":
    case "voting": return renderJudge();
    case "reveal": return renderReveal();
    case "scores": return renderScores();
    case "end": return renderEnd();
  }
}

function updatePhase() {
  if (state.phase === "lobby") renderLobbyPlayers();
  else if (["drawing", "lying", "voting"].includes(state.phase)) renderProgress();
}

function joinURL() {
  const u = new URL("play.html", location.href);
  u.search = ""; u.hash = "";
  u.searchParams.set("room", code);
  return u.toString();
}

function renderLobby() {
  const url = joinURL();
  app.innerHTML = `
    <section class="lobby">
      <div class="join-box ${settings.hideCode ? "hidden-code" : ""}" id="join-box">
        <p class="room-code">Tu sala es <span>${code}</span></p>
        <div class="qr" id="qr"></div>
        <p class="join-text">Apunta con la cámara o entra en<br><b>${esc(url.replace(/^https?:\/\//, ""))}</b></p>
        ${settings.hideCode ? `<button class="btn ghost small" id="reveal-code">Mostrar código</button>` : ""}
      </div>
      <div class="lobby-side">
        <h2>Jugadores <small id="count"></small></h2>
        <div class="players" id="players"></div>
        <ol class="howto">
          <li><b>1</b> Te toca una frase secreta y la dibujas en tu móvil.</li>
          <li><b>2</b> Los demás ven tu dibujo e inventan un título falso.</li>
          <li><b>3</b> Todos votan cuál era el título de verdad.</li>
          <li><b>4</b> Puntos por acertar y por colar tu mentira. Dibujar mal nunca resta.</li>
        </ol>
        <p class="lobby-status" id="lobby-status"></p>
        <div class="row">
          <button class="btn big" id="start">Empezar</button>
          <button class="btn ghost" id="exit">Salir</button>
        </div>
      </div>
    </section>`;
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  $("#qr").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  $("#start").onclick = () => { if (canStart()) startGame(); };
  $("#exit").onclick = showMenu;
  const rc = $("#reveal-code");
  if (rc) rc.onclick = () => { $("#join-box").classList.toggle("hidden-code"); rc.textContent = $("#join-box").classList.contains("hidden-code") ? "Mostrar código" : "Ocultar código"; };
  renderLobbyPlayers();
  ($("#start").disabled ? $("#exit") : $("#start")).focus();
}

function renderLobbyPlayers() {
  const el = $("#players");
  if (!el) return;
  const ps = sortedPlayers(state);
  const slots = Math.max(0, 3 - ps.length);
  el.innerHTML = ps.map((p) => `
      <div class="pcard ${p.connected === false ? "off" : ""} ${p.ready ? "ready" : ""}">
        ${avatarHTML(p)}<span class="pname">${esc(p.name)}</span>
        <span class="badge">${p.connected === false ? "Desconectado" : p.ready ? "¡Listo!" : "Dibujándose…"}</span>
      </div>`).join("") + ["○", "△", "□"].slice(3 - slots).map((s) => `
      <div class="pcard slot"><div class="avatar empty">${s}</div><span class="pname">Hace falta</span></div>`).join("");
  const n = active().length;
  const ok = canStart();
  $("#count").textContent = `${ps.length} de ${MAX_PLAYERS}`;
  const wasDisabled = $("#start").disabled;
  $("#start").disabled = !ok;
  if (wasDisabled && ok && document.activeElement === $("#exit")) $("#start").focus();
  $("#lobby-status").textContent = n < MIN_PLAYERS
    ? `Hacen falta al menos ${MIN_PLAYERS} jugadores (con 3 o más tiene mucha más gracia).`
    : ok ? "Todo el mundo está listo. ¡Dale!" : "Esperando a que todos pulsen «¡Estoy listo!» en el móvil.";
}

function renderDrawing() {
  app.innerHTML = `
    <section class="stage">
      <header class="stage-head">
        <h2>¡A dibujar! <small>Ronda ${state.round} de ${state.settings.rounds}</small></h2>
        <div class="timer" data-timer></div>
      </header>
      <p class="stage-sub">Mirad el móvil: cada uno tiene una frase secreta.</p>
      <div class="players progress" id="progress"></div>
    </section>`;
  renderProgress();
}

function renderProgress() {
  const s = state;
  const el = $("#progress");
  if (!el) return;
  let list = active();
  let done;
  if (s.phase === "drawing") done = (u) => !!s.drawings?.[u];
  else {
    list = list.filter((p) => p.uid !== s.current?.artist);
    done = s.phase === "lying" ? (u) => !!s.lies?.[u] : (u) => !!s.votes?.[u];
  }
  el.innerHTML = list.map((p) => `
    <div class="pcard small ${done(p.uid) ? "done" : ""}">
      ${avatarHTML(p)}<span class="pname">${esc(p.name)}</span>
      <span class="badge">${done(p.uid) ? "✓" : "…"}</span>
    </div>`).join("");
}

function artworkHTML() {
  const s = state;
  const a = s.players?.[s.current.artist];
  return `
    <figure class="artwork">
      <img src="${safeImg(s.drawings?.[s.current.artist])}" alt="">
      <figcaption>${avatarHTML(a, "tiny")} Obra de ${esc(a?.name || "?")}</figcaption>
    </figure>`;
}

function renderJudge() {
  const s = state;
  const voting = s.phase === "voting";
  app.innerHTML = `
    <section class="stage judge">
      <header class="stage-head">
        <h2>${voting ? "¿Cuál es la verdad?" : "¿Qué demonios es esto?"}
          <small>Dibujo ${s.current.index} de ${s.current.total}</small></h2>
        <div class="timer" data-timer></div>
      </header>
      <div class="judge-body">
        ${artworkHTML()}
        <div class="judge-side">
          ${voting
            ? `<ol class="options">${(s.options || []).map((o) => `<li>${esc(o.text)}</li>`).join("")}</ol>`
            : `<p class="stage-sub">Escribid en el móvil un título falso que engañe a los demás.</p>`}
          <div class="players progress" id="progress"></div>
        </div>
      </div>
    </section>`;
  renderProgress();
}

function renderReveal() {
  const s = state;
  app.innerHTML = `
    <section class="stage judge">
      <header class="stage-head"><h2>Resultados <small>Dibujo ${s.current.index} de ${s.current.total}</small></h2></header>
      <div class="judge-body">
        ${artworkHTML()}
        <div class="judge-side"><div id="reveal-card" class="reveal-card"></div></div>
      </div>
    </section>`;
}

function clearReveal() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
}

function runReveal() {
  clearReveal();
  Voice.say("suspense", { interrupt: true });
  const pid = state.phaseId;
  (state.results?.seq || []).forEach((o, i) => {
    revealTimers.push(setTimeout(() => {
      if (state?.phaseId !== pid) return;
      renderRevealCard(o);
      speakReveal(o);
    }, REVEAL_INTRO + i * REVEAL_STEP));
  });
}

function renderRevealCard(o) {
  const s = state;
  const el = $("#reveal-card");
  if (!el) return;
  const voters = (o.voters || []).map((u) => s.players?.[u]).filter(Boolean);
  let verdict;
  if (o.kind === "truth") {
    verdict = `<p class="verdict truth">¡LA VERDAD!</p>` + (voters.length
      ? `<p class="points">+1000 a quien acertó · +${500 * voters.length} para ${esc(nameOf(s.current.artist))}</p>`
      : `<p class="points">Nadie acertó. Ni el artista sabría qué dibujó.</p>`);
  } else if (o.kind === "lie") {
    const names = (o.authors || []).map((u) => esc(nameOf(u))).join(" y ");
    verdict = `<p class="verdict lie">Mentira de ${names}</p><p class="points">+${500 * voters.length} puntos</p>`;
  } else {
    verdict = `<p class="verdict lie">Mentira de la casa</p><p class="points">Aquí no gana nadie. Bueno, yo.</p>`;
  }
  el.innerHTML = `
    <div class="rc-inner pop ${o.kind}">
      <p class="rc-text">«${esc(o.text)}»</p>
      <div class="voters">${voters.map((p) => `<span class="voter">${avatarHTML(p, "tiny")}${esc(p.name)}</span>`).join("")
        || `<span class="muted">Nadie lo votó</span>`}</div>
      ${verdict}
    </div>`;
}

function speakReveal(o) {
  const n = (o.voters || []).length;
  if (o.kind === "lie") return Voice.say(n >= 2 ? "coloMuchos" : "colo");
  if (o.kind === "house") return Voice.say("casa");
  const judges = active().filter((p) => p.uid !== state.current?.artist).length;
  Voice.say(n === 0 ? "nadie" : n >= 2 && n === judges ? "todos" : "verdad");
}

function boardHTML(list, offset = 0) {
  const max = Math.max(1, ...ranking().map((p) => p.score || 0));
  return list.map((p, i) => `
    <div class="brow">
      <span class="pos">${i + 1 + offset}</span>${avatarHTML(p, "tiny")}
      <span class="pname">${esc(p.name)}</span>
      <div class="bar"><div style="width:${Math.round(100 * (p.score || 0) / max)}%"></div></div>
      <span class="score">${p.score || 0}</span>
    </div>`).join("");
}

function renderScores() {
  app.innerHTML = `
    <section class="stage">
      <header class="stage-head"><h2>Clasificación <small>Ronda ${state.round} de ${state.settings.rounds}</small></h2></header>
      <div class="board">${boardHTML(ranking())}</div>
    </section>`;
}

function winTitle() {
  const w = winners();
  if (!w.length) return "¡Gana nadie!";
  if (w.length === 1) return `¡Gana ${esc(w[0].name)}!`;
  return `¡Empate entre ${w.map((p) => esc(p.name)).join(" y ")}!`;
}

function renderEnd() {
  const r = ranking();
  app.innerHTML = `
    <section class="stage end">
      <h2 class="winner-title">${winTitle()}</h2>
      <div class="podium">${r.slice(0, 3).map((p, i) => `
        <div class="pod p${i + 1}">${avatarHTML(p)}<span class="pname">${esc(p.name)}</span>
          <span class="score">${p.score || 0}</span><div class="block">${i + 1}</div></div>`).join("")}
      </div>
      <div class="board compact">${boardHTML(r.slice(3), 3)}</div>
      <div class="row center">
        <button class="btn big" id="again">Otra partida</button>
        <button class="btn ghost" id="menu">Menú</button>
      </div>
    </section>`;
  $("#again").onclick = playAgain;
  $("#menu").onclick = () => { Voice.say("adios", { interrupt: true }); showMenu(); };
}

// Cuenta atrás en pantalla.
setInterval(() => {
  if (!state) return;
  if (state.phase === "lobby") return lobbyCues();
  if (!state.deadline) return;
  const secs = Math.max(0, Math.ceil((state.deadline - serverNow()) / 1000));
  const t = document.querySelector("[data-timer]");
  if (t) {
    t.textContent = secs;
    t.classList.toggle("hurry", secs <= 10);
  }
  timeCues(secs);
}, 250);

// Avisos de Lola según el reloj: mitad del tiempo y últimos segundos.
function timeCues(secs) {
  const s = state;
  if (cues.pid !== s.phaseId) cues = { pid: s.phaseId, half: false, last10: false };
  const total = { drawing: s.settings.drawTime, lying: s.settings.lieTime, voting: s.settings.voteTime }[s.phase];
  if (!total) return;
  if (s.phase === "drawing" && !cues.half && total >= 60 && secs <= total / 2 && secs > 15) {
    cues.half = true;
    Voice.say("mitad");
  }
  if (!cues.last10 && secs <= 10 && secs > 3) {
    cues.last10 = true;
    Voice.say({ drawing: "ultimosDibujo", lying: "prisaMentir", voting: "prisaVotar" }[s.phase]);
  }
}

// En la sala: avisa cuando todos están listos y da la lata si nadie empieza.
function lobbyCues() {
  const ready = canStart();
  if (ready && !wasReady) { Voice.say("listos"); lobbyQuietSince = Date.now(); }
  wasReady = ready;
  if (!ready && sortedPlayers(state).length && lobbyNags < 3 && Date.now() - lobbyQuietSince > 45000) {
    lobbyNags++;
    lobbyQuietSince = Date.now();
    Voice.say("espera");
  }
}

async function boot() {
  const saved = sessionStorage.getItem("gt_room");
  if (saved) {
    try {
      me = await login();
      const s = await get(ref(db, `rooms/${saved}`));
      if (s.exists() && s.val().host === me.uid) {
        code = saved;
        listen();
        return;
      }
    } catch (e) { console.error(e); }
    sessionStorage.removeItem("gt_room");
  }
  showMenu();
}

boot();
