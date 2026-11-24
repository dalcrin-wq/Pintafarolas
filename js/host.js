// Pantalla grande (tele/ordenador). Es el árbitro: decide cuándo cambia cada fase.
import { login, db, ref, set, update, get, onValue, remove, serverTimestamp, serverNow } from "./firebase.js";
import { PROMPTS, SPICY_PROMPTS, HOUSE_LIES } from "./prompts.js";
import { Voice } from "./voice.js";
import { Music } from "./music.js";
import { Sfx } from "./sfx.js";
import { startPainter, setScene } from "./painter.js";
import { startMotion, refreshGradients } from "./motion.js";
import { computeAwards } from "./awards.js";

// Se ve en el menú: así se sabe de un vistazo si la tele tiene la última versión.
const VERSION = "24 nov · 15:10";
import { $, esc, shuffle, normalize, randCode, safeImg, avatarHTML, sortedPlayers } from "./util.js";

export const TITLE = "Garabatrola";
const DEFAULTS = { pace: "normal", spicy: false, canvas: "comodo", hideCode: false, music: true, voice: true, sfx: true };
// Ritmo: segundos para dibujar, mentir y votar.
const PACES = {
  normal: { draw: 75, lie: 40, vote: 25 },
  relajado: { draw: 100, lie: 55, vote: 35 },
  tranquilo: { draw: 130, lie: 75, vote: 45 },
};
const MIN_PLAYERS = 2;
// Rondas automáticas, como el original: con poca gente se juegan más rondas,
// con mucha, menos (cada ronda ya trae un dibujo por jugador).
const rondasPara = (n) => (n <= 3 ? 3 : n <= 6 ? 2 : 1);
const MAX_PLAYERS = 10;
// El destape, por actos (ms). Ver revealPlan().
// Cada mentira que coló y la verdad llevan redoble delante (REDOBLE ms) antes de saltar al centro.
const REDOBLE = 2600;
const RV = { intro: 1900, fuera: 3400, lie: 6200, truth: 7000, points: 3600, sum: 5400 };

const app = $("#app");
let settings = loadSettings();
let me = null, code = null, roomRef = null, state = null, unsub = null;
let endLive = false;
let tickedAt = "";
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
  return { drawTime: p.draw, lieTime: p.lie, voteTime: p.vote, spicy: !!settings.spicy, canvas: settings.canvas };
}
function saveSettings() {
  try { localStorage.setItem("gt_settings", JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
}

// El navegador no deja sonar nada hasta el primer toque.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  Sfx.preload();
  if (settings.music) Music.start();
  // Como en la tele: base suave mientras saluda, y al callarse entra el bombo.
  if (viewKey === "menu") { Music.calmUntilVoiceEnds(); Voice.say("menu"); }
}
document.addEventListener("pointerdown", unlockAudio);

// Cada botón de la tele hace «pop» (y Jugar, su «ta-da»: lo pone su propio manejador).
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled || b.id === "play" || b.id === "mute") return;
  Sfx.play("click");
}, true);

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
// Silencio general (botón fijo abajo a la izquierda, o la tecla M). No toca los ajustes:
// al quitarlo, vuelve lo que hubiera (música, voz y efectos según Ajustes).
let muted = false;
try { muted = localStorage.getItem("gt_muted") === "1"; } catch { /* sin almacenamiento */ }
const muteBtn = $("#mute");
function applySound() {
  Music.setMuted(muted);
  Voice.setEnabled(settings.voice && !muted);
  Sfx.setEnabled(settings.sfx !== false && !muted);
  if (muteBtn) {
    muteBtn.textContent = muted ? "🔇 Sin sonido" : "🔊 Sonido";
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.classList.toggle("off", muted);
  }
}
function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("gt_muted", muted ? "1" : "0"); } catch { /* da igual */ }
  applySound();
}
if (muteBtn) muteBtn.onclick = (e) => { e.stopPropagation(); unlockAudio(); toggleMute(); };
document.addEventListener("keydown", (e) => {
  if ((e.key === "m" || e.key === "M") && !e.target.closest?.("input, textarea")) toggleMute();
});
applySound();

const nameOf = (uid) => state?.players?.[uid]?.name || "alguien";
const active = () => sortedPlayers(state).filter((p) => p.connected !== false);
const ranking = () => sortedPlayers(state).sort((a, b) => (b.score || 0) - (a.score || 0));
const winners = () => { const r = ranking(); const top = r[0]?.score || 0; return r.filter((p) => (p.score || 0) === top); };
const canStart = () => { const a = active(); return a.length >= MIN_PLAYERS && a.every((p) => p.ready); };

/* ---------------- Menú y ajustes ---------------- */

