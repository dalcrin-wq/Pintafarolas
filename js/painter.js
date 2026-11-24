// El pintor: pinta el fondo de la app a pinceladas, como un cuadro.
// Reglas de luz (sacadas de las referencias de Diego):
//  · La luz es cálida y la sombra fría: ningún color de sombra es más cálido
//    que el color más frío de la luz.
//  · Casi todo va desaturado; el color fuerte vive en la transición entre luz
//    y sombra (rosas, violetas, cobaltos).
//  · Mucho trazo visible: la textura es la gracia.
// Cada fase tiene su escena (de dónde viene la luz y con qué paleta).
// Se elige con <body data-scene="...">; al cambiarla, el cuadro se repinta con fundido.

// Rampas de sombra (0) a luz (1). La banda central es la transición saturada.
const RAMPS = {
  // Sombras: gris azulado y verde salvia (frías, nunca negras). Luces: oro y crema.
  // La transición pasa por verdes lima, con algún rosa suelto.
  tarde: ["#4a5a70", "#587286", "#628a8a", "#7fa37c", "#b3c445", "#e2c568", "#eedb9e", "#f5edd2"],
  manana: ["#46606a", "#53787c", "#609488", "#7db182", "#b9cc3e", "#ded77e", "#ece6ac", "#f6f2da"],
  noche: ["#3b4866", "#475d7c", "#527590", "#5f8f98", "#a6b84a", "#e2b064", "#efd184", "#f6e9bc"],
  fiesta: ["#4c5e86", "#5a76a2", "#6698a4", "#88b67e", "#b9c245", "#eaa95e", "#f2d676", "#f8eec8"],
  lavanda: ["#4f5a80", "#5f6c96", "#7082a8", "#8f9bc0", "#c98aa8", "#eab48a", "#f3d9a2", "#f8efd8"],
  menta: ["#44626e", "#4f7a80", "#5c958e", "#78b09a", "#a9d06a", "#e6d58a", "#f1e6b6", "#f8f2dc"],
};

// Escena: luz (x, y en fracción de pantalla), alcance de la luz y rampa.
const SCENES = {
  menu: { light: [0.5, 0.38], spread: 0.95, ramp: "tarde" },
  settings: { light: [0.5, 0.3], spread: 0.8, ramp: "tarde" },
  lobby: { light: [0.2, 0.32], spread: 0.85, ramp: "tarde" },
  join: { light: [0.5, 0.3], spread: 0.85, ramp: "tarde" },
  drawing: { light: [0.78, 0.18], spread: 0.95, ramp: "manana" },
  lying: { light: [0.28, 0.45], spread: 0.8, ramp: "noche" },
  voting: { light: [0.28, 0.45], spread: 0.8, ramp: "noche" },
  reveal: { light: [0.5, 0.42], spread: 0.8, ramp: "noche" },
  scores: { light: [0.5, 0.22], spread: 0.85, ramp: "tarde" },
  end: { light: [0.5, 0.35], spread: 0.95, ramp: "fiesta" },
  locked: { light: [0.5, 0.3], spread: 0.7, ramp: "noche" },
};

// Cada pocos segundos el cuadro se repinta con otra paleta de la misma familia.
const FAMILY = {
  noche: ["noche", "lavanda", "menta"],
  otros: ["tarde", "lavanda", "manana", "fiesta", "menta"],
};
function variantOf(sceneName, i) {
  const scene = SCENES[sceneName] || SCENES.menu;
  const fam = scene.ramp === "noche" ? FAMILY.noche : FAMILY.otros;
  const rest = fam.filter((r) => r !== scene.ramp);
  return i === 0 ? scene.ramp : rest[(i - 1) % rest.length];
}

/* ---------- utilidades ---------- */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;

function makeNoise(rand) {
  const N = 64, g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const at = (x, y) => g[((y & (N - 1)) * N) + (x & (N - 1))];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), xf), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), xf), yf);
  };
}

function rampColor(stops, t) {
  t = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const a = stops[i], b = stops[i + 1], f = t - i;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

// Desatura hacia el gris de su misma luminosidad.
function desat([r, g, b], k) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [lerp(r, y, k), lerp(g, y, k), lerp(b, y, k)];
}

