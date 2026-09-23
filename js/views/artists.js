import { h, screenHead, searchBox, emptyState, artistAvatar, add, put } from '../ui.js';
import { artistImage } from '../images.js';
import * as db from '../db.js';
import { normalizeKey } from '../artists.js';
import { session } from '../state.js';

export async function render(root) {
  const [artists, albums, results] = await Promise.all([db.listArtists(), db.listAlbums(), db.listResults()]);
  const stats = {};
  for (const a of albums) {
    const s = (stats[a.artistId] ??= { count: 0 });
    s.count++;
  }

  const list = h('ul', { class: 'rank', style: 'counter-reset: none' });
  let term = '';

  function draw() {
    const key = normalizeKey(term);
    const shown = artists.filter((a) => !key || normalizeKey(a.name).includes(key));
    if (shown.length === 0) {
      put(list, h('p', { class: 'empty' }, artists.length ? 'Nenhum artista encontrado.' : 'Os artistas aparecem aqui quando os álbuns forem adicionados.'));
      return;
    }
    put(list, ...shown.map((a) => {
      const s = stats[a.id] || { count: 0 };
      const img = artistImage(a, { albums, results, memberUids: session.members });
      return h('li', { class: 'no-cover artist-row' },
        artistAvatar(img, a.name),
        h('a', { href: `#/artist/${a.id}`, style: 'color: inherit; text-decoration: none; display: block; min-width: 0' },
          h('div', { class: 'ellipsis', style: 'font-weight: 650' }, a.name),
          h('div', { class: 'muted small' }, `${s.count} ${s.count === 1 ? 'álbum' : 'álbuns'}`)));
    }));
  }

  add(root, screenHead('Artistas'),
    artists.length > 0 ? searchBox('Buscar artista', (v) => { term = v; draw(); }) : null,
    artists.length === 0 ? emptyState('Nenhum artista ainda', 'Os artistas aparecem aqui quando os álbuns forem adicionados.') : list);
  draw();
}
