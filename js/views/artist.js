import {
  h, screenHead, cover, sticker, badge, badgeList, emptyState, promptDialog, withBusy, toast, icon, confirmDialog,
  artistAvatar, add, put,
} from '../ui.js';
import * as db from '../db.js';
import { albumGroupScore, withoutExpired } from '../stats.js';
import { formatScore } from '../scoring.js';
import { listCover, artistImage } from '../images.js';
import { cardBadges, displaySettings } from '../periods.js';
import { imageToVariants } from '../photo.js';
import { session, actingAdmin } from '../state.js';
import { navigate } from '../app.js';

export async function render(root, [artistId]) {
  const [artist, allAlbums, results, progress, tags, genres, displayDoc] = await Promise.all([
    db.getArtist(artistId), db.listAlbums(), db.listResults(), db.listAllProgress(), db.listTags(),
    db.listGenres().catch(() => []), db.getDisplay().catch(() => ({})),
  ]);
  if (!artist) {
    add(root, screenHead('Artista', { back: '#/artists' }), emptyState('Artista não encontrado', null));
    return;
  }
  const albums = withoutExpired(allAlbums, results, progress, session.members);
  const media = artist.customPhoto ? await db.getMedia(`artist-${artistId}`).catch(() => null) : null;
  const members = session.members;
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));
  const genreById = Object.fromEntries(genres.map((g) => [g.id, g]));
  const display = displaySettings(displayDoc);
  const mine = albums.filter((a) => a.artistId === artistId)
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, 'pt-BR'));
  const scores = mine.map((a) => albumGroupScore(a, results[a.id], members)).filter((s) => s != null);
  const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
  const artistGenres = [...new Set(mine.map((a) => genreById[a.genreId]?.name).filter(Boolean))];

  const admin = actingAdmin();
  const actions = admin && h('button', {
    class: 'icon-btn', 'aria-label': 'Editar nome do artista',
    onclick: async (e) => {
      const name = await promptDialog({ title: 'Nome do artista', label: 'Como exibir', value: artist.name });
      if (name == null || !name.trim() || name.trim() === artist.name) return;
      await withBusy(e.currentTarget, async () => {
        await db.renameArtist(artistId, name);
        toast('Nome atualizado');
        navigate(`#/artist/${artistId}`);
      });
    },
  }, icon('edit'));

  const photoBox = h('div');
  const paintPhoto = () => put(photoBox, artistAvatar(
    artistImage(artist, { size: 'page', media, albums, results, memberUids: members }), artist.name));
  paintPhoto();

  add(root,
    screenHead(artist.name, { back: '#/artists', actions }),
    h('div', { class: 'artist-head' },
      photoBox,
      h('div', null,
        h('p', { class: 'muted' },
          `${mine.length} ${mine.length === 1 ? 'álbum' : 'álbuns'}`,
          avg != null ? `, média do grupo ${formatScore(avg)}` : ''),
        artistGenres.length > 0 && h('div', { class: 'genres' }, artistGenres.map((g) => badge(g))),
      )),
    admin && photoAdmin(),
    mine.length === 0
      ? emptyState('Nenhum álbum', 'Este artista não tem álbuns cadastrados.', admin && h('button', {
        class: 'btn danger', onclick: async (e) => {
          if (!(await confirmDialog({ title: 'Apagar artista?', body: 'Ele não tem álbuns.', confirmLabel: 'Apagar', danger: true }))) return;
          await withBusy(e.currentTarget, async () => { await db.deleteArtist(artistId); navigate('#/artists'); });
        } }, 'Apagar artista'))
      : h('ul', { class: 'album-list' }, mine.map((a) => {
        const score = albumGroupScore(a, results[a.id], members);
        const done = members.filter((u) => progress[a.id]?.[u] === 'final').length;
        return h('li', { class: 'album-item' },
          h('a', { href: `#/album/${a.id}` },
            cover(listCover(a), ''),
            h('div', { style: 'min-width: 0' },
              h('h3', null, a.title),
              h('div', { class: 'artist' }, a.year || 'Ano desconhecido', genreById[a.genreId] ? `, ${genreById[a.genreId].name}` : ''),
              h('div', { class: 'meta' },
                badgeList(cardBadges(a, tagById, display)),
                !a.retro && score == null && badge(`aguardando ${members.length - done} de ${members.length}`))),
            score != null ? sticker(score) : sticker(null, { pending: a.retro ? 'sem nota' : `${done} de ${members.length}` })));
      })),
  );

  // Foto do artista: galeria, voltar para a automática ou buscar de novo.
  function photoAdmin() {
    const file = h('input', { type: 'file', accept: 'image/*', style: 'display: none' });
    const pick = h('button', { class: 'btn small secondary', type: 'button', onclick: () => file.click() }, 'Trocar foto');
    const reset = h('button', { class: 'btn small ghost', type: 'button', hidden: !artist.customPhoto }, 'Voltar para a automática');
    const search = h('button', { class: 'btn small ghost', type: 'button', hidden: !!artist.customPhoto }, 'Buscar foto de novo');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      await withBusy(pick, async () => {
        const images = await imageToVariants(f);
        await db.setArtistCustomPhoto(artistId, images);
        artist.customPhoto = images.thumb;
        put(photoBox, artistAvatar(images.full, artist.name));
        reset.hidden = false;
        search.hidden = true;
        toast('Foto trocada');
      });
    });
    reset.addEventListener('click', () => withBusy(reset, async () => {
      await db.clearArtistCustomPhoto(artistId);
      artist.customPhoto = null;
      paintPhoto();
      reset.hidden = true;
      search.hidden = false;
      toast('Foto automática de volta');
    }));
    search.addEventListener('click', () => withBusy(search, async () => {
      const updated = await db.ensureArtistPhoto(artistId, { force: true });
      Object.assign(artist, updated);
      paintPhoto();
      toast(updated?.photoUrl ? 'Foto encontrada' : 'Nenhuma foto encontrada. Você pode escolher uma da galeria.');
    }));
    return h('div', { class: 'btn-row', style: 'margin-bottom: 16px' }, pick, reset, search, file);
  }
}
