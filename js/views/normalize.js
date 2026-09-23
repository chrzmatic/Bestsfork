import { h, screenHead, emptyState, withBusy, toast, confirmDialog, add, put } from '../ui.js';
import * as db from '../db.js';
import { countedTracks, missingTracks, maxFor, formatTenths } from '../scoring.js';
import { shuffle, rankState, adjustTiers, diffScores } from '../normalize.js';
import { session } from '../state.js';
import { navigate } from '../app.js';

export async function render(root, [albumId]) {
  const back = `#/album/${albumId}`;
  const [album, rating] = await Promise.all([db.getAlbum(albumId), db.getRating(albumId, session.uid)]);
  if (!album || !rating || rating.status !== 'draft') {
    add(root, screenHead('Normalizar notas', { back }),
      emptyState('Nada para normalizar', 'A normalização só fica disponível num rascunho seu.'));
    return;
  }
  if (missingTracks(rating, album.tracks).length > 0) {
    add(root, screenHead('Normalizar notas', { back }),
      emptyState('Faltam notas', 'Dê nota a todas as faixas que contam antes de normalizar.',
        h('a', { class: 'btn secondary', href: back }, 'Voltar para o álbum')));
    return;
  }

  const tracks = countedTracks(album.tracks);
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const order = shuffle(tracks.map((t) => t.id));
  const history = [];
  const body = h('div');

  add(root, screenHead('Normalizar notas', { back }), body);
  step();

  function step() {
    const state = rankState(order, history);
    if (state.done) return finish(state.tiers);

    const q = state.question;
    const choose = (answer) => { history.push(answer); step(); };
    const trackBtn = (id, answer) => h('button', { class: 'duel-btn', onclick: () => choose(answer) },
      h('small', null, `Faixa ${byId[id].position}`), byId[id].title);

    put(body,
      h('p', { class: 'muted' }, 'Compare as faixas sem pensar nas notas. No fim o app sugere ajustes para as notas combinarem com suas preferências.'),
      h('div', { class: 'progress', style: 'margin-top: 16px', role: 'progressbar', 'aria-valuenow': Math.round(state.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('div', { style: `width: ${Math.round(state.progress * 100)}%` })),
      h('h2', { style: 'margin-top: 24px' }, 'Qual você prefere?'),
      h('div', { class: 'duel' },
        trackBtn(q.newId, 'new'),
        h('button', { class: 'btn secondary tie', onclick: () => choose('tie') }, 'Empate'),
        trackBtn(q.compareId, 'tier'),
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', disabled: history.length === 0, onclick: () => { history.pop(); step(); } }, 'Voltar'),
        h('a', { class: 'btn ghost', href: back }, 'Cancelar'),
      ),
    );
  }

  function finish(tiers) {
    const max = maxFor(rating.scale);
    const current = Object.fromEntries(tracks.map((t) => [t.id, rating.trackScores[t.id]]));
    const { scores, error } = adjustTiers(tiers, current, max);
    if (error) {
      put(body, h('div', { class: 'notice' }, error),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn secondary', onclick: () => { history.pop(); step(); } }, 'Voltar'),
          h('a', { class: 'btn', href: back }, 'Voltar para o álbum')));
      return;
    }
    const changes = diffScores(current, scores, tracks.map((t) => t.id));
    if (changes.length === 0) {
      put(body, emptyState('Tudo certo', 'Suas notas já estão consistentes com suas preferências.',
        h('a', { class: 'btn', href: back }, 'Voltar para o álbum')));
      return;
    }

    const accepted = new Set(changes.map((c) => c.id));
    const rows = changes.map((c) => {
      const t = byId[c.id];
      const box = h('input', {
        type: 'checkbox', class: 'check', checked: true,
        onchange: (e) => { if (e.target.checked) accepted.add(c.id); else accepted.delete(c.id); },
      });
      return h('label', { class: 'change-row' },
        h('div', null,
          h('div', null, `Faixa ${t.position}: ${t.title}`),
          h('div', { class: 'delta' }, `${formatTenths(c.from)} → ${formatTenths(c.to)}`)),
        box);
    });

    const apply = async (btn, ids) => {
      if (ids.length === 0) {
        toast('Nenhuma sugestão selecionada.');
        return;
      }
      await withBusy(btn, async () => {
        const trackScores = { ...rating.trackScores };
        for (const id of ids) trackScores[id] = scores[id];
        db.saveDraft(album.id, session.uid, { scale: rating.scale, trackScores, albumScore: rating.albumScore }).catch((err) => console.error(err));
        toast(ids.length === 1 ? 'Nota ajustada' : `${ids.length} notas ajustadas`);
        navigate(back);
      });
    };

    const allBtn = h('button', { class: 'btn block', onclick: (e) => apply(e.currentTarget, changes.map((c) => c.id)) }, 'Aplicar todas');
    const selBtn = h('button', { class: 'btn block secondary', onclick: (e) => apply(e.currentTarget, [...accepted]) }, 'Aplicar selecionadas');
    put(body,
      h('p', { class: 'muted' }, `${changes.length === 1 ? 'Uma faixa mudaria' : `${changes.length} faixas mudariam`} para refletir suas escolhas. A nota do álbum não muda.`),
      h('div', { style: 'margin: 12px 0 20px' }, rows),
      h('div', { class: 'stack' },
        allBtn,
        selBtn,
        h('button', { class: 'btn block ghost', onclick: async () => {
          if (await confirmDialog({ title: 'Descartar as sugestões?', body: 'Suas notas continuam como estão.', confirmLabel: 'Descartar' })) navigate(back);
        } }, 'Cancelar'),
      ),
    );
  }
}
