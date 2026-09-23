import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCORE_BANDS, normalizeBands, bandFor, scoreColors, inkFor, bandRanges } from '../js/score-colors.js';

test('padrão: vermelho até 6,4, amarelo até 7,9, verde de 8 em diante', () => {
  assert.equal(bandFor(0, DEFAULT_SCORE_BANDS).color, '#e5484d');
  assert.equal(bandFor(6.49, DEFAULT_SCORE_BANDS).color, '#e5484d');
  assert.equal(bandFor(6.5, DEFAULT_SCORE_BANDS).color, '#ffd23f');
  assert.equal(bandFor(7.99, DEFAULT_SCORE_BANDS).color, '#ffd23f');
  assert.equal(bandFor(8, DEFAULT_SCORE_BANDS).color, '#46b36b');
  assert.equal(bandFor(10, DEFAULT_SCORE_BANDS).color, '#46b36b');
});

test('sem configuração ou com lixo, usa o padrão', () => {
  assert.deepEqual(normalizeBands(undefined), DEFAULT_SCORE_BANDS);
  assert.deepEqual(normalizeBands([{ from: 'x', color: 'azul' }]), DEFAULT_SCORE_BANDS);
});

test('ordena, tira repetidos e faz a primeira começar em 0', () => {
  const bands = normalizeBands([
    { from: 9, color: '#0000FF' },
    { from: 3, color: '#ff0000' },
    { from: 9, color: '#00ff00' },
  ]);
  assert.deepEqual(bands, [{ from: 0, color: '#ff0000' }, { from: 9, color: '#0000ff' }]);
});

test('texto do adesivo contrasta com a cor', () => {
  assert.equal(inkFor('#ffd23f'), '#1b1e2b');
  assert.equal(inkFor('#1b1e2b'), '#ffffff');
  assert.deepEqual(scoreColors(8.3, DEFAULT_SCORE_BANDS), { bg: '#46b36b', ink: inkFor('#46b36b') });
  assert.equal(scoreColors(null, DEFAULT_SCORE_BANDS), null);
});

test('a cor segue a nota arredondada que aparece na tela', () => {
  assert.equal(scoreColors(6.46, DEFAULT_SCORE_BANDS).bg, '#ffd23f');
  assert.equal(scoreColors(6.44, DEFAULT_SCORE_BANDS).bg, '#e5484d');
  assert.equal(scoreColors(7.96, DEFAULT_SCORE_BANDS).bg, '#46b36b');
});

test('faixas descritas para a tela de admin', () => {
  assert.deepEqual(bandRanges(DEFAULT_SCORE_BANDS).map((b) => b.label), ['0,0 a 6,4', '6,5 a 7,9', '8,0 a 10,0']);
});
