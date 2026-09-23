import { h, screenHead, cover, avatar, userName, sheet, switchField, withBusy, deliverFile, emptyState } from '../ui.js';
import * as db from '../db.js';
import { computeStats, albumEvalYear, DEFAULT_FILTERS } from '../stats.js';
import { albumsCsv, tracksCsv, fullJson, fileName, exportAlbums } from '../export.js';
import { formatScore } from '../scoring.js';
import { session, getPref, setPref } from '../state.js';

export async function render(root) {
  const [albums, artists, results, users, tags] = await Promise.all([
    db.listAlbums(), db.listArtists(), db.listResults(), db.listUsers(), db.listTags(),
  ]);
  const data = { albums, artists, results, users, tags, memberUids: session.members };
  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  const filters = { ...DEFAULT_FILTERS, ...getPref('statsFilters', {}) };
  filters.tagIds = (filters.tagIds || []).filter((id) => tags.some((t) => t.id === id));

  const years = [...new Set(albums.map((a) => albumEvalYear(a, results[a.id])).filter((y) => y != null))].sort((a, b) => b - a);
  if (filters.year != null && !years.includes(filters.year)) filters.year = null;

  const content = h('div');
  const filterBox = h('div', { class: 'panel' });

  root.append(
    screenHead('Estatísticas', {
      actions: h('button', { class: 'btn small secondary', onclick: () => openExport(data) }, 'Exportar'),
    }),
    filterBox,
    content,
  );
  drawFilters();
  draw();

  function update() {
    setPref('statsFilters', filters);
    drawFilters();
    draw();
  }

  function drawFilters() {
    const modes = [['all', 'Todas'], ['only', 'Só'], ['except', 'Exceto']];
    filterBox.replaceChildren(
      tags.length > 0 && h('div', { class: 'field', style: 'margin-bottom: 10px' },
        h('span', null, 'Tags'),
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filtro de tags', style: 'justify-self: start' },
          modes.map(([id, label]) => h('button', {
            'aria-pressed': String(filters.tagMode === id),
            onclick: () => { filters.tagMode = id; update(); },
          }, label))),
        filters.tagMode !== 'all' && h('div', { class: 'chips', style: 'flex-wrap: wrap; margin-top: 6px' },
          tags.map((t) => h('button', {
            class: `chip${filters.tagMode === 'except' ? ' except' : ''}`,
            'aria-pressed': String(filters.tagIds.includes(t.id)),
            onclick: () => {
              filters.tagIds = filters.tagIds.includes(t.id) ? filters.tagIds.filter((x) => x !== t.id) : [...filters.tagIds, t.id];
              update();
            },
          }, t.name))),
      ),
      years.length > 0 && h('label', { class: 'field', style: 'margin-bottom: 4px' },
        h('span', null, 'Ano de avaliação'),
        h('select', { class: 'input', onchange: (e) => { filters.year = e.target.value ? Number(e.target.value) : null; update(); } },
          h('option', { value: '' }, 'Todos os anos'),
          years.map((y) => h('option', { value: String(y), selected: filters.year === y }, String(y))))),
      switchField('Incluir retroativos', filters.includeRetro, (v) => { filters.includeRetro = v; update(); }),
    );
  }

  function albumRow(album, right, sub, main = album.title) {
    return h('li', null,
      cover(album.coverUrl, ''),
      h('a', { href: `#/album/${album.id}`, style: 'color: inherit; text-decoration: none; min-width: 0' },
        h('div', { class: 'ellipsis', style: 'font-weight: 650' }, main),
        h('div', { class: 'muted small ellipsis' }, sub ?? album.artistCredit)),
      h('strong', null, right));
  }

  function section(title, node, note) {
    return [h('div', { class: 'section' }, h('h2', null, title), note && h('p', { class: 'hint' }, note)), node];
  }

  function draw() {
    const s = computeStats(data, filters);
    const out = [];
    out.push(h('div', { class: 'totals' },
      h('div', null, h('strong', null, s.totals.completed), h('small', null, 'concluídos')),
      h('div', null, h('strong', null, s.totals.inProgress), h('small', null, 'em andamento')),
      h('div', null, h('strong', null, s.totals.retro), h('small', null, 'retroativos'))));

    if (s.bestAlbums.length === 0) {
      out.push(emptyState('Sem dados ainda', 'As estatísticas aparecem quando algum álbum for concluído pelos três.'));
      content.replaceChildren(...out);
      return;
    }

    out.push(...section('Melhores álbuns', h('ol', { class: 'rank' }, s.bestAlbums.map((x) => albumRow(x.album, formatScore(x.score), x.artistName)))));
    out.push(...section('Piores álbuns', h('ol', { class: 'rank' }, s.worstAlbums.map((x) => albumRow(x.album, formatScore(x.score), x.artistName)))));

    if (s.topTracks.length) {
      out.push(...section('Faixas mais queridas', h('ol', { class: 'rank' }, s.topTracks.map((x) =>
        albumRow(x.album, formatScore(x.avg), `${x.album.title}, ${x.album.artistCredit || ''}`, x.track.title))),
      'Média do grupo de 0 a 5. Retroativos não entram.'));
    }

    if (s.topArtists.length) {
      out.push(...section('Artistas com melhor média', h('ol', { class: 'rank' }, s.topArtists.map((x) => h('li', { class: 'no-cover' },
        h('a', { href: `#/artist/${x.artist.id}`, style: 'color: inherit; text-decoration: none; min-width: 0' },
          h('div', { class: 'ellipsis', style: 'font-weight: 650' }, x.artist.name),
          h('div', { class: 'muted small' }, `${x.count} álbuns`)),
        h('strong', null, formatScore(x.avg))))), 'Mínimo de 2 álbuns concluídos.'));
    }

    const members = s.members.filter((m) => m.avg != null);
    if (members.length) {
      out.push(...section('Por membro', h('div', { class: 'stack' }, members.map((m) => h('div', { class: 'panel', style: 'margin: 0' },
        h('div', { class: 'row' },
          avatar(usersById[m.uid], 'md'),
          h('div', { class: 'grow' },
            h('h3', null, userName(usersById[m.uid])),
            h('div', { class: 'muted small' }, `${m.count} ${m.count === 1 ? 'álbum' : 'álbuns'}${s.strictest === m.uid && members.length > 1 ? ', o mais exigente' : ''}`)),
          h('div', { class: 'center' }, h('strong', { style: 'font-size: 24px' }, formatScore(m.avg)), h('div', { class: 'small muted' }, 'média'))),
        m.favorite && h('p', { class: 'small', style: 'margin-top: 10px' }, 'Favorito: ',
          h('a', { href: `#/album/${m.favorite.album.id}` }, m.favorite.album.title), ` (${formatScore(m.favorite.score)})`),
      )))));
    }

    if (s.divergences.length) {
      out.push(...section('Maiores divergências', h('ol', { class: 'rank' }, s.divergences.map((x) => h('li', null,
        cover(x.album.coverUrl, ''),
        h('a', { href: `#/album/${x.album.id}`, style: 'color: inherit; text-decoration: none; min-width: 0' },
          h('div', { class: 'ellipsis', style: 'font-weight: 650' }, x.album.title),
          h('div', { class: 'muted small' }, session.members.map((u) => `${userName(usersById[u])} ${formatScore(x.scores[u])}`).join(', '))),
        h('strong', { title: 'Diferença entre a maior e a menor nota' }, formatScore(x.spread))))), 'Diferença entre a maior e a menor nota pessoal.'));
    }
    content.replaceChildren(...out);
  }
}

