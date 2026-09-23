import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENRE_FAMILIES, genreKey, broadGenre, pickGenre } from '../js/genres.js';

test('grafias diferentes geram a mesma chave', () => {
  assert.equal(genreKey('R&B'), genreKey('r&b'));
  assert.equal(genreKey('R&B'), genreKey('R & B'));
  assert.equal(genreKey('Hip Hop'), genreKey('hip-hop'));
  assert.notEqual(genreKey('Pop'), genreKey('Rock'));
});

test('famílias da lista são elas mesmas', () => {
  for (const f of GENRE_FAMILIES) assert.equal(broadGenre(f), f);
});

const cases = {
  Pop: ['pop', 'k-pop', 'dance-pop', 'electropop', 'synth-pop', 'art pop', 'teen pop', 'city pop'],
  Alternative: ['indie rock', 'indie pop', 'bedroom pop', 'dream pop', 'shoegaze', 'grunge', 'emo', 'post-punk', 'alternative rock', 'indie folk'],
  'Hip Hop': ['hip hop', 'rap', 'trap', 'pop rap'],
  'R&B': ['r&b', 'contemporary r&b', 'soul', 'neo soul', 'alternative r&b'],
  Metal: ['heavy metal', 'nu metal'],
  Electronic: ['house', 'techno', 'edm', 'dubstep', 'trance', 'drum and bass', 'ambient', 'electronic', 'synthwave'],
  Rock: ['rock', 'pop rock', 'pop punk', 'punk rock', 'hard rock'],
  Country: ['country', 'country pop'],
  Folk: ['folk', 'singer-songwriter'],
  Jazz: ['jazz'],
  Classical: ['classical', 'orchestral'],
  Latin: ['latin', 'reggaeton', 'latin pop', 'bossa nova', 'salsa'],
  Reggae: ['reggae', 'dancehall'],
  Blues: ['blues'],
};

for (const [family, names] of Object.entries(cases)) {
  test(`${family} agrupa seus subgêneros`, () => {
    for (const n of names) assert.equal(broadGenre(n), family, n);
  });
}

test('sem família clara usa o próprio nome em Title Case', () => {
  assert.equal(broadGenre('baroque'), 'Baroque');
  assert.equal(broadGenre('mpb'), 'Mpb');
  assert.equal(broadGenre('bubblegum bass'), 'Bubblegum Bass');
});

test('vazio devolve null', () => {
  assert.equal(broadGenre(''), null);
  assert.equal(broadGenre(null), null);
  assert.equal(broadGenre('  '), null);
});

test('pickGenre pega o mais votado', () => {
  const sour = [{ name: 'rock', count: 6 }, { name: 'pop', count: 7 }, { name: 'pop punk', count: 3 }];
  assert.equal(pickGenre(sour), 'Pop');
  assert.equal(pickGenre([{ name: 'indie rock', count: 2 }, { name: 'pop', count: 2 }]), 'Alternative');
  assert.equal(pickGenre([]), null);
  assert.equal(pickGenre(undefined), null);
});
