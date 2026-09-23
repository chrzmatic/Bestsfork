// Cor do adesivo da nota do grupo por faixa de média, configurada pelo admin.

export const DEFAULT_SCORE_BANDS = [
  { from: 0, color: '#e5484d' },
  { from: 6.5, color: '#ffd23f' },
  { from: 8, color: '#46b36b' },
];

const HEX = /^#[0-9a-f]{6}$/i;

// Faixas válidas, ordenadas pelo início e com a primeira começando em 0.
export function normalizeBands(bands) {
  const list = (Array.isArray(bands) ? bands : [])
    .filter((b) => b && Number.isFinite(b.from) && b.from >= 0 && b.from <= 10 && HEX.test(b.color || ''))
    .map((b) => ({ from: Math.round(b.from * 10) / 10, color: b.color.toLowerCase() }))
    .sort((a, b) => a.from - b.from);
  if (list.length === 0) return DEFAULT_SCORE_BANDS.map((b) => ({ ...b }));
  const unique = list.filter((b, i) => i === 0 || b.from !== list[i - 1].from);
  unique[0] = { ...unique[0], from: 0 };
  return unique;
}

export function bandFor(score, bands) {
  const list = normalizeBands(bands);
  let found = list[0];
  for (const b of list) if (score >= b.from - 1e-9) found = b;
  return found;
}

// Texto escuro em cor clara, branco em cor escura.
export function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#1b1e2b' : '#ffffff';
}

export function scoreColors(score, bands) {
  if (score == null || !Number.isFinite(score)) return null;
  const { color } = bandFor(score, bands);
  return { bg: color, ink: inkFor(color) };
}

// Texto da faixa para a tela de admin: "0,0 a 6,4".
export function bandRanges(bands) {
  const list = normalizeBands(bands);
  const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return list.map((b, i) => ({
    ...b,
    to: i + 1 < list.length ? Math.round((list[i + 1].from - 0.1) * 10) / 10 : 10,
    label: `${fmt(b.from)} a ${fmt(i + 1 < list.length ? Math.round((list[i + 1].from - 0.1) * 10) / 10 : 10)}`,
  }));
}
