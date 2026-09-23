import { h, icon, cover, sticker, badge, badgeList, avatars, screenHead, searchBox, emptyState, add, put } from '../ui.js';
import * as db from '../db.js';
import { albumGroupScore } from '../stats.js';
import { normalizeKey } from '../artists.js';
import { listCover } from '../images.js';
import {
  OLD_TAG, NEW_TAG, SYSTEM_TAG_DEFAULTS, matchesPeriod, cardBadges, displaySettings, periodWarning, PERIOD_WARNINGS,
} from '../periods.js';
import { session, actingAdmin, getPref, setPref } from '../state.js';

const VIEWS = [
  { id: 'list', icon: 'viewList', label: 'Lista' },
  { id: 'grid2', icon: 'viewGrid2', label: 'Grade grande' },
  { id: 'grid3', icon: 'viewGrid3', label: 'Grade compacta' },
];

export async function render(root) {
  const [albums, progress, results, users, artists, tags, displayDoc] = await Promise.all([
    db.listAlbums(), db.listAllProgress(), db.listResults(), db.usersById(), db.listArtists(), db.listTags(),
    db.getDisplay().catch(() => ({})),
  ]);
  const members = session.members;
  const artistById = Object.fromEntries(artists.map((a) => [a.id, a]));
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));
  const display = displaySettings(displayDoc);
  const admin = actingAdmin();

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
  let period = getPref('albumPeriod', 'all');
  let view = getPref('albumView', 'list');
  if (!['all', 'new', 'old'].includes(period)) period = 'all';
  if (!VIEWS.some((v) => v.id === view)) view = 'list';
  let term = '';
  const list = h('ul');
  const count = h('span', { class: 'muted small' });

  const tagName = (id) => tagById[id]?.name || SYSTEM_TAG_DEFAULTS[id].name;
  const artistName = (a) => a.artistCredit || artistById[a.artistId]?.name || '';

  function scoreSticker(a, small = false) {
    const p = progress[a.id] || {};
    const score = albumGroupScore(a, results[a.id], members);
    if (score != null) return sticker(score, { small });
    if (a.retro) return sticker(null, { pending: 'sem nota', small });
    const done = members.filter((u) => p[u] === 'final').length;
    return sticker(null, { pending: `${done} de ${members.length || 3}`, small });
  }

  function metaBadges(a) {
    const out = badgeList(cardBadges(a, tagById, display));
    const warn = admin && periodWarning(a);
    if (warn) out.push(badge(PERIOD_WARNINGS[warn], 'warn'));
    return out;
  }

  function statusBadge(a) {
    if (a.retro) return null;
    const mine = (progress[a.id] || {})[session.uid];
    if (mine === 'final') return badge('Você finalizou', 'final');
    if (mine === 'draft') return badge('Rascunho', 'draft');
    return badge('Não começou');
  }

  function listItem(a) {
    const p = progress[a.id] || {};
    const done = members.filter((u) => p[u] === 'final');
    return h('li', { class: 'album-item' },
      h('a', { href: `#/album/${a.id}` },
        cover(listCover(a), ''),
        h('div', { style: 'min-width: 0' },
          h('h3', null, a.title),
          h('div', { class: 'artist' }, artistName(a), a.year ? `, ${a.year}` : ''),
          h('div', { class: 'meta' }, statusBadge(a), metaBadges(a), !a.retro && done.length > 0 && avatars(done.map((u) => users[u]))),
        ),
        scoreSticker(a),
      ),
    );
  }

  function gridItem(a, compact) {
    const art = h('div', { class: 'grid-cover' }, cover(listCover(a), ''));
    const badges = metaBadges(a);
    if (compact) {
      add(art, scoreSticker(a, true));
      if (badges.length) add(art, h('div', { class: 'grid-badges' }, badges));
      return h('li', null, h('a', { href: `#/album/${a.id}`, 'aria-label': `${a.title}, ${artistName(a)}` }, art));
    }
    return h('li', null,
      h('a', { href: `#/album/${a.id}` },
        art,
        h('div', { class: 'grid-info' },
          h('div', { style: 'min-width: 0' },
            h('h3', { class: 'ellipsis' }, a.title),
            h('div', { class: 'artist ellipsis' }, artistName(a))),
          scoreSticker(a, true)),
        badges.length > 0 && h('div', { class: 'meta' }, badges),
      ),
    );
  }

  function draw() {
    const key = normalizeKey(term);
    let shown = albums.filter((a) => matchesPeriod(a, period) && (!key ||
      normalizeKey(`${a.title} ${a.artistCredit || ''} ${artistById[a.artistId]?.name || ''}`).includes(key)));
    const time = (a) => a.createdAt?.getTime?.() ?? Date.now();
    if (sort === 'score') {
      const s = (a) => albumGroupScore(a, results[a.id], members) ?? -1;
      shown = shown.sort((a, b) => s(b) - s(a) || time(b) - time(a));
    } else {
      shown = shown.sort((a, b) => time(b) - time(a));
    }
    count.textContent = `${shown.length} ${shown.length === 1 ? 'álbum' : 'álbuns'}`;
    list.className = view === 'list' ? 'album-list' : `album-grid ${view}`;
    if (albums.length === 0) {
      put(list, emptyState('Nenhum álbum ainda',
        session.isAdmin ? 'Adicione o primeiro álbum para o grupo avaliar.' : 'Quando um álbum for adicionado, ele aparece aqui.',
        session.isAdmin && h('a', { class: 'btn', href: '#/album/new' }, 'Novo álbum')));
    } else if (shown.length === 0) {
      put(list, h('p', { class: 'empty' }, term ? 'Nenhum álbum encontrado.' : 'Nenhum álbum neste período.'));
    } else if (view === 'list') {
      put(list, ...shown.map(listItem));
    } else {
      put(list, ...shown.map((a) => gridItem(a, view === 'grid3')));
    }
  }

  const segmented = (options, current, onpick, label) => {
    const buttons = options.map(([id, text]) => h('button', {
      'aria-pressed': String(current === id),
      onclick: () => {
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === id)));
        onpick(id);
      },
    }, text));
    return h('div', { class: 'segmented', role: 'group', 'aria-label': label }, buttons);
  };

  const periodPicker = segmented(
    [['all', 'Todos'], ['new', tagName(NEW_TAG)], ['old', tagName(OLD_TAG)]],
    period,
    (id) => { period = id; setPref('albumPeriod', id); draw(); },
    'Período',
  );
  periodPicker.classList.add('period-picker');

  const viewBtn = h('button', { class: 'icon-btn', type: 'button' });
  const paintViewBtn = () => {
    const i = VIEWS.findIndex((v) => v.id === view);
    const next = VIEWS[(i + 1) % VIEWS.length];
    put(viewBtn, icon(VIEWS[i].icon));
    viewBtn.setAttribute('aria-label', `Visualização: ${VIEWS[i].label}. Tocar muda para ${next.label}`);
    viewBtn.title = VIEWS[i].label;
  };
  viewBtn.addEventListener('click', () => {
    const i = VIEWS.findIndex((v) => v.id === view);
    view = VIEWS[(i + 1) % VIEWS.length].id;
    setPref('albumView', view);
    paintViewBtn();
    draw();
  });
  paintViewBtn();

  add(root,
    screenHead('Álbuns', {
      actions: session.isAdmin && h('a', { class: 'icon-btn', href: '#/album/new', 'aria-label': 'Novo álbum' }, icon('plus')),
    }),
    periodPicker,
    albums.length > 0 && searchBox('Buscar álbum ou artista', (v) => { term = v; draw(); }),
    albums.length > 0 && h('div', { class: 'list-tools' },
      count,
      h('div', { class: 'row', style: 'gap: 8px' },
        segmented([['recent', 'Recentes'], ['score', 'Maior nota']], sort, (id) => { sort = id; setPref('albumSort', id); draw(); }, 'Ordenar'),
        viewBtn),
    ),
    list,
  );
  draw();
}
