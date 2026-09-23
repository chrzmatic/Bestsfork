import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, parseImportCsv, pickReleaseGroup, pickEdition, importTitle, isDuplicate,
} from '../js/import.js';

const TAGS = [
  { id: 'old-testamento', name: 'Old Testamento' },
  { id: 'new-testamento', name: 'New Testamento' },
];

test('parseCsv: BOM, CRLF, aspas, vírgula e quebra de linha dentro de aspas', () => {
  const text = '﻿a,b\r\n"x, y","diz ""oi"""\n"linha\num",2\n\n  \n';
  assert.deepEqual(parseCsv(text), [['a', 'b'], ['x, y', 'diz "oi"'], ['linha\num', '2']]);
});

test('parseCsv sem quebra de linha no fim', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

const CSV = [
  'album,artista,edicao,genero,tag,nota',
  'Positions,Ariana Grande,standard,Pop,Old Testamento,8.0',
  'Positions,Ariana Grande,deluxe,Pop,Old Testamento,8.1',
  '"Sin Miedo (del Amor, y Otros Demonios)",Kali Uchis,,Pop,New Testamento,"7,9"',
].join('\n');

test('parseImportCsv com o formato real', () => {
  const { rows, errors } = parseImportCsv(CSV, TAGS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    line: 2, title: 'Positions', artist: 'Ariana Grande', edition: 'standard', genre: 'Pop',
    tagName: 'Old Testamento', tagId: 'old-testamento', score: 8, errors: [],
  });
  assert.equal(rows[1].edition, 'deluxe');
  assert.equal(rows[1].score, 8.1);
  assert.equal(rows[2].title, 'Sin Miedo (del Amor, y Otros Demonios)');
  assert.equal(rows[2].edition, '');
  assert.equal(rows[2].tagId, 'new-testamento');
  assert.equal(rows[2].score, 7.9);
  assert.equal(rows[2].line, 4);
});

test('cabeçalho em ordem livre, com acento e maiúsculas', () => {
  const text = 'Nota,Tag,Gênero,Edição,Artista,Álbum\n9,Old Testamento,Rock,,Muse,Absolution';
  const { rows, errors } = parseImportCsv(text, TAGS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].title, 'Absolution');
  assert.equal(rows[0].genre, 'Rock');
  assert.equal(rows[0].score, 9);
});

test('coluna faltando gera erro e nenhuma linha', () => {
  const { rows, errors } = parseImportCsv('album,artista,tag,nota\nX,Y,Old Testamento,8', TAGS);
  assert.equal(rows.length, 0);
  assert.match(errors[0], /edicao, genero/);
});

test('arquivo vazio', () => {
  assert.equal(parseImportCsv('', TAGS).errors.length, 1);
});

test('tag renomeada: nome atual e nome padrão levam ao mesmo id', () => {
  const renamed = [{ id: 'old-testamento', name: 'Antigo' }];
  const a = parseImportCsv('album,artista,edicao,genero,tag,nota\nX,Y,,Pop,Old Testamento,8', renamed);
  const b = parseImportCsv('album,artista,edicao,genero,tag,nota\nX,Y,,Pop,antigo,8', renamed);
  assert.equal(a.rows[0].tagId, 'old-testamento');
  assert.equal(b.rows[0].tagId, 'old-testamento');
  assert.deepEqual(a.rows[0].errors, []);
});

test('tag vazia não é erro; desconhecida é', () => {
  const { rows } = parseImportCsv('album,artista,edicao,genero,tag,nota\nX,Y,,Pop,,8\nX,Y,,Pop,Favoritos,8', TAGS);
  assert.equal(rows[0].tagId, null);
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[1].tagId, null);
  assert.deepEqual(rows[1].errors, ['Tag não encontrada: Favoritos']);
});

test('edições aceitas e desconhecidas', () => {
  const lines = ['padrão', 'Normal', 'Deluxe Edition', 'remix'].map((e) => `X,Y,${e},Pop,,8`);
  const { rows } = parseImportCsv(['album,artista,edicao,genero,tag,nota', ...lines].join('\n'), TAGS);
  assert.deepEqual(rows.map((r) => r.edition), ['standard', 'standard', 'deluxe', '']);
  assert.deepEqual(rows[3].errors, ['Edição desconhecida: remix']);
});

test('notas inválidas', () => {
  const lines = ['10', '0', '10.5', '8.333', 'abc', '', '-1'].map((n) => `X,Y,,Pop,,${n}`);
  const { rows } = parseImportCsv(['album,artista,edicao,genero,tag,nota', ...lines].join('\n'), TAGS);
  assert.deepEqual(rows.map((r) => r.score), [10, 0, null, null, null, null, null]);
  assert.ok(rows.slice(2).every((r) => r.errors.length === 1));
});

