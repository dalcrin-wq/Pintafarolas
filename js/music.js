// Música: dos temas de ElevenLabs con la misma rejilla (ver track.js).
// Tres maneras de sonar, y los cambios caen siempre en el siguiente compás:
//  · «calma»:  los 4 primeros compases de la intro de la sala, en bucle. Sin bombo.
//              Mientras habla la presentadora, al votar, al destapar.
//  · «ciclo»:  entra el bombo y luego el tema de la sala entero en bucle, así que
//              el subidón vuelve cada vuelta (como en la tele). Menú, sala, marcador.
//  · «fiesta»: la parte con bombo del tema de dibujar, sin respiros. Fases con reloj.
import { BPM, TRACKS } from "./track.js";

const MUSIC_VOL = 0.6;
const DUCK_VOL = 0.24;
const FADE = 0.03;
const BAR = (4 * 60) / BPM;

// modo → [tema, inicio del bucle, fin del bucle, por dónde se entra]
const MODES = {
  calma: (t = TRACKS.sala) => ["sala", t.start, t.calmEnd, t.start],
  ciclo: (t = TRACKS.sala) => ["sala", t.start, t.end, t.drop],
  fiesta: (t = TRACKS.dibujo) => ["dibujo", t.drop, t.end, t.drop],
};

let ctx = null, master = null, duckGain = null, loading = null;
const buffers = {};
let cur = null; // { src, gain, mode, a, b, pos0, t0 }
let mode = "calma";
let pendingDrop = false, heardVoice = false, dropTimer = null, safetyTimer = null;

function setup() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = MUSIC_VOL;
  duckGain = ctx.createGain();
  duckGain.connect(master).connect(ctx.destination);
}

function loadOne(key) {
  return fetch(TRACKS[key].src)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((b) => new Promise((ok, ko) => ctx.decodeAudioData(b, ok, ko)))
    .then((b) => { buffers[key] = b; })
    .catch(() => {});
}

function load() {
  // La sala primero: es la que suena nada más empezar.
  if (!loading) loading = loadOne("sala").then(() => { apply(); return loadOne("dibujo"); });
  return loading;
}

// Dónde va la canción (segundos del archivo) en el instante t.
function positionAt(t) {
  let p = cur.pos0 + (t - cur.t0);
  if (p >= cur.b) p = cur.a + ((p - cur.b) % (cur.b - cur.a));
  return p;
}

function nextBarTime() {
  const now = ctx.currentTime;
  const into = (((positionAt(now) - TRACKS.sala.start) % BAR) + BAR) % BAR;
  const wait = BAR - into;
  return now + (wait < 0.08 ? wait + BAR : wait);
}

function startSource(m, when) {
  const [key, a, b, offset] = MODES[m]();
  const src = ctx.createBufferSource();
  src.buffer = buffers[key];
  src.loop = true;
  src.loopStart = a;
  src.loopEnd = b;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + FADE);
  src.connect(gain).connect(duckGain);
  src.start(when, offset);
  if (cur) {
    const old = cur;
    old.gain.gain.setValueAtTime(1, when);
    old.gain.gain.linearRampToValueAtTime(0, when + FADE);
    old.src.stop(when + FADE + 0.02);
  }
  cur = { src, gain, mode: m, a, b, pos0: offset, t0: when };
}

function apply() {
  if (!ctx || !Music.playing) return;
  // Si el tema de dibujar aún no ha llegado, tira de la sala con bombo.
  const m = mode === "fiesta" && !buffers.dibujo ? "ciclo" : mode;
  if (!buffers[MODES[m]()[0]]) return;
  if (cur?.mode === m) return;
  startSource(m, cur ? nextBarTime() : ctx.currentTime + 0.05);
}

function setMode(m) {
  mode = m;
  apply();
}

function clearDrop() {
  pendingDrop = false;
  clearTimeout(dropTimer);
  clearTimeout(safetyTimer);
}

export const Music = {
  playing: false,
  async start() {
    if (this.playing) return;
    if (!ctx) setup();
    ctx.resume();
    this.playing = true;
    await load();
    apply();
  },
  stop() {
    this.playing = false;
    clearDrop();
    if (cur) { cur.src.stop(); cur = null; }
  },
  /** Intro suave ya; el bombo entra cuando la presentadora acabe de hablar. */
  calmUntilVoiceEnds() {
    clearDrop();
    setMode("calma");
    pendingDrop = true;
    heardVoice = false;
    // Si no llega a hablar (voz apagada o sin audio), no nos quedamos sin fiesta.
    dropTimer = setTimeout(() => { if (pendingDrop && !heardVoice) this.party(); }, 4000);
    safetyTimer = setTimeout(() => { if (pendingDrop) this.party(); }, 20000);
  },
  /** Intro suave hasta nuevo aviso (votar, destapar…). */
  calm() { clearDrop(); setMode("calma"); },
  /** Tema de la sala entero en bucle: el subidón vuelve en cada vuelta. */
  party() { clearDrop(); setMode("ciclo"); },
  /** Como party(), pero si aún esperamos a que se calle, que acabe de hablar primero. */
  partySoon() { if (!pendingDrop) this.party(); },
  /** Tema de dibujar, solo la parte con bombo: para las fases con reloj. */
  drive() { clearDrop(); setMode("fiesta"); },
  /** Lo llama la voz: empieza a hablar (on) o se ha callado (off). */
  duck(on) {
    if (on) heardVoice = true;
    if (duckGain) duckGain.gain.setTargetAtTime(on ? DUCK_VOL / MUSIC_VOL : 1, ctx.currentTime, 0.25);
  },
  voiceIdle() {
    if (pendingDrop && heardVoice) this.party();
  },
  /** Dónde está el ritmo ahora: para que las letras bailen a tempo.
   *  phase: 0–1 dentro de un ciclo de 2 negras; intense: ya suena el bombo. */
  groove() {
    if (!ctx || !cur || !this.playing) return null;
    const beat = 60 / BPM;
    const p = positionAt(ctx.currentTime);
    const into = (((p - TRACKS.sala.start) % (2 * beat)) + 2 * beat) % (2 * beat);
    const intense = cur.mode === "fiesta" || (cur.mode === "ciclo" && p >= TRACKS.sala.drop - 0.05);
    return { beat, phase: into / (2 * beat), intense };
  },
};