function showMenu() {
  leaveRoom();
  viewKey = "menu";
  setScene("menu");
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
      <p class="hint small version">versión ${VERSION}</p>
    </section>`;
  $("#play").onclick = () => { unlockAudio(); Sfx.play("jugar"); createRoom(); };
  $("#cfg").onclick = () => { unlockAudio(); Voice.say("ajustes"); showSettings(); };
  $("#play").focus();
}

const SETTING_ROWS = [
  { key: "pace", label: "Ritmo", help: "Cuánto dura cada reloj: dibujar, mentir y votar.",
    options: [["normal", "Normal"], ["relajado", "Relajado"], ["tranquilo", "Tranquilo"]] },
  { key: "spicy", label: "Frases gamberras", help: "Para adultos dispuestos a dibujar cosas difíciles de justificar.",
    options: [[false, "No"], [true, "Sí"]] },
  { key: "canvas", label: "Lienzo", help: "Clásico = sin deshacer ni goma: el error se queda, y de ahí sale media comedia.",
    options: [["comodo", "Cómodo"], ["clasico", "Clásico"]] },
  { key: "hideCode", label: "Ocultar código de sala", help: "Tapa el código y el QR en la sala, por si retransmites la partida.",
    options: [[false, "No"], [true, "Sí"]] },
  { key: "music", label: "Música", help: "", options: [[true, "Sí"], [false, "No"]] },
  { key: "voice", label: "Voz de Lola", help: "", options: [[true, "Sí"], [false, "No"]] },
  { key: "sfx", label: "Efectos de sonido", help: "Botones, entradas, batacazos y aplausos.", options: [[true, "Sí"], [false, "No"]] },
];

function showSettings() {
  viewKey = "settings";
  setScene("settings");
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
    if (b.dataset.key === "music") settings.music ? Music.start() : Music.stop();
    applySound();
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
    // ¿Veníamos de la partida (gala en directo) o es una recarga en mitad del final?
    endLive = /^(drawing|lying|voting|reveal|scores)\|/.test(viewKey);
    viewKey = key;
    setScene(state.phase);
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
      if (primed && state.phase === "lobby") { Sfx.play("entra"); Voice.say("entra", { ifIdle: true }); }
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
    case "lobby": Music.partySoon(); lobbyQuietSince = Date.now(); lobbyNags = 0; wasReady = false; break;
    case "drawing": {
      const r = state.round, total = state.settings?.rounds || 1;
      Voice.say(r === 1 ? "empieza" : r === total ? "ultima" : "dibujo", { interrupt: true });
      // Recién empezada (no al recargar a mitad): el reparto con su tic-tic-tic; luego la música.
      if (state.deadline - serverNow() > (state.settings.drawTime - 3) * 1000) runReparto();
      else app.querySelectorAll(".hoja").forEach((h) => h.classList.add("cuelga"));
      if (!$("#reparto") || $("#reparto").hidden) Music.play("dibujo");
      break;
    }
    case "lying": {
      Music.play("intriga");
      // La voz entra cuando acaba de repintarse el dibujo (renderJudge); si es una recarga, ya.
      if (state.deadline - serverNow() <= (state.settings.lieTime - 3) * 1000) Voice.say("mentir", { interrupt: true });
      break;
    }
    case "voting": Voice.say("votar", { interrupt: true }); break;
    case "reveal": Music.play("fiesta"); runReveal(); break;
    // Marcador y final: música de fiesta (la voz la baja mientras habla).
    case "scores": Music.play("fiesta"); Sfx.play("aplausos"); Voice.say("marcador", { interrupt: true }); break;
    case "end": Music.play("fiesta"); break; // la gala (renderEnd) pone voz y efectos
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
  upd["settings/rounds"] = rondasPara(active().length);
  Object.assign(upd, { gallery: null, likes: null, galaDone: null });
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
    drawings: null, drawStats: null, trazos: null, lies: null, votes: null, options: null, results: null,
    current: null, queue: null, judgeTotal: null,
  }, state.settings.drawTime);
}

function startJudging() {
  const queue = shuffle(Object.keys(state.drawings || {}).filter((u) => state.prompts?.[u]));
  return nextDrawing(queue, queue.length);
}

function nextDrawing(queue, judgeTotal = state.judgeTotal || queue.length) {
  if (!queue.length) {
    if ((state.round || 1) < (state.settings?.rounds || 1)) return startRound(state.round + 1);
    return setPhase("end", { current: null, queue: null, lies: null, votes: null, options: null, results: null });
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
  const prev = {};
  for (const p of sortedPlayers(s)) prev[p.uid] = p.score || 0;
  const opts = (s.options || []).map((o) => byId[o.id]);
  const results = { opts, gains, prev, last: !(s.queue || []).length, round: s.round, rounds: s.settings?.rounds || 1 };
  const upd = {};
  for (const [u, n] of Object.entries(gains)) upd[`players/${u}/score`] = (s.players?.[u]?.score || 0) + n;
  // Para los premios del final: un registro por dibujo.
  const st = s.drawStats?.[artist] || {};
  const fooled = {}, gulped = {}, mentiras = [];
  for (const o of opts) {
    if (o.kind === "truth") continue;
    for (const v of o.voters) gulped[v] = o.text; // qué se creyó cada uno
    if (o.kind === "lie" && o.voters.length) {
      for (const a of o.authors || []) fooled[a] = (fooled[a] || 0) + o.voters.length;
      mentiras.push({ text: o.text, authors: o.authors || [], votes: o.voters.length });
    }
  }
  upd[`gallery/${s.round}_${artist}`] = {
    artist, round: s.round, img: s.drawings?.[artist] || "", prompt: s.prompts?.[artist] || "",
    strokes: st.strokes ?? null, inks: st.inks ?? null,
    truthVotes: opts.find((o) => o.kind === "truth")?.voters.length || 0,
    voters: Object.keys(s.votes || {}).filter((u) => u !== artist).length,
    fooled, gulped, mentiras,
  };
  return setPhase("reveal", { ...upd, results }, revealPlan(results).total / 1000 + 0.5);
}

// Cronograma del destape: 1) fuera las mentiras que no votó nadie, 2) una a una las que
// colaron, 3) la verdad, 4) puntos de este dibujo, 5) se suman a la clasificación.
function revealPlan(r) {
  // Firebase no guarda listas vacías: las recuperamos.
  const opts = Object.values(r?.opts || {}).map((o) => ({ ...o, voters: Object.values(o.voters || {}), authors: Object.values(o.authors || {}) }));
  const unpicked = opts.filter((o) => o.kind !== "truth" && !o.voters.length);
  const fooled = opts.filter((o) => o.kind !== "truth" && o.voters.length).sort((a, b) => a.voters.length - b.voters.length);
  const truth = opts.find((o) => o.kind === "truth");
  const steps = [];
  let t = RV.intro;
  if (unpicked.length) { steps.push({ at: t, act: "fuera", list: unpicked }); t += RV.fuera; }
  for (const o of fooled) { steps.push({ at: t, act: "lie", o }); t += RV.lie; }
  steps.push({ at: t, act: "truth", o: truth }); t += RV.truth;
  steps.push({ at: t, act: "points" }); t += RV.points;
  steps.push({ at: t, act: "sum" }); t += RV.sum;
  return { steps, total: t };
}

function playAgain() {
  Voice.say("otra", { interrupt: true });
  const upd = {
    phase: "lobby", phaseId: state.phaseId + 1, deadline: null, round: null, prompts: null,
    drawings: null, trazos: null, lies: null, votes: null, options: null, results: null,
    current: null, queue: null, judgeTotal: null, startRequested: null,
    gallery: null, likes: null, galaDone: null, drawStats: null,
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
    case "reveal": renderReveal(); return renderLikes();
    case "scores": return renderScores();
    case "end": return renderEnd();
  }
}

function updatePhase() {
  if (state.phase === "lobby") renderLobbyPlayers();
  else if (["drawing", "lying", "voting"].includes(state.phase)) renderProgress();
  else if (state.phase === "reveal") renderLikes();
}

// ♥ que llegan desde los móviles durante el destape.
function renderLikes() {
  const el = $("#likes");
  if (!el || !state.current) return;
  const n = Object.keys(state.likes?.[`${state.round}_${state.current.artist}`] || {}).length;
  if (String(n) === el.dataset.n) return;
  el.dataset.n = n;
  el.hidden = !n;
  el.textContent = `♥ ${n}`;
  el.animate([{ transform: "scale(1.6) rotate(-8deg)" }, { transform: "scale(1) rotate(4deg)" }], { duration: 450, easing: "cubic-bezier(.2,1.6,.5,1)" });
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
    : (ok ? "Todo el mundo está listo. ¡Dale!" : "Esperando a que todos pulsen «¡Estoy listo!» en el móvil.")
      + ` Con ${n} jugadores: ${rondasPara(n)} ${rondasPara(n) === 1 ? "ronda" : "rondas"}, ${n * rondasPara(n)} dibujos.`;
}

// ---------- Dibujar: tendedero con una hoja por jugador ----------
const CHISTES = [
  "Los palitos también cuentan como arte.",
  "Aquí dibujar mal no resta. Mentir mal, sí.",
  "Si no sabes dibujarlo, dibuja otra cosa con seguridad.",
  "Un círculo y dos rayas: ya es una persona.",
  "Picasso también empezó así. Más o menos.",
  "Cuanto más raro, más fácil colar una mentira.",
  "Las flechas y las palabras están prohibidas. Las intenciones, no.",
  "Nadie va a enmarcar esto. Tranquilidad.",
  "El tiempo corre. El talento, no tanto.",
  "Pista: los demás tampoco saben dibujar.",
];
const hue = (uid = "") => { let h = 7; for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
const GARABATOS = [
  "M14 40 C 30 10, 44 70, 60 34 S 84 20, 90 46",
  "M18 30 L 40 62 L 54 24 L 76 58 L 88 30",
  "M20 50 C 20 20, 60 20, 56 46 S 30 70, 52 70 S 86 52, 84 30",
];
let chisteTimer = null;

function renderDrawing() {
  const ps = active();
  app.innerHTML = `
    <section class="stage dibujo">
      <header class="dib-head">
        <p class="dib-ronda">Ronda ${state.round} de ${state.settings.rounds}</p>
        <h2 id="dib-titulo">Todos a dibujar</h2>
        <div class="timer" data-timer></div>
      </header>
      <div class="tendedero" style="--n:${ps.length}">
        <svg class="cuerda" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 8 Q 500 70 1000 8"/></svg>
        <div class="hojas">${ps.map((p, i) => `
          <figure class="hoja" data-uid="${p.uid}" style="--rot:${(i % 2 ? 1 : -1) * (1.5 + (i % 3))}deg; --h:${hue(p.uid)}; --d:${(i * 0.09).toFixed(2)}s">
            <span class="pinza"></span>
            <div class="papel">
              <div class="cara frente"><svg viewBox="0 0 100 90" aria-hidden="true"><path d="${GARABATOS[i % GARABATOS.length]}"/></svg></div>
              <div class="cara dorso"><span class="check">✓</span></div>
            </div>
            <figcaption>${avatarHTML(p, "tiny")} ${esc(p.name)}</figcaption>
          </figure>`).join("")}
        </div>
      </div>
      <div class="entregas"><div class="entregas-barra"><i id="entregas-i"></i></div><span id="entregas-n"></span></div>
      <p class="chiste" id="chiste">${CHISTES[Math.floor(Math.random() * CHISTES.length)]}</p>
      <div class="lapiz" aria-hidden="true"><div class="lapiz-cuerpo" id="lapiz"><span class="lapiz-goma"></span></div><span class="lapiz-punta"></span></div>
      <div class="reparto" id="reparto" hidden></div>
    </section>`;
  clearInterval(chisteTimer);
  chisteTimer = setInterval(() => {
    const el = $("#chiste");
    if (!el) return clearInterval(chisteTimer);
    el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-8px)" }], { duration: 350, fill: "forwards" }).onfinish = () => {
      el.textContent = CHISTES[Math.floor(Math.random() * CHISTES.length)];
      el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 350, fill: "forwards" });
    };
  }, 7000);
  renderProgress(true);
}

// Reparto de frases al empezar la ronda: las hojas «vuelan» a su sitio, tic-tic-tic y a dibujar.
function runReparto() {
  const box = $("#reparto");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="reparto-carta"><p class="reparto-k">Ronda ${state.round} de ${state.settings.rounds}</p>
    <p class="reparto-t">Repartiendo frases secretas</p><p class="reparto-dots"><i></i><i></i><i></i></p></div>`;
  Sfx.play("entrega");
  const dots = box.querySelectorAll(".reparto-dots i");
  [0, 1, 2].forEach((i) => later2(500 + i * 420, () => { dots[i]?.classList.add("on"); Sfx.play("tic"); }));
  later2(1900, () => {
    box.classList.add("fuera");
    Sfx.play("revelar");
    app.querySelectorAll(".hoja").forEach((h, i) => later2(i * 90, () => { h.classList.add("cuelga"); Sfx.play("pop", { vol: 0.7 }); }));
  });
  later2(2500, () => { box.hidden = true; Music.play("dibujo"); });
}