/* ---------- el cuadro ---------- */
function paint(canvas, sceneName, variant = 0) {
  const scene = SCENES[sceneName] || SCENES.menu;
  const stops = RAMPS[variantOf(sceneName, variant)].map(hex);
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  const rand = rng(7 + variant * 7919 + sceneName.length * 101);
  const noise = makeNoise(rand);
  const diag = Math.hypot(W, H);
  // La luz se mueve un poco en cada variante, como si pasara una nube.
  const jx = variant ? (rand() - 0.5) * 0.16 : 0, jy = variant ? (rand() - 0.5) * 0.12 : 0;
  const [lx, ly] = [(scene.light[0] + jx) * W, (scene.light[1] + jy) * H];
  const scale = Math.sqrt((W * H) / (1600 * 900));

  // Valor (cuánta luz) en cada punto: foco + manchas grandes de ruido.
  const value = (x, y) => {
    const d = Math.hypot(x - lx, (y - ly) * 1.25) / (diag * scene.spread);
    const base = 1 - Math.pow(Math.min(1, d), 0.85);
    const n = noise(x / 260, y / 260) - 0.5 + (noise(x / 90 + 40, y / 90) - 0.5) * 0.4;
    const ground = Math.max(0, y / H - 0.75) * 0.25; // la parte baja, algo en sombra
    return Math.min(1, Math.max(0, 0.2 + base * 0.78 + n * 0.3 - ground));
  };
  // Dirección del trazo: un campo suave que gira alrededor de la luz.
  // Dirección del trazo: diagonal de base, y cada zona del cuadro con su propia inclinación
  // (en parches, como hace un pintor al ir rellenando formas), no un remolino.
  const angle = (x, y) => {
    const n = noise(x / 170 + 9, y / 170 + 3);
    return -0.75 + Math.round((n - 0.5) * 6) * 0.38;
  };

  const colorAt = (v) => {
    const c = rampColor(stops, v + (rand() - 0.5) * 0.12);
    // Lejos de la transición, desaturado; en la transición (v≈0.35–0.6), color vivo.
    const mid = 1 - Math.min(1, Math.abs(v - 0.5) / 0.11);
    const k = Math.max(0, 0.5 - mid * 0.42 + (rand() - 0.5) * 0.22);
    return desat(c, k);
  };

  const stroke = (x, y, len, wid, alpha, v) => {
    const a = angle(x, y) + (rand() - 0.5) * 0.5;
    const c = colorAt(v);
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
    const bend = (rand() - 0.5) * len * 0.35;
    const nx = -Math.sin(a), ny = Math.cos(a);
    // Pincel de 3 cerdas: tres pasadas paralelas con matiz y grosor distintos.
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * wid * 0.32;
      const j = (rand() - 0.5) * 18;
      ctx.strokeStyle = `rgba(${c[0] + j | 0},${c[1] + j | 0},${c[2] + j * 0.6 | 0},${alpha * (k === 1 ? 1 : 0.7)})`;
      ctx.lineWidth = wid * (k === 1 ? 0.7 : 0.45);
      ctx.beginPath();
      ctx.moveTo(x - dx + nx * off, y - dy + ny * off);
      ctx.quadraticCurveTo(x + nx * (off + bend), y + ny * (off + bend), x + dx + nx * off, y + dy + ny * off);
      ctx.stroke();
    }
  };

  ctx.lineCap = "butt"; // pincel plano: manchas con esquinas, no churros
  // 1) Imprimación: veladura en degradado con el color medio de cada zona.
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, diag * scene.spread);
  for (let i = 0; i <= 6; i++) {
    const c = desat(rampColor(stops, 0.86 - i * 0.15), 0.35);
    g.addColorStop(i / 6, `rgb(${c.map((n) => n | 0)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 2) Manchas grandes, 3) trazos medios, 4) detalle (más detalle donde hay luz).
  const passes = [
    { n: 900, len: [50, 120], wid: [30, 60], alpha: [0.22, 0.42] },
    { n: 3200, len: [16, 48], wid: [10, 22], alpha: [0.5, 0.85] },
    { n: 1900, len: [7, 22], wid: [4, 10], alpha: [0.55, 0.9], lit: true },
  ];
  for (const p of passes) {
    const n = Math.round(p.n * scale * scale);
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * H;
      const v = value(x, y);
      if (p.lit && rand() > 0.25 + v) continue;
      stroke(x, y, lerp(p.len[0], p.len[1], rand()) * scale, lerp(p.wid[0], p.wid[1], rand()) * scale, lerp(p.alpha[0], p.alpha[1], rand()), v);
    }
  }
  // 5) Chispas de color complementario, pocas (el verde y el cobalto de las referencias).
  const sparks = [[182, 201, 58], [182, 201, 58], [68, 101, 178], [222, 93, 132]];
  for (let i = 0, n = Math.round(70 * scale * scale); i < n; i++) {
    const x = rand() * W, y = rand() * H, v = value(x, y);
    if (v < 0.35 || v > 0.85) continue;
    const c = sparks[(rand() * sparks.length) | 0];
    ctx.strokeStyle = `rgba(${c},${0.35 + rand() * 0.4})`;
    ctx.lineWidth = (5 + rand() * 7) * scale;
    const a = angle(x, y), l = (6 + rand() * 12) * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // 6) Viñeta fría: los bordes del cuadro se van a la sombra (azulada, nunca negra).
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, diag * 0.62);
  vg.addColorStop(0, "rgba(60,76,110,0)");
  vg.addColorStop(1, "rgba(60,76,110,.3)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- textura de lienzo para tarjetas ---------- */
function paperTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 220;
  const ctx = c.getContext("2d");
  const rand = rng(42);
  ctx.lineCap = "round";
  for (let i = 0; i < 260; i++) {
    const x = rand() * 220, y = rand() * 220, a = -0.5 + (rand() - 0.5) * 0.9, l = 10 + rand() * 34;
    const warm = rand() > 0.5;
    ctx.strokeStyle = warm ? `rgba(255,238,190,${0.25 + rand() * 0.35})` : `rgba(120,130,170,${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 2 + rand() * 6;
    for (const ox of [-220, 0, 220]) for (const oy of [-220, 0, 220]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  return c.toDataURL("image/png");
}

// Filtro SVG para que los bordes parezcan recortados a mano.
function roughFilter() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.innerHTML = `
    <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="rough-small" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="8" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
  document.body.appendChild(svg);
}

/* ---------- montaje ---------- */
export function startPainter() {
  roughFilter();
  document.documentElement.style.setProperty("--paper-tex", `url(${paperTexture()})`);

  const layer = document.createElement("div");
  layer.className = "painting";
  layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);

  const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // En modo ligero: un cuadro quieto por escena, sin zoom, sin fundidos y a resolución 1.
  const ligero = () => document.documentElement.classList.contains("ligero");
  const CYCLE = 7000; // cada 7 s, otro cuadro parecido con otros colores
  const FADE = 3500;  // fundido largo y suave entre cuadros
  let current = null, painted = "", timer = null, variant = 0, lastSwap = 0;

  const show = (scene, v) => {
    const reduce = reduceMQ || ligero();
    const ratio = ligero() ? Math.min(1, 1280 / innerWidth) : Math.min(window.devicePixelRatio || 1, 1.5);
    const c = document.createElement("canvas");
    c.width = Math.round(innerWidth * ratio);
    c.height = Math.round(innerHeight * ratio);
    paint(c, scene, v);
    // Zoom lentísimo hacia un punto cercano a la luz (cada cuadro, el suyo).
    const sc = SCENES[scene] || SCENES.menu;
    c.style.transformOrigin = `${Math.round((sc.light[0] + (Math.random() - 0.5) * 0.3) * 100)}% ${Math.round((sc.light[1] + (Math.random() - 0.5) * 0.3) * 100)}%`;
    // Y además gira un poco, cada cuadro hacia un lado.
    c.style.setProperty("--giro", `${(Math.random() < 0.5 ? -1 : 1) * (3.5 + Math.random() * 2)}deg`);
    layer.appendChild(c);
    const old = current;
    current = c;
    lastSwap = performance.now();
    // El fundido va con la Web Animations API: con una transición CSS, si el navegador
    // no llega a pintar el estado inicial, el cambio sale de golpe.
    if (!old || reduce) {
      c.style.opacity = 1;
      if (old) old.remove();
      return;
    }
    const fade = c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: "ease-in-out", fill: "forwards" });
    fade.finished.then(() => { if (old.isConnected && current !== old) old.remove(); }).catch(() => {});
  };

  const repaint = () => {
    const scene = document.body.dataset.scene || "menu";
    const size = `${innerWidth}x${innerHeight}`;
    if (`${scene}@${size}` === painted) return;
    if (!painted.startsWith(`${scene}@`)) variant = 0; // escena nueva: empieza por su paleta
    painted = `${scene}@${size}`;
    show(scene, variant);
  };

  new MutationObserver(repaint).observe(document.body, { attributes: true, attributeFilter: ["data-scene"] });
  addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(repaint, 250); });
  repaint();

  addEventListener("ligero", () => { painted = ""; repaint(); });
  if (!reduceMQ) {
    setInterval(() => {
      if (ligero() || document.hidden || performance.now() - lastSwap < CYCLE - 200) return;
      variant++;
      show(document.body.dataset.scene || "menu", variant);
    }, 500);
  }
}

/** Cambia la escena del cuadro (menu, lobby, drawing, voting…). */
export function setScene(name) {
  if (document.body.dataset.scene !== name) document.body.dataset.scene = name;
}
