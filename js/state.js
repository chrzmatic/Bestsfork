import { DEFAULT_SCORE_BANDS, normalizeBands } from './score-colors.js';

// Sessão do usuário logado e preferências locais.
export const session = {
  uid: null,
  user: null,
  members: [],
  isAdmin: false,
  adminMode: false,
};

// Configuração de exibição compartilhada (config/display), carregada ao entrar.
export const appearance = { scoreBands: DEFAULT_SCORE_BANDS };

export function setAppearance(display) {
  appearance.scoreBands = normalizeBands(display?.scoreBands);
}

// Admin só age como admin com o modo ligado.
export function actingAdmin() {
  return session.isAdmin && session.adminMode;
}

export function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(`bestsfork:${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(`bestsfork:${key}`, JSON.stringify(value));
  } catch {
    // Sem armazenamento local, a preferência vale só nesta sessão.
  }
}

export function applyTheme(theme = getPref('theme', 'system')) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12141c' : '#eef0f5');
}
