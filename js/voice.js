// La presentadora. De momento usa la voz del navegador; más adelante
// se pueden cambiar estas frases por audios grabados con una voz de IA.
import { pick } from "./util.js";

export const LINES = {
  welcome: [
    "¡Hola, artistas sin talento! Bienvenidos.",
    "Bienvenidos al único concurso donde dibujar mal es una ventaja.",
  ],
  lobby: [
    "Escanead el código con el móvil. Sí, con la cámara. No, no hace falta descargar nada.",
    "Mientras llega el resto, dibujad vuestra cara. Ya sé que no os parecerá. Esa es la gracia.",
  ],
  join: [
    "Ha llegado {name}. Qué ilusión. Bueno, normal.",
    "Bienvenido, {name}. Tu autorretrato ya me da miedo.",
    "{name} se une a la fiesta.",
    "Mirad quién ha venido: {name}.",
  ],
  start: [
    "¡Empezamos! Mirad el móvil y dibujad lo que os toque. Nadie más puede ver la frase.",
    "Que empiece el desastre. Mirad vuestro móvil.",
  ],
  drawing: [
    "Tenéis un rato para dibujar. Usad bien el tiempo, Picasso también empezó mal.",
    "A dibujar. Recordad: si sale fatal, alguien acertará menos.",
  ],
  lying: [
    "¿Qué demonios es esto? Escribid una mentira que parezca verdad.",
    "Inventad un título creíble. Mentir bien también es un arte.",
    "Obra de {name}. Escribid qué creéis que es. O mejor, qué queréis que los demás crean.",
  ],
  voting: [
    "Ahora votad cuál es la verdad. Cuidado, que aquí miente hasta el apuntador.",
    "Elegid la respuesta auténtica. Solo una es verdad. Las demás son puro farol.",
  ],
  fooled: [
    "¡Pillados! Era una mentira de {name}.",
    "Os la ha colado {name}. Qué vergüenza.",
    "Mentira, cortesía de {name}.",
  ],
  house: [
    "Esa mentira era mía. Sí, yo también juego sucio.",
  ],
  truth: [
    "¡Y la verdad era esta!",
    "La respuesta correcta era…",
  ],
  noOneTruth: [
    "Nadie acertó. El dibujo era tan malo que es casi arte.",
  ],
  scores: [
    "Vamos a ver la clasificación.",
    "Marcador. Los de abajo, no lloréis, que aún queda partida.",
  ],
  end: [
    "Y el gran ganador es… {name}. Enhorabuena, eres el mejor mentiroso de la sala.",
    "Gana {name}. Dibuja fatal, pero miente de maravilla.",
  ],
};

let enabled = true;
let voice = null;

function chooseVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const es = voices.filter((v) => v.lang?.toLowerCase().startsWith("es"));
  const female = /(helena|laura|elvira|m[oó]nica|paulina|lucia|luc[ií]a|carmen|female|mujer|google español$)/i;
  voice = es.find((v) => v.lang === "es-ES" && female.test(v.name)) ||
          es.find((v) => v.lang === "es-ES") || es.find((v) => female.test(v.name)) || es[0] || null;
}
if (window.speechSynthesis) {
  chooseVoice();
  window.speechSynthesis.onvoiceschanged = chooseVoice;
}

export const Voice = {
  setEnabled(v) { enabled = v; if (!v) window.speechSynthesis?.cancel(); },
  say(key, vars = {}) {
    if (!enabled || !window.speechSynthesis) return;
    let text = Array.isArray(LINES[key]) ? pick(LINES[key]) : (LINES[key] || key);
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 1.05;
    u.pitch = 1.15;
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  },
  stop() { window.speechSynthesis?.cancel(); },
};
