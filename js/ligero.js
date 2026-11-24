// Modo ligero para teles y aparatos lentos: sin filtros de papel roto, sin fundidos del cuadro
// de fondo y sin mezclas de color. Se activa solo (navegador de tele, o si va a tirones al
// medirlo), con ?ligero=1 / ?ligero=0 en la dirección, o desde Ajustes. Se recuerda.
const KEY = "gt_ligero";
const TELE = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|AFT[A-Z]|CrKey|Android TV|GoogleTV|AppleTV|PlayStation|Xbox|Opera TV|VIDAA|Hisense|Philips|NETTV|Roku|Viera|SonyCEBrowser/i;

function leer() {
  const q = new URLSearchParams(location.search).get("ligero");
  if (q === "1" || q === "0") { try { localStorage.setItem(KEY, q); } catch {} return q === "1"; }
  try { const v = localStorage.getItem(KEY); if (v === "1" || v === "0") return v === "1"; } catch {}
  return TELE.test(navigator.userAgent);
}

export function esLigero() { return document.documentElement.classList.contains("ligero"); }

export function ponLigero(on, recordar = true) {
  document.documentElement.classList.toggle("ligero", !!on);
  if (recordar) try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  dispatchEvent(new Event("ligero"));
}

ponLigero(leer(), false);

// Si nadie ha decidido aún, mide los primeros segundos: si va a menos de ~35 fotogramas
// por segundo, pasa a ligero sin preguntar.
(() => {
  try { if (localStorage.getItem(KEY) != null || esLigero()) return; } catch { return; }
  let n = 0, t0 = 0;
  const paso = (t) => {
    if (!t0) t0 = t;
    n++;
    if (t - t0 < 3000) return requestAnimationFrame(paso);
    const fps = (n * 1000) / (t - t0);
    if (fps < 35 && !document.hidden) ponLigero(true);
  };
  setTimeout(() => requestAnimationFrame(paso), 1500);
})();
