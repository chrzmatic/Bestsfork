import { h, cover, screenHead, switchField, loading, toast, confirmDialog, withBusy, userName, emptyState } from '../ui.js';
import * as db from '../db.js';
import * as mb from '../musicbrainz.js';
import { normalizeKey } from '../artists.js';
import { countedTracks } from '../scoring.js';
import { session, actingAdmin } from '../state.js';
import { navigate } from '../app.js';
import { trackEditor, tracksFromLines } from './track-editor.js';

// Nota final de 0 a 10 com até 2 casas, como digitada pelo admin.
export function parseFinal(text) {
  const raw = String(text ?? '').trim().replace(',', '.');
  if (raw === '') return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { value: null, error: 'Use um número de 0 a 10 com até duas casas' };
  const v = Number(raw);
  if (v < 0 || v > 10) return { value: null, error: 'A nota vai de 0 a 10' };
  return { value: v, error: null };
}

export function tagsForYear(tags, year) {
  if (!Number.isInteger(year)) return [];
  return tags.filter((t) => t.yearFrom != null && year >= t.yearFrom && (t.yearTo == null || year <= t.yearTo)).map((t) => t.id);
}

export async function render(root) {
  if (!session.isAdmin) {
    root.append(screenHead('Novo álbum', { back: '#/albums' }), emptyState('Só o admin adiciona álbuns', null));
    return;
  }
  const allowRetro = actingAdmin();
  const body = h('div');
  let retro = false;

  root.append(screenHead('Novo álbum', { back: '#/albums' }), body);
  searchStep();

  function searchStep(initial = '') {
    const input = h('input', { class: 'input', type: 'search', value: initial, placeholder: 'Ex.: the fame lady gaga', enterkeyhint: 'search', 'aria-label': 'Álbum e artista' });
    const results = h('div');
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Buscar');

    const run = async () => {
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      submit.disabled = true;
      results.replaceChildren(loading());
      try {
        const groups = await mb.searchReleaseGroups(q);
        if (groups.length === 0) {
          toast('Nada encontrado no MusicBrainz. Preencha à mão.');
          confirmStep({ title: '', artistName: '', artistCredit: '', year: null, tracks: [], manual: true });
          return;
        }
        results.replaceChildren(h('ul', { class: 'result-list' }, groups.map((g) => h('li', null,
          h('button', { type: 'button', onclick: () => optionsStep(g, q) },
            cover(g.coverUrl, ''),
            h('div', { style: 'min-width: 0' },
              h('h3', null, g.title),
              h('div', { class: 'muted small' }, g.artistCredit),
              h('div', { class: 'muted small' }, [g.year, g.type].filter(Boolean).join(', ')),
            ),
          )))));
      } catch (err) {
        results.replaceChildren(networkError(err, run));
      } finally {
        submit.disabled = false;
      }
    };

    body.replaceChildren(
      allowRetro && h('div', { class: 'panel' }, switchField('Registro retroativo', retro, (v) => { retro = v; }),
        h('p', { class: 'hint' }, 'Para álbuns avaliados antes do app. Grava só a nota final, sem passar pela avaliação.')),
      h('form', { class: 'row', style: 'margin-bottom: 12px', onsubmit: (e) => { e.preventDefault(); run(); } },
        h('div', { class: 'grow' }, input), submit),
      h('button', { class: 'btn ghost', type: 'button', style: 'padding-left: 0',
        onclick: () => confirmStep({ title: '', artistName: '', artistCredit: '', year: null, tracks: [], manual: true }) },
      'Preencher à mão'),
      results,
    );
    setTimeout(() => input.focus(), 50);
    if (initial) run();
  }

  function networkError(err, retry) {
    return h('div', { class: 'notice' },
      h('p', null, err?.message || 'Não foi possível falar com o MusicBrainz.'),
      h('div', { class: 'btn-row', style: 'margin-top: 10px' },
        h('button', { class: 'btn small', type: 'button', onclick: retry }, 'Tentar de novo'),
        h('button', { class: 'btn small secondary', type: 'button',
          onclick: () => confirmStep({ title: '', artistName: '', artistCredit: '', year: null, tracks: [], manual: true }) }, 'Preencher à mão'),
      ));
  }

  async function optionsStep(group, query) {
    body.replaceChildren(h('p', { class: 'muted' }, `Buscando as edições de ${group.title}…`), loading());
    let options;
    try {
      options = await mb.getReleaseOptions(group.id);
    } catch (err) {
      body.replaceChildren(networkError(err, () => optionsStep(group, query)),
        h('button', { class: 'btn ghost', onclick: () => searchStep(query) }, 'Voltar para a busca'));
      return;
    }
    const base = {
      musicbrainzReleaseId: null,
      coverUrl: mb.coverUrlForGroup(group.id, 500),
      title: group.title,
      artistName: group.artists[0]?.name || group.artistCredit,
      artistMbid: group.artists[0]?.id || null,
      artistCredit: group.artistCredit,
      year: group.year,
    };
    const pick = (o) => confirmStep({
      ...base,
      musicbrainzReleaseId: o.releaseId,
      tracks: o.tracks.map((t, i) => ({ id: `t${i + 1}`, disc: t.disc, position: t.position, title: t.title, lengthMs: t.lengthMs ?? null, excluded: false })),
      back: () => (options.length > 1 ? optionsStep(group, query) : searchStep(query)),
    });
    if (options.length === 0) {
      toast('Esse lançamento não tem faixas no MusicBrainz. Complete à mão.');
      confirmStep({ ...base, tracks: [], back: () => searchStep(query) });
      return;
    }
    if (options.length === 1) { pick(options[0]); return; }

    body.replaceChildren(
      h('div', { class: 'row', style: 'margin-bottom: 16px' },
        h('div', { style: 'width: 72px; flex: none' }, cover(group.coverUrl, '')),
        h('div', { class: 'grow' }, h('h2', null, group.title), h('div', { class: 'muted' }, group.artistCredit))),
      h('h3', { style: 'margin-bottom: 4px' }, 'Qual edição?'),
      h('p', { class: 'hint' }, 'Edições com a mesma lista de faixas aparecem juntas.'),
      h('ul', { class: 'result-list option-list' }, options.map((o) => h('li', null,
        h('button', { type: 'button', onclick: () => pick(o) },
          h('div', null,
            h('h3', null, o.isDeluxe ? h('span', null, o.title, ' ', h('span', { class: 'badge draft' }, 'Deluxe')) : o.title),
            h('div', { class: 'muted small' }, [o.disambiguation, o.year, o.count > 1 ? `${o.count} edições` : null].filter(Boolean).join(', ')),
          ),
          h('strong', null, `${o.trackCount} faixas`),
        )))),
      h('button', { class: 'btn ghost', onclick: () => searchStep(query) }, 'Voltar para a busca'),
    );
  }

  async function confirmStep(data) {
    body.replaceChildren(loading());
    const [tags, users] = await Promise.all([db.listTags(), db.usersById()]);
    const state = { tracks: data.tracks.map((t) => ({ ...t })) };
    const selectedTags = new Set();
    let autoTags = [];

    const title = h('input', { class: 'input', value: data.title || '', required: true });
    const artist = h('input', { class: 'input', value: data.artistName || '', required: true });
    const credit = h('input', { class: 'input', value: data.artistCredit || '', placeholder: 'Igual ao artista' });
    const year = h('input', { class: 'input', inputmode: 'numeric', value: data.year ?? '' });
    const error = h('p', { class: 'error-text', role: 'alert' });
    const editor = trackEditor(state);
    const lines = h('textarea', { class: 'input', placeholder: 'Uma faixa por linha' });
    const linesBox = h('div', { class: 'field' },
      h('span', null, 'Colar faixas'),
      lines,
      h('button', { class: 'btn secondary small', type: 'button', style: 'justify-self: start', onclick: () => {
        const added = tracksFromLines(lines.value);
        if (!added.length) return;
        state.tracks = added;
        linesBox.remove();
        editor.redraw();
      } }, 'Usar estas faixas'));

    // Campos do retroativo
    const evalYear = h('input', { class: 'input', inputmode: 'numeric' });
    const groupScore = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Ex.: 7,85' });
    const memberInputs = session.members.map((u) => ({ uid: u, input: h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Opcional' }) }));
    const tagChips = h('div', { class: 'chips', style: 'flex-wrap: wrap' });
    const drawTags = () => tagChips.replaceChildren(...tags.map((t) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(selectedTags.has(t.id)),
      onclick: () => { if (selectedTags.has(t.id)) selectedTags.delete(t.id); else selectedTags.add(t.id); drawTags(); },
    }, t.name)));
    evalYear.addEventListener('input', () => {
      const y = Number(evalYear.value);
      for (const id of autoTags) selectedTags.delete(id);
      autoTags = tagsForYear(tags, y).filter((id) => !selectedTags.has(id));
      for (const id of autoTags) selectedTags.add(id);
      drawTags();
    });
    drawTags();

    const saveBtn = h('button', { class: 'btn block', type: 'submit' }, retro ? 'Salvar registro retroativo' : 'Salvar álbum');

    const form = h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      data.coverUrl && h('div', { style: 'width: 140px; margin-bottom: 16px' }, cover(data.coverUrl, '')),
      h('label', { class: 'field' }, h('span', null, 'Título'), title),
      h('label', { class: 'field' }, h('span', null, 'Artista principal'), artist),
      h('label', { class: 'field' }, h('span', null, 'Crédito completo'), credit,
        h('span', { class: 'hint' }, 'Como aparece na capa, ex.: Lady Gaga & Bradley Cooper.')),
      h('label', { class: 'field' }, h('span', null, 'Ano de lançamento'), year),
      tags.length > 0 && h('div', { class: 'field' }, h('span', null, 'Tags'), tagChips),
      retro && h('div', { class: 'panel' },
        h('h2', null, 'Registro retroativo'),
        h('label', { class: 'field' }, h('span', null, 'Ano em que foi avaliado'), evalYear),
        h('label', { class: 'field' }, h('span', null, 'Nota do grupo (0 a 10)'), groupScore),
        memberInputs.map(({ uid, input }) => h('label', { class: 'field' }, h('span', null, `Nota final de ${userName(users[uid])}`), input)),
      ),
      h('div', { class: 'section' }, h('h2', null, 'Faixas'),
        h('p', { class: 'hint' }, retro ? 'Opcional em registros retroativos.' : 'Marque "Não conta na avaliação" em intros, interlúdios e afins. Remova só o que nem deveria estar no álbum.')),
      editor.el,
      state.tracks.length === 0 && linesBox,
      error,
      h('div', { class: 'stack', style: 'margin-top: 24px' },
        saveBtn,
        h('button', { class: 'btn block ghost', type: 'button', onclick: () => (data.back ? data.back() : searchStep()) }, 'Voltar'),
      ),
    );
    body.replaceChildren(form);

    async function save() {
      error.textContent = '';
      const t = title.value.trim();
      const a = artist.value.trim();
      if (!t || !a) { error.textContent = 'Preencha título e artista.'; return; }
      if (!normalizeKey(a)) { error.textContent = 'O nome do artista precisa ter letras ou números.'; return; }
      const y = year.value.trim() ? Number(year.value) : null;
      if (y != null && !Number.isInteger(y)) { error.textContent = 'Ano inválido.'; return; }
      const tracks = state.tracks.map((tr) => ({ ...tr, title: tr.title.trim() })).filter((tr) => tr.title);
      if (!retro && countedTracks(tracks).length === 0) { error.textContent = 'O álbum precisa ter pelo menos uma faixa que conta.'; return; }

      let result = null;
      let evaluatedYear = null;
      if (retro) {
        evaluatedYear = evalYear.value.trim() ? Number(evalYear.value) : null;
        if (evaluatedYear != null && !Number.isInteger(evaluatedYear)) { error.textContent = 'Ano de avaliação inválido.'; return; }
        const g = parseFinal(groupScore.value);
        if (g.error || g.value == null) { error.textContent = g.error || 'Digite a nota do grupo.'; return; }
        const memberScores = {};
        for (const { uid, input } of memberInputs) {
          const m = parseFinal(input.value);
          if (m.error) { error.textContent = `${userName(users[uid])}: ${m.error}`; return; }
          if (m.value != null) memberScores[uid] = m.value;
        }
        result = { memberScores, groupScore: g.value, trackAvgs: {} };
      }

      const existing = await db.listAlbums().catch(() => []);
      const dupe = existing.find((x) =>
        (data.musicbrainzReleaseId && x.musicbrainzReleaseId === data.musicbrainzReleaseId) ||
        (normalizeKey(x.title) === normalizeKey(t) && (x.artistId === normalizeKey(a) || normalizeKey(x.artistCredit || '') === normalizeKey(credit.value || a))));
      if (dupe) {
        const go = await confirmDialog({
          title: 'Esse álbum já existe?',
          body: `Já tem "${dupe.title}" de ${dupe.artistCredit || a} cadastrado. Quer salvar mesmo assim?`,
          confirmLabel: 'Salvar mesmo assim',
        });
        if (!go) return;
      }

      await withBusy(saveBtn, async () => {
        const id = await db.createAlbum({
          album: {
            title: t,
            artistCredit: credit.value.trim() || a,
            year: y,
            coverUrl: data.coverUrl || null,
            musicbrainzReleaseId: data.musicbrainzReleaseId || null,
            tracks,
            retro,
            evaluatedYear,
            tags: [...selectedTags],
          },
          artistName: a,
          artistMbid: normalizeKey(a) === normalizeKey(data.artistName || '') ? data.artistMbid || null : null,
          result,
        }, session.uid);
        toast(retro ? 'Registro retroativo salvo' : 'Álbum salvo');
        navigate(`#/album/${id}`);
      });
    }
  }
}
