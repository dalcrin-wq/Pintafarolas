// Temas musicales (ElevenLabs Music, plan Starter con licencia comercial).
// Los dos van a 115 BPM y comparten rejilla: 8 compases de intro sin bombo ni bajo
// y, en el compás 9, entra el bombo. Tiempos medidos sobre los MP3 de audio/musica.
export const BPM = 115.04;
const BAR = (4 * 60) / BPM;
const START = 0.032;              // primer tiempo del compás 1
const DROP = START + 8 * BAR;     // ≈ 16.72 s: entra el bombo
const END = DROP + 6 * BAR;       // ≈ 29.24 s: fin del último compás completo

export const TRACKS = {
  // «Risas de la noche de juegos»: sala de espera, menú, votar, marcador.
  sala: { src: "audio/musica/sala.mp3", start: START, calmEnd: START + 4 * BAR, drop: DROP, end: END },
  // «Board Game Boogie»: dibujar e inventar títulos (solo la parte con bombo).
  dibujo: { src: "audio/musica/dibujo.mp3", start: START, calmEnd: START + 4 * BAR, drop: DROP, end: END },
};