function later2(ms, fn) {
  const pid = state.phaseId;
  revealTimers.push(setTimeout(() => { if (state?.phaseId === pid) fn(); }, ms));
}

function renderProgress(first = false) {
  const s = state;
  if (s.phase === "drawing") return renderHojas(first);
  const el = $("#progress");
  if (!el) return;
  let list = active();
  let done;
  if (s.phase === "drawing") done = (u) => !!s.drawings?.[u];
  else {
    list = list.filter((p) => p.uid !== s.current?.artist);
    done = s.phase === "lying" ? (u) => !!s.lies?.[u] : (u) => !!s.votes?.[u];
  }
  const n = list.filter((p) => done(p.uid)).length;
  const prev = +(el.dataset.n || 0);
  if (!first && n > prev) Sfx.play("entrega");
  el.dataset.n = n;
  el.innerHTML = list.map((p) => `
    <span class="chip ${done(p.uid) ? "hecho" : ""}" style="--h:${hue(p.uid)}">${avatarHTML(p, "tiny")}${esc(p.name)}${done(p.uid) ? " ✓" : ""}</span>`).join("");
  const c = $("#cuenta");
  if (c) c.innerHTML = `<b>${n} de ${list.length}</b> ${s.phase === "lying" ? "han escrito su mentira" : "ya han votado"}`;
}

function renderHojas(first) {
  const s = state;
  const ps = active();
  const done = ps.filter((p) => s.drawings?.[p.uid]);
  const faltan = ps.filter((p) => !s.drawings?.[p.uid]);
  for (const p of ps) {
    const h = app.querySelector(`.hoja[data-uid="${p.uid}"]`);
    if (!h) continue;
    const ok = !!s.drawings?.[p.uid];
    if (ok && !h.classList.contains("entregada")) {
      h.classList.add("entregada");
      if (!first) Sfx.play("entrega");
    }
  }
  const t = $("#dib-titulo");
  if (t) {
    const nombres = (l) => l.map((p) => `<span class="nom" style="--h:${hue(p.uid)}">${esc(p.name)}</span>`);
    const html = !done.length ? "Todos a dibujar"
      : !faltan.length ? "¡Todos han entregado!"
      : faltan.length > 3 ? `Faltan ${faltan.length}`
      : `${faltan.length === 1 ? "Falta" : "Faltan"} ${nombres(faltan).join(faltan.length === 2 ? " y " : ", ").replace(/, ([^,]*)$/, " y $1")}`;
    if (t.dataset.html !== html) { t.dataset.html = html; t.innerHTML = html; }
  }
  const i = $("#entregas-i"), n = $("#entregas-n");
  if (i) i.style.width = `${(100 * done.length) / Math.max(1, ps.length)}%`;
  if (n) n.textContent = `${done.length} de ${ps.length}`;
}

// La cartela de museo: cada obra con su técnica (siempre la misma para el mismo dibujo).
const TECHNIQUES = [
  "Óleo sobre móvil", "Dedo sobre cristal", "Técnica mixta: prisa y fe", "Pulgar sobre pantalla",
  "Garabato al temple", "Escuela de la servilleta", "Acuarela sin agua", "Realismo optimista",
  "Expresionismo de sofá", "Arte conceptual (muy conceptual)",
  "Huella dactilar con grasa de patatas", "Temple de pulgar sudado", "Óleo de autobús en marcha",
  "Rotulador seco sobre ilusión", "Grafito imaginario", "Pixel sobre esperanza", "Técnica de la abuela con prisa",
  "Barroco de sobremesa", "Cubismo involuntario", "Surrealismo de lunes", "Impresionismo con temblor",
  "Minimalismo por falta de tiempo", "Escuela del margen del cuaderno", "Arte rupestre digital",
  "Óleo sobre excusa", "Carboncillo de barbacoa", "Expresionismo abstracto (sin querer)", "Puntillismo nervioso",
  "Fresco de nevera", "Mural de puerta de baño", "Retrato robot de comisaría", "Garabato de llamada telefónica",
  "Técnica del dedo meñique", "Pastel sin azúcar", "Realismo mágico (más mágico que real)", "Escuela de la cola del súper",
  "Arte povera, muy povera", "Neoclasicismo de ascensor", "Dadaísmo de grupo de WhatsApp", "Pop art de mercadillo",
  "Gótico flamígero de pupitre", "Naíf de autoescuela", "Vanguardia de sobremesa larga", "Romanticismo con prisas",
  "Tinta china del bazar", "Acrílico emocional", "Bodegón con hambre", "Paisaje de memoria (mala)",
  "Escuela de Altamira, sucursal móvil", "Óleo sobre pantalla rota", "Grafiti de servilleta de bar", "Hiperrealismo fallido",
];
function technique(uid = "", round = 1) {
  let h = round * 31;
  for (const ch of uid) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return TECHNIQUES[h % TECHNIQUES.length];
}

