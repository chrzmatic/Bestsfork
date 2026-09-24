import { groupScore } from './scoring.js';
import { matchesPeriod } from './periods.js';

export const DEFAULT_FILTERS = { tagMode: 'all', tagIds: [], includeRetro: true, year: null, period: 'all', genreId: null };

const saoPauloYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const byTitle = (a, b) => (a.album.title || '').localeCompare(b.album.title || '', 'pt-BR');

export function albumGroupScore(album, result, memberUids) {
  if (!result) return null;
  if (album.retro || result.retro) return isNum(result.groupScore) ? result.groupScore : null;
  const score = groupScore(result.memberScores, memberUids);
  return score ?? (isNum(result.groupScore) ? result.groupScore : null);
}

export function albumEvalYear(album, result) {
  if (album.retro) return album.evaluatedYear ?? null;
  const d = result?.completedAt;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return Number(saoPauloYear.format(d));
}

// Data opcional dos retroativos, gravada como 'AAAA-MM-DD' ou 'AAAA-MM-DDTHH:MM', sem fuso.
export function retroEvalDate(album) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(album?.evaluatedAt || '');
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
  return Number.isNaN(date.getTime()) ? null : { date, hasTime: hh != null };
}

// Junta os campos de data e hora do formulário no formato de retroEvalDate.
export function evalDateValue(dateText, timeText) {
  const d = String(dateText ?? '').trim();
  const t = String(timeText ?? '').trim();
  if (!d) return t ? { value: null, year: null, error: 'Preencha a data para usar a hora.' } : { value: null, year: null, error: null };
  const value = t ? `${d}T${t.slice(0, 5)}` : d;
  const parsed = retroEvalDate({ evaluatedAt: value });
  if (!parsed) return { value: null, year: null, error: 'Data de avaliação inválida.' };
  return { value, year: parsed.date.getFullYear(), error: null };
}

// Notas das listas de faixas, de 0 a 5: 4 pontos vêm da média do grupo (80%) e 1 das escolhas
// feitas nas avaliações (20%). A parte das escolhas é a fração do máximo possível com esses membros.

// Mais queridas: cada membro dá até 3 pontos a uma faixa (1º lugar), então o máximo é 3 por membro.
export function lovedScore(avg, pickPoints, members) {
  const picks = members > 0 ? Math.min(pickPoints / (3 * members), 1) : 0;
  return avg * 0.8 + picks;
}

// Menos queridas, o espelho: o quanto a média ficou abaixo de 5 e quantos a marcaram como menos favorita.
export function rejectionScore(avg, leastVotes, members) {
  const picks = members > 0 ? Math.min(leastVotes / members, 1) : 0;
  return (5 - avg) * 0.8 + picks;
}

// Avaliação em grupo: 24 horas para todos enviarem, contadas da criação do álbum.
export const EVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Passou do prazo sem resultado. Álbuns criados antes do prazo existir não têm `expiresAt` e nunca vencem.
export function isExpired(album, result, now = Date.now()) {
  return !album.retro && !result && album.expiresAt instanceof Date && album.expiresAt.getTime() <= now;
}

// A avaliação em grupo ainda aberta, se houver. Só pode existir uma por vez.
export function openEvaluation(albums, results, now = Date.now()) {
  return albums.find((a) => !a.retro && !results[a.id] && !isExpired(a, results[a.id], now)) || null;
}

// Álbum não retroativo com o resultado mais recente. Sem data conta como recém-concluído.
export function latestEvaluatedId(albums, results) {
  let best = null;
  let bestTime = -Infinity;
  for (const a of albums) {
    const r = results[a.id];
    if (a.retro || !r || r.retro) continue;
    const t = r.completedAt instanceof Date ? r.completedAt.getTime() : Infinity;
    if (t > bestTime) { best = a.id; bestTime = t; }
  }
  return best;
}

// Período, gênero e tags: o que vale para os totais também.
function passesGroup(album, f) {
  if (!matchesPeriod(album, f.period)) return false;
  if (f.genreId != null && (album.genreId ?? null) !== f.genreId) return false;
  return passesTags(album, f);
}

function passesTags(album, filters) {
  const ids = filters.tagIds || [];
  if (filters.tagMode === 'only' && ids.length) return (album.tags || []).some((t) => ids.includes(t));
  if (filters.tagMode === 'except' && ids.length) return !(album.tags || []).some((t) => ids.includes(t));
  return true;
}

export function filterAlbums(data, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const results = data.results || {};
  return (data.albums || []).filter((album) => {
    const result = results[album.id];
    if (!result) return false;
    if (album.retro && !f.includeRetro) return false;
    if (!passesGroup(album, f)) return false;
    if (f.year != null && albumEvalYear(album, result) !== f.year) return false;
    return true;
  });
}

