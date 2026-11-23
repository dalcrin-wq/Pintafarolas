// Movimiento: las letras de los títulos bailan a tempo y los botones se
// desperezan de vez en cuando. Si hay música (la tele), se sincroniza con ella;
// si no (el móvil), sigue un pulso suave al mismo tempo.
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DANCERS = ".logo, .stage-head h2, .winner-title, .lobby-side h2, .panel h2, .card h2";
const BPM = 115.04;
const WAVE = 0.07; // desfase entre letras, en fracción del ciclo: hace la ola

let clock = null;
let intense = false;
const letters = []; // { el, anim, i }

function defaultGroove() {
  const beat = 60 / BPM;
  const t = performance.now() / 1000;
  return { beat, phase: (t % (2 * beat)) / (2 * beat), intense: false };
}

// Un ciclo = 2 negras: rebote en cada negra, balanceo a un lado y al otro.
function frames(strong) {
  const y = strong ? 0.09 : 0.035, r = strong ? 4 : 1.6, s = strong ? 1.06 : 1.01;
  return [
    { transform: "translateY(0) rotate(0deg) scale(1)", easing: "ease-out" },
    { transform: `translateY(-${y}em) rotate(-${r}deg) scale(${s})`, offset: 0.18, easing: "ease-in" },
    { transform: "translateY(0) rotate(0deg) scale(1)", offset: 0.5, easing: "ease-out" },
    { transform: `translateY(-${y * 0.7}em) rotate(${r}deg) scale(1)`, offset: 0.68, easing: "ease-in" },
    { transform: "translateY(0) rotate(0deg) scale(1)" },
  ];
}

// Parte el título en letras (agrupadas por palabras para que no se corten),
// sin tocar los elementos de dentro, como el <small> de «Ronda 1 de 2».
function split(el) {
  if (el.dataset.dance) return;
  el.dataset.dance = "1";
  el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
  const g = defaultGroove();
  let i = 0;
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
    const frag = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach((word) => {
      if (!word) return;
      if (/^\s+$/.test(word)) { frag.append(word); return; }
      const w = document.createElement("span");
      w.className = "w";
      w.setAttribute("aria-hidden", "true");
      for (const ch of word) {
        const l = document.createElement("span");
        l.className = "l";
        l.textContent = ch;
        w.append(l);
        const idx = i++;
        const anim = l.animate(frames(intense), { duration: 2000 * g.beat, iterations: Infinity });
        letters.push({ el: l, anim, i: idx });
      }
      frag.append(w);
    });
    node.replaceWith(frag);
  }
  paintGradient(el);
}

// Los títulos con degradado (logo, ganador): cada letra muestra su trozo del degradado de la palabra entera.
function paintGradient(el) {
  const cs = getComputedStyle(el);
  if (!el.dataset.grad) {
    if (!(cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text")) return;
    el.dataset.grad = cs.backgroundImage;
    el.style.backgroundImage = "none"; // el degradado pasa a las letras
    el.classList.add("dance-gradient");
  }
  const box = el.getBoundingClientRect();
  for (const l of el.querySelectorAll(".l")) {
    const r = l.getBoundingClientRect();
    l.style.backgroundImage = el.dataset.grad;
    l.style.backgroundSize = `${box.width}px ${box.height}px`;
    l.style.backgroundPosition = `${box.left - r.left}px ${box.top - r.top}px`;
  }
}

function sync() {
  const g = (clock && clock()) || defaultGroove();
  const dur = 2000 * g.beat;
  if (g.intense !== intense) {
    intense = g.intense;
    for (const x of letters) x.anim.effect.setKeyframes(frames(intense));
  }
  for (let k = letters.length - 1; k >= 0; k--) {
    const x = letters[k];
    if (!x.el.isConnected) { x.anim.cancel(); letters.splice(k, 1); continue; }
    x.anim.effect.updateTiming({ duration: dur });
    x.anim.currentTime = ((g.phase + 1 - (x.i * WAVE) % 1) % 1) * dur;
  }
}

// De vez en cuando, un botón se despereza (justo en un tiempo del compás).
function wiggleSoon() {
  setTimeout(() => {
    const btns = [...document.querySelectorAll("#app .btn:not(:disabled)")].filter((b) => b.offsetParent);
    const b = btns[Math.floor(Math.random() * btns.length)];
    const g = (clock && clock()) || defaultGroove();
    const toBeat = ((1 - ((g.phase * 2) % 1)) % 1) * g.beat * 1000;
    if (b && !b.matches(":active")) {
      setTimeout(() => b.animate([
        { transform: "rotate(0) scale(1)" },
        { transform: "rotate(-3deg) scale(1.06)", offset: 0.25 },
        { transform: "rotate(2.5deg) scale(1.04)", offset: 0.55 },
        { transform: "rotate(-1deg) scale(1.01)", offset: 0.8 },
        { transform: "rotate(0) scale(1)" },
      ], { duration: 2 * g.beat * 1000, easing: "ease-in-out" }), toBeat);
    }
    wiggleSoon();
  }, 4000 + Math.random() * 5000);
}

export function startMotion(grooveClock) {
  if (REDUCE) return;
  clock = grooveClock || null;
  const app = document.getElementById("app");
  const scan = () => { app.querySelectorAll(DANCERS).forEach(split); sync(); };
  new MutationObserver(scan).observe(app, { childList: true, subtree: true });
  document.fonts?.ready.then(() => app.querySelectorAll(".dance-gradient").forEach(paintGradient));
  addEventListener("resize", () => app.querySelectorAll(".dance-gradient").forEach(paintGradient));
  scan();
  setInterval(sync, 1000);
  wiggleSoon();
}