function artworkHTML({ canvas = false, secreto = false } = {}) {
  const s = state;
  const a = s.players?.[s.current.artist];
  return `
    <figure class="artwork">
      ${canvas ? `<canvas class="obra" width="360" height="360"></canvas>` : `<img src="${safeImg(s.drawings?.[s.current.artist])}" alt="">`}
      <figcaption class="cartela">
        <span class="c-autor">${secreto ? `<span class="avatar tiny incognito">?</span> Autor desconocido` : `${avatarHTML(a, "tiny")} ${esc(a?.name || "Anónimo")}`}</span>
        <span class="c-tecnica">${technique(s.current.artist, s.round)}, ${new Date().getFullYear()}</span>
      </figcaption>
      ${s.phase === "reveal" ? `<span class="likes" id="likes" hidden></span>` : ""}
    </figure>`;
}

// ---------- Mentir y votar: el dibujo en el centro de la mesa ----------
const SE_DESCUBRE = ["Agarraos a la silla", "Que nadie se ría todavía", "Atención: arte", "Respirad hondo", "Sin juzgar. Bueno, un poco"];

function opcionHTML(o, n) {
  return `<li class="opcion" data-id="${o.id}" style="--i:${n}"><span class="num">${n + 1}</span><span class="txt">${esc(o.text)}</span>
    <span class="opt-voters"></span><span class="stamp"></span><span class="gain-badge"></span></li>`;
}

function mesaHTML({ voting, reveal = false }) {
  const s = state;
  const opts = voting ? (reveal ? Object.values(s.results?.opts || {}) : s.options || []) : [];
  const orden = (s.options || []).map((o) => o.id);
  const num = (o) => Math.max(0, orden.indexOf(o.id));
  const izq = opts.filter((_, i) => i % 2 === 0), der = opts.filter((_, i) => i % 2 === 1);
  return `
    <section class="stage mesa ${reveal ? "destapando" : voting ? "votando" : "mintiendo"}">
      <header class="mesa-head">
        <h2>¿Qué es esto?</h2>
        <p class="mesa-sub" id="mesa-sub">${reveal ? "Se acabó: a ver quién ha picado" : voting ? "Uno es verdad · votad en el móvil" : `Dibujo ${s.current.index} de ${s.current.total}`}</p>
        ${reveal ? "" : `<div class="timer" data-timer></div>`}
      </header>
      <div class="mesa-cuerpo">
        <ol class="col izq">${izq.map((o) => opcionHTML(o, num(o))).join("")}</ol>
        <div class="centro">${artworkHTML({ canvas: !voting && !reveal, secreto: true })}<p class="pintando" id="pintando"></p></div>
        <ol class="col der">${der.map((o) => opcionHTML(o, num(o))).join("")}</ol>
      </div>
      ${reveal ? `<p class="reveal-caption" id="reveal-caption"></p>` : `
      <div class="mesa-pie"><p class="cuenta" id="cuenta"></p><div class="chips" id="progress"></div></div>
      <div class="lapiz" aria-hidden="true"><div class="lapiz-cuerpo" id="lapiz"><span class="lapiz-goma"></span></div><span class="lapiz-punta"></span></div>`}
      <div class="descubre" id="descubre" hidden></div>
    </section>`;
}

function renderJudge() {
  const voting = state.phase === "voting";
  app.innerHTML = mesaHTML({ voting });
  renderProgress(true);
  const fresh = state.deadline - serverNow() > ((voting ? state.settings.voteTime : state.settings.lieTime) - 3) * 1000;
  if (voting) {
    if (fresh) {
      app.querySelectorAll(".opcion").forEach((li, i) => {
        li.classList.add("espera");
        later2(900 + i * 110, () => { li.classList.remove("espera"); li.classList.add("aparece"); Sfx.play("pop"); });
      });
    }
    return;
  }
  const cv = app.querySelector("canvas.obra");
  const trazos = state.trazos?.[state.current.artist];
  if (!fresh) return pintarFinal(cv);
  // Intro: «Se descubre el dibujo» · tic-tic-tic · se repinta trazo a trazo.
  const mesa = app.querySelector(".mesa");
  mesa.classList.add("en-intro");
  const box = $("#descubre");
  box.hidden = false;
  box.innerHTML = `<div class="reparto-carta"><p class="reparto-k">Se descubre el dibujo</p>
    <p class="reparto-t">${SE_DESCUBRE[Math.floor(Math.random() * SE_DESCUBRE.length)]}</p><p class="reparto-dots"><i></i><i></i><i></i></p></div>`;
  const dots = box.querySelectorAll(".reparto-dots i");
  [0, 1, 2].forEach((i) => later2(700 + i * 260, () => { dots[i]?.classList.add("on"); Sfx.play("tic"); }));
  later2(1500, () => {
    box.classList.add("fuera");
    Sfx.play("revelar");
    const p = $("#pintando");
    if (p) p.textContent = "— se está pintando";
    const ms = trazos ? repintar(cv, trazos) : (pintarFinal(cv), 400);
    later2(ms + 250, () => {
      box.hidden = true;
      if (p) p.textContent = "";
      mesa.classList.remove("en-intro");
      Sfx.play("pop");
      Voice.say("mentir", { interrupt: true });
    });
  });
}

function pintarFinal(cv) {
  if (!cv) return;
  const img = new Image();
  img.onload = () => cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  img.src = safeImg(state.drawings?.[state.current.artist]);
}

/** Repinta el dibujo trazo a trazo con sonido de lápiz. Devuelve cuánto tarda (ms). */
function repintar(cv, json) {
  let data;
  try { data = JSON.parse(json); } catch { pintarFinal(cv); return 400; }
  const x = cv.getContext("2d");
  const k = cv.width / (data.s || 360);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, cv.width, cv.height);
  // Cada trazo = un punto inicial y luego sus segmentos.
  const ev = [];
  for (const [color, width, pts] of data.l || []) {
    if (!pts || pts.length < 2) continue;
    ev.push({ color, w: width * k, x: pts[0] * k, y: pts[1] * k, start: true });
    for (let j = 2; j < pts.length; j += 2) ev.push({ color, w: width * k, x0: pts[j - 2] * k, y0: pts[j - 1] * k, x: pts[j] * k, y: pts[j + 1] * k });
  }
  if (!ev.length) { pintarFinal(cv); return 400; }
  const nTrazos = ev.filter((e) => e.start).length;
  const dur = Math.min(2600, Math.max(800, nTrazos * 240, ev.length * 6));
  const t0 = performance.now(), pid = state.phaseId;
  let done = 0, lastSfx = -1e9;
  const step = (now) => {
    if (state?.phaseId !== pid || !cv.isConnected) return;
    const target = Math.min(ev.length, Math.ceil(((now - t0) / dur) * ev.length));
    for (; done < target; done++) {
      const e = ev[done];
      x.strokeStyle = x.fillStyle = e.color;
      x.lineWidth = e.w; x.lineCap = "round"; x.lineJoin = "round";
      x.beginPath();
      if (e.start) {
        x.arc(e.x, e.y, e.w / 2, 0, Math.PI * 2); x.fill();
        if (now - lastSfx > 110) { Sfx.play("trazo", { rate: 0.9 + Math.random() * 0.25 }); lastSfx = now; }
      } else { x.moveTo(e.x0, e.y0); x.lineTo(e.x, e.y); x.stroke(); }
    }
    if (done < ev.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return dur;
}

function renderReveal() {
  app.innerHTML = mesaHTML({ voting: true, reveal: true });
}

function clearReveal() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
}

