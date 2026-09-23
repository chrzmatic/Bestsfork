import { normalizeKey } from './artists.js';

export const GENRE_FAMILIES = [
  'Pop', 'Rock', 'Alternative', 'R&B', 'Hip Hop', 'Electronic', 'Metal',
  'Country', 'Folk', 'Jazz', 'Classical', 'Latin', 'Reggae', 'Blues',
];

export function genreKey(name) {
  return normalizeKey(name);
}

// A ordem importa: a primeira regra que casar vence. R&B e Hip Hop vêm antes de
// Alternative ("alternative r&b" é R&B), Alternative antes de Pop e Folk ("indie pop",
// "indie folk"), Latin e Country antes de Pop ("latin pop", "country pop"), e
// "pop rock"/"pop punk" antes de Pop para cair em Rock.
const RULES = [
  ['R&B', /\b(r b|rnb|soul)\b/],
  ['Hip Hop', /\b(hip hop|rap|trap)\b/],
  ['Metal', /\bmetal\b/],
  ['Alternative', /\b(indie|alternative|bedroom pop|dream pop|shoegaze|grunge|emo|post punk)\b/],
  ['Latin', /\b(latin|reggaeton|bossa nova|salsa)\b/],
  ['Country', /\bcountry\b/],
  ['Rock', /\bpop (rock|punk)\b/],
  ['Pop', /pop\b/],
  ['Electronic', /\b(house|techno|edm|dubstep|trance|drum and bass|drum n bass|ambient|electronic|electronica|synthwave)\b/],
  ['Rock', /\b(rock|punk)\b/],
  ['Folk', /\b(folk|singer songwriter)\b/],
  ['Jazz', /\bjazz\b/],
  ['Classical', /\b(classical|orchestral)\b/],
  ['Reggae', /\b(reggae|dancehall)\b/],
  ['Blues', /\bblues\b/],
];

function titleCase(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join('-'))
    .join(' ');
}

export function broadGenre(name) {
  const key = normalizeKey(name);
  if (!key) return null;
  const words = key.replace(/-/g, ' ');
  for (const [family, re] of RULES) if (re.test(words)) return family;
  return titleCase(String(name));
}

export function pickGenre(list) {
  let best = null;
  for (const g of list || []) {
    if (!g?.name) continue;
    if (!best || (g.count ?? 0) > (best.count ?? 0)) best = g;
  }
  return best ? broadGenre(best.name) : null;
}
