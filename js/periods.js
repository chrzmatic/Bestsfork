// Períodos (Old e New Testamento) e visibilidade de tags e selos nos cards.

export const OLD_TAG = 'old-testamento';
export const NEW_TAG = 'new-testamento';
export const SYSTEM_TAGS = [OLD_TAG, NEW_TAG];

export const SYSTEM_TAG_DEFAULTS = {
  [OLD_TAG]: { name: 'Old Testamento', yearFrom: 2021, yearTo: 2024, showOnCards: true },
  [NEW_TAG]: { name: 'New Testamento', yearFrom: 2025, yearTo: null, showOnCards: false },
};

export function isSystemTag(id) {
  return SYSTEM_TAGS.includes(id);
}

// Old ganha quando o álbum tem as duas tags por engano.
export function albumPeriod(album) {
  const tags = album?.tags || [];
  if (tags.includes(OLD_TAG)) return 'old';
  if (tags.includes(NEW_TAG)) return 'new';
  return null;
}

export function periodWarning(album) {
  const tags = album?.tags || [];
  const old = tags.includes(OLD_TAG);
  const neu = tags.includes(NEW_TAG);
  if (old && neu) return 'both';
  if (!old && !neu) return 'none';
  return null;
}

export const PERIOD_WARNINGS = {
  both: 'Old e New ao mesmo tempo',
  none: 'Sem período',
};

export function matchesPeriod(album, period) {
  if (!period || period === 'all') return true;
  return albumPeriod(album) === period;
}

// Tags sem o campo assumem o padrão: new-testamento oculta, as outras visíveis.
export function tagShownOnCards(tag) {
  if (typeof tag?.showOnCards === 'boolean') return tag.showOnCards;
  return tag?.id !== NEW_TAG;
}

export function displaySettings(config) {
  return { showRetroBadge: config?.showRetroBadge === true };
}

// Selos de um card de álbum: o de retroativo e as tags visíveis, na ordem do álbum.
export function cardBadges(album, tagsById, display) {
  const out = [];
  if (album?.retro && display?.showRetroBadge) out.push({ kind: 'retro', label: 'Retroativo' });
  for (const id of album?.tags || []) {
    const tag = tagsById?.[id];
    if (tag && tagShownOnCards(tag)) out.push({ kind: 'tag', id, label: tag.name });
  }
  return out;
}

// Na página do álbum aparecem todas as tags; `hiddenOnCards` serve para o estilo discreto.
// O retroativo não ganha selo aqui: a linha "Avaliado em" no fim da página já diz quando foi.
export function pageBadges(album, tagsById) {
  const out = [];
  for (const id of album?.tags || []) {
    const tag = tagsById?.[id];
    if (tag) out.push({ kind: 'tag', id, label: tag.name, hiddenOnCards: !tagShownOnCards(tag) });
  }
  return out;
}

// Álbum criado pelo fluxo normal nasce em New Testamento.
export function initialTags(retro) {
  return retro ? [] : [NEW_TAG];
}
