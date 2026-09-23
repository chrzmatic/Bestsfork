// Foto automática do artista: Wikidata (Commons), Wikipedia e TheAudioDB, nessa ordem.
import { getArtistInfo as mbArtistInfo, findArtistId as mbFindArtistId } from './musicbrainz.js';

const TIMEOUT_MS = 8000;
const AUDIODB = 'https://www.theaudiodb.com/api/v1/json/123/';

const LANGS = {
  BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt',
  FR: 'fr', BE: 'fr', CH: 'de', LU: 'fr',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', UY: 'es', PY: 'es', BO: 'es',
  EC: 'es', CU: 'es', DO: 'es', PR: 'es', GT: 'es', CR: 'es', PA: 'es', HN: 'es', SV: 'es', NI: 'es',
  DE: 'de', AT: 'de',
  IT: 'it', JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh',
  SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is',
  NL: 'nl', RU: 'ru', UA: 'uk', PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', GR: 'el',
  TR: 'tr', IL: 'he', IN: 'hi', ID: 'id', TH: 'th', VN: 'vi', PH: 'tl', RS: 'sr', HR: 'hr',
};

function norm(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function wikidataIdFromUrl(url) {
  const m = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)\b/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

export function wikiLangForCountry(cc) {
  return LANGS[String(cc ?? '').toUpperCase()] ?? null;
}

export function commonsThumbUrl(fileName, width = 400) {
  const name = String(fileName).replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

export function pickWikipediaTitles(sitelinks, lang) {
  const out = [];
  const en = sitelinks?.enwiki?.title;
  if (en) out.push({ lang: 'en', title: en });
  if (lang && lang !== 'en') {
    const local = sitelinks?.[`${lang}wiki`]?.title;
    if (local) out.push({ lang, title: local });
  }
  return out;
}

export function audioDbThumb(url, size = 'small') {
  if (!url) return null;
  return `${String(url).replace(/\/+$/, '')}/${size}`;
}

async function getJson(fetchFn, url) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fromWikidata(fetchFn, qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims%7Csitelinks&format=json&origin=*`;
  const data = await getJson(fetchFn, url);
  const entity = data?.entities?.[qid];
  if (!entity) return { photo: null, sitelinks: null };
  const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  // O Wikimedia só serve tamanhos padrão de miniatura (250, 500...); outros viram redirecionamento.
  const photo = typeof file === 'string' && file
    ? { url: commonsThumbUrl(file, 500), thumbUrl: commonsThumbUrl(file, 250), source: 'wikidata' }
    : null;
  return { photo, sitelinks: entity.sitelinks ?? null };
}

async function fromWikipedia(fetchFn, titles) {
  for (const { lang, title } of titles) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=thumbnail&pithumbsize=500&format=json&origin=*`;
    const data = await getJson(fetchFn, url);
    const pages = Object.values(data?.query?.pages ?? {});
    const src = pages.find((p) => p?.thumbnail?.source)?.thumbnail?.source;
    if (src) return { url: src, thumbUrl: src, source: 'wikipedia' };
  }
  return null;
}

async function fromAudioDb(fetchFn, mbid, name) {
  let artist = null;
  if (mbid) {
    const data = await getJson(fetchFn, `${AUDIODB}artist-mb.php?i=${encodeURIComponent(mbid)}`);
    artist = data?.artists?.[0] ?? null;
  }
  if (!artist?.strArtistThumb && name) {
    const data = await getJson(fetchFn, `${AUDIODB}search.php?s=${encodeURIComponent(name)}`);
    const wanted = norm(name);
    artist = (data?.artists ?? []).find((a) => a?.strArtistThumb && norm(a.strArtist) === wanted) ?? null;
  }
  const thumb = artist?.strArtistThumb;
  if (!thumb) return null;
  return { url: audioDbThumb(thumb, 'medium'), thumbUrl: audioDbThumb(thumb, 'small'), source: 'theaudiodb' };
}

// Nunca lança: qualquer falha passa para a próxima fonte, e sem nenhuma devolve null.
export async function findArtistPhoto({ musicbrainzId, name } = {}, deps = {}) {
  const fetchFn = deps.fetch ?? ((...args) => globalThis.fetch(...args));
  const getArtistInfo = deps.getArtistInfo ?? mbArtistInfo;
  const findArtistId = deps.findArtistId ?? mbFindArtistId;
  try {
    let mbid = musicbrainzId || null;
    if (!mbid && name) mbid = await findArtistId(name).catch(() => null);

    let info = null;
    if (mbid) info = await getArtistInfo(mbid).catch(() => null);

    if (info?.wikidataId) {
      const { photo, sitelinks } = await fromWikidata(fetchFn, info.wikidataId);
      if (photo) return photo;
      const titles = pickWikipediaTitles(sitelinks, wikiLangForCountry(info.country));
      const wiki = await fromWikipedia(fetchFn, titles);
      if (wiki) return wiki;
    }

    return await fromAudioDb(fetchFn, mbid, name || info?.name);
  } catch {
    return null;
  }
}
