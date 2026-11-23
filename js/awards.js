// Premios del final. Se calculan a partir de la galería de la partida
// (un registro por dibujo, que escribe la tele en cada destape) y de los ♥ de los móviles.
// Lo usan la tele (la gala) y los móviles («tus premios»).

const count = (o) => Object.keys(o || {}).length;
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString("es-ES");
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Los ganadores de un máximo (o mínimo): todos los empatados. */
function best(map, { min = false, floor = 1 } = {}) {
  const entries = Object.entries(map).filter(([, v]) => (min ? true : v >= floor));
  if (!entries.length) return { winners: [], value: 0 };
  const value = min ? Math.min(...entries.map(([, v]) => v)) : Math.max(...entries.map(([, v]) => v));
  return { winners: entries.filter(([, v]) => v === value).map(([u]) => u), value };
}

export function computeAwards(state) {
  const players = state.players || {};
  const gallery = Object.entries(state.gallery || {})
    .map(([key, g]) => ({ key, ...g }))
    .filter((g) => players[g.artist]);
  const likes = state.likes || {};
  const awards = [];
  if (!gallery.length) return awards;

  // 1) Dibujo favorito: el que más ♥ recibió.
  const likeBy = Object.fromEntries(gallery.map((g) => [g.key, count(likes[g.key])]));
  const fav = best(likeBy);
  if (fav.winners.length) {
    const ds = gallery.filter((g) => fav.winners.includes(g.key));
    awards.push({
      id: "favorito", voice: "premioFavorito", title: "Dibujo favorito", desc: "El que más ♥ se llevó del público",
      winners: [...new Set(ds.map((g) => g.artist))], img: ds[0].img, caption: ds[0].prompt,
      stat: plural(fav.value, "♥", "♥"),
    });
  }

  // 2) Mentiroso de oro: quien más gente engañó.
  const fooled = {};
  for (const g of gallery) for (const [u, n] of Object.entries(g.fooled || {})) fooled[u] = (fooled[u] || 0) + n;
  const liar = best(fooled);
  if (liar.winners.length) {
    awards.push({
      id: "mentiroso", voice: "premioMentiroso", title: "Mentiroso de oro", desc: "Quien más gente engañó",
      winners: liar.winners, stat: `Engañó ${plural(liar.value, "vez", "veces")}`,
    });
  }

  // 3) Se lo cree todo: quien más mentiras se tragó (las de la casa también cuentan).
  const gulped = {};
  for (const g of gallery) for (const u of Object.keys(g.gulped || {})) gulped[u] = (gulped[u] || 0) + 1;
  const gull = best(gulped);
  if (gull.winners.length) {
    awards.push({
      id: "credulo", voice: "premioCredulo", title: "Se lo cree todo", desc: "Quien más mentiras se tragó",
      winners: gull.winners, stat: `Se tragó ${plural(gull.value, "mentira", "mentiras")}`,
    });
  }

  // 4) Nadie entendió nada: un dibujo que no acertó nadie (el que más despistó).
  const lost = gallery.filter((g) => !g.truthVotes && g.voters > 0)
    .sort((a, b) => sum(b.fooled) + count(b.gulped) - (sum(a.fooled) + count(a.gulped)));
  if (lost.length) {
    awards.push({
      id: "nadie", voice: "premioNadie", title: "Nadie entendió nada", desc: "El dibujo que no acertó nadie",
      winners: [lost[0].artist], img: lost[0].img, caption: lost[0].prompt, stat: `Era «${lost[0].prompt}»`,
    });
  }

  // 5 y 6) Trazos por dibujo: escuela minimalista y quien se lo tomó en serio.
  const strokes = {}, drawn = {};
  for (const g of gallery) {
    if (g.strokes == null) continue; // dibujo sin datos de trazos (móvil antiguo)
    strokes[g.artist] = (strokes[g.artist] || 0) + (+g.strokes || 0);
    drawn[g.artist] = (drawn[g.artist] || 0) + 1;
  }
  const avg = Object.fromEntries(Object.keys(drawn).map((u) => [u, strokes[u] / drawn[u]]));
  if (Object.keys(avg).length >= 2) {
    const lo = best(avg, { min: true }), hi = best(avg, { floor: 0 });
    if (hi.value > lo.value) {
      awards.push({
        id: "minimal", voice: "premioMinimal", title: "Escuela minimalista", desc: "Menos trazos por dibujo",
        winners: lo.winners, stat: `${fmt(lo.value)} trazos por dibujo`,
      });
      awards.push({
        id: "serio", voice: "premioSerio", title: "Se lo tomó en serio", desc: "Más trazos por dibujo",
        winners: hi.winners, stat: `${fmt(hi.value)} trazos por dibujo`,
      });
    }
  }

  // 7) Alérgico al color: una sola tinta en todos sus dibujos.
  const mono = Object.keys(drawn).filter((u) => gallery.filter((g) => g.artist === u).every((g) => g.inks != null && +g.inks <= 1));
  if (mono.length) {
    awards.push({
      id: "color", voice: "premioColor", title: "Alérgico al color", desc: "Una sola tinta en toda la partida",
      winners: mono, stat: mono.length === Object.keys(drawn).length ? "Todos. Qué tristeza cromática" : "Ni un toque de color",
    });
  }
  return awards;
}
