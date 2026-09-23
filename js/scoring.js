export const MAX = { 5: 50, 10: 100 };

export function maxFor(scale) {
  return MAX[scale] ?? MAX[5];
}

function validInt(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

export function countedTracks(tracks) {
  return (tracks || []).filter((t) => !t.excluded);
}

export function missingTracks(rating, tracks) {
  const max = maxFor(rating?.scale);
  const scores = rating?.trackScores || {};
  return countedTracks(tracks)
    .filter((t) => !validInt(scores[t.id], max))
    .map((t) => t.id);
}

export function isComplete(rating, tracks) {
  if (!rating) return false;
  if (countedTracks(tracks).length === 0) return false;
  if (!validInt(rating.albumScore, maxFor(rating.scale))) return false;
  return missingTracks(rating, tracks).length === 0;
}

// Converte décimos numa escala qualquer para a base 5 (0 a 5).
function toBase5(tenths, scale) {
  return (tenths / 10) * (5 / scale);
}

export function trackAverage5(trackScores, tracks, scale) {
  const scores = trackScores || {};
  const values = countedTracks(tracks)
    .map((t) => scores[t.id])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return toBase5(sum / values.length, scale);
}

export function album5(albumScore, scale) {
  if (typeof albumScore !== 'number' || !Number.isFinite(albumScore)) return null;
  return toBase5(albumScore, scale);
}

export function personalFinal(rating, tracks) {
  if (!isComplete(rating, tracks)) return null;
  return trackAverage5(rating.trackScores, tracks, rating.scale) + album5(rating.albumScore, rating.scale);
}

function convertValue(value, from, to) {
  if (typeof value !== 'number') return value;
  if (from === to) return value;
  if (from === 5 && to === 10) return value * 2;
  return Math.round(value / 2);
}

export function convertScale(rating, toScale) {
  const from = rating.scale;
  const trackScores = {};
  for (const [id, v] of Object.entries(rating.trackScores || {})) {
    trackScores[id] = convertValue(v, from, toScale);
  }
  const albumScore = rating.albumScore == null ? null : convertValue(rating.albumScore, from, toScale);
  return { scale: toScale, trackScores, albumScore };
}

export function conversionLosesPrecision(rating, toScale) {
  if (!(rating.scale === 10 && toScale === 5)) return false;
  const values = [...Object.values(rating.trackScores || {}), rating.albumScore];
  return values.some((v) => typeof v === 'number' && v % 2 !== 0);
}

export function groupScore(memberScores, uids) {
  if (!uids || uids.length === 0) return null;
  const values = uids.map((u) => memberScores?.[u]);
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function trackAverages(ratings, tracks) {
  const out = {};
  for (const t of countedTracks(tracks)) {
    const values = [];
    for (const r of ratings || []) {
      const v = r?.trackScores?.[t.id];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(toBase5(v, r.scale));
    }
    if (values.length > 0) out[t.id] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return out;
}

export function parseScore(text, scale) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { value: null, error: null };
  const normalized = raw.replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(normalized)) return { value: null, error: 'Nota inválida' };
  const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
  if (decimals > 1) return { value: null, error: 'Use no máximo uma casa decimal' };
  const value = Math.round(Number(normalized) * 10);
  if (!Number.isFinite(value)) return { value: null, error: 'Nota inválida' };
  if (value < 0 || value > maxFor(scale)) return { value: null, error: `A nota vai de 0 a ${scale}` };
  return { value, error: null };
}

const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatters = {};

export function formatTenths(tenths) {
  if (tenths == null || !Number.isFinite(tenths)) return '-';
  return oneDecimal.format(tenths / 10);
}

// Arredonda para até `digits` casas e tira o zero final: 8,50 vira 8,5 e 8,00 vira 8,0.
export function formatScore(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '-';
  formatters[digits] ??= new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: digits });
  return formatters[digits].format(value);
}

// Monta o resumo do álbum a partir das avaliações finalizadas de todos os membros.
// Devolve null se algum membro ainda não finalizou.
export function buildResult(tracks, ratingsByUid, uids) {
  const memberScores = {};
  for (const uid of uids) {
    const r = ratingsByUid[uid];
    if (!r || r.status !== 'final' || typeof r.personalFinal !== 'number') return null;
    memberScores[uid] = r.personalFinal;
  }
  return {
    memberScores,
    groupScore: groupScore(memberScores, uids),
    trackAvgs: trackAverages(uids.map((u) => ratingsByUid[u]), tracks),
    retro: false,
  };
}
