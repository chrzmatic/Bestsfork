import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, filterAlbums, albumEvalYear, albumGroupScore } from '../js/stats.js';

const U = ['u1', 'u2', 'u3'];

function sample() {
  const albums = [
    { id: 'a1', title: 'Alpha', artistId: 'x', year: 2020, retro: false, evaluatedYear: null, tags: ['new'],
      tracks: [{ id: 't1', title: 'Um' }, { id: 't2', title: 'Dois' }, { id: 't3', title: 'Intro', excluded: true }] },
    { id: 'a2', title: 'Beta', artistId: 'x', year: 2021, retro: false, evaluatedYear: null, tags: [],
      tracks: [{ id: 't1', title: 'Tres' }] },
    { id: 'a3', title: 'Gama', artistId: 'y', year: 2010, retro: true, evaluatedYear: 2022, tags: ['old'], tracks: [] },
    { id: 'a4', title: 'Delta', artistId: 'y', year: 2024, retro: false, evaluatedYear: null, tags: [], tracks: [] },
    { id: 'a5', title: 'Epsilon', artistId: 'y', year: 2015, retro: true, evaluatedYear: 2023, tags: ['old'], tracks: [] },
  ];
  const results = {
    a1: { memberScores: { u1: 8, u2: 6, u3: 7 }, groupScore: 0, trackAvgs: { t1: 4.5, t2: 3, t3: 5 }, retro: false,
      completedAt: new Date(2025, 2, 1) },
    a2: { memberScores: { u1: 9, u2: 9, u3: 9 }, groupScore: 9, trackAvgs: { t1: 4.8 }, retro: false,
      completedAt: new Date(2026, 0, 5) },
    a3: { memberScores: { u1: 5 }, groupScore: 4.5, trackAvgs: {}, retro: true, completedAt: new Date(2026, 1, 1) },
    a5: { memberScores: {}, groupScore: 3, trackAvgs: {}, retro: true, completedAt: null },
  };
  return {
    albums,
    results,
    artists: [{ id: 'x', name: 'Xis' }, { id: 'y', name: 'Ypsilon' }, { id: 'z', name: 'Zeta' }],
    users: [{ id: 'u1', displayName: 'Ana' }, { id: 'u2', displayName: 'Bia' }, { id: 'u3', displayName: 'Caio' }],
    memberUids: U,
    tags: [{ id: 'old', name: 'Old Testamento' }, { id: 'new', name: 'New Testamento' }],
  };
}

test('group score recalculado de memberScores e retro usa groupScore salvo', () => {
  const d = sample();
  assert.equal(albumGroupScore(d.albums[0], d.results.a1, U), 7);
  assert.equal(albumGroupScore(d.albums[2], d.results.a3, U), 4.5);
});

test('ano de avaliação', () => {
  const d = sample();
  assert.equal(albumEvalYear(d.albums[0], d.results.a1), 2025);
  assert.equal(albumEvalYear(d.albums[2], d.results.a3), 2022);
});

test('melhores e piores álbuns', () => {
  const s = computeStats(sample());
  assert.deepEqual(s.bestAlbums.map((x) => x.album.id), ['a2', 'a1', 'a3', 'a5']);
  assert.deepEqual(s.worstAlbums.map((x) => x.album.id), ['a5', 'a3', 'a1', 'a2']);
  assert.equal(s.bestAlbums[0].artistName, 'Xis');
});

test('faixas mais queridas ignoram retro e excluídas', () => {
  const s = computeStats(sample());
  assert.deepEqual(s.topTracks.map((x) => `${x.album.id}:${x.track.id}`), ['a2:t1', 'a1:t1', 'a1:t2']);
});

test('artistas com pelo menos 2 álbuns', () => {
  const s = computeStats(sample());
  assert.equal(s.topArtists.length, 2);
  assert.equal(s.topArtists[0].artist.name, 'Xis');
  assert.equal(s.topArtists[0].avg, 8);
  assert.equal(s.topArtists[1].artist.name, 'Ypsilon');
  assert.equal(s.topArtists[1].count, 2);
});

test('por membro, favorito e mais exigente', () => {
  const s = computeStats(sample());
  const [m1, m2] = s.members;
  assert.equal(m1.count, 3);
  assert.ok(Math.abs(m1.avg - 22 / 3) < 1e-9);
  assert.equal(m1.favorite.album.id, 'a2');
  assert.equal(m2.avg, 7.5);
  assert.equal(m2.user.displayName, 'Bia');
  assert.equal(s.strictest, 'u1');
});