function runReveal() {
  clearReveal();
  const r = state.results;
  if (!r?.opts) return;
  const pid = state.phaseId;
  const plan = revealPlan(r);
  // Si la tele se recarga a mitad de destape, se retoma por el acto que toca.
  const elapsed = Math.max(0, plan.total - Math.max(0, (state.deadline || 0) - serverNow()) - 500);
  // Arranque: el dibujo encoge y baja para dejar sitio a las tarjetas.
  if (elapsed < 600) {
    Sfx.play("tic");
    Voice.say("suspense", { interrupt: true });
    revealTimers.push(setTimeout(() => { app.querySelector(".mesa")?.classList.add("encoge"); Sfx.play("revelar"); }, 450));
  } else app.querySelector(".mesa")?.classList.add("encoge");
  for (const st of plan.steps) {
    const wait = st.at - elapsed;
    if (wait < -800 && st.act !== "sum") { revealTimers.push(setTimeout(() => replayStep(st, pid), 0)); continue; }
    revealTimers.push(setTimeout(() => { if (state?.phaseId === pid) playStep(st); }, Math.max(0, wait)));
  }
}

// Al retomar, los actos ya pasados se dejan pintados sin sonido.
function replayStep(st, pid) {
  if (state?.phaseId !== pid) return;
  if (st.act === "fuera") st.list.forEach((o) => markOut(o, true));
  if (st.act === "lie") markLie(st.o, true);
  if (st.act === "truth") markTruth(st.o, true);
  if (st.act === "points") renderPoints(true);
}

function playStep(st) {
  switch (st.act) {
    case "fuera": {
      st.list.forEach((o, i) => setTimeout(() => markOut(o), i * 450));
      caption(st.list.length === 1 ? "Esta no ha colado a nadie." : "Estas no han colado a nadie.");
      return Voice.say(st.list.some((o) => o.kind === "house") && st.list.length === 1 ? "casa" : "nadiePico", { interrupt: true });
    }
    case "lie": {
      const li = optEl(st.o);
      li?.classList.add("tension");
      Sfx.play("redoble");
      caption("¿Quién habrá picado con esta?");
      return later2(REDOBLE, () => {
        li?.classList.remove("tension");
        markLie(st.o);
        const n = st.o.voters.length;
        caption(n === 1 ? `${nameOf(st.o.voters[0])} ha picado.` : `Han picado ${n}.`);
        later2(650, () => { Sfx.play("fallo"); Sfx.play("picado", { vol: 0.6 }); });
        later2(1000, () => Sfx.play("puntos"));
        later2(1050, () => Voice.say(st.o.kind === "house" ? "casa" : n >= 2 ? "coloMuchos" : "colo", { interrupt: true }));
        later2(RV.lie - REDOBLE - 500, () => soltar(li));
      });
    }
    case "truth": {
      const li = optEl(st.o);
      app.querySelectorAll(".mesa .opcion").forEach((x) => x !== li && x.classList.add("apagada"));
      li?.classList.add("tension");
      Sfx.play("redoble");
      caption("Y el título de verdad es…");
      return later2(REDOBLE, () => {
        li?.classList.remove("tension");
        markTruth(st.o);
        const n = st.o.voters.length;
        const judges = active().filter((p) => p.uid !== state.current?.artist).length;
        caption(n ? `Lo dibujó ${nameOf(state.current.artist)}.` : `Lo dibujó ${nameOf(state.current.artist)}. Y no lo acertó nadie.`);
        Sfx.play("revelar");
        later2(500, () => Sfx.play(n ? "acierto" : "fallo"));
        if (n) { later2(900, () => Sfx.play("puntos")); later2(1100, () => Sfx.play("aplausos", { vol: 0.7 })); }
        later2(300, () => Voice.say(n === 0 ? "nadie" : n >= 2 && n === judges ? "todos" : "verdad", { interrupt: true }));
      });
    }
    case "points": setScene("scores"); return renderPoints();
    case "sum": return runSum();
  }
}

function caption(text) {
  const c = $("#reveal-caption");
  if (!c) return;
  c.textContent = text;
  c.classList.remove("pop");
  void c.offsetWidth;
  c.classList.add("pop");
}

const optEl = (o) => app.querySelector(`.mesa .opcion[data-id="${o?.id}"]`);

