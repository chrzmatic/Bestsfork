import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustTiers, rankState, shuffle, diffScores } from '../js/normalize.js';

const M = 50;

test('1. A=40, B=40, B > A', () => {
  const { scores, error } = adjustTiers([['A'], ['B']], { A: 40, B: 40 }, M);
  assert.equal(error, null);
  assert.deepEqual(scores, { A: 40, B: 41 });
});

test('2. A=30, B=40, C=50, A > B > C', () => {
  const { scores } = adjustTiers([['C'], ['B'], ['A']], { A: 30, B: 40, C: 50 }, M);
  assert.deepEqual(scores, { C: 39, B: 40, A: 41 });
});

test('3. A e B empatadas, C pior', () => {
  const { scores } = adjustTiers([['C'], ['A', 'B']], { A: 40, B: 45, C: 30 }, M);
  assert.deepEqual(scores, { C: 30, A: 43, B: 43 });
});

test('4. A=50, B=40, A > B não muda', () => {
  const old = { A: 50, B: 40 };
  const { scores } = adjustTiers([['B'], ['A']], old, M);
  assert.deepEqual(scores, old);
  assert.deepEqual(diffScores(old, scores), []);
});

test('5. todas no mesmo tier recebem a média arredondada', () => {
  const { scores } = adjustTiers([['A', 'B', 'C']], { A: 40, B: 45, C: 32 }, M);
  assert.deepEqual(scores, { A: 39, B: 39, C: 39 });
});

test('6. resultados dentro de [0, M]', () => {
  const high = adjustTiers([['A'], ['B'], ['C']], { A: 50, B: 50, C: 50 }, M);
  assert.deepEqual(high.scores, { A: 48, B: 49, C: 50 });
  const low = adjustTiers([['A'], ['B'], ['C']], { A: 0, B: 0, C: 0 }, M);
  assert.deepEqual(low.scores, { A: 0, B: 1, C: 2 });
  for (const r of [high, low]) {
    for (const v of Object.values(r.scores)) assert.ok(v >= 0 && v <= M);
  }
});

test('tiers demais para a escala geram erro', () => {
  const tiers = Array.from({ length: 12 }, (_, i) => [`t${i}`]);
  const scores = Object.fromEntries(tiers.map(([id]) => [id, 5]));
  const r = adjustTiers(tiers, scores, 10);
  assert.ok(r.error);
});

test('diffScores lista só mudanças', () => {
  assert.deepEqual(diffScores({ A: 40, B: 30 }, { A: 41, B: 30 }), [{ id: 'A', from: 40, to: 41 }]);
});

test('shuffle mantém os elementos', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const out = shuffle(ids, () => 0.3);
  assert.deepEqual([...out].sort(), ids);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
});

test('rankState: primeira pergunta e conclusão', () => {
  const order = ['a', 'b', 'c'];
  let s = rankState(order, []);
  assert.deepEqual(s.question, { newId: 'b', compareId: 'a' });
  assert.equal(s.done, false);
  assert.equal(s.progress, 0);

  s = rankState(order, ['new']);
  assert.deepEqual(s.tiers, [['a'], ['b']]);
  // c compara com o tier do meio (mid = 1, "b")
  assert.deepEqual(s.question, { newId: 'c', compareId: 'b' });

  s = rankState(order, ['new', 'tier']);
  assert.deepEqual(s.question, { newId: 'c', compareId: 'a' });

  s = rankState(order, ['new', 'tier', 'new']);
  assert.equal(s.done, true);
  assert.equal(s.question, null);
  assert.equal(s.progress, 1);
  assert.deepEqual(s.tiers, [['a'], ['c'], ['b']]);
});

test('rankState: empate entra no tier', () => {
  const s = rankState(['a', 'b', 'c'], ['tie', 'tier']);
  assert.equal(s.done, true);
  assert.deepEqual(s.tiers, [['c'], ['a', 'b']]);
});

test('rankState: voltar é encurtar o histórico', () => {
  const order = ['a', 'b', 'c'];
  const history = ['new', 'tier'];
  const back = rankState(order, history.slice(0, -1));
  assert.deepEqual(back, rankState(order, ['new']));
  assert.ok(back.progress > 0 && back.progress < 1);
});

test('rankState com uma faixa já termina', () => {
  const s = rankState(['a'], []);
  assert.equal(s.done, true);
  assert.deepEqual(s.tiers, [['a']]);
});
