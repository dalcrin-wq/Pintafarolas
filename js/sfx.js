// Efectos de sonido (ElevenLabs Sound Effects). Cada efecto puede tener varias
// versiones: se elige una al azar, sin repetir la última, para que no canse.
const BANK = {
  jugar: ["jugar"],
  click: ["click"],
  entra: ["entra-1", "entra-2"],
  picado: ["picado-1", "picado-2", "picado-3", "picado-4", "picado-5", "picado-6"], // alguien se ha tragado una mentira
  aplausos: ["aplausos-1", "aplausos-2"],
  ovacion: ["ovacion"],
};
const VOL = { jugar: 0.85, click: 0.6, entra: 0.75, picado: 0.9, aplausos: 0.85, ovacion: 0.95 };

let enabled = true;
const last = {};
const cache = {};

function audioFor(file) {
  if (!cache[file]) {
    cache[file] = new Audio(`audio/sfx/${file}.mp3`);
    cache[file].preload = "auto";
  }
  return cache[file];
}

export const Sfx = {
  setEnabled(v) { enabled = !!v; },
  /** Precarga todo (llamar tras el primer toque en pantalla). */
  preload() { Object.values(BANK).flat().forEach(audioFor); },
  /** Suena un efecto. Devuelve cuánto dura (en ms, aproximado) para encadenar la voz detrás. */
  play(name) {
    const list = BANK[name];
    if (!enabled || !list) return 0;
    let file = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && file === last[name]) file = list[(list.indexOf(file) + 1) % list.length];
    last[name] = file;
    const a = audioFor(file).cloneNode();
    a.volume = VOL[name] ?? 0.8;
    a.play().catch(() => {});
    const d = audioFor(file).duration;
    return Number.isFinite(d) ? d * 1000 : 1500;
  },
};
