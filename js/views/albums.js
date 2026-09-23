import { h, icon, cover, sticker, badge, avatars, screenHead, searchBox, emptyState, add, put } from '../ui.js';
import * as db from '../db.js';
import { albumGroupScore } from '../stats.js';
import { normalizeKey } from '../artists.js';
import { session, getPref, setPref } from '../state.js';

export async function render(root) {
  const [albums, progress, results, users, artists, tags] = await Promise.all([
    db.listAlbums(), db.listAllProgress(), db.listResults(), db.usersById(), db.listArtists(), db.listTags(),
  ]);
  const members = session.members;
  const artistById = Object.fromEntries(artists.map((a) => [a.id, a]));
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));

  // Autocorreção: todos finalizaram, mas o resultado não foi gravado.
  for (const a of albums) {
    if (a.retro || results[a.id]) continue;
    const p = progress[a.id] || {};
    if (members.length && members.every((u) => p[u] === 'final')) {
      db.ensureResult(a, p).then((r) => {
        if (r) { results[a.id] = r; draw(); }
      }).catch(() => {});
    }
  }

  let sort = getPref('albumSort', 'recent');
  let term = '';
  const list = h('ul', { class: 'album-list' });

  function item(a) {
    const p = progress[a.id] || {};
    const result = results[a.id];
    const score = albumGroupScore(a, result, members);
    const mine = p[session.uid];
    const done = members.filter((u) => p[u] === 'final');
    const meta = [];
    if (a.retro) {
      meta.push(badge('Retroativo', 'retro'));
      for (const t of a.tags || []) if (tagById[t]) meta.push(badge(tagById[t].name));
    } else if (mine === 'final') meta.push(badge('Você finalizou', 'final'));
    else if (mine === 'draft') meta.push(badge('Rascunho', 'draft'));
    else meta.push(badge('Não começou'));
    if (!a.retro && done.length) meta.push(avatars(done.map((u) => users[u])));

    let right;
    if (score != null) right = sticker(score);
    else if (a.retro) right = sticker(null, { pending: 'sem nota' });
    else right = sticker(null, { pending: `${done.length} de ${members.length || 3}` });

    const artistName = a.artistCredit || artistById[a.artistId]?.name || '';
    return h('li', { class: 'album-item' },
      h('a', { href: `#/album/${a.id}` },
        cover(a.coverUrl, ''),
        h('div', { style: 'min-width: 0' },
          h('h3', null, a.title),
          h('div', { class: 'artist' }, artistName, a.year ? `, ${a.year}` : ''),
          h('div', { class: 'meta' }, meta),
        ),
        right,
      ),
    );
  }

  function draw() {
    const key = normalizeKey(term);
    let shown = albums.filter((a) => !key ||
      normalizeKey(`${a.title} ${a.artistCredit || ''} ${artistById[a.artistId]?.name || ''}`).includes(key));
    const time = (a) => a.createdAt?.getTime?.() ?? Date.now();
    if (sort === 'score') {
      const s = (a) => albumGroupScore(a, results[a.id], members) ?? -1;
      shown = shown.sort((a, b) => s(b) - s(a) || time(b) - time(a));
    } else {
      shown = shown.sort((a, b) => time(b) - time(a));
    }
    if (albums.length === 0) {
      put(list, emptyState('Nenhum álbum ainda',
        session.isAdmin ? 'Adicione o primeiro álbum para o grupo avaliar.' : 'Quando um álbum for adicionado, ele aparece aqui.',
        session.isAdmin && h('a', { class: 'btn', href: '#/album/new' }, 'Novo álbum')));
    } else if (shown.length === 0) {
      put(list, h('p', { class: 'empty' }, 'Nenhum álbum encontrado.'));
    } else {
      put(list, ...shown.map(item));
    }
  }

  const sortBtns = [['recent', 'Recentes'], ['score', 'Maior nota']].map(([id, label]) =>
    h('button', {
      'aria-pressed': String(sort === id),
      onclick: (e) => {
        sort = id;
        setPref('albumSort', id);
        sortBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        draw();
      },
    }, label));

  add(root,
    screenHead('Álbuns', {
      actions: session.isAdmin && h('a', { class: 'icon-btn', href: '#/album/new', 'aria-label': 'Novo álbum' }, icon('plus')),
    }),
    albums.length > 0 && searchBox('Buscar álbum ou artista', (v) => { term = v; draw(); }),
    albums.length > 0 && h('div', { class: 'list-tools' },
      h('span', { class: 'muted small' }, `${albums.length} ${albums.length === 1 ? 'álbum' : 'álbuns'}`),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ordenar' }, sortBtns),
    ),
    list,
  );
  draw();
}
