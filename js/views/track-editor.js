import { h, icon } from '../ui.js';

export function nextTrackId(tracks, used = []) {
  const nums = [...tracks.map((t) => t.id), ...used]
    .map((id) => Number(String(id).replace(/^t/, '')))
    .filter(Number.isFinite);
  return `t${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function tracksFromLines(text, startId = 1) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((title, i) => ({
    id: `t${startId + i}`, disc: 1, position: i + 1, title, lengthMs: null, excluded: false,
  }));
}

// Renumera posições dentro de cada disco na ordem atual.
function renumber(tracks) {
  const counters = {};
  for (const t of tracks) {
    const d = t.disc || 1;
    counters[d] = (counters[d] || 0) + 1;
    t.position = counters[d];
  }
}

// Editor de tracklist. `state.tracks` é alterado no lugar; `usedIds` evita reaproveitar ids apagados.
export function trackEditor(state, { usedIds = [], onChange = () => {}, locked = false } = {}) {
  const list = h('div');
  const removed = [...usedIds];

  const draw = () => {
    renumber(state.tracks);
    const multiDisc = new Set(state.tracks.map((t) => t.disc || 1)).size > 1;
    list.replaceChildren(...state.tracks.map((t, i) => {
      const title = h('input', {
        class: 'input', value: t.title, 'aria-label': `Título da faixa ${i + 1}`, disabled: locked,
        oninput: (e) => { t.title = e.target.value; onChange(); },
      });
      const excluded = h('input', {
        type: 'checkbox', role: 'switch', checked: !!t.excluded,
        onchange: (e) => { t.excluded = e.target.checked; onChange(); },
      });
      const move = (dir) => {
        const j = i + dir;
        if (j < 0 || j >= state.tracks.length) return;
        [state.tracks[i], state.tracks[j]] = [state.tracks[j], state.tracks[i]];
        if (state.tracks[i].disc !== state.tracks[j].disc) {
          [state.tracks[i].disc, state.tracks[j].disc] = [state.tracks[j].disc, state.tracks[i].disc];
        }
        draw(); onChange();
      };
      return h('div', { class: 'edit-track' },
        h('div', { class: 'row' },
          h('span', { class: 'muted small', style: 'width: 34px; text-align: right; flex: none' }, multiDisc ? `${t.disc}.${t.position}` : t.position),
          title),
        h('div', { class: 'tools' },
          !locked && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Subir', disabled: i === 0, onclick: () => move(-1) }, icon('up')),
          !locked && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Descer', disabled: i === state.tracks.length - 1, onclick: () => move(1) }, icon('down')),
          !locked && h('button', {
            class: 'icon-btn', type: 'button', 'aria-label': 'Remover faixa',
            onclick: () => { removed.push(t.id); state.tracks.splice(i, 1); draw(); onChange(); },
          }, icon('trash')),
        ),
        h('label', { class: 'switch' }, h('span', null, 'Não conta na avaliação'), excluded),
      );
    }));
  };

  const addBtn = !locked && h('button', {
    class: 'btn secondary small', type: 'button',
    onclick: () => {
      const last = state.tracks[state.tracks.length - 1];
      state.tracks.push({ id: nextTrackId(state.tracks, removed), disc: last?.disc || 1, position: 0, title: '', lengthMs: null, excluded: false });
      draw(); onChange();
      list.querySelectorAll('.edit-track input.input')[state.tracks.length - 1]?.focus();
    },
  }, icon('plus'), 'Adicionar faixa');

  draw();
  return { el: h('div', null, list, addBtn && h('div', { style: 'margin-top: 12px' }, addBtn)), redraw: draw };
}
