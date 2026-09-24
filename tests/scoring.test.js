import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxFor, countedTracks, missingTracks, isComplete, trackAverage5, album5, personalFinal,
  convertScale, conversionLosesPrecision, groupScore, trackAverages, parseScore, formatTenths, formatScore,
} from '../js/scoring.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const tracks = [
  { id: 't1', title: 'Intro', excluded: true },
  { id: 't2', title: 'A' },
  { id: 't3', title: 'B' },
  { id: 't4', title: 'C' },
];

test('maxFor', () => {
  assert.equal(maxFor(5), 50);
  assert.equal(maxFor(10), 100);
});

test('countedTracks ignora excluídas', () => {
  assert.deepEqual(countedTracks(tracks).map((t) => t.id), ['t2', 't3', 't4']);
});

test('nota final na escala 5', () => {
  const rating = { scale: 5, trackScores: { t2: 40, t3: 30, t4: 50 }, albumScore: 45 };
  close(trackAverage5(rating.trackScores, tracks, 5), 4);
  close(album5(45, 5), 4.5);
  close(personalFinal(rating, tracks), 8.5);
});

test('nota final na escala 10', () => {
  const rating = { scale: 10, trackScores: { t2: 80, t3: 60, t4: 100 }, albumScore: 90 };
  close(personalFinal(rating, tracks), 8.5);
});

test('nota de faixa excluída é ignorada mesmo se salva', () => {
  const rating = { scale: 5, trackScores: { t1: 0, t2: 40, t3: 40, t4: 40 }, albumScore: 40 };
  close(trackAverage5(rating.trackScores, tracks, 5), 4);
  close(personalFinal(rating, tracks), 8);
});

test('validação exige toda faixa que conta e nota do álbum', () => {
  const partial = { scale: 5, trackScores: { t2: 40, t3: 30 }, albumScore: 45 };
  assert.deepEqual(missingTracks(partial, tracks), ['t4']);
  assert.equal(isComplete(partial, tracks), false);
  assert.equal(personalFinal(partial, tracks), null);

  const noAlbum = { scale: 5, trackScores: { t2: 40, t3: 30, t4: 20 }, albumScore: null };
  assert.equal(isComplete(noAlbum, tracks), false);

  const outOfRange = { scale: 5, trackScores: { t2: 60, t3: 30, t4: 20 }, albumScore: 30 };
  assert.deepEqual(missingTracks(outOfRange, tracks), ['t2']);

  const ok = { scale: 5, trackScores: { t2: 40, t3: 30, t4: 20 }, albumScore: 0 };
  assert.equal(isComplete(ok, tracks), true);

  assert.equal(isComplete(ok, [{ id: 'x', excluded: true }]), false);
});

test('trackAverage5 sem notas é null', () => {
  assert.equal(trackAverage5({}, tracks, 5), null);
  assert.equal(album5(null, 5), null);
});

test('conversão de 5 para 10', () => {
  const r = convertScale({ scale: 5, trackScores: { t2: 43, t3: 50 }, albumScore: 21 }, 10);
  assert.deepEqual(r, { scale: 10, trackScores: { t2: 86, t3: 100 }, albumScore: 42 });
});

test('conversão de 10 para 5 arredonda para o décimo mais próximo', () => {
  const rating = { scale: 10, trackScores: { t2: 87, t3: 86 }, albumScore: null };
  const r = convertScale(rating, 5);
  assert.deepEqual(r, { scale: 5, trackScores: { t2: 44, t3: 43 }, albumScore: null });
  assert.equal(conversionLosesPrecision(rating, 5), true);
  assert.equal(conversionLosesPrecision({ scale: 10, trackScores: { t2: 86 }, albumScore: 40 }, 5), false);
  assert.equal(conversionLosesPrecision({ scale: 5, trackScores: { t2: 43 }, albumScore: 41 }, 10), false);
});

test('conversão na mesma escala devolve cópia', () => {
  const rating = { scale: 5, trackScores: { t2: 43 }, albumScore: 21 };
  const r = convertScale(rating, 5);
  assert.deepEqual(r, rating);
  assert.notEqual(r.trackScores, rating.trackScores);
});

test('média do grupo', () => {
  close(groupScore({ a: 8, b: 7, c: 9 }, ['a', 'b', 'c']), 8);
  assert.equal(groupScore({ a: 8, b: 7 }, ['a', 'b', 'c']), null);
  assert.equal(groupScore({}, []), null);
});

test('trackAverages mistura escalas e ignora excluídas', () => {
  const ratings = [
    { scale: 5, trackScores: { t1: 50, t2: 40, t3: 30, t4: 20 } },
    { scale: 10, trackScores: { t1: 100, t2: 100, t3: 60, t4: 40 } },
  ];
  const avgs = trackAverages(ratings, tracks);
  assert.equal('t1' in avgs, false);
  close(avgs.t2, 4.5);
  close(avgs.t3, 3);
  close(avgs.t4, 2);
});

