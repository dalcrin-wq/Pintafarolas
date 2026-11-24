// Lola, la presentadora. Audios pregrabados con ElevenLabs (voz «Sofia»),
// uno por frase, en audio/voz/<código>.mp3. El guion completo está en audio/voz/guion.tsv.
import { Music } from "./music.js";
import { DUR } from "./duraciones.js";

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
  dibujo: N("dibujo", 4),
  mitad: N("mitad", 4),
  ultimosDibujo: N("ultimos-dib", 4),
  rapidos: N("rapidos", 2),
  mentir: N("mentir", 7),
  prisaMentir: N("prisa-mentir", 2),
  votar: N("votar", 5),
  prisaVotar: N("prisa-votar", 2),
  suspense: N("suspense", 3),
  colo: N("colo", 7),
  coloMuchos: N("colo-muchos", 5),
  casa: N("casa", 3),
  nadiePico: N("nadie-pico", 6), // mentiras que no votó nadie: a la papelera
  lider: N("lider", 4),           // alguien se pone en cabeza
  verdad: N("verdad", 6),
  nadie: N("nadie", 5),
  todos: N("todos", 3),
  marcador: N("marcador", 5),
  ultima: N("ultima", 2),
  gala: N("gala", 2),                 // empieza la gala de premios
  premioMinimal: N("premio-minimal", 2),
  premioSerio: N("premio-serio", 2),
  premioColor: N("premio-color", 2),
  premioCredulo: N("premio-credulo", 2),
  premioNadie: N("premio-nadie", 2),
  premioMentiroso: N("premio-mentiroso", 2),
  premioFavorito: N("premio-favorito", 2),
  podio: N("podio", 2),
  tercero: N("tercero", 3),           // sube el 3.º (público de cartón)
  segundo: N("segundo", 3),
  anuncio: N("anuncio", 2),           // apagón: «el ganador es…»
  despedida: N("despedida", 3),       // felicita, da las gracias, último chiste y «¿otra?»
  descanso: N("descanso", 3),         // fin de ronda (no la última)
  remontada: N("remontada", 2),
  ganador: N("ganador", 4),
  ganadorPodio: ["ganador-01", "ganador-03", "ganador-04"], // tras «el ganador es…» no repite la fórmula
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
  audio.__code = code;
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

// En las frases del podio, cuándo acaba el anuncio («En tercer lugar…») y empieza el chiste:
// ahí sube el escalón. Medido sobre la forma de onda (ms).
export const CORTE = {
  "tercero-01": 1450, "tercero-02": 1650, "tercero-03": 780,
  "segundo-01": 1350, "segundo-02": 1500, "segundo-03": 700,
};

export const Voice = {
  /** Elige ya qué frase dirá en ese momento (para medir la coreografía antes de empezar). */
  pick: (moment) => pickCode(moment),
  /** Cuánto dura una frase, en ms (con o sin sonido: el ritmo no cambia al silenciar). */
  ms: (code) => (code ? DUR[code] || 3000 : 0),
  /** Cuánto le queda por hablar (lo que está diciendo + lo que tiene en cola), en ms. */
  restante() {
    if (!enabled) return 0;
    let ms = queue.reduce((n, c) => n + (DUR[c] || 3000), 0);
    if (current) {
      const d = current.duration, t = current.currentTime;
      ms += Number.isFinite(d) && d > 0 ? Math.max(0, d - t) * 1000 : DUR[current.__code] || 2000;
    }
    return ms;
  },
  /** Dice exactamente esa frase. */
  sayCode(code, { interrupt = false } = {}) {
    if (!enabled || !code || missing.has(code)) return;
    if (interrupt) queue.length = 0;
    queue.push(code);
    playNext();
  },
  setEnabled(v) {
    enabled = v;
    if (!v) this.stop();
  },
  /** Dice una frase del momento indicado.
   *  `interrupt`: es lo más urgente; se salta lo que estuviera en cola, pero NUNCA corta a Lola
   *  a media frase: espera a que acabe la que está diciendo. (Para cortar de verdad, stop().) */
  say(moment, { interrupt = false, ifIdle = false } = {}) {
    if (!enabled) return;
    if (ifIdle && (current || queue.length)) return; // p. ej. si entran tres a la vez, un saludo basta
    const code = pickCode(moment);
    if (!code) return;
    if (interrupt) queue.length = 0;
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
