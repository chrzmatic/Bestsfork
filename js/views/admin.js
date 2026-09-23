import { h, screenHead, emptyState, sheet, withBusy, toast, confirmDialog, deliverFile } from '../ui.js';
import * as db from '../db.js';
import { backupJson, fileName } from '../export.js';
import { actingAdmin } from '../state.js';
import { navigate } from '../app.js';

export async function render(root) {
  if (!actingAdmin()) {
    root.append(screenHead('Admin', { back: '#/profile' }), emptyState('Só no modo admin', 'Ative o modo admin em Perfil.'));
    return;
  }
  db.invalidate('tags');
  const [tags, albums] = await Promise.all([db.listTags(), db.listAlbums()]);
  const usage = {};
  for (const a of albums) for (const t of a.tags || []) usage[t] = (usage[t] || 0) + 1;

  const range = (t) => {
    if (t.yearFrom != null && t.yearTo != null) return `de ${t.yearFrom} a ${t.yearTo}`;
    if (t.yearFrom != null) return `de ${t.yearFrom} em diante`;
    if (t.yearTo != null) return `até ${t.yearTo}`;
    return 'sem intervalo de anos';
  };

  const tagList = h('ul', { class: 'menu' }, tags.map((t) => h('li', { class: 'row', style: 'padding: 10px 0' },
    h('div', { class: 'grow' },
      h('div', { style: 'font-weight: 650' }, t.name),
      h('div', { class: 'muted small' }, `${range(t)}, ${usage[t.id] || 0} ${usage[t.id] === 1 ? 'álbum' : 'álbuns'}`)),
    h('button', { class: 'btn small secondary', onclick: () => editTag(t) }, 'Editar'),
  )));

  const recalcBtn = h('button', { class: 'btn block secondary' }, 'Recalcular resultados');
  const recalcState = h('p', { class: 'hint' });
  recalcBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Recalcular todos os resultados?',
      body: 'Recalcula a nota pessoal de cada avaliação finalizada e reescreve o resultado de todos os álbuns. As notas dadas não mudam.',
      confirmLabel: 'Recalcular',
    });
    if (!ok) return;
    await withBusy(recalcBtn, async () => {
      await db.recalcAllResults((done, total) => { recalcState.textContent = `${done} de ${total} álbuns`; });
      recalcState.textContent = 'Resultados recalculados.';
      toast('Resultados recalculados');
    });
  });

  const backupBtn = h('button', { class: 'btn block' }, 'Backup completo');
  backupBtn.addEventListener('click', () => withBusy(backupBtn, async () => {
    const all = await db.fullBackup();
    await deliverFile(fileName('backup'), backupJson(all), 'application/json');
  }));

  root.append(
    screenHead('Admin', { back: '#/profile' }),
    h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'margin-bottom: 4px' }, h('h2', { class: 'grow' }, 'Tags'),
        h('button', { class: 'btn small', onclick: () => editTag(null) }, 'Nova tag')),
      tags.length ? tagList : h('p', { class: 'muted' }, 'Nenhuma tag.')),
    h('div', { class: 'panel' },
      h('h2', null, 'Resultados'),
      h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Use se alguma nota do grupo parecer errada ou depois de mudar regras de cálculo.'),
      recalcBtn, recalcState),
    h('div', { class: 'panel' },
      h('h2', null, 'Backup'),
      h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Baixa um JSON com tudo, inclusive rascunhos e avaliações individuais. O plano gratuito do Firebase não faz backup sozinho, então guarde uma cópia de vez em quando.'),
      backupBtn),
  );

  async function editTag(tag) {
    const saved = await sheet((close) => {
      const name = h('input', { class: 'input', value: tag?.name || '', required: true });
      const from = h('input', { class: 'input', inputmode: 'numeric', value: tag?.yearFrom ?? '', placeholder: 'Opcional' });
      const to = h('input', { class: 'input', inputmode: 'numeric', value: tag?.yearTo ?? '', placeholder: 'Opcional' });
      const error = h('p', { class: 'error-text' });
      const submit = h('button', { class: 'btn block', type: 'submit' }, 'Salvar tag');
      const year = (input) => (input.value.trim() ? Number(input.value) : null);
      const del = tag && h('button', {
        class: 'btn block danger', type: 'button',
        onclick: async () => {
          const n = usage[tag.id] || 0;
          const ok = await confirmDialog({
            title: `Apagar a tag ${tag.name}?`,
            body: n ? `Ela sai de ${n} ${n === 1 ? 'álbum' : 'álbuns'}. Os álbuns continuam.` : 'Nenhum álbum usa esta tag.',
            confirmLabel: 'Apagar tag',
            danger: true,
          });
          if (!ok) return;
          await withBusy(del, async () => { await db.deleteTag(tag.id); close(true); });
        },
      }, 'Apagar tag');
      return h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const yf = year(from), yt = year(to);
          if (!name.value.trim()) { error.textContent = 'Dê um nome à tag.'; return; }
          if ((yf != null && !Number.isInteger(yf)) || (yt != null && !Number.isInteger(yt))) { error.textContent = 'Ano inválido.'; return; }
          if (yf != null && yt != null && yf > yt) { error.textContent = 'O ano inicial precisa ser menor que o final.'; return; }
          await withBusy(submit, async () => {
            await db.saveTag(tag?.id || null, { name: name.value.trim(), yearFrom: yf, yearTo: yt });
            close(true);
          });
        },
      },
        h('h2', null, tag ? 'Editar tag' : 'Nova tag'),
        h('label', { class: 'field' }, h('span', null, 'Nome'), name),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', null, 'De (ano)'), from),
          h('label', { class: 'field grow' }, h('span', null, 'Até (ano)'), to)),
        h('p', { class: 'hint', style: 'margin: -6px 0 12px' }, 'O intervalo serve para marcar a tag sozinha ao registrar um álbum retroativo.'),
        error,
        h('div', { class: 'actions' }, submit, del,
          h('button', { class: 'btn block secondary', type: 'button', onclick: () => close(false) }, 'Cancelar')),
      );
    });
    if (saved) {
      toast('Tags atualizadas');
      navigate('#/admin');
    }
  }
}
