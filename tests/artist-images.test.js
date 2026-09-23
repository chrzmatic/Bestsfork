import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wikidataIdFromUrl, wikiLangForCountry, commonsThumbUrl, pickWikipediaTitles, audioDbThumb, findArtistPhoto,
} from '../js/artist-images.js';

const json = (body) => ({ ok: true, json: async () => body });

// fetch falso que responde por trecho da URL; registra as URLs pedidas.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [part, body] of routes) {
      if (url.includes(part)) {
        if (body instanceof Error) throw body;
        return json(body);
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

const info = (extra = {}) => ({ id: 'mb1', name: 'Anitta', country: 'BR', genres: [], wikidataId: 'Q1', ...extra });

test('wikidataIdFromUrl extrai o Q', () => {
  assert.equal(wikidataIdFromUrl('https://www.wikidata.org/wiki/Q42'), 'Q42');
  assert.equal(wikidataIdFromUrl('https://www.wikidata.org/entity/Q1744'), 'Q1744');
  assert.equal(wikidataIdFromUrl('https://example.com/Q42'), null);
  assert.equal(wikidataIdFromUrl(null), null);
});

test('wikiLangForCountry mapeia países e ignora os de língua inglesa', () => {
  assert.equal(wikiLangForCountry('BR'), 'pt');
  assert.equal(wikiLangForCountry('mx'), 'es');
  assert.equal(wikiLangForCountry('JP'), 'ja');
  assert.equal(wikiLangForCountry('US'), null);
  assert.equal(wikiLangForCountry('GB'), null);
  assert.equal(wikiLangForCountry('XX'), null);
  assert.equal(wikiLangForCountry(null), null);
});

test('commonsThumbUrl troca espaços e codifica o nome', () => {
  assert.equal(
    commonsThumbUrl('Madonna (cropped).jpg', 160),
    'https://commons.wikimedia.org/wiki/Special:FilePath/Madonna_(cropped).jpg?width=160',
  );
  assert.match(commonsThumbUrl('Beyoncé & Jay.jpg'), /Beyonc%C3%A9_%26_Jay\.jpg\?width=400$/);
});

test('pickWikipediaTitles põe o inglês primeiro e depois o idioma de origem', () => {
  const links = { enwiki: { title: 'Anitta (singer)' }, ptwiki: { title: 'Anitta' } };
  assert.deepEqual(pickWikipediaTitles(links, 'pt'), [
    { lang: 'en', title: 'Anitta (singer)' },
    { lang: 'pt', title: 'Anitta' },
  ]);
  assert.deepEqual(pickWikipediaTitles(links, 'en'), [{ lang: 'en', title: 'Anitta (singer)' }]);
  assert.deepEqual(pickWikipediaTitles({ ptwiki: { title: 'Anitta' } }, 'pt'), [{ lang: 'pt', title: 'Anitta' }]);
  assert.deepEqual(pickWikipediaTitles(null, 'pt'), []);
});

test('audioDbThumb acrescenta o tamanho', () => {
  assert.equal(audioDbThumb('https://r2.theaudiodb.com/a/thumb/x.jpg'), 'https://r2.theaudiodb.com/a/thumb/x.jpg/small');
  assert.equal(audioDbThumb('https://r2.theaudiodb.com/a/thumb/x.jpg', 'medium'), 'https://r2.theaudiodb.com/a/thumb/x.jpg/medium');
  assert.equal(audioDbThumb(''), null);
  assert.equal(audioDbThumb(null), null);
});

test('findArtistPhoto usa a imagem P18 do Wikidata', async () => {
  const fetch = fakeFetch([
    ['wikidata.org', { entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Anitta 2023.jpg' } } }] }, sitelinks: {} } } }],
  ]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1', name: 'Anitta' }, { fetch, getArtistInfo: async () => info() });
  assert.equal(photo.source, 'wikidata');
  assert.equal(photo.url, 'https://commons.wikimedia.org/wiki/Special:FilePath/Anitta_2023.jpg?width=500');
  assert.equal(photo.thumbUrl, 'https://commons.wikimedia.org/wiki/Special:FilePath/Anitta_2023.jpg?width=250');
  assert.equal(fetch.calls.length, 1);
});

test('sem P18 cai na Wikipedia em inglês', async () => {
  const fetch = fakeFetch([
    ['wikidata.org', { entities: { Q1: { claims: {}, sitelinks: { enwiki: { title: 'Anitta (singer)' }, ptwiki: { title: 'Anitta' } } } } }],
    ['en.wikipedia.org', { query: { pages: { 1: { thumbnail: { source: 'https://upload.wikimedia.org/en.jpg' } } } } }],
  ]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1' }, { fetch, getArtistInfo: async () => info() });
  assert.deepEqual(photo, { url: 'https://upload.wikimedia.org/en.jpg', thumbUrl: 'https://upload.wikimedia.org/en.jpg', source: 'wikipedia' });
});

test('sem imagem em inglês tenta a Wikipedia do idioma de origem', async () => {
  const fetch = fakeFetch([
    ['wikidata.org', { entities: { Q1: { claims: {}, sitelinks: { enwiki: { title: 'Anitta (singer)' }, ptwiki: { title: 'Anitta' } } } } }],
    ['en.wikipedia.org', { query: { pages: { 1: { title: 'Anitta (singer)' } } } }],
    ['pt.wikipedia.org', { query: { pages: { 2: { thumbnail: { source: 'https://upload.wikimedia.org/pt.jpg' } } } } }],
  ]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1' }, { fetch, getArtistInfo: async () => info() });
  assert.equal(photo.source, 'wikipedia');
  assert.equal(photo.url, 'https://upload.wikimedia.org/pt.jpg');
  assert.ok(fetch.calls.some((u) => u.includes('titles=Anitta&')));
});

test('sem Wikidata nem Wikipedia cai no TheAudioDB pelo MBID', async () => {
  const fetch = fakeFetch([
    ['wikidata.org', { entities: { Q1: { claims: {}, sitelinks: {} } } }],
    ['artist-mb.php?i=mb1', { artists: [{ strArtist: 'Anitta', strArtistThumb: 'https://r2.theaudiodb.com/t/a.jpg' }] }],
  ]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1' }, { fetch, getArtistInfo: async () => info() });
  assert.deepEqual(photo, {
    url: 'https://r2.theaudiodb.com/t/a.jpg/medium',
    thumbUrl: 'https://r2.theaudiodb.com/t/a.jpg/small',
    source: 'theaudiodb',
  });
});

test('sem MBID busca o artista pelo nome e usa a busca do TheAudioDB', async () => {
  const fetch = fakeFetch([
    ['search.php?s=', { artists: [
      { strArtist: 'Outra Pessoa', strArtistThumb: 'https://r2.theaudiodb.com/t/x.jpg' },
      { strArtist: 'Beyoncé', strArtistThumb: 'https://r2.theaudiodb.com/t/b.jpg' },
    ] }],
  ]);
  const photo = await findArtistPhoto({ name: 'Beyonce' }, {
    fetch,
    findArtistId: async () => null,
    getArtistInfo: async () => { throw new Error('não devia chamar'); },
  });
  assert.equal(photo.source, 'theaudiodb');
  assert.equal(photo.thumbUrl, 'https://r2.theaudiodb.com/t/b.jpg/small');
});

test('sem nenhuma fonte devolve null', async () => {
  const fetch = fakeFetch([
    ['wikidata.org', { entities: { Q1: { claims: {}, sitelinks: {} } } }],
    ['artist-mb.php', { artists: null }],
    ['search.php', { artists: null }],
  ]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1', name: 'Anitta' }, { fetch, getArtistInfo: async () => info() });
  assert.equal(photo, null);
});

test('erro de rede em tudo devolve null sem lançar', async () => {
  const fetch = fakeFetch([['', new TypeError('Failed to fetch')]]);
  const photo = await findArtistPhoto({ musicbrainzId: 'mb1', name: 'Anitta' }, {
    fetch,
    getArtistInfo: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal(photo, null);
  const noName = await findArtistPhoto({}, { fetch, findArtistId: async () => { throw new Error('x'); } });
  assert.equal(noName, null);
});
