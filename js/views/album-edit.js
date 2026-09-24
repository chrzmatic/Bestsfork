import { h, screenHead, emptyState, confirmDialog, withBusy, toast, userName, cover, add, put } from '../ui.js';
import * as db from '../db.js';
import { artistKey, normalizeKey } from '../artists.js';
import { countedTracks, formatScore } from '../scoring.js';
import { actingAdmin, session } from '../state.js';
import { navigate } from '../app.js';
import { trackEditor } from './track-editor.js';
import { parseFinal } from './album-new.js';
import { evalDateValue } from '../stats.js';
import { imageToVariants } from '../photo.js';
import { pageCover } from '../images.js';

export async function render(root, [albumId]) {
  const back = `#/album/${albumId}`;
  if (!actingAdmin()) {
    add(root, screenHead('Editar álbum', { back }), emptyState('Só no modo admin', 'Ative o modo admin em Perfil para editar álbuns.'));
    return;
  }
  const [album, progress, tags, users, genres] = await Promise.all([
    db.getAlbum(albumId), db.getProgress(albumId), db.listTags(), db.usersById(), db.listGenres().catch(() => []),
  ]);
  if (!album) {
    add(root, screenHead('Editar álbum', { back: '#/albums' }), emptyState('Álbum não encontrado', null));
    return;
  }
  const artist = await db.getArtist(album.artistId);
  const media = album.customCover ? await db.getMedia(`album-${albumId}`).catch(() => null) : null;
  const currentGenre = genres.find((g) => g.id === album.genreId)?.name || '';
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
  const genre = h('input', { class: 'input', list: 'genre-options', value: currentGenre, placeholder: 'Sem gênero', autocomplete: 'off' });
  const genreList = h('datalist', { id: 'genre-options' }, genres.map((g) => h('option', { value: g.name })));

  // Capa: a escolhida pelo admin tem prioridade; dá para voltar para a automática.
  const coverBox = h('div', { style: 'width: 140px' });
  const coverFile = h('input', { type: 'file', accept: 'image/*', style: 'display: none' });
  const coverPick = h('button', { class: 'btn small secondary', type: 'button', onclick: () => coverFile.click() }, 'Escolher da galeria');
  const coverReset = h('button', { class: 'btn small ghost', type: 'button', hidden: !album.customCover }, 'Voltar para a automática');
  const paintCover = (url) => put(coverBox, cover(url, ''));
  paintCover(pageCover(album, media));
  coverFile.addEventListener('change', async () => {
    const file = coverFile.files?.[0];
    coverFile.value = '';
    if (!file) return;
    await withBusy(coverPick, async () => {
      const images = await imageToVariants(file);
      await db.setAlbumCustomCover(album.id, images);
      album.customCover = images.thumb;
      paintCover(images.full);
      coverReset.hidden = false;
      toast('Capa trocada');
    });
  });
  coverReset.addEventListener('click', () => withBusy(coverReset, async () => {
    await db.clearAlbumCustomCover(album.id);
    album.customCover = null;
    paintCover(album.coverUrl);
    coverReset.hidden = true;
    toast('Capa automática de volta');
  }));
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
  const [savedDate = '', savedTime = ''] = (album.evaluatedAt || '').split('T');
  const evalDate = h('input', { class: 'input', type: 'date', value: savedDate });
  const evalTime = h('input', { class: 'input', type: 'time', value: savedTime });
  evalDate.addEventListener('change', () => { if (evalDate.value) evalYear.value = evalDate.value.slice(0, 4); });
  const groupScore = h('input', { class: 'input', inputmode: 'decimal', value: result?.groupScore != null ? formatScore(result.groupScore, 2) : '' });
  const memberInputs = session.members.map((u) => ({
    uid: u,
    input: h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Opcional',
      value: typeof result?.memberScores?.[u] === 'number' ? formatScore(result.memberScores[u], 2) : '' }),
  }));

  const saveBtn = h('button', { class: 'btn block', type: 'submit' }, 'Salvar alterações');
  const deleteBtn = h('button', { class: 'btn block danger', type: 'button', onclick: remove }, 'Apagar álbum');

  add(root,
    screenHead('Editar álbum', { back }),
    h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { class: 'field' }, h('span', null, 'Capa'),
        h('div', { class: 'row', style: 'align-items: flex-end; flex-wrap: wrap' }, coverBox,
          h('div', { class: 'stack' }, coverPick, coverReset)), coverFile),
      h('label', { class: 'field' }, h('span', null, 'Título'), title),
      h('label', { class: 'field' }, h('span', null, 'Artista principal'), artistInput,
        h('span', { class: 'hint' }, 'Para corrigir a grafia do artista em todos os álbuns, edite na página do artista.')),
      h('label', { class: 'field' }, h('span', null, 'Crédito completo'), credit),
      h('label', { class: 'field' }, h('span', null, 'Ano de lançamento'), year),
      h('label', { class: 'field' }, h('span', null, 'Endereço da capa automática'), coverUrl),
      h('label', { class: 'field' }, h('span', null, 'Gênero'), genre, genreList),
      tags.length > 0 && h('div', { class: 'field' }, h('span', null, 'Tags'), tagChips),
      album.retro && h('div', { class: 'panel' },
        h('h2', null, 'Registro retroativo'),
        h('label', { class: 'field' }, h('span', null, 'Ano em que foi avaliado (opcional)'), evalYear),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', null, 'Data (opcional)'), evalDate),
          h('label', { class: 'field grow' }, h('span', null, 'Hora (opcional)'), evalTime)),
        h('label', { class: 'field' }, h('span', null, 'Nota do grupo (0 a 10)'), groupScore),
        memberInputs.map(({ uid, input }) => h('label', { class: 'field' }, h('span', null, `Nota final de ${userName(users[uid])}`), input)),
      ),
      h('div', { class: 'section' }, h('h2', null, 'Faixas'), h('p', { class: 'hint' }, 'Marque as faixas que não contam na avaliação, como intros e interlúdios.')),
      hasRatings && h('div', { class: 'notice' }, 'Este álbum já tem avaliações. Mudar a tracklist afeta as notas: faixas removidas saem da média, e uma faixa que passar a contar fica sem nota nos rascunhos. As avaliações finalizadas e o resultado são recalculados.'),
      editor.el,
      error,
      h('div', { class: 'stack', style: 'margin-top: 24px' }, saveBtn, h('a', { class: 'btn block ghost', href: back }, 'Cancelar')),
    ),
    h('div', { style: 'margin-top: 40px' }, deleteBtn),
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
      const when = evalDateValue(evalDate.value, evalTime.value);
      if (when.error) { error.textContent = when.error; return; }
      patch.evaluatedYear = when.value ? when.year : ey;
      patch.evaluatedAt = when.value;
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
      if (genre.value.trim() !== currentGenre) await db.setAlbumGenre(album.id, genre.value.trim() || null);
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
