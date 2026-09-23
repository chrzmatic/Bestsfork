import { albumGroupScore, albumEvalYear } from './stats.js';

const BOM = '﻿';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'number') text = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
  else if (typeof value === 'boolean') text = value ? 'sim' : 'não';
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function exportAlbums(data, { includeRetro = true } = {}) {
  const results = data.results || {};
  return (data.albums || []).filter((a) => results[a.id] && (includeRetro || !a.retro));
}

function lookups(data) {
  const artists = new Map((data.artists || []).map((a) => [a.id, a]));
  const tags = new Map((data.tags || []).map((t) => [t.id, t]));
  const users = new Map((data.users || []).map((u) => [u.id, u]));
  return {
    artistName: (album) => artists.get(album.artistId)?.name ?? album.artistCredit ?? '',
    tagNames: (album) => (album.tags || []).map((id) => tags.get(id)?.name).filter(Boolean),
    userName: (uid) => users.get(uid)?.displayName || users.get(uid)?.name || uid,
  };
}

const sortedTracks = (album) =>
  [...(album.tracks || [])].sort((a, b) => (a.disc ?? 1) - (b.disc ?? 1) || (a.position ?? 0) - (b.position ?? 0));

function trackScore5(rating, trackId) {
  const v = rating?.trackScores?.[trackId];
  if (!isNum(v)) return null;
  return (v / 10) * (5 / (rating.scale || 5));
}

export function albumsCsv(data, opts = {}) {
  const { artistName, tagNames, userName } = lookups(data);
  const uids = data.memberUids || [];
  const rows = [['Título', 'Artista', 'Ano', 'Ano avaliado', 'Tags', 'Nota do grupo', ...uids.map(userName)]];
  for (const album of exportAlbums(data, opts)) {
    const result = data.results[album.id];
    rows.push([
      album.title,
      artistName(album),
      album.year ?? null,
      albumEvalYear(album, result),
      tagNames(album).join('; '),
      albumGroupScore(album, result, uids),
      ...uids.map((u) => (isNum(result.memberScores?.[u]) ? result.memberScores[u] : null)),
    ]);
  }
  return toCsv(rows);
}

export function tracksCsv(data, opts = {}) {
  const { artistName, userName } = lookups(data);
  const uids = data.memberUids || [];
  const rows = [['Álbum', 'Artista', 'Disco', 'Número', 'Faixa', 'Conta', 'Média do grupo', ...uids.map(userName)]];
  for (const album of exportAlbums(data, opts)) {
    const result = data.results[album.id];
    const ratings = data.ratings?.[album.id] || {};
    for (const track of sortedTracks(album)) {
      const counts = !track.excluded;
      const avg = counts && !album.retro ? result.trackAvgs?.[track.id] : null;
      rows.push([
        album.title,
        artistName(album),
        track.disc ?? 1,
        track.position ?? null,
        track.title,
        counts ? 'sim' : 'não',
        isNum(avg) ? avg : null,
        ...uids.map((u) => (counts && !album.retro ? trackScore5(ratings[u], track.id) : null)),
      ]);
    }
  }
  return toCsv(rows);
}

function withDates(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(withDates);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = withDates(v);
    return out;
  }
  return value;
}

export function fullJson(data, opts = {}) {
  const { artistName, tagNames, userName } = lookups(data);
  const uids = data.memberUids || [];
  const albums = exportAlbums(data, opts).map((album) => {
    const result = data.results[album.id];
    const entry = {
      ...album,
      artistName: artistName(album),
      tagNames: tagNames(album),
      groupScore: albumGroupScore(album, result, uids),
      result,
    };
    if (!album.retro) {
      const ratings = data.ratings?.[album.id] || {};
      entry.ratings = Object.fromEntries(
        uids
          .filter((u) => ratings[u])
          .map((u) => [u, { member: userName(u), ...ratings[u] }]),
      );
    }
    return entry;
  });
  return JSON.stringify(
    withDates({
      exportedAt: new Date(),
      albums,
      artists: data.artists || [],
      users: (data.users || []).map((u) => ({ id: u.id, displayName: u.displayName || u.name || '' })),
    }),
    null,
    2,
  );
}

export function backupJson(everything) {
  return JSON.stringify(withDates({ backupAt: new Date(), ...everything }), null, 2);
}

export function fileName(kind, date = new Date(), ext = kind === 'albuns' || kind === 'faixas' ? 'csv' : 'json') {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `bestsfork-${kind}-${stamp}.${ext}`;
}