test('título e artista vazios', () => {
  const { rows } = parseImportCsv('album,artista,edicao,genero,tag,nota\n,,,Pop,,8', TAGS);
  assert.deepEqual(rows[0].errors, ['Título vazio', 'Artista vazio']);
});

const GROUPS = [
  { id: 'g1', title: 'Positions (Deluxe)', artistCredit: 'Ariana Grande', artists: [{ id: 'a', name: 'Ariana Grande' }], type: 'Single' },
  { id: 'g2', title: 'Positions', artistCredit: 'Ariana Grande', artists: [{ id: 'a', name: 'Ariana Grande' }], type: 'Álbum' },
  { id: 'g3', title: 'Positions', artistCredit: 'Outra Pessoa', artists: [{ id: 'b', name: 'Outra Pessoa' }], type: 'Álbum' },
];

test('pickReleaseGroup casa título e artista, preferindo álbum', () => {
  assert.equal(pickReleaseGroup(GROUPS, 'Positions', 'Ariana Grande').id, 'g2');
  assert.equal(pickReleaseGroup(GROUPS, 'positions [Deluxe Edition]', 'ariana grande').id, 'g2');
  assert.equal(pickReleaseGroup(GROUPS, 'Positions', 'Ninguém'), null);
  assert.equal(pickReleaseGroup(GROUPS, 'Outro Disco', 'Ariana Grande'), null);
  assert.equal(pickReleaseGroup([], 'Positions', 'Ariana Grande'), null);
});

test('pickReleaseGroup aceita artista dentro do crédito', () => {
  const g = [{ id: 'x', title: 'A Star Is Born', artistCredit: 'Lady Gaga & Bradley Cooper', artists: [], type: 'Álbum, Trilha sonora' }];
  assert.equal(pickReleaseGroup(g, 'A Star Is Born', 'Lady Gaga').id, 'x');
});

const OPTIONS = [
  { releaseId: 's1', isDeluxe: false, trackCount: 14, count: 5 },
  { releaseId: 's2', isDeluxe: false, trackCount: 15, count: 5 },
  { releaseId: 's3', isDeluxe: false, trackCount: 13, count: 2 },
  { releaseId: 'd1', isDeluxe: true, trackCount: 18, count: 1 },
  { releaseId: 'd2', isDeluxe: true, trackCount: 20, count: 1 },
];

test('pickEdition: deluxe pega a de mais faixas', () => {
  assert.deepEqual(pickEdition(OPTIONS, 'deluxe'), { option: OPTIONS[4], exact: true });
});

test('pickEdition: standard e vazio pegam a mais comum, empate com menos faixas', () => {
  assert.deepEqual(pickEdition(OPTIONS, 'standard'), { option: OPTIONS[0], exact: true });
  assert.deepEqual(pickEdition(OPTIONS, ''), { option: OPTIONS[0], exact: true });
});

test('pickEdition sem a edição pedida marca exact false', () => {
  const onlyStd = OPTIONS.slice(0, 3);
  assert.deepEqual(pickEdition(onlyStd, 'deluxe'), { option: OPTIONS[1], exact: false });
  const onlyDeluxe = OPTIONS.slice(3);
  assert.deepEqual(pickEdition(onlyDeluxe, 'standard'), { option: OPTIONS[3], exact: false });
  assert.equal(pickEdition([], 'standard'), null);
});

test('importTitle acrescenta (Deluxe) só quando falta', () => {
  assert.equal(importTitle('Positions', 'deluxe'), 'Positions (Deluxe)');
  assert.equal(importTitle('Positions (Deluxe)', 'deluxe'), 'Positions (Deluxe)');
  assert.equal(importTitle('Positions', 'standard'), 'Positions');
  assert.equal(importTitle('Positions', ''), 'Positions');
});

test('isDuplicate por título e artista normalizados', () => {
  const albums = [
    { title: 'Born This Way', artistId: 'lady-gaga', artistCredit: 'Lady Gaga' },
    { title: 'Collab', artistId: 'x', artistCredit: 'Beyoncé' },
  ];
  assert.equal(isDuplicate({ title: 'born this way', artist: 'LADY GAGA' }, albums), true);
  assert.equal(isDuplicate({ title: 'Collab', artist: 'Beyonce' }, albums), true);
  assert.equal(isDuplicate({ title: 'Born This Way', artist: 'Madonna' }, albums), false);
  assert.equal(isDuplicate({ title: 'Chromatica', artist: 'Lady Gaga' }, albums), false);
});
