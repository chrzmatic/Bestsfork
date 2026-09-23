import { h, screenHead, cover, sticker, badge, emptyState, promptDialog, withBusy, toast, icon, confirmDialog, add } from '../ui.js';
import * as db from '../db.js';
import { albumGroupScore } from '../stats.js';
import { formatScore } from '../scoring.js';
import { session, actingAdmin } from '../state.js';
import { navigate } from '../app.js';

export async function render(root, [artistId]) {
  const [artist, albums, results, progress] = await Promise.all([
    db.getArtist(artistId), db.listAlbums(), db.listResults(), db.listAllProgress(),
  ]);
  if (!artist) {
    add(root, screenHead('Artista', { back: '#/artists' }), emptyState('Artista não encontrado', null));
    return;
  }
  const members = session.members;
  const mine = albums.filter((a) => a.artistId === artistId)
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, 'pt-BR'));
  const scores = mine.map((a) => albumGroupScore(a, results[a.id], members)).filter((s) => s != null);
  const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;

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

  add(root,
    screenHead(artist.name, { back: '#/artists', actions }),
    h('p', { class: 'muted', style: 'margin-top: -8px; margin-bottom: 16px' },
      `${mine.length} ${mine.length === 1 ? 'álbum' : 'álbuns'}`,
      avg != null ? `, média do grupo ${formatScore(avg)}` : ''),
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
            cover(a.coverUrl, ''),
            h('div', { style: 'min-width: 0' },
              h('h3', null, a.title),
              h('div', { class: 'artist' }, a.year || 'Ano desconhecido'),
              h('div', { class: 'meta' },
                a.retro ? badge('Retroativo', 'retro') : score == null ? badge(`aguardando ${members.length - done} de ${members.length}`) : null)),
            score != null ? sticker(score) : sticker(null, { pending: a.retro ? 'sem nota' : `${done} de ${members.length}` })));
      })),
  );
}
