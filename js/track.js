// Temas musicales (ElevenLabs Music, plan Starter con licencia comercial).
// Tiempos medidos sobre los propios MP3 de audio/musica (en segundos).
//  · start: primer tiempo de compás · drop: entra el bombo · end: fin del último compás útil
//  · Las de la sala suenan enteras y se encadenan (una distinta cada minuto).
//  · Las de las fases son bucles de 8, 12 o 16 compases.
const bars = (bpm, n) => (n * 4 * 60) / bpm;

export const TRACKS = {
  // Sala de espera (y menú): intro sin bombo ni bajo y, hacia el segundo 16, el bombo.
  sala1: { src: "audio/musica/sala1.mp3", bpm: 111.98, start: 1.642, drop: 16.645, end: 57.366 }, // funk silbado
  sala2: { src: "audio/musica/sala2.mp3", bpm: 117.96, start: 1.821, drop: 16.063, end: 56.755 }, // concurso de los 60
  sala3: { src: "audio/musica/sala3.mp3", bpm: 115.99, start: 0.044, drop: 16.597, end: 55.911 }, // espías de comedia
  // Fases con reloj y momentos de tensión: bucles.
  dibujo: { src: "audio/musica/dibujo.mp3", bpm: 125.96, start: 0.517, end: 0.517 + bars(125.96, 12) },
  intriga: { src: "audio/musica/intriga.mp3", bpm: 104.02, start: 1.211, end: 1.211 + bars(104.02, 8) },
  fiesta: { src: "audio/musica/fiesta.mp3", bpm: 149.99, start: 0.05, end: 0.05 + bars(149.99, 16) },
};

export const SALA = ["sala1", "sala2", "sala3"];
export const barOf = (key) => (4 * 60) / TRACKS[key].bpm;