export function computeStats(data, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const results = data.results || {};
  const memberUids = data.memberUids || [];
  const artistsById = new Map((data.artists || []).map((a) => [a.id, a]));
  const usersById = new Map((data.users || []).map((u) => [u.id, u]));
  const genresById = new Map((data.genres || []).map((g) => [g.id, g]));
  const genreOf = (album) => (album.genreId != null ? genresById.get(album.genreId) ?? null : null);
  const byGenre = (a, b) => b.avg - a.avg || (a.genre.name || '').localeCompare(b.genre.name || '', 'pt-BR');
  const artistName = (album) => artistsById.get(album.artistId)?.name ?? album.artistCredit ?? '';

  const albums = filterAlbums(data, f);

  const scored = albums
    .map((album) => ({ album, artistName: artistName(album), score: albumGroupScore(album, results[album.id], memberUids) }))
    .filter((x) => isNum(x.score));

  const bestAlbums = [...scored].sort((a, b) => b.score - a.score || byTitle(a, b)).slice(0, 10);
  const worstAlbums = [...scored].sort((a, b) => a.score - b.score || byTitle(a, b)).slice(0, 10);

  // Faixas das avaliações reais (retroativos não têm nota por faixa). Resultados antigos, sem
  // escolhas guardadas, contam só pela média. Só entram nas menos queridas as faixas que alguém
  // marcou como menos favorita e que não estejam nas mais queridas.
  const byTrack = (a, b) => byTitle(a, b) || (a.track.title || '').localeCompare(b.track.title || '', 'pt-BR');
  const trackRows = [];
  for (const album of albums) {
    if (album.retro) continue;
    const result = results[album.id];
    const avgs = result.trackAvgs || {};
    for (const track of album.tracks || []) {
      if (track.excluded || !isNum(avgs[track.id])) continue;
      const avg = avgs[track.id];
      const least = result.leastVotes?.[track.id] || 0;
      trackRows.push({
        album, track, avg, least,
        score: lovedScore(avg, result.pickPoints?.[track.id] || 0, memberUids.length),
        rejection: rejectionScore(avg, least, memberUids.length),
      });
    }
  }
  const topTracks = [...trackRows].sort((a, b) => b.score - a.score || byTrack(a, b)).slice(0, 20);
  const loved = new Set(topTracks);
  const leastTracks = trackRows.filter((x) => x.least > 0 && !loved.has(x))
    .sort((a, b) => b.rejection - a.rejection || byTrack(a, b)).slice(0, 10);

  const perArtist = new Map();
  for (const x of scored) {
    const list = perArtist.get(x.album.artistId) || [];
    list.push(x.score);
    perArtist.set(x.album.artistId, list);
  }
  const topArtists = [...perArtist.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([id, list]) => ({ artist: artistsById.get(id) ?? { id, name: id }, avg: mean(list), count: list.length }))
    .sort((a, b) => b.avg - a.avg || a.artist.name.localeCompare(b.artist.name, 'pt-BR'));

  const perGenre = new Map();
  for (const x of scored) {
    const genre = genreOf(x.album);
    if (!genre) continue;
    const list = perGenre.get(genre.id) || [];
    list.push(x.score);
    perGenre.set(genre.id, list);
  }
  const genres = [...perGenre.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([id, list]) => ({ genre: genresById.get(id), avg: mean(list), count: list.length }))
    .sort(byGenre);

  const members = memberUids.map((uid) => {
    const entries = albums
      .map((album) => ({ album, score: results[album.id].memberScores?.[uid] }))
      .filter((x) => isNum(x.score));
    const mine = new Map();
    for (const x of entries) {
      const genre = genreOf(x.album);
      if (!genre) continue;
      const list = mine.get(genre.id) || [];
      list.push(x.score);
      mine.set(genre.id, list);
    }
    const favoriteGenre = [...mine.entries()]
      .map(([id, list]) => ({ genre: genresById.get(id), avg: mean(list), count: list.length }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count || (a.genre.name || '').localeCompare(b.genre.name || '', 'pt-BR'))[0] ?? null;
    const favorite = entries.length
      ? entries.reduce((best, x) => (x.score > best.score ? x : best))
      : null;
    return {
      uid,
      user: usersById.get(uid) ?? null,
      avg: entries.length ? mean(entries.map((x) => x.score)) : null,
      count: entries.length,
      favorite,
      favoriteGenre,
    };
  });

  const withData = members.filter((m) => m.avg != null);
  const strictest = withData.length ? withData.reduce((a, b) => (b.avg < a.avg ? b : a)).uid : null;

  const divergences = [];
  for (const album of albums) {
    const ms = results[album.id].memberScores || {};
    if (!memberUids.length || !memberUids.every((u) => isNum(ms[u]))) continue;
    const values = memberUids.map((u) => ms[u]);
    const scores = Object.fromEntries(memberUids.map((u) => [u, ms[u]]));
    divergences.push({ album, spread: Math.max(...values) - Math.min(...values), scores });
  }
  divergences.sort((a, b) => b.spread - a.spread || byTitle(a, b));
  divergences.splice(10);

  const all = data.albums || [];
  const yearOk = (album) => f.year == null || albumEvalYear(album, results[album.id]) === f.year;
  const totals = {
    completed: all.filter((a) => !a.retro && results[a.id] && passesGroup(a, f) && yearOk(a)).length,
    inProgress: all.filter((a) => !a.retro && !results[a.id] && passesGroup(a, f)).length,
    retro: all.filter((a) => a.retro && results[a.id] && passesGroup(a, f) && yearOk(a)).length,
  };

  return { bestAlbums, worstAlbums, topTracks, leastTracks, topArtists, genres, members, strictest, divergences, totals };
}
