export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Para comparar textos: sin mayúsculas, tildes, signos ni artículos. */
export function normalize(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(el|la|los|las|un|una|unos|unas|de|del)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function randCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

/** Solo aceptamos imágenes en base64: nada de colar HTML por la puerta de atrás. */
export function safeImg(src) {
  return typeof src === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "";
}

export function avatarHTML(p, cls = "") {
  const src = safeImg(p?.avatar);
  if (src) return `<img class="avatar ${cls}" src="${src}" alt="">`;
  return `<div class="avatar empty ${cls}">${esc((p?.name || "?")[0].toUpperCase())}</div>`;
}

export function sortedPlayers(state) {
  return Object.entries(state?.players || {})
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}
