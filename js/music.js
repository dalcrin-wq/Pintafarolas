// Música chiptune generada en el navegador: sin archivos ni derechos de autor.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Do – Lam – Fa – Sol, el progreso más alegre y desvergonzado del pop.
const CHORDS = [
  [60, 64, 67, 72],
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [55, 59, 62, 67],
];
const BASS = [36, 33, 29, 31];
const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]);
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2];

let ctx = null, master = null, noise = null;
let timer = null, step = 0, nextTime = 0;
const BPM = 116;
const STEP = 60 / BPM / 4;

function setup() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.11;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3200;
  master.connect(lp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function tone(freq, t, dur, type, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function kick(t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.16);
}

function hat(t) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  s.connect(hp).connect(g).connect(master);
  s.start(t);
  s.stop(t + 0.06);
}

function schedule() {
  while (nextTime < ctx.currentTime + 0.12) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const chord = CHORDS[bar];
    if (BASS_STEPS.has(s)) tone(mtof(BASS[bar]), nextTime, STEP * 1.8, "square", 0.22);
    tone(mtof(chord[ARP[s]] + 12), nextTime, STEP * 0.9, "triangle", 0.16);
    if (s % 8 === 0) kick(nextTime);
    if (s % 4 === 2) hat(nextTime);
    nextTime += STEP;
    step++;
  }
}

export const Music = {
  playing: false,
  start() {
    if (this.playing) return;
    if (!ctx) setup();
    ctx.resume();
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 25);
    this.playing = true;
  },
  stop() {
    clearInterval(timer);
    this.playing = false;
  },
  duck(on) {
    if (master) master.gain.setTargetAtTime(on ? 0.04 : 0.11, ctx.currentTime, 0.2);
  },
};
