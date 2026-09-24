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

// Notas exibidas com uma casa (5,03 vira 5,0). Campos de edição pedem 2 casas, sem zero final.
export function formatScore(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '-';
  formatters[digits] ??= new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: digits });
  return formatters[digits].format(value);
}

/* Faixas favoritas e menos favorita */

export const COMMENT_MAX = 280;

// Quantas favoritas cada um escolhe: 3, ou menos em álbuns curtos, sobrando sempre uma para a menos favorita.
export function favoriteSlots(tracks) {
  return Math.min(3, Math.max(0, countedTracks(tracks).length - 1));
}

// O que ainda falta escolher. Faixas repetidas ou que não contam valem como não escolhidas.
export function missingPicks(rating, tracks) {
  const ids = new Set(countedTracks(tracks).map((t) => t.id));
  const slots = favoriteSlots(tracks);
  const favorites = (rating?.favorites || []).slice(0, slots);
  const favoritesOk = favorites.length === slots && new Set(favorites).size === slots && favorites.every((id) => ids.has(id));
  const least = rating?.leastFavorite;
  const leastOk = slots === 0 || (ids.has(least) && !favorites.includes(least));
  return { favorites: !favoritesOk, least: !leastOk };
}

export function picksComplete(rating, tracks) {
  const m = missingPicks(rating, tracks);
  return !m.favorites && !m.least;
}

// Soma por faixa: pontos de favorita (3, 2 e 1 pelo 1º, 2º e 3º lugar), quantos a puseram no top
// e quantos a marcaram como menos favorita.
export function pickTally(ratings) {
  const pickPoints = {};
  const pickVotes = {};
  const leastVotes = {};
  for (const r of ratings) {
    (r?.favorites || []).slice(0, 3).forEach((id, i) => {
      if (!id) return;
      pickPoints[id] = (pickPoints[id] || 0) + 3 - i;
      pickVotes[id] = (pickVotes[id] || 0) + 1;
    });
    if (r?.leastFavorite) leastVotes[r.leastFavorite] = (leastVotes[r.leastFavorite] || 0) + 1;
  }
  return { pickPoints, pickVotes, leastVotes };
}

// Mais amada: 3, 2 e 1 pontos pelo 1º, 2º e 3º lugar. Precisa estar no top de pelo menos 2 membros;
// empate no topo se resolve pela média do grupo e, se ainda empatar, fica sem consenso.
// Menos amada: a mesma faixa escolhida por pelo menos 2 membros.
export function consensusPicks(ratings, trackAvgs = {}) {
  const { pickPoints: points, pickVotes: votes, leastVotes } = pickTally(ratings);
  const avg = (id) => trackAvgs[id] ?? -Infinity;
  const ranked = Object.keys(points).filter((id) => votes[id] >= 2)
    .sort((a, b) => points[b] - points[a] || avg(b) - avg(a));
  const [first, second] = ranked;
  const tied = second != null && points[first] === points[second] && avg(first) === avg(second);
  const leastRanked = Object.entries(leastVotes).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  const leastTied = leastRanked.length > 1 && leastRanked[0][1] === leastRanked[1][1];
  return {
    favoriteTrack: first != null && !tied ? first : null,
    leastTrack: leastRanked.length && !leastTied ? leastRanked[0][0] : null,
  };
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
  const ratings = uids.map((u) => ratingsByUid[u]);
  const trackAvgs = trackAverages(ratings, tracks);
  const { pickPoints, leastVotes } = pickTally(ratings);
  return {
    memberScores,
    groupScore: groupScore(memberScores, uids),
    trackAvgs,
    ...consensusPicks(ratings, trackAvgs),
    // Guardados para as estatísticas de faixas mais e menos queridas.
    pickPoints,
    leastVotes,
    retro: false,
  };
}
