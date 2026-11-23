// Movimiento: las letras de los títulos bailan a tempo y los botones se
// desperezan de vez en cuando. Si hay música (la tele), se sincroniza con ella;
// si no (el móvil), sigue un pulso suave al mismo tempo.
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DANCERS = ".logo, .tagline, .stage-head h2, .winner-title, .lobby-side h2, .panel h2, .card h2";
const MENU_BTNS = ".menu .btn"; // en el menú, los botones también bailan, todo el rato
const BPM = 115.04;
const WAVE = 0.07; // desfase entre letras, en fracción del ciclo: hace la ola

let clock = null;
let mood = ""; // «intense|menu»: cambia la amplitud del baile
const letters = []; // { el, anim, i, kind: "l" | "btn" }

function defaultGroove() {
  const beat = 60 / BPM;
  const t = performance.now() / 1000;
  return { beat, phase: (t % (2 * beat)) / (2 * beat), intense: false };
}

// Un ciclo = 2 negras: rebote en cada negra, balanceo a un lado y al otro.
// En el menú, todo baila bastante más: es el escaparate.
function frames(strong, menu, kind = "l") {
  if (kind === "btn") {
    const y = strong ? 7 : 4, r = strong ? 2.5 : 1.5;
    return [
      { transform: "translateY(0) rotate(0deg) scale(1)", easing: "ease-out" },
      { transform: `translateY(-${y}px) rotate(-${r}deg) scale(1.04)`, offset: 0.18, easing: "ease-in" },
      { transform: "translateY(0) rotate(0deg) scale(1)", offset: 0.5, easing: "ease-out" },
      { transform: `translateY(-${y * 0.6}px) rotate(${r}deg) scale(1.02)`, offset: 0.68, easing: "ease-in" },
      { transform: "translateY(0) rotate(0deg) scale(1)" },
    ];
  }
  const k = menu ? 1.9 : 1;
  const y = (strong ? 0.09 : 0.04) * k, r = (strong ? 4 : 1.8) * k, s = 1 + (strong ? 0.06 : 0.015) * k;
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
        const [st, mn] = mood.split("|");
        const anim = l.animate(frames(st === "1", mn === "1"), { duration: 2000 * g.beat, iterations: Infinity });
        letters.push({ el: l, anim, i: idx, kind: "l" });
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

function danceButtons() {
  document.querySelectorAll(MENU_BTNS).forEach((b, n) => {
    if (b.dataset.dance) return;
    b.dataset.dance = "1";
    const [st, mn] = mood.split("|");
    const anim = b.animate(frames(st === "1", mn === "1", "btn"), { duration: 1043, iterations: Infinity });
    letters.push({ el: b, anim, i: 3 + n * 2, kind: "btn" });
  });
}

function sync() {
  const g = (clock && clock()) || defaultGroove();
  const dur = 2000 * g.beat;
  const menu = document.body.dataset.scene === "menu";
  const m = `${g.intense ? 1 : 0}|${menu ? 1 : 0}`;
  if (m !== mood) {
    mood = m;
    for (const x of letters) x.anim.effect.setKeyframes(frames(g.intense, menu, x.kind));
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
    const btns = [...document.querySelectorAll("#app .btn:not(:disabled)")].filter((b) => b.offsetParent && !b.dataset.dance);
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
  const scan = () => { app.querySelectorAll(DANCERS).forEach(split); danceButtons(); sync(); };
  new MutationObserver(scan).observe(app, { childList: true, subtree: true });
  document.fonts?.ready.then(() => app.querySelectorAll(".dance-gradient").forEach(paintGradient));
  addEventListener("resize", () => app.querySelectorAll(".dance-gradient").forEach(paintGradient));
  scan();
  setInterval(sync, 1000);
  wiggleSoon();
}
