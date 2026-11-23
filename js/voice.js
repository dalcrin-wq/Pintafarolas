// Lola, la presentadora. Audios pregrabados con ElevenLabs (voz «Sofia»),
// uno por frase, en audio/voz/<código>.mp3. El guion completo está en audio/voz/guion.tsv.
import { Music } from "./music.js";

const N = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

// Momento del juego → frases posibles (se elige una al azar sin repetir la última).
export const MOMENTS = {
  menu: N("menu", 3),
  ajustes: N("ajustes", 2),
  sala: N("sala", 3),
  entra: N("entra", 6),
  espera: [...N("espera", 3), "silencio-01"],
  listos: N("listos", 2),
  empieza: N("empieza", 3),
  dibujo: N("dibujo", 3),
  mitad: N("mitad", 3),
  ultimosDibujo: N("ultimos-dib", 4),
  rapidos: N("rapidos", 2),
  mentir: N("mentir", 5),
  prisaMentir: N("prisa-mentir", 2),
  votar: N("votar", 4),
  prisaVotar: N("prisa-votar", 2),
  suspense: N("suspense", 3),
  colo: N("colo", 4),
  coloMuchos: N("colo-muchos", 3),
  casa: N("casa", 3),
  verdad: N("verdad", 4),
  nadie: N("nadie", 3),
  todos: N("todos", 2),
  marcador: N("marcador", 4),
  ultima: N("ultima", 2),
  ganador: N("ganador", 4),
  empate: N("empate", 2),
  otra: N("otra", 2),
  adios: ["adios-01"],
  desconecta: N("desconecta", 2),
  vuelve: ["vuelve-01"],
  error: ["error-01"],
};

let enabled = true;
const lastUsed = {};
const queue = [];
let current = null;
const missing = new Set();

function pickCode(moment) {
  const list = (MOMENTS[moment] || []).filter((c) => !missing.has(c));
  if (!list.length) return null;
  const options = list.length > 1 ? list.filter((c) => c !== lastUsed[moment]) : list;
  const code = options[Math.floor(Math.random() * options.length)];
  lastUsed[moment] = code;
  return code;
}

function playNext() {
  if (current) return;
  if (!queue.length) { Music.duck(false); Music.voiceIdle(); return; }
  const code = queue.shift();
  const audio = new Audio(`audio/voz/${code}.mp3`);
  current = audio;
  Music.duck(true);
  const done = () => {
    if (current !== audio) return;
    current = null;
    playNext();
  };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", () => { missing.add(code); done(); });
  audio.play().catch(done);
}

export const Voice = {
  setEnabled(v) {
    enabled = v;
    if (!v) this.stop();
  },
  /** Dice una frase del momento indicado. `interrupt` corta lo que esté sonando. */
  say(moment, { interrupt = false, ifIdle = false } = {}) {
    if (!enabled) return;
    if (ifIdle && (current || queue.length)) return; // p. ej. si entran tres a la vez, un saludo basta
    const code = pickCode(moment);
    if (!code) return;
    if (interrupt) this.stop();
    if (queue.length >= 2) queue.shift(); // si se acumula, mejor saltarse una que llegar tarde
    queue.push(code);
    playNext();
  },
  stop() {
    queue.length = 0;
    if (current) { current.pause(); current = null; }
    Music.duck(false);
  },
};
