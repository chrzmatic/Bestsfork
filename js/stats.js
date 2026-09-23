import { groupScore } from './scoring.js';

export const DEFAULT_FILTERS = { tagMode: 'all', tagIds: [], includeRetro: true, year: null };

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
  return result?.completedAt?.getFullYear?.() ?? null;
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
    if (!passesTags(album, f)) return false;
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
  const artistName = (album) => artistsById.get(album.artistId)?.name ?? album.artistCredit ?? '';

  const albums = filterAlbums(data, f);

  const scored = albums
    .map((album) => ({ album, artistName: artistName(album), score: albumGroupScore(album, results[album.id], memberUids) }))
    .filter((x) => isNum(x.score));

  const bestAlbums = [...scored].sort((a, b) => b.score - a.score || byTitle(a, b)).slice(0, 10);
  const worstAlbums = [...scored].sort((a, b) => a.score - b.score || byTitle(a, b)).slice(0, 10);

  const topTracks = [];
  for (const album of albums) {
    if (album.retro) continue;
    const avgs = results[album.id].trackAvgs || {};
    for (const track of album.tracks || []) {
      if (track.excluded || !isNum(avgs[track.id])) continue;
      topTracks.push({ album, track, avg: avgs[track.id] });
    }
  }
  topTracks.sort((a, b) => b.avg - a.avg || byTitle(a, b) || (a.track.title || '').localeCompare(b.track.title || '', 'pt-BR'));
  topTracks.splice(20);

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

  const members = memberUids.map((uid) => {
    const entries = albums
      .map((album) => ({ album, score: results[album.id].memberScores?.[uid] }))
      .filter((x) => isNum(x.score));
    const favorite = entries.length
      ? entries.reduce((best, x) => (x.score > best.score ? x : best))
      : null;
    return {
      uid,
      user: usersById.get(uid) ?? null,
      avg: entries.length ? mean(entries.map((x) => x.score)) : null,
      count: entries.length,
      favorite,
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
    completed: all.filter((a) => !a.retro && results[a.id] && passesTags(a, f) && yearOk(a)).length,
    inProgress: all.filter((a) => !a.retro && !results[a.id] && passesTags(a, f)).length,
    retro: all.filter((a) => a.retro && results[a.id] && passesTags(a, f) && yearOk(a)).length,
  };

  return { bestAlbums, worstAlbums, topTracks, topArtists, members, strictest, divergences, totals };
}
