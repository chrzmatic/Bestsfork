import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, toCsv, albumsCsv, tracksCsv, fullJson, backupJson, fileName, exportAlbums } from '../js/export.js';

const U = ['u1', 'u2', 'u3'];

function sample() {
  return {
    albums: [
      { id: 'a1', title: 'Born, This "Way"', artistId: 'gaga', artistCredit: 'Lady Gaga', year: 2011, retro: false,
        evaluatedYear: null, tags: ['new'],
        tracks: [
          { id: 't2', disc: 1, position: 2, title: 'Hair', excluded: false },
          { id: 't1', disc: 1, position: 1, title: 'Intro', excluded: true },
        ] },
      { id: 'a2', title: 'Velho', artistId: 'x', year: 2000, retro: true, evaluatedYear: 2022, tags: ['old'], tracks: [] },
      { id: 'a3', title: 'Sem resultado', artistId: 'x', retro: false, tags: [], tracks: [] },
    ],
    artists: [{ id: 'gaga', name: 'Lady Gaga' }, { id: 'x', name: 'Xis' }],
    results: {
      a1: { memberScores: { u1: 8.5, u2: 7, u3: 9 }, groupScore: 8.1666, trackAvgs: { t2: 4.333333 }, retro: false,
        completedAt: new Date(2026, 5, 1) },
      a2: { memberScores: {}, groupScore: 6.25, trackAvgs: {}, retro: true, completedAt: null },
    },
    users: [{ id: 'u1', displayName: 'Ana' }, { id: 'u2', displayName: 'Bia, a "B"' }, { id: 'u3', name: 'Caio' }],
    memberUids: U,
    tags: [{ id: 'old', name: 'Old Testamento' }, { id: 'new', name: 'New Testamento' }],
    ratings: {
      a1: {
        u1: { scale: 5, trackScores: { t1: 50, t2: 43 }, albumScore: 42, status: 'final' },
        u2: { scale: 10, trackScores: { t2: 80 }, albumScore: 70, status: 'final' },
        u3: { scale: 5, trackScores: { t2: 47 }, albumScore: 45, status: 'final' },
      },
    },
  };
}

const lines = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('csvEscape trata vírgulas, aspas e quebras de linha', () => {
  assert.equal(csvEscape('simples'), 'simples');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvEscape('linha1\nlinha2'), '"linha1\nlinha2"');
  assert.equal(csvEscape('cr\r'), '"cr\r"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(csvEscape(8.16666), '8.17');
  assert.equal(csvEscape(4.3), '4.3');
});

test('toCsv usa BOM, vírgula e CRLF', () => {
  const csv = toCsv([['a', 'b'], [1, 'x,y']]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv, '﻿a,b\r\n1,"x,y"\r\n');
});