test('divergências só com todas as notas', () => {
  const s = computeStats(sample());
  assert.deepEqual(s.divergences.map((x) => [x.album.id, x.spread]), [['a1', 2], ['a2', 0]]);
});

test('totais', () => {
  const s = computeStats(sample());
  assert.deepEqual(s.totals, { completed: 2, inProgress: 1, retro: 2 });
});

test('filtro sem retroativos', () => {
  const s = computeStats(sample(), { includeRetro: false });
  assert.deepEqual(s.bestAlbums.map((x) => x.album.id), ['a2', 'a1']);
  assert.equal(s.members[0].count, 2);
  assert.equal(s.topArtists.length, 1);
});

test('filtro só uma tag', () => {
  const d = sample();
  assert.deepEqual(filterAlbums(d, { tagMode: 'only', tagIds: ['old'] }).map((a) => a.id), ['a3', 'a5']);
  const s = computeStats(d, { tagMode: 'only', tagIds: ['old'] });
  assert.deepEqual(s.totals, { completed: 0, inProgress: 0, retro: 2 });
});

test('filtro tudo menos uma tag', () => {
  const d = sample();
  assert.deepEqual(filterAlbums(d, { tagMode: 'except', tagIds: ['old'] }).map((a) => a.id), ['a1', 'a2']);
});

test('filtro por ano de avaliação', () => {
  const d = sample();
  assert.deepEqual(filterAlbums(d, { year: 2026 }).map((a) => a.id), ['a2']);
  assert.deepEqual(filterAlbums(d, { year: 2022 }).map((a) => a.id), ['a3']);
  const s = computeStats(d, { year: 2025 });
  assert.equal(s.totals.completed, 1);
  assert.equal(s.totals.retro, 0);
});

test('sem dados', () => {
  const s = computeStats({ albums: [], results: {}, artists: [], users: [], memberUids: U });
  assert.equal(s.bestAlbums.length, 0);
  assert.equal(s.strictest, null);
  assert.equal(s.members[0].avg, null);
  assert.equal(s.members[0].favorite, null);
});

test('top 10 limita a lista', () => {
  const albums = [];
  const results = {};
  for (let i = 0; i < 15; i++) {
    albums.push({ id: `a${i}`, title: `T${i}`, artistId: 'x', retro: false, tags: [], tracks: [] });
    results[`a${i}`] = { memberScores: { u1: i, u2: i, u3: i }, trackAvgs: {}, retro: false, completedAt: null };
  }
  const s = computeStats({ albums, results, artists: [], users: [], memberUids: U });
  assert.equal(s.bestAlbums.length, 10);
  assert.equal(s.bestAlbums[0].score, 14);
  assert.equal(s.worstAlbums[0].score, 0);
});

const TAGS = [{ id: 'old-testamento', name: 'Old Testamento' }, { id: 'new-testamento', name: 'New Testamento' }];

function periodData() {
  const r = (g) => ({ memberScores: {}, groupScore: g, trackAvgs: {}, retro: true, completedAt: null });
  return {
    albums: [
      { id: 'o', title: 'Old', artistId: 'x', retro: true, tags: ['old-testamento'], genreId: 'pop' },
      { id: 'n', title: 'New', artistId: 'x', retro: true, tags: ['new-testamento'], genreId: 'rock' },
      { id: 'b', title: 'Both', artistId: 'x', retro: true, tags: ['old-testamento', 'new-testamento'], genreId: 'pop' },
      { id: 's', title: 'Sem', artistId: 'x', retro: true, tags: ['minha'] },
      { id: 'v', title: 'Vazio', artistId: 'x', retro: true },
    ],
    results: { o: r(8), n: r(7), b: r(6), s: r(5), v: r(4) },
    artists: [{ id: 'x', name: 'Xis' }],
    users: [],
    memberUids: U,
    tags: [...TAGS, { id: 'minha', name: 'Minha' }],
    genres: [{ id: 'pop', name: 'Pop' }, { id: 'rock', name: 'Rock' }],
  };
}

const ids = (list) => list.map((a) => a.id).sort();

test('ano de avaliação dos normais é calculado em São Paulo', () => {
  const album = { id: 'a', retro: false };
  assert.equal(albumEvalYear(album, { completedAt: new Date('2025-01-01T01:30:00Z') }), 2024);
  assert.equal(albumEvalYear(album, { completedAt: new Date('2025-01-01T03:30:00Z') }), 2025);
  assert.equal(albumEvalYear(album, { completedAt: null }), null);
  assert.equal(albumEvalYear(album, null), null);
});

