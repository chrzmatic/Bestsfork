import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByTracklist } from '../js/musicbrainz.js';

const credit = [{ name: 'Lady Gaga', joinphrase: '', artist: { id: 'gaga', name: 'Lady Gaga' } }];

function rel(id, title, date, discs, extra = {}) {
  return {
    id,
    title,
    date,
    'artist-credit': credit,
    media: discs.map((titles, i) => ({
      position: i + 1,
      tracks: titles.map((t, j) => ({ position: j + 1, title: t, length: 1000 * (j + 1) })),
    })),
    ...extra,
  };
}

test('edições com mesma tracklist viram uma opção, mesmo com acentos diferentes', () => {
  const opts = groupByTracklist([
    rel('b', 'The Fame', '2009-01-01', [['Just Dance', 'Poker Face']]),
    rel('a', 'The Fame', '2008-08-19', [['Just Dánce', 'Poker-Face']]),
  ]);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].releaseId, 'a');
  assert.equal(opts[0].count, 2);
  assert.equal(opts[0].year, 2008);
  assert.equal(opts[0].artistCredit, 'Lady Gaga');
  assert.equal(opts[0].label, '2 faixas');
});

test('deluxe fica separado e depois das normais', () => {
  const opts = groupByTracklist([
    rel('d', 'The Fame (Deluxe Edition)', '2008-10-01', [['Just Dance', 'Poker Face', 'Bonus']]),
    rel('n', 'The Fame', '2008-08-19', [['Just Dance', 'Poker Face']]),
  ]);
  assert.equal(opts.length, 2);
  assert.equal(opts[0].isDeluxe, false);
  assert.equal(opts[1].isDeluxe, true);
  assert.equal(opts[1].label, 'Deluxe, 3 faixas');
});

test('deluxe detectado pela desambiguação', () => {
  const opts = groupByTracklist([rel('x', 'Album', null, [['A']], { disambiguation: 'expanded edition' })]);
  assert.equal(opts[0].isDeluxe, true);
  assert.equal(opts[0].label, 'Deluxe, 1 faixa');
  assert.equal(opts[0].year, null);
});

test('disco múltiplo preserva disco e posição', () => {
  const opts = groupByTracklist([rel('m', 'Duplo', '2020', [['A', 'B'], ['C']])]);
  assert.deepEqual(
    opts[0].tracks.map((t) => [t.disc, t.position, t.title]),
    [[1, 1, 'A'], [1, 2, 'B'], [2, 1, 'C']],
  );
  assert.equal(opts[0].trackCount, 3);
});

test('mesma quantidade com títulos diferentes não agrupa; lançamentos sem faixas são ignorados', () => {
  const opts = groupByTracklist([
    rel('a', 'X', '2000', [['A', 'B']]),
    rel('b', 'X', '2000', [['A', 'C']]),
    { id: 'vazio', title: 'X', media: [] },
  ]);
  assert.equal(opts.length, 2);
});

test('sem data usa a primeira edição como representante', () => {
  const opts = groupByTracklist([rel('p', 'X', undefined, [['A']]), rel('q', 'X', undefined, [['A']])]);
  assert.equal(opts[0].releaseId, 'p');
});
