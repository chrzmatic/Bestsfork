const API = 'https://musicbrainz.org/ws/2/';
const MIN_INTERVAL_MS = 1100;

export class MusicBrainzError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'MusicBrainzError';
    this.kind = kind;
  }
}

let queue = Promise.resolve();
let lastRequestAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function schedule(task) {
  const run = queue.then(async () => {
    const delay = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

async function rawFetch(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new MusicBrainzError('Sem conexão com o MusicBrainz. Verifique a internet e tente de novo.', 'network');
  }
  return res;
}

async function request(path) {
  const url = API + path;
  let res = await schedule(() => rawFetch(url));
  if (res.status === 503) {
    res = await schedule(() => rawFetch(url));
    if (res.status === 503) {
      throw new MusicBrainzError('O MusicBrainz está recebendo muitas buscas agora. Espere alguns segundos e tente de novo.', 'rate');
    }
  }
  if (!res.ok) {
    throw new MusicBrainzError(`O MusicBrainz respondeu com erro (${res.status}). Tente de novo ou preencha à mão.`, 'http');
  }
  try {
    return await res.json();
  } catch {
    throw new MusicBrainzError('Resposta inválida do MusicBrainz. Tente de novo ou preencha à mão.', 'http');
  }
}

export function coverUrlForGroup(id, size = 500) {
  return `https://coverartarchive.org/release-group/${id}/front-${size}`;
}

export function coverUrlForRelease(releaseId) {
  return `https://coverartarchive.org/release/${releaseId}/front-500`;
}

function creditString(credit) {
  if (!Array.isArray(credit)) return '';
  return credit.map((c) => (c.name ?? c.artist?.name ?? '') + (c.joinphrase ?? '')).join('').trim();
}

function creditArtists(credit) {
  if (!Array.isArray(credit)) return [];
  return credit
    .filter((c) => c.artist)
    .map((c) => ({ id: c.artist.id ?? null, name: c.artist.name ?? c.name ?? '' }));
}

function yearOf(date) {
  const y = parseInt(String(date ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

const TYPE_NAMES = {
  album: 'Álbum',
  ep: 'EP',
  single: 'Single',
  compilation: 'Compilação',
  live: 'Ao vivo',
  soundtrack: 'Trilha sonora',
  remix: 'Remix',
  broadcast: 'Transmissão',
};

function typeLabel(primary, secondary = []) {
  const names = [primary, ...secondary]
    .filter(Boolean)
    .map((t) => TYPE_NAMES[t.toLowerCase()] ?? 'Outro');
  return [...new Set(names)].join(', ') || 'Outro';
}

export async function searchReleaseGroups(query) {
  const q = encodeURIComponent(query.trim());
  const data = await request(`release-group/?query=${q}&fmt=json&limit=10`);
  return (data['release-groups'] ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    artistCredit: creditString(g['artist-credit']),
    artists: creditArtists(g['artist-credit']),
    year: yearOf(g['first-release-date']),
    type: typeLabel(g['primary-type'], g['secondary-types']),
    coverUrl: coverUrlForGroup(g.id, 250),
  }));
}

export async function getReleaseOptions(releaseGroupId) {
  const id = encodeURIComponent(releaseGroupId);
  const data = await request(`release?release-group=${id}&inc=recordings+artist-credits+media&fmt=json&limit=100`);
  return groupByTracklist(data.releases ?? []);
}

function normTitle(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const DELUXE_RE = /deluxe|expanded|edi[cç][aã]o especial|special|anniversary/i;

function releaseTracks(release) {
  const tracks = [];
  (release.media ?? []).forEach((medium, i) => {
    const disc = medium.position ?? i + 1;
    (medium.tracks ?? []).forEach((t, j) => {
      tracks.push({
        disc,
        position: t.position ?? j + 1,
        title: t.title ?? t.recording?.title ?? '',
        lengthMs: t.length ?? t.recording?.length ?? null,
      });
    });
  });
  return tracks;
}

export function groupByTracklist(releases) {
  const groups = new Map();
  for (const release of releases) {
    const tracks = releaseTracks(release);
    if (!tracks.length) continue;
    const key = tracks.length + '|' + tracks.map((t) => normTitle(t.title)).join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ release, tracks });
  }

  const options = [];
  for (const members of groups.values()) {
    const dated = members.filter((m) => m.release.date);
    dated.sort((a, b) => String(a.release.date).localeCompare(String(b.release.date)));
    const rep = dated[0] ?? members[0];
    const r = rep.release;
    const isDeluxe = members.some((m) => DELUXE_RE.test(m.release.title ?? '') || DELUXE_RE.test(m.release.disambiguation ?? ''));
    const trackCount = rep.tracks.length;
    const faixas = trackCount === 1 ? '1 faixa' : `${trackCount} faixas`;
    options.push({
      releaseId: r.id,
      title: r.title,
      disambiguation: r.disambiguation ?? '',
      isDeluxe,
      trackCount,
      tracks: rep.tracks,
      artistCredit: creditString(r['artist-credit']),
      artists: creditArtists(r['artist-credit']),
      year: yearOf(r.date),
      count: members.length,
      label: isDeluxe ? `Deluxe, ${faixas}` : faixas,
    });
  }

  options.sort((a, b) => (a.isDeluxe - b.isDeluxe) || (a.trackCount - b.trackCount));
  return options;
}

function genreList(list) {
  return (list ?? [])
    .filter((g) => g?.name)
    .map((g) => ({ name: g.name, count: g.count ?? 0 }));
}

export async function getReleaseGroupGenres(id) {
  const data = await request(`release-group/${encodeURIComponent(id)}?inc=genres&fmt=json`);
  return genreList(data.genres);
}

export async function getArtistInfo(mbid) {
  const data = await request(`artist/${encodeURIComponent(mbid)}?inc=genres+url-rels&fmt=json`);
  const iso = data.country || data.area?.['iso-3166-1-codes']?.[0] || null;
  const wikidata = (data.relations ?? []).find((r) => r.type === 'wikidata')?.url?.resource ?? '';
  const match = /\/wiki\/(Q\d+)\b/.exec(wikidata);
  return {
    id: data.id ?? mbid,
    name: data.name ?? '',
    country: iso ? String(iso).toUpperCase().slice(0, 2) : null,
    genres: genreList(data.genres),
    wikidataId: match ? match[1] : null,
  };
}

export async function findArtistId(name) {
  const wanted = normTitle(name);
  if (!wanted) return null;
  const q = encodeURIComponent(`artist:"${String(name).trim().replace(/"/g, '')}"`);
  const data = await request(`artist/?query=${q}&fmt=json&limit=5`);
  const hit = (data.artists ?? []).find((a) => normTitle(a.name) === wanted);
  return hit?.id ?? null;
}
