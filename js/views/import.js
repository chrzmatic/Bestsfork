import { h, screenHead, emptyState, cover, badge, toast, confirmDialog, withBusy, add, put } from '../ui.js';
import * as db from '../db.js';
import * as mb from '../musicbrainz.js';
import { parseImportCsv, pickReleaseGroup, pickEdition, importTitle, isDuplicate } from '../import.js';
import { parseFinal } from './album-new.js';
import { normalizeKey } from '../artists.js';
import { formatScore } from '../scoring.js';
import { actingAdmin, session } from '../state.js';

export async function render(root) {
  const back = '#/admin';
  if (!actingAdmin()) {
    add(root, screenHead('Importar retroativos', { back }), emptyState('Só no modo admin', 'Ative o modo admin em Perfil.'));
    return;
  }
  const [tags, albums] = await Promise.all([db.listTags(), db.listAlbums()]);
  const body = h('div');
  let busy = false;
  add(root, screenHead('Importar retroativos', { back }), body);
  pickStep();

  const leaveGuard = (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', leaveGuard);
  const cleanup = () => window.removeEventListener('beforeunload', leaveGuard);

  function pickStep() {
    const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'input' });
    const error = h('div');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const text = await f.text();
      const parsed = parseImportCsv(text, tags);
      if (parsed.errors.length) {
        put(error, h('div', { class: 'notice' }, parsed.errors.join(' ')));
        return;
      }
      if (parsed.rows.length === 0) {
        put(error, h('div', { class: 'notice' }, 'O arquivo não tem nenhuma linha de álbum.'));
        return;
      }
      matchStep(parsed.rows);
    });
    put(body,
      h('p', { class: 'muted', style: 'margin-bottom: 14px' },
        'Escolha o CSV com as colunas album, artista, edicao, genero, tag e nota. Nada é gravado antes de você confirmar a prévia.'),
      h('label', { class: 'field' }, h('span', null, 'Arquivo CSV'), file),
      error,
    );
  }

  // Busca cada linha no MusicBrainz, uma de cada vez por causa do limite de 1 por segundo.
  async function matchStep(rows) {
    busy = true;
    const bar = h('div', { style: 'width: 0%' });
    const label = h('p', { class: 'muted' });
    put(body, label, h('div', { class: 'progress', style: 'margin-top: 10px' }, bar));
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      label.textContent = `Buscando ${i + 1} de ${rows.length}: ${row.title}, ${row.artist}`;
      bar.style.width = `${Math.round((i / rows.length) * 100)}%`;
      const item = { row, group: null, options: [], choice: null, exact: true, error: null };
      if (row.title && row.artist) {
        try {
          const groups = await mb.searchReleaseGroups(`${row.title} ${row.artist}`);
          item.group = pickReleaseGroup(groups, row.title, row.artist);
          if (item.group) {
            item.options = await mb.getReleaseOptions(item.group.id);
            const picked = pickEdition(item.options, row.edition);
            item.choice = picked?.option || null;
            item.exact = picked ? picked.exact : true;
          }
        } catch (err) {
          item.error = err?.message || 'Falha ao buscar no MusicBrainz.';
        }
      }
      items.push(item);
    }
    busy = false;
    previewStep(items);
  }

  function previewStep(items) {
    const entries = items.map((item) => {
      const { row } = item;
      const title = importTitle(row.title, row.edition);
      const dupe = isDuplicate({ title, artist: row.artist }, albums);
      return {
        item,
        include: row.errors.length === 0 && !dupe,
        dupe,
        title: h('input', { class: 'input', value: title, 'aria-label': 'Título' }),
        artist: h('input', { class: 'input', value: row.artist, 'aria-label': 'Artista' }),
        genre: h('input', { class: 'input', value: row.genre, placeholder: 'Sem gênero', 'aria-label': 'Gênero' }),
        score: h('input', { class: 'input', inputmode: 'decimal', value: row.score != null ? formatScore(row.score) : '', 'aria-label': 'Nota do grupo' }),
        tag: h('select', { class: 'input', 'aria-label': 'Tag' },
          h('option', { value: '' }, 'Sem tag'),
          tags.map((t) => h('option', { value: t.id, selected: t.id === row.tagId }, t.name))),
        edition: item.options.length > 1 ? h('select', { class: 'input', 'aria-label': 'Edição' },
          item.options.map((o, i) => h('option', { value: String(i), selected: o === item.choice },
            `${o.title}${o.disambiguation ? ` (${o.disambiguation})` : ''}, ${o.label}`))) : null,
        useMb: !!item.choice,
      };
    });

    const found = entries.filter((e) => e.item.choice).length;
    const summary = h('p', { class: 'muted' });
    const paintSummary = () => {
      const n = entries.filter((e) => e.include).length;
      summary.textContent = `${entries.length} linhas, ${found} encontradas no MusicBrainz, ${entries.length - found} sem correspondência. ${n} marcadas para importar.`;
    };

    const card = (e) => {
      const { item } = e;
      const status = [];
      if (item.error) status.push(badge('Erro na busca', 'warn'));
      else if (item.choice) status.push(badge('Encontrado', 'final'));
      else status.push(badge('Sem correspondência', 'warn'));
      if (item.choice && !item.exact) status.push(badge('Edição aproximada', 'warn'));
      if (e.dupe) status.push(badge('Já existe no app', 'warn'));
      const include = h('input', { type: 'checkbox', class: 'check', checked: e.include,
        onchange: (ev) => { e.include = ev.target.checked; paintSummary(); } });
      const mbSwitch = item.choice && h('label', { class: 'row small', style: 'gap: 8px; margin-top: 6px' },
        h('input', { type: 'checkbox', class: 'check', checked: e.useMb, onchange: (ev) => { e.useMb = ev.target.checked; } }),
        'Usar ano, capa e faixas do MusicBrainz');
      const choice = item.choice;
      return h('li', { class: 'panel import-row' },
        h('div', { class: 'row', style: 'align-items: flex-start' },
          h('label', { style: 'padding-top: 4px' }, include),
          h('div', { style: 'width: 64px; flex: none' }, cover(item.group ? mb.coverUrlForGroup(item.group.id, 250) : null, '')),
          h('div', { class: 'grow' },
            h('div', { class: 'small muted' }, `Linha ${item.row.line}`),
            h('div', { class: 'badges', style: 'margin: 4px 0' }, status),
            item.group && h('div', { class: 'small' },
              `${item.group.title}, ${item.group.artistCredit}${item.group.year ? `, ${item.group.year}` : ''}`,
              choice ? `, ${choice.label}` : ''),
            item.error && h('div', { class: 'small error-text' }, item.error),
            item.row.errors.length > 0 && h('div', { class: 'small error-text' }, item.row.errors.join('. ')))),
        h('div', { class: 'import-fields' },
          h('label', { class: 'field' }, h('span', null, 'Título'), e.title),
          h('label', { class: 'field' }, h('span', null, 'Artista'), e.artist),
          h('label', { class: 'field' }, h('span', null, 'Gênero'), e.genre),
          h('label', { class: 'field' }, h('span', null, 'Tag'), e.tag),
          h('label', { class: 'field' }, h('span', null, 'Nota do grupo'), e.score),
          e.edition && h('label', { class: 'field' }, h('span', null, 'Edição'), e.edition)),
        mbSwitch,
      );
    };

    const saveBtn = h('button', { class: 'btn block', onclick: () => save(entries, saveBtn) }, 'Importar marcados');
    paintSummary();
    put(body,
      summary,
      h('ul', { class: 'import-list' }, entries.map(card)),
      h('div', { class: 'stack', style: 'margin-top: 16px' },
        saveBtn,
        h('button', { class: 'btn block ghost', onclick: () => pickStep() }, 'Escolher outro arquivo')),
    );
  }

  async function save(entries, saveBtn) {
    const chosen = entries.filter((e) => e.include);
    if (chosen.length === 0) { toast('Nenhuma linha marcada.', { error: true }); return; }
    const problems = [];
    const payloads = chosen.map((e) => {
      const title = e.title.value.trim();
      const artist = e.artist.value.trim();
      const score = parseFinal(e.score.value);
      if (!title || !normalizeKey(artist)) problems.push(`Linha ${e.item.row.line}: título e artista são obrigatórios`);
      if (score.error || score.value == null) problems.push(`Linha ${e.item.row.line}: ${score.error || 'falta a nota do grupo'}`);
      const option = e.edition ? e.item.options[Number(e.edition.value)] : e.item.choice;
      const group = e.useMb ? e.item.group : null;
      const sameArtist = group && normalizeKey(artist) === normalizeKey(group.artists[0]?.name || '');
      return {
        line: e.item.row.line,
        album: {
          title,
          artistCredit: sameArtist ? group.artistCredit : artist,
          year: group?.year ?? null,
          coverUrl: group ? mb.coverUrlForGroup(group.id, 500) : null,
          musicbrainzReleaseId: group && option ? option.releaseId : null,
          tracks: group && option
            ? option.tracks.map((t, i) => ({ id: `t${i + 1}`, disc: t.disc, position: t.position, title: t.title, lengthMs: t.lengthMs ?? null, excluded: false }))
            : [],
          retro: true,
          evaluatedYear: null,
          tags: e.tag.value ? [e.tag.value] : [],
        },
        artistName: artist,
        artistMbid: sameArtist ? group.artists[0]?.id || null : null,
        genreName: e.genre.value.trim() || null,
        result: { memberScores: {}, groupScore: score.value, trackAvgs: {} },
      };
    });
    if (problems.length) {
      toast(problems.slice(0, 3).join('. '), { error: true, duration: 6000 });
      return;
    }
    const ok = await confirmDialog({
      title: `Importar ${chosen.length} ${chosen.length === 1 ? 'álbum' : 'álbuns'}?`,
      body: 'Eles entram como registros retroativos, com a nota do grupo e sem avaliações individuais.',
      confirmLabel: 'Importar',
    });
    if (!ok) return;

    busy = true;
    saveBtn.disabled = true;
    const label = h('p', { class: 'muted' });
    const bar = h('div', { style: 'width: 0%' });
    put(body, label, h('div', { class: 'progress', style: 'margin-top: 10px' }, bar));
    const artistIds = new Set();
    const failed = [];
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      label.textContent = `Gravando ${i + 1} de ${payloads.length}: ${p.album.title}`;
      bar.style.width = `${Math.round((i / payloads.length) * 100)}%`;
      try {
        const { artistId } = await db.createAlbum(p, session.uid);
        artistIds.add(artistId);
      } catch (err) {
        console.error(err);
        failed.push(`Linha ${p.line} (${p.album.title})`);
      }
    }
    const ids = [...artistIds];
    for (let i = 0; i < ids.length; i++) {
      label.textContent = `Buscando fotos dos artistas: ${i + 1} de ${ids.length}`;
      bar.style.width = `${Math.round((i / ids.length) * 100)}%`;
      await db.ensureArtistPhoto(ids[i]).catch(() => {});
    }
    busy = false;
    bar.style.width = '100%';
    const done = payloads.length - failed.length;
    put(body,
      emptyState('Importação concluída', `${done} ${done === 1 ? 'álbum importado' : 'álbuns importados'}.`,
        h('a', { class: 'btn', href: '#/albums' }, 'Ver álbuns')),
      failed.length > 0 && h('div', { class: 'notice' }, `Não foi possível gravar: ${failed.join(', ')}. Tente essas de novo com um CSV só com elas.`),
    );
    toast('Importação concluída');
  }

  return cleanup;
}