async function openExport(data) {
  let includeRetro = true;
  await sheet((close) => {
    const count = h('p', { class: 'body' });
    const paint = () => {
      const n = exportAlbums(data, { includeRetro }).length;
      count.textContent = `${n} ${n === 1 ? 'álbum concluído entra' : 'álbuns concluídos entram'} no arquivo.`;
    };
    paint();
    // Busca as notas já ao abrir, para o compartilhamento no iPhone acontecer logo após o toque.
    const ratings = db.ratingsForExport(exportAlbums(data, { includeRetro: true }), data.memberUids);
    ratings.catch(() => {});
    const withRatings = async () => ({ ...data, ratings: await ratings });
    const btn = (label, run) => {
      const b = h('button', { class: 'btn block secondary', onclick: () => withBusy(b, async () => { await run(); close(); }) }, label);
      return b;
    };
    return h('div', null,
      h('h2', null, 'Exportar'),
      count,
      switchField('Incluir retroativos', includeRetro, (v) => { includeRetro = v; paint(); }),
      h('div', { class: 'actions', style: 'margin-top: 12px' },
        btn('CSV de álbuns', () => deliverFile(fileName('albuns'), albumsCsv(data, { includeRetro }), 'text/csv;charset=utf-8')),
        btn('CSV de faixas', async () => deliverFile(fileName('faixas'), tracksCsv(await withRatings(), { includeRetro }), 'text/csv;charset=utf-8')),
        btn('JSON completo', async () => deliverFile(fileName('completo'), fullJson(await withRatings(), { includeRetro }), 'application/json')),
        h('button', { class: 'btn block ghost', onclick: () => close() }, 'Fechar'),
      ),
    );
  });
}
