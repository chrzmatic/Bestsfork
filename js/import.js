import { normalizeKey } from './artists.js';
import { SYSTEM_TAG_DEFAULTS } from './periods.js';

const COLUMNS = ['album', 'artista', 'edicao', 'genero', 'tag', 'nota'];

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseEdition(raw) {
  const key = normalizeKey(raw);
  if (!key) return { edition: '', error: null };
  if (key.includes('deluxe')) return { edition: 'deluxe', error: null };
  if (['standard', 'padrao', 'normal'].includes(key)) return { edition: 'standard', error: null };
  return { edition: '', error: `Edição desconhecida: ${raw.trim()}` };
}

function parseScore(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(text)) return { score: null, error: 'Nota inválida: use um número de 0 a 10 com até duas casas' };
  const score = Number(text.replace(',', '.'));
  if (score > 10) return { score: null, error: 'A nota vai de 0 a 10' };
  return { score, error: null };
}

function resolveTag(name, tags) {
  const key = normalizeKey(name);
  if (!key) return { tagId: null, error: null };
  const current = (tags || []).find((t) => normalizeKey(t.name) === key);
  if (current) return { tagId: current.id, error: null };
  const system = Object.entries(SYSTEM_TAG_DEFAULTS).find(([, d]) => normalizeKey(d.name) === key);
  if (system) return { tagId: system[0], error: null };
  return { tagId: null, error: `Tag não encontrada: ${name.trim()}` };
}

export function parseImportCsv(text, tags) {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: ['O arquivo está vazio.'] };
  const header = table[0].map((h) => normalizeKey(h));
  const index = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  const missing = COLUMNS.filter((c) => index[c] < 0);
  if (missing.length) {
    return { rows: [], errors: [`Faltam colunas no cabeçalho: ${missing.join(', ')}.`] };
  }

  const rows = table.slice(1).map((cells, i) => {
    const get = (c) => String(cells[index[c]] ?? '').trim();
    const errors = [];
    const title = get('album');
    const artist = get('artista');
    if (!title) errors.push('Título vazio');
    if (!artist) errors.push('Artista vazio');
    const { edition, error: edErr } = parseEdition(get('edicao'));
    if (edErr) errors.push(edErr);
    const { score, error: scoreErr } = parseScore(get('nota'));
    if (scoreErr) errors.push(scoreErr);
    const tagName = get('tag');
    const { tagId, error: tagErr } = resolveTag(tagName, tags);
    if (tagErr) errors.push(tagErr);
    return { line: i + 2, title, artist, edition, genre: get('genero'), tagName, tagId, score, errors };
  });
  return { rows, errors: [] };
}

const EDITION_SUFFIX = /\s*[([][^)\]]*(deluxe|edition|version|remaster|expanded)[^)\]]*[)\]]/gi;

function titleKey(title) {
  return normalizeKey(String(title ?? '').replace(EDITION_SUFFIX, ''));
}

export function pickReleaseGroup(groups, title, artist) {
  const tk = titleKey(title);
  const ak = normalizeKey(artist);
  if (!tk || !ak) return null;
  const matches = (groups || []).filter((g) => {
    if (titleKey(g.title) !== tk) return false;
    const byName = (g.artists || []).some((a) => normalizeKey(a.name) === ak);
    return byName || normalizeKey(g.artistCredit).includes(ak);
  });
  return matches.find((g) => String(g.type || '').startsWith('Álbum')) || matches[0] || null;
}

export function pickEdition(options, edition) {
  const list = options || [];
  if (list.length === 0) return null;
  const byTracksDesc = (a, b) => b.trackCount - a.trackCount;
  if (edition === 'deluxe') {
    const deluxe = list.filter((o) => o.isDeluxe).sort(byTracksDesc);
    if (deluxe.length) return { option: deluxe[0], exact: true };
    return { option: [...list].sort(byTracksDesc)[0], exact: false };
  }
  const standard = list
    .filter((o) => !o.isDeluxe)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.trackCount - b.trackCount);
  if (standard.length) return { option: standard[0], exact: true };
  return { option: list[0], exact: false };
}

export function importTitle(title, edition) {
  if (edition === 'deluxe' && !/deluxe/i.test(title)) return `${title} (Deluxe)`;
  return title;
}

export function isDuplicate({ title, artist }, albums) {
  const tk = normalizeKey(title);
  const ak = normalizeKey(artist);
  return (albums || []).some((a) => normalizeKey(a.title) === tk &&
    (a.artistId === ak || normalizeKey(a.artistCredit) === ak));
}
