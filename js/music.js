// Música: seis temas de ElevenLabs (ver track.js). Modos:
//  · «calma»:   los 4 primeros compases de la intro del tema de sala, en bucle. Sin bombo.
//               Mientras la presentadora saluda.
//  · «sala»:    los tres temas de sala encadenados, enteros: cada minuto uno distinto,
//               y cada uno con su intro suave y su entrada del bombo.
//  · «dibujo», «intriga», «fiesta»: bucles para dibujar, votar/destapar y el marcador/final.
// Los cambios caen en el siguiente compás del tema que está sonando.
import { TRACKS, SALA, barOf } from "./track.js";

const MUSIC_VOL = 0.6;
const DUCK_VOL = 0.24;
const FADE = 0.04;

let ctx = null, master = null, duckGain = null;
let muted = false;
const buffers = {}, loading = {};
let cur = null; // { key, kind, src, gain, t0, pos0, loop:[a,b]|null }
let mode = "calma";
let salaIdx = Math.floor(Math.random() * SALA.length);
let chainTimer = null;
let pendingDrop = false, heardVoice = false, dropTimer = null, safetyTimer = null;

function setup() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MUSIC_VOL;
  duckGain = ctx.createGain();
  duckGain.connect(master).connect(ctx.destination);
}

function load(key) {
  if (!loading[key]) {
    loading[key] = fetch(TRACKS[key].src)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((b) => new Promise((ok, ko) => ctx.decodeAudioData(b, ok, ko)))
      .then((b) => { buffers[key] = b; })
      .catch(() => {});
  }
  return loading[key];
}

async function loadAll() {
  await load(SALA[salaIdx]); // la que va a sonar primero
  apply();
  for (const k of ["dibujo", ...SALA, "intriga", "fiesta"]) await load(k);
}

function positionAt(t) {
  let p = cur.pos0 + (t - cur.t0);
  if (cur.loop && p >= cur.loop[1]) p = cur.loop[0] + ((p - cur.loop[1]) % (cur.loop[1] - cur.loop[0]));
  return p;
}

function nextBarTime() {
  const now = ctx.currentTime;
  if (!cur) return now + 0.05;
  const bar = barOf(cur.key);
  const into = (((positionAt(now) - TRACKS[cur.key].start) % bar) + bar) % bar;
  const wait = bar - into;
  return now + (wait < 0.08 ? wait + bar : wait);
}

function startSource(key, kind, when, offset, loop) {
  clearTimeout(chainTimer);
  const t = TRACKS[key];
  const src = ctx.createBufferSource();
  src.buffer = buffers[key];
  if (loop) {
    src.loop = true;
    [src.loopStart, src.loopEnd] = loop;
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + FADE);
  src.connect(gain).connect(duckGain);
  if (loop) src.start(when, offset);
  else src.start(when, offset, Math.max(0.1, t.end - offset));
  if (cur) {
    const old = cur;
    old.gain.gain.setValueAtTime(1, when);
    old.gain.gain.linearRampToValueAtTime(0, when + FADE);
    try { old.src.stop(when + FADE + 0.02); } catch { /* ya parado */ }
  }
  cur = { key, kind, src, gain, t0: when, pos0: offset, loop };
  // En la sala, cuando acaba un tema empieza el siguiente (con su intro y su subidón).
  if (kind === "sala") {
    const endAt = when + (t.end - offset);
    chainTimer = setTimeout(() => {
      if (cur?.src !== src || mode !== "sala") return;
      const next = SALA[(salaIdx + 1) % SALA.length];
      if (!buffers[next]) return;
      salaIdx = (salaIdx + 1) % SALA.length;
      startSource(next, "sala", endAt, 0, null);
    }, Math.max(0, (endAt - ctx.currentTime - 1.2) * 1000));
  }
}

function apply() {
  if (!ctx || !Music.playing) return;
  if (cur?.kind === mode) return;
  const salaKey = cur && (cur.kind === "sala" || cur.kind === "calma") ? cur.key : SALA[salaIdx];
  const key = mode === "calma" || mode === "sala" ? salaKey : mode;
  if (!buffers[key]) { load(key).then(apply); return; }
  const when = nextBarTime();
  const t = TRACKS[key];
  if (mode === "calma") return startSource(key, "calma", when, t.start, [t.start, t.start + 4 * barOf(key)]);
  if (mode === "sala") {
    if (cur?.kind === "calma") return startSource(key, "sala", when, t.drop, null); // ¡bombo!
    if (cur) { // venimos de otra fase: siguiente tema de la sala, desde su intro
      const k = SALA[(salaIdx + 1) % SALA.length];
      if (!buffers[k]) { load(k).then(apply); return; }
      salaIdx = (salaIdx + 1) % SALA.length;
      return startSource(k, "sala", when, 0, null);
    }
    return startSource(key, "sala", when, 0, null);
  }
  return startSource(key, mode, when, t.start, [t.start, t.end]);
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
  /** Silencio general: la música sigue corriendo (las letras siguen bailando a tempo), pero sin volumen. */
  setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : MUSIC_VOL, ctx.currentTime, 0.08);
  },
  start() {
    if (this.playing) return;
    if (!ctx) setup();
    ctx.resume();
    this.playing = true;
    loadAll();
    apply();
  },
  stop() {
    this.playing = false;
    clearDrop();
    clearTimeout(chainTimer);
    if (cur) { try { cur.src.stop(); } catch { /* ya parado */ } cur = null; }
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
  /** Música de una fase: "sala", "dibujo", "intriga" o "fiesta". */
  play(m) { clearDrop(); setMode(m); },
  party() { this.play("sala"); },
  /** Como party(), pero si aún esperamos a que se calle, que acabe de hablar primero. */
  partySoon() { if (!pendingDrop) this.party(); },
  /** Lo llama la voz: empieza a hablar (on) o se ha callado (off). */
  duck(on) {
    if (on) heardVoice = true;
    if (duckGain) duckGain.gain.setTargetAtTime(on ? DUCK_VOL / MUSIC_VOL : 1, ctx.currentTime, 0.25);
  },
  voiceIdle() {
    if (pendingDrop && heardVoice) this.party();
  },
  /** Dónde está el ritmo ahora: para que las letras bailen a tempo.
   *  phase: 0–1 dentro de un ciclo de 2 negras; intense: suena el bombo. */
  groove() {
    if (!ctx || !cur || !this.playing) return null;
    const t = TRACKS[cur.key];
    const beat = 60 / t.bpm;
    const p = positionAt(ctx.currentTime);
    const into = (((p - t.start) % (2 * beat)) + 2 * beat) % (2 * beat);
    const intense = cur.kind === "dibujo" || cur.kind === "fiesta" || (cur.kind === "sala" && p >= t.drop - 0.05);
    return { beat, phase: into / (2 * beat), intense };
  },
};
