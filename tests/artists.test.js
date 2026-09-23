import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artistKey, normalizeKey, resolveArtist } from '../js/artists.js';

test('maiúsculas e espaços geram a mesma chave', () => {
  const keys = ['Madonna', 'madonna', ' MADONNA ', 'Madonna '].map(artistKey);
  assert.ok(keys.every((k) => k === 'madonna'));
});

test('acentos são ignorados', () => {
  assert.equal(artistKey('Beyoncé'), artistKey('Beyonce'));
});

test('símbolos viram separador', () => {
  assert.equal(artistKey('AC/DC'), artistKey('AC DC'));
});

test('Sigur Rós', () => {
  assert.equal(artistKey('Sigur Rós'), 'sigur-ros');
});

test('outros alfabetos geram chave não vazia', () => {
  assert.ok(artistKey('宇多田ヒカル').length > 0);
});

test('artistas diferentes geram chaves diferentes', () => {
  const names = ['Madonna', 'Lady Gaga', 'Beyoncé', 'AC/DC', 'Sigur Rós', '宇多田ヒカル', 'Björk'];
  assert.equal(new Set(names.map(artistKey)).size, names.length);
});

test('nome vazio ou só símbolos gera erro', () => {
  for (const name of ['', '   ', '!!!', '/-/', null]) {
    assert.throws(() => artistKey(name));
  }
  assert.equal(normalizeKey('!!!'), '');
});

const existing = [
  { id: 'lady-gaga', name: 'Lady Gaga', musicbrainzId: 'mb-gaga' },
  { id: 'beyonce', name: 'Beyoncé', musicbrainzId: null },
];

test('resolveArtist reaproveita por grafia diferente', () => {
  const r = resolveArtist('BEYONCE', null, existing);
  assert.deepEqual(r, { id: 'beyonce', isNew: false, data: null, patch: null });
});

test('resolveArtist preenche musicbrainzId vazio', () => {
  const r = resolveArtist('Beyonce', 'mb-bey', existing);
  assert.equal(r.id, 'beyonce');
  assert.deepEqual(r.patch, { musicbrainzId: 'mb-bey' });
});

test('resolveArtist reaproveita por musicbrainzId com nome diferente', () => {
  const r = resolveArtist('Stefani Germanotta', 'mb-gaga', existing);
  assert.equal(r.id, 'lady-gaga');
  assert.equal(r.isNew, false);
});

test('resolveArtist cria novo sem correspondência', () => {
  const r = resolveArtist('Sigur Rós', 'mb-sigur', existing);
  assert.deepEqual(r, {
    id: 'sigur-ros',
    isNew: true,
    data: { name: 'Sigur Rós', musicbrainzId: 'mb-sigur' },
    patch: null,
  });
});