test('retroativo sem ano de avaliação', () => {
  assert.equal(albumEvalYear({ retro: true, evaluatedYear: null }, {}), null);
  assert.equal(albumEvalYear({ retro: true }, {}), null);
  const d = periodData();
  assert.equal(filterAlbums(d, {}).length, 5);
  assert.equal(filterAlbums(d, { year: 2022 }).length, 0);
  assert.equal(computeStats(d, { year: 2022 }).totals.retro, 0);
  assert.equal(computeStats(d).totals.retro, 5);
});

test('filtro de período pelas tags do sistema', () => {
  const d = periodData();
  assert.deepEqual(ids(filterAlbums(d, { period: 'all' })), ['b', 'n', 'o', 's', 'v']);
  assert.deepEqual(ids(filterAlbums(d, { period: 'old' })), ['b', 'o']);
  assert.deepEqual(ids(filterAlbums(d, { period: 'new' })), ['n']);
  assert.equal(computeStats(d, { period: 'old' }).totals.retro, 2);
});

test('renomear as tags não muda o filtro de período', () => {
  const d = periodData();
  d.tags = [{ id: 'old-testamento', name: 'Antigo' }, { id: 'new-testamento', name: 'Novo' }];
  assert.deepEqual(ids(filterAlbums(d, { period: 'old' })), ['b', 'o']);
  assert.deepEqual(ids(filterAlbums(d, { period: 'new' })), ['n']);
});

test('período também vale para os em andamento', () => {
  const d = periodData();
  d.albums.push({ id: 'p', title: 'Andando', artistId: 'x', retro: false, tags: ['new-testamento'] });
  d.albums.push({ id: 'q', title: 'Andando 2', artistId: 'x', retro: false, tags: [] });
  assert.equal(computeStats(d, { period: 'new' }).totals.inProgress, 1);
  assert.equal(computeStats(d, { period: 'old' }).totals.inProgress, 0);
  assert.equal(computeStats(d).totals.inProgress, 2);
});

test('filtro por gênero', () => {
  const d = periodData();
  assert.deepEqual(ids(filterAlbums(d, { genreId: 'pop' })), ['b', 'o']);
  assert.deepEqual(ids(filterAlbums(d, { genreId: 'rock' })), ['n']);
  assert.equal(computeStats(d, { genreId: 'pop' }).totals.retro, 2);
  assert.deepEqual(computeStats(d, { genreId: 'pop' }).bestAlbums.map((x) => x.album.id), ['o', 'b']);
});

test('média por gênero ignora álbum sem gênero ou com gênero apagado', () => {
  const d = periodData();
  d.albums[3].genreId = 'apagado';
  const s = computeStats(d);
  assert.deepEqual(s.genres.map((g) => [g.genre.name, g.avg, g.count]), [['Pop', 7, 2], ['Rock', 7, 1]]);
});

test('gênero favorito de cada membro', () => {
  const d = sample();
  d.genres = [{ id: 'pop', name: 'Pop' }, { id: 'rock', name: 'Rock' }];
  d.albums[0].genreId = 'pop';
  d.albums[1].genreId = 'rock';
  d.albums[2].genreId = 'pop';
  const s = computeStats(d);
  const [m1, m2] = s.members;
  assert.equal(m1.favoriteGenre.genre.name, 'Rock');
  assert.equal(m1.favoriteGenre.avg, 9);
  assert.equal(m2.favoriteGenre.genre.name, 'Rock');
  assert.equal(computeStats(sample()).members[0].favoriteGenre, null);
});

test('gênero favorito desempata pela quantidade', () => {
  const d = periodData();
  d.results.o.memberScores = { u1: 8 };
  d.results.b.memberScores = { u1: 8 };
  d.results.n.memberScores = { u1: 8 };
  assert.equal(computeStats(d).members[0].favoriteGenre.genre.name, 'Pop');
  assert.equal(computeStats(d).members[0].favoriteGenre.count, 2);
});

test('dados antigos sem gênero não quebram', () => {
  const s = computeStats(sample());
  assert.deepEqual(s.genres, []);
  assert.equal(filterAlbums(sample(), { genreId: null }).length, 4);
});

test('estatísticas iguais com tags visíveis ou ocultas nos cards', () => {
  const a = periodData();
  const b = periodData();
  a.tags = a.tags.map((t) => ({ ...t, showOnCards: true }));
  b.tags = b.tags.map((t) => ({ ...t, showOnCards: false }));
  for (const f of [{}, { period: 'old' }, { period: 'new' }, { tagMode: 'only', tagIds: ['minha'] }]) {
    assert.deepEqual(computeStats(a, f), computeStats(b, f));
  }
});
