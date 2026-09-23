import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OLD_TAG, NEW_TAG, isSystemTag, albumPeriod, periodWarning, matchesPeriod,
  tagShownOnCards, displaySettings, cardBadges, pageBadges, initialTags,
} from '../js/periods.js';

const baseTags = () => ({
  [OLD_TAG]: { id: OLD_TAG, name: 'Old Testamento' },
  [NEW_TAG]: { id: NEW_TAG, name: 'New Testamento' },
  fav: { id: 'fav', name: 'Favoritos' },
});
const labels = (list) => list.map((b) => b.label);

test('álbum do fluxo normal nasce em New, com a tag oculta no card e visível na página', () => {
  const album = { retro: false, tags: initialTags(false) };
  assert.deepEqual(album.tags, [NEW_TAG]);
  assert.equal(albumPeriod(album), 'new');
  assert.equal(periodWarning(album), null);
  assert.deepEqual(cardBadges(album, baseTags(), displaySettings()), []);
  assert.deepEqual(pageBadges(album, baseTags(), displaySettings()), [
    { kind: 'tag', id: NEW_TAG, label: 'New Testamento', hiddenOnCards: true },
  ]);
});

test('retroativo nasce sem tag', () => {
  assert.deepEqual(initialTags(true), []);
});

test('remover new-testamento tira do período e gera aviso', () => {
  const album = { tags: [] };
  assert.equal(albumPeriod(album), null);
  assert.equal(periodWarning(album), 'none');
  assert.equal(matchesPeriod(album, 'new'), false);
  assert.equal(matchesPeriod(album, 'all'), true);
});

test('só old aparece só em Old', () => {
  const album = { tags: [OLD_TAG] };
  assert.equal(albumPeriod(album), 'old');
  assert.equal(periodWarning(album), null);
  assert.equal(matchesPeriod(album, 'old'), true);
  assert.equal(matchesPeriod(album, 'new'), false);
});

test('as duas tags: Old com aviso', () => {
  const album = { tags: [NEW_TAG, OLD_TAG] };
  assert.equal(albumPeriod(album), 'old');
  assert.equal(periodWarning(album), 'both');
  assert.equal(matchesPeriod(album, 'old'), true);
  assert.equal(matchesPeriod(album, 'new'), false);
});

test('só tags personalizadas ou nenhuma: só em Todos, com aviso', () => {
  for (const album of [{ tags: ['fav'] }, { tags: [] }, {}, { tags: undefined }]) {
    assert.equal(albumPeriod(album), null);
    assert.equal(periodWarning(album), 'none');
    assert.equal(matchesPeriod(album, 'all'), true);
    assert.equal(matchesPeriod(album, 'old'), false);
    assert.equal(matchesPeriod(album, 'new'), false);
  }
});

test('matchesPeriod sem período ou "all" aceita tudo', () => {
  assert.equal(matchesPeriod({ tags: [] }, undefined), true);
  assert.equal(matchesPeriod({ tags: [] }, 'all'), true);
});

test('tag nova sem o campo nasce visível; New sem o campo nasce oculta', () => {
  assert.equal(tagShownOnCards({ id: 'fav', name: 'Favoritos' }), true);
  assert.equal(tagShownOnCards({ id: OLD_TAG, name: 'Old' }), true);
  assert.equal(tagShownOnCards({ id: NEW_TAG, name: 'New' }), false);
  const album = { tags: ['fav'] };
  assert.deepEqual(labels(cardBadges(album, baseTags(), displaySettings())), ['Favoritos']);
});

test('ocultar e reexibir some e volta do card, mas fica na página', () => {
  const tags = baseTags();
  const album = { tags: ['fav', OLD_TAG] };
  tags.fav.showOnCards = false;
  assert.deepEqual(labels(cardBadges(album, tags, displaySettings())), ['Old Testamento']);
  assert.deepEqual(pageBadges(album, tags, displaySettings()).map((b) => [b.label, b.hiddenOnCards]),
    [['Favoritos', true], ['Old Testamento', false]]);
  tags.fav.showOnCards = true;
  assert.deepEqual(labels(cardBadges(album, tags, displaySettings())), ['Favoritos', 'Old Testamento']);
  tags[NEW_TAG].showOnCards = true;
  assert.deepEqual(labels(cardBadges({ tags: [NEW_TAG] }, tags, displaySettings())), ['New Testamento']);
});

test('renomear tag muda o rótulo e mantém a visibilidade', () => {
  const tags = baseTags();
  tags.fav = { id: 'fav', name: 'Preferidos', showOnCards: false };
  const album = { tags: ['fav'] };
  assert.deepEqual(cardBadges(album, tags, displaySettings()), []);
  assert.deepEqual(pageBadges(album, tags, displaySettings())[0], { kind: 'tag', id: 'fav', label: 'Preferidos', hiddenOnCards: true });
  tags.fav.showOnCards = true;
  tags.fav.name = 'Top';
  assert.deepEqual(labels(cardBadges(album, tags, displaySettings())), ['Top']);
});

test('renomear as tags de sistema não muda o filtro de período', () => {
  const tags = baseTags();
  tags[OLD_TAG].name = 'Era Antiga';
  tags[NEW_TAG].name = 'Era Nova';
  assert.equal(matchesPeriod({ tags: [OLD_TAG] }, 'old'), true);
  assert.equal(matchesPeriod({ tags: [NEW_TAG] }, 'new'), true);
  assert.deepEqual(labels(cardBadges({ tags: [OLD_TAG] }, tags, displaySettings())), ['Era Antiga']);
});

test('tag apagada no álbum é ignorada sem erro', () => {
  const album = { retro: true, tags: ['apagada', OLD_TAG] };
  const tags = baseTags();
  assert.deepEqual(labels(cardBadges(album, tags, displaySettings())), ['Old Testamento']);
  assert.deepEqual(labels(pageBadges(album, tags, displaySettings())), ['Retroativo', 'Old Testamento']);
  assert.deepEqual(cardBadges(album, undefined, undefined), []);
  assert.equal(albumPeriod(album), 'old');
});

test('dados antigos sem campos assumem os padrões', () => {
  assert.deepEqual(displaySettings(undefined), { showRetroBadge: false });
  assert.deepEqual(displaySettings(null), { showRetroBadge: false });
  assert.deepEqual(displaySettings({}), { showRetroBadge: false });
  assert.deepEqual(displaySettings({ showRetroBadge: 'sim' }), { showRetroBadge: false });
  assert.equal(tagShownOnCards(undefined), true);
});

test('selo Retroativo: no card só com showRetroBadge, na página sempre', () => {
  const album = { retro: true, tags: [] };
  assert.deepEqual(cardBadges(album, baseTags(), displaySettings()), []);
  assert.deepEqual(labels(cardBadges(album, baseTags(), displaySettings({ showRetroBadge: true }))), ['Retroativo']);
  assert.deepEqual(pageBadges(album, baseTags(), displaySettings()), [{ kind: 'retro', label: 'Retroativo', hiddenOnCards: true }]);
  assert.deepEqual(pageBadges(album, baseTags(), displaySettings({ showRetroBadge: true })), [{ kind: 'retro', label: 'Retroativo', hiddenOnCards: false }]);
  assert.deepEqual(pageBadges({ retro: false, tags: [] }, baseTags(), displaySettings({ showRetroBadge: true })), []);
});

test('isSystemTag', () => {
  assert.equal(isSystemTag(OLD_TAG), true);
  assert.equal(isSystemTag(NEW_TAG), true);
  assert.equal(isSystemTag('fav'), false);
  assert.equal(isSystemTag(undefined), false);
});