// Lleva una tarjeta al centro de la mesa, en grande.
function alCentro(li) {
  const box = app.querySelector(".mesa-cuerpo");
  if (!li || !box) return;
  const a = li.getBoundingClientRect(), b = box.getBoundingClientRect();
  li.style.setProperty("--dx", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
  li.style.setProperty("--dy", `${b.top + b.height * 0.42 - (a.top + a.height / 2)}px`);
  li.classList.add("foco");
}
function soltar(li) { li?.classList.remove("foco"); }

// El autor sale en la cartela cuando se descubre la verdad.
function firmar() {
  const a = state.players?.[state.current?.artist];
  const c = app.querySelector(".c-autor");
  if (c && a) { c.innerHTML = `${avatarHTML(a, "tiny")} ${esc(a.name)}`; c.classList.add("firmada"); }
}
function votersHTML(o, delay = 0.25) {
  return o.voters.map((u, i) => {
    const p = state.players?.[u];
    return p ? `<span class="flyer" style="animation-delay:${(delay + i * 0.22).toFixed(2)}s">${avatarHTML(p, "tiny")}<b>${esc(p.name)}</b></span>` : "";
  }).join("");
}

function markOut(o, still = false) {
  const li = optEl(o);
  if (!li) return;
  li.querySelector(".stamp").textContent = o.kind === "house" ? "De la casa" : "Nadie picó";
  li.classList.add("fuera");
  if (still) { li.classList.add("still", "ida"); return; }
  // Tiembla, se cae del tendedero y el hueco se cierra: fuera de la lista.
  setTimeout(() => {
    if (!li.isConnected) return;
    const cs = getComputedStyle(li);
    li.animate([
      { height: `${li.offsetHeight}px`, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
      { height: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" },
    ], { duration: 450, easing: "ease-in-out" }).onfinish = () => li.classList.add("ida");
  }, 1850);
}

function markLie(o, still = false) {
  const li = optEl(o);
  if (!li) return;
  const who = o.kind === "house" ? "la mentira de la casa" : `la mentira de ${(o.authors || []).map(nameOf).join(" y ")}`;
  li.querySelector(".opt-voters").innerHTML = votersHTML(o, 0.35);
  li.querySelector(".stamp").textContent = who;
  li.querySelector(".gain-badge").textContent = o.kind === "house" ? "" : `+${500 * o.voters.length}`;
  li.classList.add("mentira");
  if (still) { li.classList.add("still"); return; }
  alCentro(li);
}

function markTruth(o, still = false) {
  const li = optEl(o);
  if (!li) return;
  app.querySelectorAll(".mesa .opcion").forEach((x) => x !== li && x.classList.add("apagada"));
  li.querySelector(".opt-voters").innerHTML = votersHTML(o, 0.45);
  li.querySelector(".stamp").textContent = "el título de verdad";
  li.querySelector(".gain-badge").textContent = o.voters.length ? `+1000 c/u` : "";
  if (!li.querySelector(".rayos")) li.insertAdjacentHTML("afterbegin", `<span class="rayos" aria-hidden="true"></span>`);
  li.classList.add("verdad");
  firmar();
  if (still) { li.classList.add("still"); return; }
  alCentro(li);
}

/* --- Puntos de este dibujo → clasificación general --- */
function pointsRows() {
  const r = state.results;
  return sortedPlayers(state).map((p) => ({ p, gain: r.gains?.[p.uid] || 0, prev: r.prev?.[p.uid] ?? Math.max(0, (p.score || 0) - (r.gains?.[p.uid] || 0)) }));
}

// Por qué ha ganado puntos cada uno con este dibujo.
function motivos(uid) {
  const r = state.results;
  const opts = Object.values(r?.opts || {}).map((o) => ({ ...o, voters: Object.values(o.voters || {}), authors: Object.values(o.authors || {}) }));
  const m = [];
  if (uid === state.current?.artist && opts.find((o) => o.kind === "truth")?.voters.length) m.push("lo dibujó");
  if (opts.find((o) => o.kind === "truth")?.voters.includes(uid)) m.push("acertó");
  for (const o of opts) if (o.kind === "lie" && o.voters.length && o.authors.includes(uid)) m.push(`«${o.text}»`);
  return m.join(" + ");
}

function renderPoints(still = false) {
  const r = state.results;
  const rows = pointsRows().sort((a, b) => (b.gain - a.gain) || a.p.name.localeCompare(b.p.name));
  const max = Math.max(1, ...rows.map((x) => x.gain));
  const title = r.last ? `Fin de la ronda ${r.round} de ${r.rounds}` : `Dibujo ${state.current.index} de ${state.current.total}`;
  app.innerHTML = `
    <section class="stage marcador hoja-puntos">
      <div class="hp-papel">
        <figure class="hp-obra"><img src="${safeImg(state.drawings?.[state.current.artist])}" alt=""><figcaption>${esc(state.prompts?.[state.current.artist] || "")}</figcaption></figure>
        <div class="hp-der">
          <h2 id="board-title">Este dibujo ha dado <small>${title}</small></h2>
          <div class="board" id="board">${rows.map(({ p, gain, prev }, i) => `
            <div class="hp-fila" data-uid="${p.uid}" style="--h:${hue(p.uid)}; --i:${i}">
              <span class="pos"></span>${avatarHTML(p, "tiny")}<span class="pname">${esc(p.name)}</span>
              <div class="hp-barra ${gain ? "" : "cero"}"><i style="--w:${gain ? Math.max(14, (100 * gain) / max) : 6}%"></i>
                <span class="hp-motivo">${esc(motivos(p.uid))}</span>
                <span class="gain" data-gain="${gain}">${still || !gain ? `+${gain}` : "+0"}</span></div>
              <span class="score" data-prev="${prev}" hidden>${prev}</span>
            </div>`).join("")}
          </div>
        </div>
      </div>
    </section>`;
  if (still) { app.querySelectorAll(".hp-fila").forEach((f) => f.classList.add("vivo")); return; }
  Sfx.play("puntos");
  app.querySelectorAll(".hp-fila").forEach((f, i) => later2(450 + i * 180, () => {
    f.classList.add("vivo");
    Sfx.play("pop");
    const g = f.querySelector(".gain");
    if (+g.dataset.gain) countUp(g, 0, +g.dataset.gain, 700, "+");
  }));
}

function countUp(el, from, to, ms, prefix = "") {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = prefix + v;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function runSum() {
  const r = state.results;
  if (!$("#board")) renderPoints(true);
  const board = $("#board");
  const rows = pointsRows();
  const rank = (key) => [...rows].sort((a, b) => (b[key] - a[key]) || a.p.name.localeCompare(b.p.name)).map((x) => x.p.uid);
  const before = rank("prev");
  rows.forEach((x) => { x.total = x.prev + x.gain; });
  const after = rank("total");
  const puesto = (key, v) => 1 + rows.filter((y) => y[key] > v).length;
  const maxT = Math.max(1, ...rows.map((x) => x.total));
  const t = $("#board-title");
  if (t) t.innerHTML = `Así va la cosa <small>${r.last ? `Fin de la ronda ${r.round} de ${r.rounds}` : `Tras el dibujo ${state.current.index} de ${state.current.total}`}</small>`;
  app.querySelector(".hoja-puntos")?.classList.add("totales");
  Sfx.play("revelar");
  Sfx.play("aplausos", { vol: 0.6 });
  // 1) Las barras pasan de «lo de este dibujo» a «lo que lleva cada uno».
  board.querySelectorAll(".hp-fila").forEach((row) => {
    const x = rows.find((y) => y.p.uid === row.dataset.uid);
    row.querySelector(".hp-barra i").style.setProperty("--w", `${Math.max(6, (100 * x.total) / maxT)}%`);
    row.querySelector(".hp-barra").classList.remove("cero");
    row.querySelector(".hp-motivo").textContent = "";
    countUp(row.querySelector(".gain"), x.prev, x.total, 1100);
  });
  // 2) Se reordenan (FLIP), con puesto, flechas y corona.
  later2(1300, () => {
    if (!board.isConnected) return;
    const first = new Map([...board.children].map((el) => [el.dataset.uid, el.getBoundingClientRect().top]));
    const top = rows.find((y) => y.p.uid === after[0]);
    const soloEnCabeza = top.total > 0 && rows.filter((y) => y.total === top.total).length === 1;
    after.forEach((uid) => board.appendChild(board.querySelector(`[data-uid="${uid}"]`)));
    const hayHistoria = rows.some((y) => y.prev > 0);
    let remonta = false;
    [...board.children].forEach((el) => {
      const dy = first.get(el.dataset.uid) - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 700, easing: "cubic-bezier(.3,1.3,.5,1)" });
      const x = rows.find((y) => y.p.uid === el.dataset.uid);
      const now = puesto("total", x.total), was = puesto("prev", x.prev);
      el.querySelector(".pos").textContent = `${now}.º`;
      el.classList.toggle("sube", hayHistoria && was > now);
      if (hayHistoria && was - now >= 2) remonta = true;
      el.classList.toggle("lider", now === 1 && soloEnCabeza);
    });
    Sfx.play("pop");
    const antes = rows.find((y) => y.p.uid === before[0]);
    const lideraba = antes.prev > 0 && rows.filter((y) => y.prev === antes.prev).length === 1 ? antes.p.uid : null;
    const newLeader = soloEnCabeza && top.p.uid !== lideraba && hayHistoria;
    if (newLeader) {
      board.querySelector(".lider")?.classList.add("nuevo");
      Sfx.play("fanfarria", { vol: 0.8 });
      Voice.say("lider", { interrupt: true });
    } else if (remonta) Voice.say("remontada", { interrupt: true });
    else if (r.last && r.round < r.rounds) Voice.say("descanso", { interrupt: true });
    else if (r.last) Voice.say("marcador", { interrupt: true });
  });
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

// ---------- Final: la gala de premios y el podio ----------
// Orden de la gala: de lo más absurdo a lo más deseado.
const GALA_ORDER = ["minimal", "serio", "color", "credulo", "nadie", "mentiroso", "favorito"];
// El redoble (audio/sfx/redoble.mp3) da el platillazo a los ~2 s: se lanza para que caiga justo al abrir.
const CRASH = 2000;
const GALA = { intro: 4200, open: 3300, award: 8800, pod: [2000, 4000, 7800], buttons: 9800 };

const puestoFinal = (p, r) => 1 + r.filter((x) => (x.score || 0) > (p.score || 0)).length;

// Cartel de «se busca» para el mentiroso de oro, con el dibujo del delito al lado.
function seBuscaHTML(a) {
  const carteles = a.winners.map((u) => state.players?.[u]).filter(Boolean).map((p) => `
    <div class="se-busca">
      <p class="sb-wanted">WANTED</p>
      <p class="sb-sub">Se busca por mentir</p>
      <div class="sb-foto">${avatarHTML(p)}</div>
      <p class="sb-nombre">${esc(p.name)}</p>
      <p class="sb-recompensa">Recompensa: 500 puntos por víctima</p>
    </div>`).join("");
  return `<div class="sb-fila">${carteles}
    ${a.img ? `<figure class="award-art sb-delito"><img src="${safeImg(a.img)}" alt=""><figcaption>${esc(a.caption || "")}</figcaption></figure>` : ""}</div>`;
}

// El teatro: cortinas rojas dibujadas a los lados durante la gala; se cierran para el ganador.
function cortinaSVG(lado) {
  const pliegues = [38, 76, 114, 152, 190, 228, 266].map((x, i) => `
    <path d="M${x} 0 C ${x + (i % 2 ? 10 : -10)} 320, ${x + (i % 2 ? -12 : 12)} 640, ${x} 950" class="pliegue"/>
    <path d="M${x + 12} 10 C ${x + 20} 320, ${x + 4} 640, ${x + 14} 940" class="brillo"/>`).join("");
  return `<svg class="cortina cortina-${lado}" viewBox="0 0 300 1000" preserveAspectRatio="none">
    <defs><linearGradient id="tela-${lado}" x1="0" x2="1">
      ${Array.from({ length: 8 }, (_, i) => `<stop offset="${i / 7}" stop-color="${i % 2 ? "#c0283f" : "#8f1730"}"/>`).join("")}
    </linearGradient></defs>
    <path d="M0 0 H300 V955 Q 262 1000 225 962 Q 187 1000 150 958 Q 112 1000 75 962 Q 37 1000 0 955 Z" fill="url(#tela-${lado})" class="tela"/>
    ${pliegues}
  </svg>`;
}
function teatroHTML() {
  return `<div class="teatro" id="teatro" aria-hidden="true">
    ${cortinaSVG("izq")}${cortinaSVG("der")}
    <div class="bambalina"></div><div class="foco-luz"></div></div>`;
}

function namesHTML(uids) {
  const ps = uids.map((u) => state.players?.[u]).filter(Boolean);
  return ps.map((p) => `<span class="aw-person">${avatarHTML(p)}<b>${esc(p.name)}</b></span>`).join("");
}

function renderEnd() {
  const r = ranking();
  const awards = computeAwards(state).sort((a, b) => GALA_ORDER.indexOf(a.id) - GALA_ORDER.indexOf(b.id));
  const live = endLive && !state.galaDone;
  app.innerHTML = `
    <section class="stage end">
      <div class="gala" id="gala"></div>
      <div class="final" id="final" hidden>
        <h2 class="winner-title" id="win-title">${winTitle()}</h2>
        <div class="podium">${r.slice(0, 3).map((p) => {
          const pos = puestoFinal(p, r); // empates: mismo puesto
          return `
          <div class="pod p${pos}" data-pos="${pos}" data-uid="${p.uid}">${avatarHTML(p)}<span class="pname">${esc(p.name)}</span>
            <span class="score">${p.score || 0}</span><div class="block">${pos}</div></div>`;
        }).join("")}
        </div>
        <div class="board compact">${boardHTML(r.slice(3), 3)}</div>
        ${awards.length ? `<ul class="palmares">${awards.map((a) => `
          <li><span class="pl-title">${esc(a.title)}</span> ${a.winners.map((u) => esc(state.players?.[u]?.name || "")).join(" y ")}</li>`).join("")}
        </ul>` : ""}
        <div class="row center" id="end-buttons">
          <button class="btn big" id="again">Otra partida</button>
          <button class="btn ghost" id="menu">Menú</button>
        </div>
      </div>
      <button class="btn ghost small skip" id="skip" hidden>Saltar la gala</button>
      ${teatroHTML()}
    </section>`;
  $("#again").onclick = playAgain;
  $("#menu").onclick = () => { Music.calmUntilVoiceEnds(); Voice.say("adios", { interrupt: true }); showMenu(); };
  if (live) runGala(awards);
  else showFinal({ still: true });
}

function later(ms, fn) {
  const pid = state.phaseId;
  revealTimers.push(setTimeout(() => { if (state?.phaseId === pid && state.phase === "end") fn(); }, ms));
}

function runGala(awards) {
  const gala = $("#gala");
  const skip = $("#skip");
  skip.hidden = false;
  skip.onclick = () => { clearReveal(); Voice.stop(); showFinal({ still: false }); };
  gala.innerHTML = `
    <div class="gala-intro">
      <h2 class="gala-title">Los Garabatos de Oro</h2>
      <p class="gala-sub">${awards.length ? `${awards.length} premios que nadie ha pedido` : "Este año no hay premios: el jurado está de huelga"}</p>
    </div>`;
  Voice.say("gala", { interrupt: true });
  Sfx.play("fanfarria");
  later(400, () => Sfx.play("aplausos", { vol: 0.8 }));
  let t = GALA.intro;
  awards.forEach((a, i) => {
    later(t, () => showAward(a, i, awards.length));
    later(t + GALA.open - CRASH, () => Sfx.play("redoble"));
    later(t + GALA.open, () => openAward(a));
    t += GALA.award;
  });
  later(t, () => runPodium());
}

function showAward(a, i, n) {
  $("#gala").innerHTML = `
    <article class="award" data-award="${a.id}">
      <p class="award-count">Premio ${i + 1} de ${n}</p>
      <h2 class="award-title">${esc(a.title)}</h2>
      <p class="award-desc">${esc(a.desc)}</p>
      <div class="sobre" aria-hidden="true"><span class="sobre-solapa"></span><span class="sobre-sello">G</span></div>
      <div class="award-winner">
        ${a.id === "mentiroso" ? seBuscaHTML(a) : `
        ${a.img ? `<figure class="award-art">${a.id === "serio" ? `<span class="marco-orla" aria-hidden="true"></span>` : ""}<img src="${safeImg(a.img)}" alt="">${a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ""}</figure>` : ""}
        <div class="award-names">${namesHTML(a.winners)}</div>`}
        <p class="award-stat">${esc(a.stat || "")}</p>
      </div>
    </article>`;
  Sfx.play("entrega");
  later(250, () => Sfx.play("pop"));
}

function openAward(a) {
  const el = $(".award");
  if (!el) return;
  el.classList.add("abierto");
  Sfx.play("revelar");
  later(350, () => Sfx.play("pop"));
  later(500, () => Sfx.play("acierto"));
  later(700, () => Sfx.play("aplausos", { vol: 0.8 }));
  later(900, () => Sfx.play("puntos"));
  Voice.say(a.voice, { interrupt: true });
}

// Público de cartón para el 3.º y el 2.º (cutre a propósito).
function publicoHTML() {
  const n = 16;
  const caras = ["M40 58 Q50 66 60 58", "M41 60 Q50 54 59 60", "M44 59 H56", "M42 57 Q50 70 58 57 Z"];
  return `<div class="publico" id="publico" aria-hidden="true">${Array.from({ length: n }, (_, i) => `
    <svg class="fan" viewBox="0 0 100 130" style="--d:${((i * 37) % 9) / 10}s; --s:${0.8 + ((i * 13) % 6) / 10}">
      <path class="brazo bi" d="M30 92 L12 48"/><path class="brazo bd" d="M70 92 L88 48"/>
      <path class="cuerpo" d="M22 130 C 22 98, 78 98, 78 130 Z" style="fill:hsl(${(i * 47) % 360} 45% 62%)"/>
      <circle class="cabeza" cx="50" cy="52" r="22" style="fill:hsl(${(i * 29 + 20) % 60 + 15} 55% 78%)"/>
      <circle cx="43" cy="49" r="2.6" class="ojo"/><circle cx="57" cy="49" r="2.6" class="ojo"/>
      <path class="boca" d="${caras[i % caras.length]}"/>
    </svg>`).join("")}</div>`;
}

function runPodium() {
  $("#gala").hidden = true;
  const fin = $("#final");
  fin.hidden = false;
  fin.classList.add("en-vivo");
  requestAnimationFrame(() => refreshGradients(fin)); // el título se troceó estando oculto
  fin.querySelectorAll(".pod").forEach((p) => p.classList.add("oculto"));
  $("#win-title").classList.add("oculto");
  fin.querySelectorAll("#end-buttons, .palmares, .board.compact").forEach((x) => x.classList.add("oculto"));
  fin.insertAdjacentHTML("beforeend", publicoHTML());
  Voice.say("podio", { interrupt: true });
  const pods = [...fin.querySelectorAll(".pod")];
  const puestos = [...new Set(pods.map((p) => +p.dataset.pos))].sort((a, b) => b - a).filter((p) => p !== 1);
  const publico = $("#publico");
  // 3.º y 2.º: suben, el público de cartón aplaude y Lola comenta.
  let t = 2200;
  for (const pos of puestos) {
    later(t, () => {
      pods.filter((p) => +p.dataset.pos === pos).forEach((p) => { p.classList.remove("oculto"); p.classList.add("sube"); });
      Sfx.play("revelar");
      later(250, () => Sfx.play("pop"));
      publico.classList.add("aplaude");
      later(300, () => Sfx.play("aplausos", { vol: 0.9 }));
      Voice.say(pos === 3 ? "tercero" : "segundo", { interrupt: true });
      later(3600, () => publico.classList.remove("aplaude"));
    });
    t += 4600;
  }
  // 1.º: se cierra el telón, foco, redoble… se abre y aparece el ganador en grande;
  // luego salta a su puesto del podio y todos bailan.
  const teatro = $("#teatro");
  later(t, () => {
    publico.classList.remove("aplaude");
    teatro.classList.add("cerrado");
    Sfx.play("revelar", { rate: 0.7 });
    Music.duck(true);
    Voice.say("anuncio", { interrupt: true });
    later(1100, () => teatro.classList.add("foco"));
  });
  later(t + 1400, () => Sfx.play("redoble"));
  const w = winners();
  later(t + 1400 + CRASH, () => {
    fin.insertAdjacentHTML("beforeend", `<div class="estrella" id="estrella">
      <div class="estrella-caras">${w.map((p) => `<div class="estrella-cara" data-uid="${p.uid}">${avatarHTML(p)}</div>`).join("")}</div>
      <p class="estrella-nombre">${w.length > 1 ? "¡Empate! " : "¡Gana "}${w.map((p) => `<span>${esc(p.name)}</span>`).join(" y ")}${w.length > 1 ? "" : "!"}</p></div>`);
    teatro.classList.remove("cerrado");
    Sfx.play("fanfarria");
    later(200, () => Sfx.play("ovacion"));
    publico.classList.add("aplaude", "fiesta");
    Voice.say(w.length > 1 ? "empate" : "ganador", { interrupt: true });
  });
  // Salto al podio.
  later(t + 1400 + CRASH + 3000, () => {
    teatro.classList.remove("foco");
    Music.duck(false);
    const est = $("#estrella");
    est?.querySelector(".estrella-nombre")?.classList.add("vete");
    est?.querySelectorAll(".estrella-cara").forEach((cara) => {
      const pod = fin.querySelector(`.pod[data-uid="${cara.dataset.uid}"]`);
      const dest = pod?.querySelector(".avatar")?.getBoundingClientRect();
      const ori = cara.getBoundingClientRect();
      if (!dest || !ori.width) return;
      const dx = dest.left + dest.width / 2 - (ori.left + ori.width / 2), dy = dest.top + dest.height / 2 - (ori.top + ori.height / 2);
      const k = dest.width / ori.width;
      Sfx.play("pop");
      cara.animate([
        { transform: "translate(0,0) scale(1)" },
        { transform: `translate(${dx * 0.5}px, ${Math.min(dy * 0.5, 0) - 160}px) scale(${(1 + k) / 2}) rotate(-12deg)`, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})` },
      ], { duration: 900, easing: "cubic-bezier(.4,0,.3,1)", fill: "forwards" });
    });
    later(950, () => {
      est?.remove();
      Sfx.play("acierto");
      pods.forEach((p) => { p.classList.remove("oculto"); p.classList.add("baila"); });
      $("#win-title").classList.remove("oculto");
      Voice.say("despedida");
    });
  });
  later(t + 1400 + CRASH + 4600, () => showFinal({ still: true, keepVoice: true }));
}

