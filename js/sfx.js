// Efectos de sonido. Dos familias:
//  · Interfaz (cortos y secos, pegados a cada animación): pop, tic, entrega, trazo,
//    revelar, acierto, fallo, puntos, fanfarria, redoble.
//  · Ambiente (largos): aplausos, ovación, batacazos de dibujos animados, ta-da de Jugar…
// Suenan con Web Audio (búferes ya decodificados) para que un «tic-tic-tic» caiga a tempo;
// si no hay Web Audio, con <audio>.
const BANK = {
  // interfaz
  pop: ["pop-1", "pop-2"],
  tic: ["tic-1", "tic-2"],
  entrega: ["entrega"],
  trazo: ["trazo-1", "trazo-2"],
  revelar: ["revelar"],
  acierto: ["acierto"],
  fallo: ["fallo"],
  puntos: ["puntos"],
  fanfarria: ["fanfarria"],
  redoble: ["redoble"],
  // ambiente
  jugar: ["jugar"],
  click: ["click"],
  entra: ["entra-1", "entra-2"],
  picado: ["picado-1", "picado-2", "picado-3", "picado-4", "picado-5", "picado-6"],
  aplausos: ["aplausos-1", "aplausos-2"],
  ovacion: ["ovacion"],
};
const VOL = {
  pop: 0.5, tic: 0.55, entrega: 0.55, trazo: 0.3, revelar: 0.7, acierto: 0.7, fallo: 0.7, puntos: 0.38,
  fanfarria: 0.75, redoble: 0.8,
  jugar: 0.85, click: 0.6, entra: 0.75, picado: 0.9, aplausos: 0.85, ovacion: 0.95,
};

let enabled = true;
let ctx = null, out = null;
const last = {};
const buffers = {}, loading = {}, durations = {};
const tags = {};

function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  out = ctx.createGain();
  out.connect(ctx.destination);
  return ctx;
}

function load(file) {
  if (buffers[file] || loading[file]) return loading[file];
  const c = context();
  if (!c) return null;
  loading[file] = fetch(`audio/sfx/${file}.mp3`)
    .then((r) => r.arrayBuffer())
    .then((b) => new Promise((ok, ko) => c.decodeAudioData(b, ok, ko)))
    .then((buf) => { buffers[file] = buf; durations[file] = buf.duration; })
    .catch(() => {});
  return loading[file];
}

function tag(file) {
  if (!tags[file]) { tags[file] = new Audio(`audio/sfx/${file}.mp3`); tags[file].preload = "auto"; }
  return tags[file];
}

function pick(name) {
  const list = BANK[name];
  let file = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && file === last[name]) file = list[(list.indexOf(file) + 1) % list.length];
  last[name] = file;
  return file;
}

export const Sfx = {
  setEnabled(v) { enabled = !!v; },
  /** Precarga todo (llamar tras el primer toque en pantalla). */
  preload() {
    const c = context();
    c?.resume?.();
    Object.values(BANK).flat().forEach((f) => (c ? load(f) : tag(f)));
  },
  /** Suena un efecto. `at`: segundos de retraso (programado con precisión). Devuelve su duración en ms. */
  play(name, { at = 0, vol = 1, rate = 1 } = {}) {
    const list = BANK[name];
    if (!enabled || !list) return 0;
    const file = pick(name);
    const gain = (VOL[name] ?? 0.8) * vol;
    const buf = buffers[file];
    if (ctx && buf) {
      if (ctx.state === "suspended") ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(out);
      src.start(ctx.currentTime + Math.max(0, at));
      return (buf.duration / rate) * 1000;
    }
    load(file);
    const a = tag(file).cloneNode();
    a.volume = Math.min(1, gain);
    if (at > 0) setTimeout(() => a.play().catch(() => {}), at * 1000);
    else a.play().catch(() => {});
    return (durations[file] || 1.5) * 1000;
  },
  /** Una ráfaga: p. ej. tic-tic-tic cada 0,25 s. */
  burst(name, n, gap) {
    for (let i = 0; i < n; i++) this.play(name, { at: i * gap });
  },
};