test('parseScore', () => {
  assert.deepEqual(parseScore('4,3', 5), { value: 43, error: null });
  assert.deepEqual(parseScore('4.3', 5), { value: 43, error: null });
  assert.deepEqual(parseScore(' 5 ', 5), { value: 50, error: null });
  assert.deepEqual(parseScore('0', 5), { value: 0, error: null });
  assert.deepEqual(parseScore('10', 10), { value: 100, error: null });
  assert.deepEqual(parseScore('', 5), { value: null, error: null });
  assert.equal(parseScore('4,35', 5).error, 'Use no máximo uma casa decimal');
  assert.equal(parseScore('5,1', 5).error, 'A nota vai de 0 a 5');
  assert.equal(parseScore('11', 10).error, 'A nota vai de 0 a 10');
  assert.equal(parseScore('abc', 5).error, 'Nota inválida');
  assert.equal(parseScore('-1', 5).error, 'Nota inválida');
});

test('formatação pt-BR', () => {
  assert.equal(formatTenths(43), '4,3');
  assert.equal(formatTenths(50), '5,0');
  assert.equal(formatTenths(null), '-');
  assert.equal(formatScore(8.456), '8,5');
  assert.equal(formatScore(5.03), '5,0');
  assert.equal(formatScore(7.67), '7,7');
  assert.equal(formatScore(8), '8,0');
  assert.equal(formatScore(8.456, 2), '8,46');
  assert.equal(formatScore(8.5, 2), '8,5');
  assert.equal(formatScore(null), '-');
  assert.equal(formatScore(4.25, 1), '4,3');
});

test('buildResult exige todos finalizados e calcula o grupo', async () => {
  const { buildResult } = await import('../js/scoring.js');
  const tracks = [{ id: 't1' }, { id: 't2', excluded: true }];
  const r = (pf, s) => ({ status: 'final', personalFinal: pf, scale: 5, trackScores: { t1: s, t2: 50 } });
  const all = { a: r(8, 40), b: r(6, 30), c: r(7, 20) };
  const res = buildResult(tracks, all, ['a', 'b', 'c']);
  assert.equal(res.groupScore, 7);
  assert.deepEqual(Object.keys(res.trackAvgs), ['t1']);
  assert.equal(res.trackAvgs.t1, 3);
  assert.equal(buildResult(tracks, { ...all, c: { ...all.c, status: 'draft' } }, ['a', 'b', 'c']), null);
  assert.equal(res.favoriteTrack, null);
  assert.equal(res.leastTrack, null);
});

test('favoritas: quantas escolher e o que falta', async () => {
  const { favoriteSlots, missingPicks, picksComplete } = await import('../js/scoring.js');
  const tracks = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })).concat({ id: 'x', excluded: true });
  assert.equal(favoriteSlots(tracks), 3);
  assert.equal(favoriteSlots(tracks.slice(0, 3)), 2);
  assert.equal(favoriteSlots([{ id: 'a' }]), 0);
  assert.deepEqual(missingPicks({}, tracks), { favorites: true, least: true });
  assert.equal(picksComplete({ favorites: ['a', 'b', 'c'], leastFavorite: 'e' }, tracks), true);
  assert.deepEqual(missingPicks({ favorites: ['a', 'a', 'c'], leastFavorite: 'e' }, tracks), { favorites: true, least: false });
  assert.deepEqual(missingPicks({ favorites: ['a', 'b', 'x'], leastFavorite: 'e' }, tracks), { favorites: true, least: false });
  assert.deepEqual(missingPicks({ favorites: ['a', 'b', 'c'], leastFavorite: 'a' }, tracks), { favorites: false, least: true });
  assert.equal(picksComplete({}, [{ id: 'a' }]), true);
});

test('consenso da mais amada e da menos amada', async () => {
  const { consensusPicks } = await import('../js/scoring.js');
  const pick = (favorites, leastFavorite) => ({ favorites, leastFavorite });
  // b: 2 + 3 + 1 = 6 pontos, a: 3 + 2 = 5. A menos amada 'e' teve 2 votos.
  assert.deepEqual(consensusPicks([pick(['a', 'b', 'c'], 'e'), pick(['b', 'a', 'd'], 'e'), pick(['c', 'd', 'b'], 'd')]),
    { favoriteTrack: 'b', leastTrack: 'e' });
  // Ninguém em comum: sem consenso nos dois.
  assert.deepEqual(consensusPicks([pick(['a'], 'x'), pick(['b'], 'y'), pick(['c'], 'z')]), { favoriteTrack: null, leastTrack: null });
  // Empate em pontos: vence a de maior média; com média igual, nenhuma.
  const tie = [pick(['a', 'b'], null), pick(['b', 'a'], null), pick(['c'], null)];
  assert.equal(consensusPicks(tie, { a: 4.5, b: 4.2 }).favoriteTrack, 'a');
  assert.equal(consensusPicks(tie, { a: 4, b: 4 }).favoriteTrack, null);
  // Avaliações antigas sem escolhas.
  assert.deepEqual(consensusPicks([{}, {}, {}]), { favoriteTrack: null, leastTrack: null });
});

