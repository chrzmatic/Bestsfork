import { h, screenHead, searchBox, emptyState, add, put } from '../ui.js';
import * as db from '../db.js';
import { albumGroupScore } from '../stats.js';
import { normalizeKey } from '../artists.js';
import { formatScore } from '../scoring.js';
import { session } from '../state.js';

export async function render(root) {
  const [artists, albums, results] = await Promise.all([db.listArtists(), db.listAlbums(), db.listResults()]);
  const stats = {};
  for (const a of albums) {
    const s = (stats[a.artistId] ??= { count: 0, scores: [] });
    s.count++;
    const score = albumGroupScore(a, results[a.id], session.members);
    if (score != null) s.scores.push(score);
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
      const s = stats[a.id] || { count: 0, scores: [] };
      const avg = s.scores.length ? s.scores.reduce((x, y) => x + y, 0) / s.scores.length : null;
      return h('li', { class: 'no-cover', style: 'grid-template-columns: 1fr auto' },
        h('a', { href: `#/artist/${a.id}`, style: 'color: inherit; text-decoration: none; display: block; min-width: 0' },
          h('div', { class: 'ellipsis', style: 'font-weight: 650' }, a.name),
          h('div', { class: 'muted small' }, `${s.count} ${s.count === 1 ? 'álbum' : 'álbuns'}`)),
        avg != null ? h('strong', { title: 'Média do grupo nos álbuns concluídos' }, formatScore(avg)) : h('span', { class: 'muted small' }, 'sem nota'));
    }));
  }

  add(root, screenHead('Artistas'),
    artists.length > 0 ? searchBox('Buscar artista', (v) => { term = v; draw(); }) : null,
    artists.length === 0 ? emptyState('Nenhum artista ainda', 'Os artistas aparecem aqui quando os álbuns forem adicionados.') : list);
  draw();
}
