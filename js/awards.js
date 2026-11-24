// Premios del final. Cada premio se lo lleva UN DIBUJO concreto (o una mentira sobre un dibujo):
// la gala es para recordar los momentos de la partida, no para enseñar medias.
// Se calcula a partir de la galería (un registro por dibujo que escribe la tele en cada destape)
// y de los ♥ de los móviles. Lo usan la tele (la gala) y los móviles («tus premios»).

const count = (o) => Object.keys(o || {}).length;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const vals = (o) => Object.values(o || {});

export function computeAwards(state) {
  const players = state.players || {};
  const gallery = Object.entries(state.gallery || {})
    .map(([key, g]) => ({ key, ...g, mentiras: vals(g.mentiras).map((m) => ({ ...m, authors: vals(m.authors) })) }))
    .filter((g) => players[g.artist]);
  const likes = state.likes || {};
  const awards = [];
  if (!gallery.length) return awards;
  const era = (g) => (g.prompt ? `Era «${g.prompt}»` : "");
  const conTrazos = gallery.filter((g) => g.strokes != null && g.strokes > 0);

  // Dibujo favorito: el que más ♥ recibió.
  const fav = [...gallery].sort((a, b) => count(likes[b.key]) - count(likes[a.key]))[0];
  if (fav && count(likes[fav.key])) {
    awards.push({ id: "favorito", voice: "premioFavorito", title: "Dibujo favorito", desc: "El que más ♥ se llevó del público",
      winners: [fav.artist], img: fav.img, caption: era(fav), stat: plural(count(likes[fav.key]), "♥", "♥") });
  }

  // Mentiroso de oro: LA mentira que más gente engañó, con su dibujo.
  let best = null;
  for (const g of gallery) for (const m of g.mentiras) if (!best || m.votes > best.m.votes) best = { g, m };
  if (best && best.m.votes) {
    awards.push({ id: "mentiroso", voice: "premioMentiroso", title: "Mentiroso de oro", desc: "La mentira que más gente se tragó",
      winners: best.m.authors, img: best.g.img, caption: `Dijo que esto era «${best.m.text}»`, stat: `Engañó a ${plural(best.m.votes, "persona", "personas")}` });
  }

  // Se lo cree todo: quien más picó, con el dibujo y la trola que se creyó.
  const picadas = {};
  for (const g of gallery) for (const [u, txt] of Object.entries(g.gulped || {})) (picadas[u] ||= []).push({ g, txt });
  const credulo = Object.entries(picadas).sort((a, b) => b[1].length - a[1].length)[0];
  if (credulo && players[credulo[0]]) {
    const [u, lista] = credulo;
    const ej = lista.find((x) => typeof x.txt === "string") || lista[0];
    awards.push({ id: "credulo", voice: "premioCredulo", title: "Se lo cree todo", desc: "Quien más mentiras se tragó",
      winners: [u], img: ej.g.img, caption: typeof ej.txt === "string" ? `Se creyó que esto era «${ej.txt}»` : era(ej.g),
      stat: `Picó ${plural(lista.length, "vez", "veces")}` });
  }

  // Nadie entendió nada: el dibujo que no acertó nadie (el que más despistó).
  const lost = gallery.filter((g) => !g.truthVotes && g.voters > 0)
    .sort((a, b) => count(b.gulped) - count(a.gulped));
  if (lost.length) {
    awards.push({ id: "nadie", voice: "premioNadie", title: "Nadie entendió nada", desc: "El dibujo que no acertó nadie",
      winners: [lost[0].artist], img: lost[0].img, caption: era(lost[0]), stat: "0 aciertos" });
  }

  // Escuela minimalista y Se lo tomó en serio: el dibujo con menos y con más trazos.
  if (conTrazos.length >= 2) {
    const orden = [...conTrazos].sort((a, b) => a.strokes - b.strokes);
    const lo = orden[0], hi = orden[orden.length - 1];
    if (hi.strokes > lo.strokes) {
      awards.push({ id: "minimal", voice: "premioMinimal", title: "Escuela minimalista", desc: "El dibujo con menos trazos",
        winners: [lo.artist], img: lo.img, caption: era(lo), stat: plural(lo.strokes, "trazo", "trazos") });
      awards.push({ id: "serio", voice: "premioSerio", title: "Se lo tomó en serio", desc: "El dibujo más currado",
        winners: [hi.artist], img: hi.img, caption: era(hi), stat: plural(hi.strokes, "trazo", "trazos") });
    }
  }

  // Alérgico al color: quien no usó más que una tinta en toda la partida (si no fueron todos),
  // con su dibujo más elaborado.
  const artistas = [...new Set(gallery.map((g) => g.artist))];
  const mono = artistas.filter((u) => gallery.filter((g) => g.artist === u).every((g) => g.inks != null && +g.inks <= 1));
  if (mono.length && mono.length < artistas.length) {
    const suyos = gallery.filter((g) => mono.includes(g.artist)).sort((a, b) => (b.strokes || 0) - (a.strokes || 0));
    awards.push({ id: "color", voice: "premioColor", title: "Alérgico al color", desc: "Ni un toque de color en toda la partida",
      winners: mono, img: suyos[0].img, caption: era(suyos[0]), stat: "Una sola tinta. Siempre." });
  }
  return awards;
}