test('exportAlbums inclui só álbuns com results e pode excluir retro', () => {
  assert.deepEqual(exportAlbums(sample()).map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(exportAlbums(sample(), { includeRetro: false }).map((a) => a.id), ['a1']);
});

test('CSV de álbuns', () => {
  const rows = lines(albumsCsv(sample()));
  assert.equal(rows[0], 'Título,Artista,Ano,Ano avaliado,Tags,Gênero,Nota do grupo,Ana,"Bia, a ""B""",Caio');
  assert.equal(rows[1], '"Born, This ""Way""",Lady Gaga,2011,2026,New Testamento,,8.17,8.5,7,9');
  assert.equal(rows[2], 'Velho,Xis,2000,2022,Old Testamento,,6.25,,,');
  assert.equal(rows.length, 3);
  assert.equal(lines(albumsCsv(sample(), { includeRetro: false })).length, 2);
});

test('CSV de faixas em base 5, excluídas vazias', () => {
  const rows = lines(tracksCsv(sample()));
  assert.equal(rows[0], 'Álbum,Artista,Disco,Número,Faixa,Conta,Média do grupo,Ana,"Bia, a ""B""",Caio');
  assert.equal(rows[1], '"Born, This ""Way""",Lady Gaga,1,1,Intro,não,,,,');
  assert.equal(rows[2], '"Born, This ""Way""",Lady Gaga,1,2,Hair,sim,4.33,4.3,4,4.7');
  assert.equal(rows.length, 3);
});

test('JSON completo inclui notas por membro de álbuns normais', () => {
  const json = JSON.parse(fullJson(sample()));
  assert.equal(json.albums.length, 2);
  const a1 = json.albums.find((a) => a.id === 'a1');
  assert.equal(a1.artistName, 'Lady Gaga');
  assert.deepEqual(a1.tagNames, ['New Testamento']);
  assert.equal(a1.ratings.u1.trackScores.t2, 43);
  assert.equal(a1.ratings.u1.member, 'Ana');
  assert.equal(typeof a1.result.completedAt, 'string');
  const a2 = json.albums.find((a) => a.id === 'a2');
  assert.equal(a2.ratings, undefined);
  assert.equal(json.users[2].displayName, 'Caio');
  assert.ok(json.exportedAt);
});

test('backup converte datas para ISO', () => {
  const json = JSON.parse(backupJson({ albums: [{ id: 'a', createdAt: new Date(Date.UTC(2026, 0, 2)) }] }));
  assert.equal(json.albums[0].createdAt, '2026-01-02T00:00:00.000Z');
  assert.ok(json.backupAt);
});

test('nomes de arquivo', () => {
  const d = new Date(2026, 8, 4);
  assert.equal(fileName('albuns', d), 'bestsfork-albuns-2026-09-04.csv');
  assert.equal(fileName('faixas', d), 'bestsfork-faixas-2026-09-04.csv');
  assert.equal(fileName('completo', d), 'bestsfork-completo-2026-09-04.json');
  assert.equal(fileName('backup', d), 'bestsfork-backup-2026-09-04.json');
});

test('CSV de álbuns traz o nome atual do gênero', () => {
  const d = sample();
  d.genres = [{ id: 'pop', name: 'Pop' }];
  d.albums[0].genreId = 'pop';
  d.albums[1].genreId = 'sumiu';
  let rows = lines(albumsCsv(d));
  assert.equal(rows[1], '"Born, This ""Way""",Lady Gaga,2011,2026,New Testamento,Pop,8.17,8.5,7,9');
  assert.equal(rows[2], 'Velho,Xis,2000,2022,Old Testamento,,6.25,,,');
  d.genres[0].name = 'Pop Music';
  rows = lines(albumsCsv(d));
  assert.ok(rows[1].includes(',Pop Music,'));
  const json = JSON.parse(fullJson(d));
  assert.equal(json.albums.find((a) => a.id === 'a1').genreName, 'Pop Music');
  assert.equal(json.albums.find((a) => a.id === 'a2').genreName, '');
});

test('retroativo sem ano de avaliação sai com o campo vazio', () => {
  const d = sample();
  d.albums[1].evaluatedYear = null;
  assert.equal(lines(albumsCsv(d))[2], 'Velho,Xis,2000,,Old Testamento,,6.25,,,');
  delete d.albums[1].evaluatedYear;
  assert.equal(lines(albumsCsv(d))[2], 'Velho,Xis,2000,,Old Testamento,,6.25,,,');
});

test('export igual com tags visíveis ou ocultas nos cards', () => {
  const a = sample();
  const b = sample();
  a.tags = a.tags.map((t) => ({ ...t, showOnCards: true }));
  b.tags = b.tags.map((t) => ({ ...t, showOnCards: false }));
  assert.equal(albumsCsv(a), albumsCsv(b));
  assert.equal(tracksCsv(a), tracksCsv(b));
  const strip = (x) => x.replace(/"exportedAt": "[^"]+"/, '');
  assert.equal(strip(fullJson(a)), strip(fullJson(b)));
});
