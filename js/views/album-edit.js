import { h, screenHead, emptyState, confirmDialog, withBusy, toast, userName, cover, add, put } from '../ui.js';
import * as db from '../db.js';
import { artistKey, normalizeKey } from '../artists.js';
import { countedTracks, formatScore } from '../scoring.js';
import { actingAdmin, session } from '../state.js';
import { navigate } from '../app.js';
import { trackEditor } from './track-editor.js';
import { parseFinal } from './album-new.js';

export async function render(root, [albumId]) {
  const back = `#/album/${albumId}`;
  if (!actingAdmin()) {
    add(root, screenHead('Editar álbum', { back }), emptyState('Só no modo admin', 'Ative o modo admin em Perfil para editar álbuns.'));
    return;
  }
  const [album, progress, tags, users] = await Promise.all([
    db.getAlbum(albumId), db.getProgress(albumId), db.listTags(), db.usersById(),
  ]);
  if (!album) {
    add(root, screenHead('Editar álbum', { back: '#/albums' }), emptyState('Álbum não encontrado', null));
    return;
  }
  const artist = await db.getArtist(album.artistId);
  const result = album.retro ? await db.getResult(albumId) : null;
  const hasRatings = Object.keys(progress).length > 0;
  const originalTracks = JSON.stringify(album.tracks || []);
  const state = { tracks: (album.tracks || []).map((t) => ({ ...t })) };
  const selectedTags = new Set(album.tags || []);

  const title = h('input', { class: 'input', value: album.title });
  const artistInput = h('input', { class: 'input', value: artist?.name || '' });
  const credit = h('input', { class: 'input', value: album.artistCredit || '' });
  const year = h('input', { class: 'input', inputmode: 'numeric', value: album.year ?? '' });
  const coverUrl = h('input', { class: 'input', type: 'url', value: album.coverUrl || '', placeholder: 'https://…' });
  const error = h('p', { class: 'error-text', role: 'alert' });
  const usedIds = (album.tracks || []).map((t) => t.id);
  const editor = trackEditor(state, { usedIds });

  const tagChips = h('div', { class: 'chips', style: 'flex-wrap: wrap' });
  const drawTags = () => put(tagChips, ...tags.map((t) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(selectedTags.has(t.id)),
    onclick: () => { if (selectedTags.has(t.id)) selectedTags.delete(t.id); else selectedTags.add(t.id); drawTags(); },
  }, t.name)));
  drawTags();

  const evalYear = h('input', { class: 'input', inputmode: 'numeric', value: album.evaluatedYear ?? '' });
  const groupScore = h('input', { class: 'input', inputmode: 'decimal', value: result?.groupScore != null ? formatScore(result.groupScore) : '' });
  const memberInputs = session.members.map((u) => ({
    uid: u,
    input: h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Opcional',
      value: typeof result?.memberScores?.[u] === 'number' ? formatScore(result.memberScores[u]) : '' }),
  }));

  const saveBtn = h('button', { class: 'btn block', type: 'submit' }, 'Salvar alterações');
  const deleteBtn = h('button', { class: 'btn block danger', type: 'button', onclick: remove }, 'Apagar álbum');

  add(root,
    screenHead('Editar álbum', { back }),
    h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { style: 'width: 120px; margin-bottom: 16px' }, cover(album.coverUrl, '')),
      h('label', { class: 'field' }, h('span', null, 'Título'), title),
      h('label', { class: 'field' }, h('span', null, 'Artista principal'), artistInput,
        h('span', { class: 'hint' }, 'Para corrigir a grafia do artista em todos os álbuns, edite na página do artista.')),
      h('label', { class: 'field' }, h('span', null, 'Crédito completo'), credit),
      h('label', { class: 'field' }, h('span', null, 'Ano de lançamento'), year),
      h('label', { class: 'field' }, h('span', null, 'Endereço da capa'), coverUrl),
      tags.length > 0 && h('div', { class: 'field' }, h('span', null, 'Tags'), tagChips),
      album.retro && h('div', { class: 'panel' },
        h('h2', null, 'Registro retroativo'),
        h('label', { class: 'field' }, h('span', null, 'Ano em que foi avaliado'), evalYear),
        h('label', { class: 'field' }, h('span', null, 'Nota do grupo (0 a 10)'), groupScore),
        memberInputs.map(({ uid, input }) => h('label', { class: 'field' }, h('span', null, `Nota final de ${userName(users[uid])}`), input)),
      ),
      h('div', { class: 'section' }, h('h2', null, 'Faixas')),
      hasRatings && h('div', { class: 'notice' }, 'Este álbum já tem avaliações. Mudar a tracklist afeta as notas: faixas removidas saem da média, e uma faixa que passar a contar fica sem nota nos rascunhos. As avaliações finalizadas e o resultado são recalculados.'),
      editor.el,
      error,
      h('div', { class: 'stack', style: 'margin-top: 24px' }, saveBtn, h('a', { class: 'btn block ghost', href: back }, 'Cancelar')),
    ),
    h('div', { class: 'section' }, h('h2', null, 'Zona de perigo')),
    deleteBtn,
  );

  async function save() {
    error.textContent = '';
    const t = title.value.trim();
    const a = artistInput.value.trim();
    if (!t || !a || !normalizeKey(a)) { error.textContent = 'Preencha título e artista.'; return; }
    const y = year.value.trim() ? Number(year.value) : null;
    if (y != null && !Number.isInteger(y)) { error.textContent = 'Ano inválido.'; return; }
    const tracks = state.tracks.map((tr) => ({ ...tr, title: tr.title.trim() })).filter((tr) => tr.title);
    if (!album.retro && countedTracks(tracks).length === 0) { error.textContent = 'O álbum precisa ter pelo menos uma faixa que conta.'; return; }
    const tracksChanged = JSON.stringify(tracks) !== originalTracks;

    const patch = {
      title: t,
      artistCredit: credit.value.trim() || a,
      year: y,
      coverUrl: coverUrl.value.trim() || null,
      tags: [...selectedTags],
    };
    let retroPatch = null;
    if (album.retro) {
      const ey = evalYear.value.trim() ? Number(evalYear.value) : null;
      if (ey != null && !Number.isInteger(ey)) { error.textContent = 'Ano de avaliação inválido.'; return; }
      patch.evaluatedYear = ey;
      const g = parseFinal(groupScore.value);
      if (g.error || g.value == null) { error.textContent = g.error || 'Digite a nota do grupo.'; return; }
      const memberScores = {};
      for (const { uid, input } of memberInputs) {
        const m = parseFinal(input.value);
        if (m.error) { error.textContent = `${userName(users[uid])}: ${m.error}`; return; }
        if (m.value != null) memberScores[uid] = m.value;
      }
      retroPatch = { groupScore: g.value, memberScores };
    }

    if (tracksChanged && hasRatings) {
      const ok = await confirmDialog({
        title: 'Alterar a tracklist?',
        body: 'Já existem avaliações neste álbum. As notas finalizadas e o resultado serão recalculados.',
        confirmLabel: 'Alterar e recalcular',
        danger: true,
      });
      if (!ok) return;
    }

    await withBusy(saveBtn, async () => {
      await db.updateAlbum(album.id, patch);
      if (artistKey(a) !== album.artistId) await db.changeAlbumArtist(album.id, a);
      if (tracksChanged) {
        if (album.retro) await db.updateAlbum(album.id, { tracks });
        else await db.updateTracks({ ...album, ...patch }, tracks);
      }
      if (retroPatch) await db.updateRetroResult(album.id, retroPatch);
      toast('Alterações salvas');
      navigate(back);
    });
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Apagar "${album.title}"?`,
      body: hasRatings
        ? 'O álbum e todas as avaliações dele, inclusive as dos outros membros, serão apagados. Não dá para desfazer.'
        : 'O álbum será apagado. Não dá para desfazer.',
      confirmLabel: 'Apagar álbum',
      danger: true,
    });
    if (!ok) return;
    await withBusy(deleteBtn, async () => {
      await db.deleteAlbum(album.id);
      toast('Álbum apagado');
      navigate('#/albums');
    });
  }
}
