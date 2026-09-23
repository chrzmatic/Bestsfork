import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smallCoverUrl, listCover, pageCover, fallbackArtistCover, artistImage } from '../js/images.js';

const caa = 'https://coverartarchive.org/release-group/abc/front-500';

test('listas usam a capa de 250 px ou a miniatura manual', () => {
  assert.equal(smallCoverUrl(caa), 'https://coverartarchive.org/release-group/abc/front-250');
  assert.equal(smallCoverUrl(null), null);
  assert.equal(listCover({ coverUrl: caa }), 'https://coverartarchive.org/release-group/abc/front-250');
  assert.equal(listCover({ coverUrl: caa, customCover: 'data:thumb' }), 'data:thumb');
  assert.equal(listCover({}), null);
});

test('página usa a imagem cheia manual quando existe', () => {
  assert.equal(pageCover({ coverUrl: caa }), caa);
  assert.equal(pageCover({ coverUrl: caa, customCover: 'data:thumb' }, { data: 'data:full' }), 'data:full');
  assert.equal(pageCover({ coverUrl: caa, customCover: 'data:thumb' }, null), 'data:thumb');
});

test('artista sem foto usa a capa do álbum mais bem avaliado', () => {
  const uids = ['a'];
  const albums = [
    { id: 'x', artistId: 'mad', coverUrl: 'https://c/x/front-500', retro: false },
    { id: 'y', artistId: 'mad', coverUrl: 'https://c/y/front-500', retro: false },
    { id: 'z', artistId: 'outro', coverUrl: 'https://c/z/front-500' },
  ];
  const results = { x: { memberScores: { a: 6 } }, y: { memberScores: { a: 9 } } };
  assert.equal(fallbackArtistCover('mad', albums, results, uids), 'https://c/y/front-250');
  assert.equal(fallbackArtistCover('mad', albums, {}, uids), 'https://c/x/front-250');
  assert.equal(fallbackArtistCover('ninguem', albums, results, uids), null);
});

test('ordem da foto do artista: manual, automática, capa, nada', () => {
  const ctx = { albums: [{ id: 'x', artistId: 'mad', coverUrl: 'https://c/x/front-500' }], results: {}, memberUids: [] };
  assert.equal(artistImage({ id: 'mad', customPhoto: 'data:t', photoUrl: 'u' }, ctx), 'data:t');
  assert.equal(artistImage({ id: 'mad', customPhoto: 'data:t' }, { ...ctx, size: 'page', media: { data: 'data:f' } }), 'data:f');
  assert.equal(artistImage({ id: 'mad', photoUrl: 'big', photoThumbUrl: 'small' }, ctx), 'small');
  assert.equal(artistImage({ id: 'mad', photoUrl: 'big', photoThumbUrl: 'small' }, { ...ctx, size: 'page' }), 'big');
  assert.equal(artistImage({ id: 'mad' }, ctx), 'https://c/x/front-250');
  assert.equal(artistImage({ id: 'sem' }, ctx), null);
});