function showFinal({ still, keepVoice = false }) {
  const gala = $("#gala"), fin = $("#final");
  if (!fin) return;
  gala.hidden = true;
  fin.hidden = false;
  requestAnimationFrame(() => refreshGradients(fin));
  fin.querySelectorAll(".oculto").forEach((x) => x.classList.remove("oculto"));
  fin.querySelectorAll(".pod").forEach((p) => p.classList.add("baila"));
  $("#estrella")?.remove();
  $("#teatro")?.classList.remove("cerrado", "foco");
  $("#skip").hidden = true;
  if (!still) {
    Sfx.play("ovacion");
    if (!keepVoice) Voice.say(winners().length > 1 ? "empate" : "ganador", { interrupt: true });
  }
  if (!state.galaDone) update(roomRef, { galaDone: true }).catch(() => {});
  setTimeout(() => $("#again")?.focus(), 50);
}

// Cuenta atrás en pantalla.
setInterval(() => {
  if (!state) return;
  if (state.phase === "lobby") return lobbyCues();
  if (!state.deadline) return;
  const left = Math.max(0, state.deadline - serverNow());
  const secs = Math.ceil(left / 1000);
  const t = document.querySelector("[data-timer]");
  if (t) {
    t.textContent = secs;
    t.classList.toggle("hurry", secs <= 10);
  }
  // El lápiz se gasta con el tiempo (dibujar, mentir y votar).
  const total = { drawing: state.settings.drawTime, lying: state.settings.lieTime, voting: state.settings.voteTime }[state.phase];
  const lapiz = document.getElementById("lapiz");
  if (lapiz && total) lapiz.style.width = `${Math.min(100, (100 * left) / (total * 1000))}%`;
  // Últimos 5 segundos: tic por segundo.
  if (total && secs <= 5 && secs >= 1 && tickedAt !== `${state.phaseId}|${secs}`) {
    tickedAt = `${state.phaseId}|${secs}`;
    Sfx.play("tic", { vol: secs <= 2 ? 1 : 0.7 });
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

startPainter();
startMotion(() => Music.groove());
boot();

// La tele suele quedarse encendida días: si hay versión nueva publicada, se actualiza sola
// (solo en el menú o en la sala, nunca a mitad de partida).
const ARCHIVOS = ["index.html", "js/host.js", "js/voice.js", "js/music.js", "js/sfx.js", "js/painter.js", "js/motion.js",
  "js/awards.js", "js/prompts.js", "js/track.js", "js/util.js", "js/firebase.js", "css/style.css"];
let huella = null;
async function huellaActual() {
  const t = await Promise.all(ARCHIVOS.slice(0, 2).concat("css/style.css").map((f) => fetch(f, { cache: "no-store" }).then((r) => r.text())));
  return t.map((x) => `${x.length}:${x.slice(-80)}`).join("|");
}
setInterval(async () => {
  try {
    const h = await huellaActual();
    if (huella === null) { huella = h; return; }
    const quieto = !state || state.phase === "lobby" || (state.phase === "end" && state.galaDone) || /^(menu|settings)/.test(viewKey);
    if (h !== huella && quieto) {
      await Promise.all(ARCHIVOS.map((f) => fetch(f, { cache: "reload" }).catch(() => {})));
      location.reload();
    }
  } catch { /* sin red: ya lo intentará luego */ }
}, 120000);
huellaActual().then((h) => { huella = h; }).catch(() => {});
