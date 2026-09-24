import {
  h, screenHead, emptyState, sheet, withBusy, toast, confirmDialog, promptDialog, deliverFile, switchField, badge, icon, add, put,
} from '../ui.js';
import { DEFAULT_SCORE_BANDS, normalizeBands, bandRanges } from '../score-colors.js';
import * as db from '../db.js';
import { backupJson, fileName } from '../export.js';
import { isSystemTag, tagShownOnCards, displaySettings } from '../periods.js';
import { genreKey } from '../genres.js';
import { actingAdmin, setAppearance } from '../state.js';
import { navigate } from '../app.js';

export async function render(root) {
  if (!actingAdmin()) {
    add(root, screenHead('Admin', { back: '#/profile' }), emptyState('Só no modo admin', 'Ative o modo admin em Perfil.'));
    return;
  }
  db.invalidate('tags', 'genres', 'display');
  const [tags, albums, genres, displayDoc] = await Promise.all([
    db.listTags(), db.listAlbums(), db.listGenres(), db.getDisplay().catch(() => ({})),
  ]);
  const display = displaySettings(displayDoc);
  const usage = {};
  const genreUsage = {};
  for (const a of albums) {
    for (const t of a.tags || []) usage[t] = (usage[t] || 0) + 1;
    if (a.genreId) genreUsage[a.genreId] = (genreUsage[a.genreId] || 0) + 1;
  }
  const albumsText = (n) => `${n || 0} ${n === 1 ? 'álbum' : 'álbuns'}`;
  const reload = () => navigate('#/admin');

  const range = (t) => {
    if (t.yearFrom != null && t.yearTo != null) return `de ${t.yearFrom} a ${t.yearTo}`;
    if (t.yearFrom != null) return `de ${t.yearFrom} em diante`;
    if (t.yearTo != null) return `até ${t.yearTo}`;
    return 'sem intervalo de anos';
  };

  const tagRow = (t) => {
    const shown = tagShownOnCards(t);
    return h('li', { style: 'padding: 10px 0' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight: 650' }, t.name, ' ', !shown && badge('Oculta nos cards', 'faint'), isSystemTag(t.id) && badge('Período')),
          h('div', { class: 'muted small' }, `${range(t)}, ${albumsText(usage[t.id])}`)),
        h('button', { class: 'btn small secondary', onclick: () => editTag(t) }, 'Editar')),
      switchField('Mostrar nos cards', shown, (on) => withBusy(null, async () => {
        await db.setTagVisibility(t.id, on);
        toast(on ? `${t.name} aparece nos cards` : `${t.name} oculta nos cards`);
        reload();
      })),
    );
  };

  const genreRow = (g) => h('li', { class: 'row', style: 'padding: 10px 0' },
    h('div', { class: 'grow' },
      h('div', { style: 'font-weight: 650' }, g.name),
      h('div', { class: 'muted small' }, albumsText(genreUsage[g.id]))),
    h('button', { class: 'btn small secondary', onclick: () => editGenre(g) }, 'Editar'));

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

  const photosBtn = h('button', { class: 'btn block secondary' }, 'Buscar fotos que faltam');
  const photosState = h('p', { class: 'hint' });
  photosBtn.addEventListener('click', () => withBusy(photosBtn, async () => {
    photosState.textContent = 'Procurando…';
    const { total, found } = await db.fetchMissingArtistPhotos((done, all, ok) => {
      photosState.textContent = `${done} de ${all} artistas, ${ok} com foto`;
    });
    photosState.textContent = total === 0 ? 'Todos os artistas já têm foto.' : `${found} de ${total} artistas ganharam foto.`;
  }));

  // Cores do adesivo da nota por faixa de média.
  let bands = normalizeBands(displayDoc?.scoreBands);
  const bandsBox = h('div');
  const bandsError = h('p', { class: 'error-text' });
  const parseFrom = (text) => {
    const v = Number(String(text).trim().replace(',', '.'));
    return Number.isFinite(v) && v >= 0 && v <= 10 ? Math.round(v * 10) / 10 : null;
  };
  const drawBands = () => {
    const ranges = bandRanges(bands);
    put(bandsBox, ...bands.map((b, i) => {
      const from = h('input', {
        class: 'input', inputmode: 'decimal', value: b.from.toLocaleString('pt-BR', { minimumFractionDigits: 1 }),
        disabled: i === 0, 'aria-label': `Início da faixa ${i + 1}`,
        onchange: (e) => {
          const v = parseFrom(e.target.value);
          if (v == null || v <= 0) { bandsError.textContent = 'Use um número entre 0,1 e 10.'; return; }
          bandsError.textContent = '';
          bands[i] = { ...b, from: v };
          bands = normalizeBands(bands);
          drawBands();
        },
      });
      const color = h('input', {
        type: 'color', class: 'color-input', value: b.color, 'aria-label': `Cor da faixa ${i + 1}`,
        oninput: (e) => { bands[i] = { ...b, color: e.target.value }; },
      });
      return h('div', { class: 'band-row' },
        h('div', { class: 'band-range' }, h('span', { class: 'small muted' }, 'A partir de'), from),
        color,
        h('span', { class: 'small muted' }, ranges[i].label),
        i > 0 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remover faixa',
          onclick: () => { bands.splice(i, 1); bands = normalizeBands(bands); drawBands(); } }, icon('trash')) : h('span'),
      );
    }));
  };
  drawBands();
  const addBand = h('button', { class: 'btn small secondary', type: 'button', onclick: () => {
    const last = bands[bands.length - 1];
    if (last.from >= 10) return;
    bands = normalizeBands([...bands, { from: Math.min(10, Math.round((last.from + 1) * 10) / 10), color: '#8d9cff' }]);
    drawBands();
  } }, icon('plus'), 'Adicionar faixa');
  const saveBands = h('button', { class: 'btn small', type: 'button', onclick: () => withBusy(saveBands, async () => {
    bands = normalizeBands(bands);
    await db.setDisplay({ scoreBands: bands });
    setAppearance({ scoreBands: bands });
    drawBands();
    toast('Cores das notas salvas');
  }) }, 'Salvar cores');
  const resetBands = h('button', { class: 'btn small ghost', type: 'button', onclick: () => {
    bands = DEFAULT_SCORE_BANDS.map((b) => ({ ...b }));
    drawBands();
  } }, 'Voltar ao padrão');

  const backupBtn = h('button', { class: 'btn block' }, 'Backup completo');
  backupBtn.addEventListener('click', () => withBusy(backupBtn, async () => {
    const all = await db.fullBackup();
    await deliverFile(fileName('backup'), backupJson(all), 'application/json');
  }));

  add(root,
    screenHead('Admin', { back: '#/profile' }),
    h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'margin-bottom: 4px' }, h('h2', { class: 'grow' }, 'Tags'),
        h('button', { class: 'btn small', onclick: () => editTag(null) }, 'Nova tag')),
      tags.length ? h('ul', { class: 'menu' }, tags.map(tagRow)) : h('p', { class: 'muted' }, 'Nenhuma tag.'),
      h('hr', { class: 'divider' }),
      switchField('Mostrar o selo Retroativo nos cards', display.showRetroBadge, (on) => withBusy(null, async () => {
        await db.setDisplay({ showRetroBadge: on });
        toast(on ? 'Selo Retroativo aparece nos cards' : 'Selo Retroativo oculto nos cards');
      })),
      h('p', { class: 'hint' }, 'Vale para os três. Na página do álbum ele não aparece.')),
    h('div', { class: 'panel' },
      h('h2', null, 'Cores das notas'),
      h('p', { class: 'hint', style: 'margin-bottom: 10px' }, 'Cor do adesivo da nota do grupo conforme a média. Vale para os três, em todas as telas.'),
      bandsBox,
      bandsError,
      h('div', { class: 'btn-row', style: 'margin-top: 10px' }, addBand, resetBands, saveBands)),
    h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'margin-bottom: 4px' }, h('h2', { class: 'grow' }, 'Gêneros'),
        h('button', { class: 'btn small', onclick: newGenre }, 'Novo gênero')),
      genres.length ? h('ul', { class: 'menu' }, genres.map(genreRow)) : h('p', { class: 'muted' }, 'Nenhum gênero ainda.')),
    h('div', { class: 'panel' },
      h('h2', null, 'Importar retroativos'),
      h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Lê um CSV com os álbuns avaliados antes do app e mostra uma prévia antes de gravar.'),
      h('a', { class: 'btn block secondary', href: '#/admin/import' }, 'Importar CSV')),
    h('div', { class: 'panel' },
      h('h2', null, 'Fotos dos artistas'),
      h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Procura no Wikidata, na Wikipedia e no TheAudioDB a foto dos artistas que ainda não têm.'),
      photosBtn, photosState),
    h('div', { class: 'panel' },
      h('h2', null, 'Resultados'),
      h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Use se alguma nota do grupo parecer errada.'),
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
      const del = tag && !isSystemTag(tag.id) && h('button', {
        class: 'btn block danger', type: 'button',
        onclick: async () => {
          const n = usage[tag.id] || 0;
          const ok = await confirmDialog({
            title: `Apagar a tag ${tag.name}?`,
            body: n ? `Ela sai de ${albumsText(n)}. Os álbuns continuam.` : 'Nenhum álbum usa esta tag.',
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
        tag && isSystemTag(tag.id) && h('p', { class: 'hint', style: 'margin-bottom: 12px' }, 'Tag de período: pode ser renomeada, mas não apagada.'),
        error,
        h('div', { class: 'actions' }, submit, del,
          h('button', { class: 'btn block secondary', type: 'button', onclick: () => close(false) }, 'Cancelar')),
      );
    });
    if (saved) {
      toast('Tags atualizadas');
      reload();
    }
  }

  async function newGenre() {
    const name = await promptDialog({ title: 'Novo gênero', label: 'Nome', confirmLabel: 'Criar' });
    if (!name?.trim()) return;
    if (genres.some((g) => g.id === genreKey(name) || genreKey(g.name) === genreKey(name))) {
      toast('Esse gênero já existe.', { error: true });
      return;
    }
    await withBusy(null, async () => { await db.ensureGenre(name); reload(); });
  }

  async function editGenre(g) {
    const done = await sheet((close) => {
      const name = h('input', { class: 'input', value: g.name });
      const target = h('select', { class: 'input' },
        h('option', { value: '' }, 'Escolha o gênero'),
        genres.filter((x) => x.id !== g.id).map((x) => h('option', { value: x.id }, x.name)));
      const rename = h('button', { class: 'btn block', type: 'button', onclick: () => withBusy(rename, async () => {
        const value = name.value.trim();
        if (!value) return;
        const clash = genres.find((x) => x.id !== g.id && genreKey(x.name) === genreKey(value));
        if (clash) { toast(`Já existe ${clash.name}. Use "Juntar" para unir os dois.`, { error: true }); return; }
        await db.renameGenre(g.id, value);
        close(true);
      }) }, 'Renomear');
      const merge = h('button', { class: 'btn block secondary', type: 'button', onclick: async () => {
        const to = genres.find((x) => x.id === target.value);
        if (!to) { toast('Escolha para qual gênero juntar.', { error: true }); return; }
        const ok = await confirmDialog({
          title: `Juntar ${g.name} em ${to.name}?`,
          body: `${albumsText(genreUsage[g.id])} passam para ${to.name}, e ${g.name} deixa de existir.`,
          confirmLabel: 'Juntar',
        });
        if (ok) await withBusy(merge, async () => { await db.mergeGenres(g.id, to.id); close(true); });
      } }, 'Juntar');
      const del = h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        const ok = await confirmDialog({
          title: `Apagar ${g.name}?`,
          body: genreUsage[g.id] ? `${albumsText(genreUsage[g.id])} ficam sem gênero.` : 'Nenhum álbum usa este gênero.',
          confirmLabel: 'Apagar gênero',
          danger: true,
        });
        if (ok) await withBusy(del, async () => { await db.deleteGenre(g.id); close(true); });
      } }, 'Apagar gênero');
      return h('div', null,
        h('h2', null, g.name),
        h('label', { class: 'field' }, h('span', null, 'Nome'), name),
        h('div', { class: 'actions' }, rename),
        genres.length > 1 && h('label', { class: 'field', style: 'margin-top: 18px' }, h('span', null, 'Juntar com outro gênero'), target),
        genres.length > 1 && h('div', { class: 'actions' }, merge),
        h('div', { class: 'actions', style: 'margin-top: 18px' }, del,
          h('button', { class: 'btn block secondary', type: 'button', onclick: () => close(false) }, 'Cancelar')),
      );
    });
    if (done) {
      toast('Gêneros atualizados');
      reload();
    }
  }
}