test('soma das escolhas por faixa', async () => {
  const { pickTally } = await import('../js/scoring.js');
  const t = pickTally([
    { favorites: ['a', 'b', 'c'], leastFavorite: 'z' },
    { favorites: ['b', null, 'a'], leastFavorite: 'z' },
    {},
  ]);
  assert.deepEqual(t.pickPoints, { a: 4, b: 5, c: 1 });
  assert.deepEqual(t.pickVotes, { a: 2, b: 2, c: 1 });
  assert.deepEqual(t.leastVotes, { z: 2 });
  assert.deepEqual(pickTally([]), { pickPoints: {}, pickVotes: {}, leastVotes: {} });
});

test('mais amada precisa de pelo menos 2 membros, mesmo com menos pontos', async () => {
  const { consensusPicks } = await import('../js/scoring.js');
  // 'a' tem 3 pontos de um membro só; 'b' soma 2 + 3 = 5 e 'c' soma 1 + 3 = 4, ambas com 2 membros.
  const r = consensusPicks([{ favorites: ['a', 'b', 'c'] }, { favorites: ['b', 'd', 'e'] }, { favorites: ['c', 'f', 'g'] }]);
  assert.equal(r.favoriteTrack, 'b');
  // Os três em 1º lugar.
  assert.equal(consensusPicks([{ favorites: ['a'] }, { favorites: ['a'] }, { favorites: ['a'] }]).favoriteTrack, 'a');
  // Só um membro escolheu: sem consenso.
  assert.equal(consensusPicks([{ favorites: ['a', 'b', 'c'] }, {}, {}]).favoriteTrack, null);
});

test('empate da mais amada: média desempata, sem média ou média igual fica sem consenso', async () => {
  const { consensusPicks } = await import('../js/scoring.js');
  // 'a' e 'b' com 5 pontos cada.
  const tie = [{ favorites: ['a', 'b'] }, { favorites: ['b', 'a'] }, { favorites: ['c'] }];
  assert.equal(consensusPicks(tie, { a: 3.9, b: 4.1 }).favoriteTrack, 'b');
  assert.equal(consensusPicks(tie, { a: 4.1 }).favoriteTrack, 'a');
  assert.equal(consensusPicks(tie, { a: 4, b: 4 }).favoriteTrack, null);
  assert.equal(consensusPicks(tie).favoriteTrack, null);
  // Quem vem logo abaixo com menos pontos não conta como empate.
  assert.equal(consensusPicks([{ favorites: ['a', 'b'] }, { favorites: ['a', 'b'] }, {}]).favoriteTrack, 'a');
});

test('menos amada: 2 ou 3 votos iguais, senão sem consenso', async () => {
  const { consensusPicks } = await import('../js/scoring.js');
  const least = (...ids) => consensusPicks(ids.map((leastFavorite) => ({ leastFavorite }))).leastTrack;
  assert.equal(least('x', 'x', 'y'), 'x');
  assert.equal(least('x', 'x', 'x'), 'x');
  assert.equal(least('x', 'y', 'z'), null);
  assert.equal(least('x', null, null), null);
  assert.equal(least(null, null, null), null);
});

test('buildResult guarda consenso e pontos para as estatísticas', async () => {
  const { buildResult } = await import('../js/scoring.js');
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const r = (favorites, leastFavorite) => ({
    status: 'final', personalFinal: 7, scale: 5, trackScores: { a: 40, b: 30, c: 20, d: 10 }, favorites, leastFavorite,
  });
  const res = buildResult(tracks, { u1: r(['a', 'b', 'c'], 'd'), u2: r(['a', 'c', 'b'], 'd'), u3: r(['b', 'a', 'c'], 'c') }, ['u1', 'u2', 'u3']);
  assert.equal(res.favoriteTrack, 'a');
  assert.equal(res.leastTrack, 'd');
  assert.deepEqual(res.pickPoints, { a: 8, b: 6, c: 4 });
  assert.deepEqual(res.leastVotes, { d: 2, c: 1 });
});

test('escolhas incompletas ou inválidas', async () => {
  const { missingPicks, picksComplete } = await import('../js/scoring.js');
  const tracks = ['a', 'b', 'c', 'd'].map((id) => ({ id })).concat({ id: 'x', excluded: true });
  // Lugar vazio no meio, faixa que não conta e faixa de outro álbum.
  assert.equal(missingPicks({ favorites: ['a', null, 'c'], leastFavorite: 'd' }, tracks).favorites, true);
  assert.equal(missingPicks({ favorites: ['a', 'b', 'c'], leastFavorite: 'x' }, tracks).least, true);
  assert.equal(missingPicks({ favorites: ['a', 'b', 'zz'], leastFavorite: 'd' }, tracks).favorites, true);
  // A menos favorita não pode ser uma das favoritas, em nenhum dos lugares.
  for (const least of ['a', 'b', 'c']) {
    assert.equal(picksComplete({ favorites: ['a', 'b', 'c'], leastFavorite: least }, tracks), false);
  }
  // Álbum de 3 faixas: 2 favoritas e a menos favorita.
  const short = tracks.slice(0, 3);
  assert.equal(picksComplete({ favorites: ['a', 'b'], leastFavorite: 'c' }, short), true);
  assert.equal(picksComplete({ favorites: ['a', 'b'], leastFavorite: null }, short), false);
});
