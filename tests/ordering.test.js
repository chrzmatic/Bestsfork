import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumSortKey, sortRecent, moveKey, topKey } from '../js/ordering.js';

const at = (iso) => new Date(iso);
const albums = [
  { id: 'a', createdAt: at('2026-09-01T00:00:00Z') },
  { id: 'b', createdAt: at('2026-09-02T00:00:00Z') },
  { id: 'c', createdAt: at('2026-09-03T00:00:00Z') },
];

test('sem sortKey, Recentes usa a data de criação', () => {
  assert.deepEqual(sortRecent(albums).map((a) => a.id), ['c', 'b', 'a']);
});

test('sortKey do admin vence a data de criação', () => {
  const list = [...albums, { id: 'x', createdAt: at('2026-09-04T00:00:00Z'), sortKey: at('2026-09-01T12:00:00Z').getTime() }];
  assert.deepEqual(sortRecent(list).map((a) => a.id), ['c', 'b', 'x', 'a']);
});

test('álbum ainda sem data do servidor fica no topo', () => {
  assert.equal(sortRecent([...albums, { id: 'novo', createdAt: null }])[0].id, 'novo');
  assert.equal(albumSortKey({}), Number.MAX_SAFE_INTEGER);
});

test('subir e descer uma posição', () => {
  const sorted = sortRecent(albums);
  const up = moveKey(sorted, 2, -1);
  const afterUp = sortRecent(sorted.map((a) => (a.id === 'a' ? { ...a, sortKey: up } : a)));
  assert.deepEqual(afterUp.map((a) => a.id), ['c', 'a', 'b']);
  const down = moveKey(sorted, 0, 1);
  const afterDown = sortRecent(sorted.map((a) => (a.id === 'c' ? { ...a, sortKey: down } : a)));
  assert.deepEqual(afterDown.map((a) => a.id), ['b', 'c', 'a']);
});

test('subir até o topo e descer até o fim', () => {
  const sorted = sortRecent(albums);
  const top = moveKey(sorted, 1, -1);
  assert.ok(top > albumSortKey(sorted[0]));
  const bottom = moveKey(sorted, 1, 1);
  assert.ok(bottom < albumSortKey(sorted[2]));
  assert.ok(topKey(sorted) > albumSortKey(sorted[0]));
});

test('não move além das pontas', () => {
  const sorted = sortRecent(albums);
  assert.equal(moveKey(sorted, 0, -1), null);
  assert.equal(moveKey(sorted, 2, 1), null);
});

test('movimentos repetidos continuam ordenando certo', () => {
  let list = sortRecent(albums);
  for (let i = 0; i < 30; i++) {
    const idx = list.findIndex((a) => a.id === 'a');
    const dir = idx === 0 ? 1 : -1;
    const key = moveKey(list, idx, dir);
    list = sortRecent(list.map((a) => (a.id === 'a' ? { ...a, sortKey: key } : a)));
  }
  assert.equal(new Set(list.map(albumSortKey)).size, 3);
});
