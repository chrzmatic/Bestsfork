import { h, icon, cover, sticker, badge, badgeList, avatar, userName, toast, confirmDialog, sheet, withBusy, formatLength, debounce, emptyState, add } from '../ui.js';
import * as db from '../db.js';
import {
  maxFor, countedTracks, missingTracks, isComplete, trackAverage5, album5, personalFinal,
  convertScale, conversionLosesPrecision, parseScore, formatTenths, formatScore,
} from '../scoring.js';
import { albumGroupScore } from '../stats.js';
import { pageCover } from '../images.js';
import { scoreColors } from '../score-colors.js';
import { appearance, setAppearance } from '../state.js';
import { pageBadges, displaySettings, periodWarning, PERIOD_WARNINGS } from '../periods.js';
import { session, actingAdmin, getPref } from '../state.js';
import { navigate } from '../app.js';

// Nota em décimos de uma escala qualquer mostrada em outra escala.
function showIn(tenths, fromScale, toScale) {
  if (typeof tenths !== 'number') return '-';
  const v = (tenths / 10) * (toScale / fromScale);
  return formatScore(v, Number.isInteger(Math.round(v * 1000) / 100) ? 1 : 2);
}

function groupByDisc(tracks) {
  const discs = new Map();
  for (const t of tracks) {
    if (!discs.has(t.disc || 1)) discs.set(t.disc || 1, []);
    discs.get(t.disc || 1).push(t);
  }
  return [...discs.entries()];
}

function trackList(tracks, rowFor) {
  const discs = groupByDisc(tracks);
  const out = [];
  for (const [disc, list] of discs) {
    if (discs.length > 1) out.push(h('li', { class: 'disc-head' }, `Disco ${disc}`));
    for (const t of list) out.push(rowFor(t));
  }
  return h('ul', { class: 'tracks' }, out);
}

function trackTitle(t) {
  return h('div', { class: 'title' },
    h('div', null, t.title),
    t.excluded ? badge('não conta') : t.lengthMs ? h('span', { class: 'len' }, formatLength(t.lengthMs)) : null,
  );
}

export async function render(root, [albumId]) {
  const album = await db.getAlbum(albumId);
  if (!album) {
    add(root, emptyState('Álbum não encontrado', 'Ele pode ter sido apagado.', h('a', { class: 'btn secondary', href: '#/albums' }, 'Voltar para os álbuns')));
    return;
  }
  const members = session.members;
  const [users, progress, artist, tags, mine, genres, displayDoc, media] = await Promise.all([
    db.usersById(), album.retro ? {} : db.getProgress(albumId), db.getArtist(album.artistId), db.listTags(),
    album.retro ? null : db.getRating(albumId, session.uid),
    db.listGenres().catch(() => []), db.getDisplay().catch(() => ({})),
    album.customCover ? db.getMedia(`album-${albumId}`).catch(() => null) : null,
  ]);
  const genre = genres.find((g) => g.id === album.genreId);
  setAppearance(displayDoc);
  let result = await db.getResult(albumId);
  if (!album.retro && !result && members.length && members.every((u) => progress[u] === 'final')) {
    result = await db.ensureResult(album, progress).catch(() => null);
  }

  const admin = actingAdmin();
  const iFinalized = mine?.status === 'final';
  // Às cegas: só vê notas alheias depois de finalizar, ou no modo admin.
  const others = (iFinalized || admin) && !album.retro
    ? await db.getRatings(albumId, members.filter((u) => u !== session.uid))
    : {};

  const score = albumGroupScore(album, result, members);
  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));
  const cleanups = [];

  add(root, header());
  if (album.retro) {
    add(root, retroBody());
  } else {
    add(root, membersRow());
    if (!mine) add(root, startBody());
    else if (mine.status === 'draft') add(root, draftBody(mine));
    else add(root, finalBody());
  }
  if (admin) add(root, adminBody());

  return () => cleanups.forEach((fn) => fn());

  function header() {
    const done = members.filter((u) => progress[u] === 'final').length;
    const hero = h('div', { class: 'album-hero' }, cover(pageCover(album, media), `Capa de ${album.title}`));
    if (score != null) add(hero, sticker(score, { big: true }));
    else if (!album.retro) add(hero, sticker(null, { big: true, pending: `Aguardando ${members.length - done} de ${members.length}` }));

    const meta = badgeList(pageBadges(album, tagById, displaySettings(displayDoc)));
    if (album.retro && album.evaluatedYear) meta.push(badge(`Avaliado em ${album.evaluatedYear}`));
    const warn = admin && periodWarning(album);
    if (warn) meta.push(badge(PERIOD_WARNINGS[warn], 'warn'));

    return h('div', null,
      h('header', { class: 'screen-head', style: 'margin-bottom: 8px' },
        h('a', { class: 'back', href: '#/albums', 'aria-label': 'Voltar' }, icon('back')),
        h('span', { style: 'flex: 1' }),
        admin && h('a', { class: 'icon-btn', href: `#/album/${album.id}/edit`, 'aria-label': 'Editar álbum' }, icon('edit')),
      ),
      hero,
      h('div', { class: 'album-title' },
        h('h1', null, album.title),
        h('div', { class: 'artist' },
          h('a', { href: `#/artist/${album.artistId}` }, album.artistCredit || artist?.name || '')),
        album.year && h('div', { class: 'year' }, album.year),
        genre && h('div', { class: 'genre' }, genre.name),
        meta.length > 0 && h('div', { class: 'meta badges' }, meta),
      ),
    );
  }

  function membersRow() {
    return h('div', { class: 'members-row' }, members.map((u) => {
      const st = progress[u];
      const label = st === 'final' ? 'finalizou' : st === 'draft' ? 'avaliando' : 'não começou';
      return h('div', { class: `member-chip${st === 'final' ? ' done' : ''}` },
        avatar(users[u], 'md'),
        h('div', null, h('div', null, u === session.uid ? 'Você' : userName(users[u])), h('div', { class: 'state small' }, label)),
      );
    }));
  }

  function retroBody() {
    const box = h('div');
    const memberScores = result?.memberScores || {};
    const withScore = members.filter((u) => typeof memberScores[u] === 'number');
    if (withScore.length) {
      add(box, h('div', { class: 'section' }, h('h2', null, 'Notas de cada um')),
        h('div', { class: 'result-grid' }, withScore.map((u) => h('div', { class: 'result-cell' },
          avatar(users[u], 'md'), h('strong', null, formatScore(memberScores[u])), h('small', null, userName(users[u]))))));
    }
    if (album.tracks?.length) {
      add(box, h('div', { class: 'section' }, h('h2', null, 'Faixas')),
        trackList(album.tracks, (t) => h('li', { class: `track${t.excluded ? ' excluded' : ''}` },
          h('span', { class: 'num' }, t.position), trackTitle(t), h('span'))));
    }
    return box;
  }

  function startBody() {
    const scale = getPref('scale', 5);
    const btn = h('button', {
      class: 'btn block',
      onclick: () => withBusy(btn, async () => {
        await db.createRating(album.id, session.uid, scale);
        navigate(`#/album/${album.id}`);
      }),
    }, 'Começar avaliação');
    return h('div', { class: 'stack', style: 'margin-top: 20px' },
      btn,
      h('p', { class: 'muted small center' }, `Escala de 0 a ${scale}. Dá para trocar durante o rascunho.`),
      h('div', { class: 'section' }, h('h2', null, 'Faixas')),
      trackList(album.tracks || [], (t) => h('li', { class: `track${t.excluded ? ' excluded' : ''}` },
        h('span', { class: 'num' }, t.position), trackTitle(t), h('span'))),
    );
  }

  function draftBody(initial) {
    const rating = {
      scale: initial.scale,
      trackScores: { ...initial.trackScores },
      albumScore: initial.albumScore,
    };
    const saveState = h('div', { class: 'save-state', 'aria-live': 'polite' });
    const partial = h('strong');
    const albumPart = h('strong');
    const finalPart = h('strong');
    const sendBtn = h('button', { class: 'btn', onclick: () => finalize() }, 'Enviar definitivo');
    const normBtn = h('a', { class: 'btn secondary small', href: `#/album/${album.id}/normalize` }, 'Normalizar notas');
    const missingText = h('p', { class: 'hint' });
    let dirty = false;

    const persist = async () => {
      if (!dirty) return;
      dirty = false;
      saveState.textContent = 'Salvando…';
      const offline = !db.isOnline();
      if (offline) saveState.textContent = 'Salvo neste aparelho. Será enviado quando a conexão voltar.';
      try {
        await db.saveDraft(album.id, session.uid, rating);
        saveState.textContent = 'Rascunho salvo';
      } catch (err) {
        console.error(err);
        if (err?.code === 'permission-denied') {
          saveState.textContent = 'Não foi possível salvar. Esta avaliação não está mais aberta para edição.';
          return;
        }
        dirty = true;
        saveState.textContent = 'Não foi possível salvar. Tentando de novo em instantes.';
        setTimeout(() => save(), 4000);
      }
    };
    const save = debounce(persist, 1000);
    cleanups.push(() => save.flush());

    function scoreInput(get, set, label) {
      const current = get();
      const input = h('input', {
        class: 'score-input',
        inputmode: 'decimal',
        enterkeyhint: 'next',
        autocomplete: 'off',
        'aria-label': label,
        value: current == null ? '' : formatTenths(current),
      });
      input.addEventListener('input', () => {
        const { value, error } = parseScore(input.value, rating.scale);
        input.classList.toggle('invalid', !!error);
        input.title = error || '';
        if (error) return;
        set(value);
        dirty = true;
        saveState.textContent = '';
        save();
        refresh();
      });
      input.addEventListener('blur', () => {
        const { value, error } = parseScore(input.value, rating.scale);
        if (!error && value != null) input.value = formatTenths(value);
        if (error) toast(error, { error: true });
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = [...root.querySelectorAll('.score-input')];
        const next = all[all.indexOf(input) + 1];
        if (next) next.focus(); else input.blur();
      });
      return input;
    }

    function refresh() {
      const avg = trackAverage5(rating.trackScores, album.tracks, rating.scale);
      const alb = album5(rating.albumScore, rating.scale);
      partial.textContent = avg == null ? '-' : formatScore(avg);
      albumPart.textContent = alb == null ? '-' : formatScore(alb);
      const pf = personalFinal(rating, album.tracks);
      finalPart.textContent = pf == null ? '-' : formatScore(pf);
      const missing = missingTracks(rating, album.tracks);
      sendBtn.disabled = !isComplete(rating, album.tracks);
      const allTracks = missing.length === 0;
      normBtn.classList.toggle('disabled', !allTracks);
      normBtn.setAttribute('aria-disabled', String(!allTracks));
      normBtn.style.pointerEvents = allTracks ? '' : 'none';
      normBtn.style.opacity = allTracks ? '' : '0.4';
      const parts = [];
      if (missing.length) parts.push(`Faltam ${missing.length} ${missing.length === 1 ? 'faixa' : 'faixas'}`);
      if (rating.albumScore == null) parts.push('falta a nota do álbum');
      missingText.textContent = parts.length ? `${parts.join(', ')}.` : 'Tudo preenchido. Revise e envie quando quiser.';
    }

    const list = trackList(album.tracks, (t) => {
      if (t.excluded) {
        return h('li', { class: 'track excluded' }, h('span', { class: 'num' }, t.position), trackTitle(t), h('span'));
      }
      const input = scoreInput(() => rating.trackScores[t.id], (v) => {
        if (v == null) delete rating.trackScores[t.id]; else rating.trackScores[t.id] = v;
      }, `Nota de ${t.title}`);
      return h('li', { class: 'track' }, h('span', { class: 'num' }, t.position), trackTitle(t), input);
    });

    const albumInput = scoreInput(() => rating.albumScore, (v) => { rating.albumScore = v; }, 'Nota do álbum');

    const scaleBtns = [5, 10].map((s) => h('button', {
      'aria-pressed': String(rating.scale === s),
      onclick: async () => {
        if (rating.scale === s) return;
        if (s === 5 && conversionLosesPrecision(rating, 5)) {
          const ok = await confirmDialog({
            title: 'Trocar para a escala 5?',
            body: 'As notas serão divididas por 2 e arredondadas para o décimo mais próximo. Algumas vão mudar um pouco.',
            confirmLabel: 'Trocar escala',
          });
          if (!ok) return;
        }
        Object.assign(rating, convertScale(rating, s));
        dirty = true;
        save.flush();
        navigate(`#/album/${album.id}`);
      },
    }, `0 a ${s}`));

    // Retoma a edição sem perder o que está pendente ao navegar para a normalização.
    normBtn.addEventListener('click', () => save.flush());

    refresh();
    return h('div', null,
      h('div', { class: 'row', style: 'justify-content: space-between; margin: 8px 0 4px' },
        h('h2', null, 'Suas notas'),
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Escala' }, scaleBtns),
      ),
      saveState,
      list,
      h('div', { class: 'album-score-row' },
        h('div', null, h('h3', null, 'Nota merecida do álbum'), h('p', { class: 'hint' }, `De 0 a ${rating.scale}, pelo álbum como um todo.`)),
        albumInput,
      ),
      h('div', { class: 'row', style: 'justify-content: space-between' }, missingText, normBtn),
      h('div', { class: 'summary-bar' },
        h('div', { class: 'figures' },
          h('div', { class: 'fig' }, h('small', null, 'Faixas /5'), partial),
          h('div', { class: 'fig' }, h('small', null, 'Álbum /5'), albumPart),
          h('div', { class: 'fig' }, h('small', null, 'Final /10'), finalPart),
        ),
        sendBtn,
      ),
    );

    async function finalize() {
      if (!isComplete(rating, album.tracks)) return;
      if (!db.isOnline()) {
        toast('Sem conexão. Conecte-se à internet para enviar a avaliação definitiva.', { error: true });
        return;
      }
      const avg = trackAverage5(rating.trackScores, album.tracks, rating.scale);
      const alb = album5(rating.albumScore, rating.scale);
      const pf = personalFinal(rating, album.tracks);
      const first = await confirmDialog({
        title: 'Enviar definitivo?',
        body: h('div', { class: 'stack' },
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Média das faixas (0 a 5)'), h('strong', null, formatScore(avg))),
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Nota do álbum (0 a 5)'), h('strong', null, formatScore(alb))),
          h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Nota final (0 a 10)'), h('strong', { style: 'font-size: 22px' }, formatScore(pf))),
        ),
        confirmLabel: 'Enviar definitivo',
      });
      if (!first) return;
      const second = await confirmDialog({
        title: 'Tem certeza?',
        body: 'Depois de enviar você não poderá mais editar esta avaliação.',
        confirmLabel: 'Sim, enviar',
      });
      if (!second) return;
      save.cancel();
      dirty = false;
      await withBusy(sendBtn, async () => {
        await db.finalizeRating(album, session.uid, rating);
        toast('Avaliação enviada');
        navigate(`#/album/${album.id}`);
      });
    }
  }

  function finalBody() {
    const visible = [session.uid, ...members.filter((u) => u !== session.uid && others[u]?.status === 'final')];
    const ratingOf = (u) => (u === session.uid ? mine : others[u]);
    const waiting = members.filter((u) => progress[u] !== 'final');
    const myScale = mine.scale;

    const head = h('div', { class: 'cols-head' }, h('span'), h('span', { class: 'small muted' }, `Notas de 0 a ${myScale}`),
      h('div', { class: 'scores-cols' }, visible.map((u) => h('div', { class: 'score-cell' }, avatar(users[u])))));

    const list = trackList(album.tracks, (t) => h('li', { class: `track${t.excluded ? ' excluded' : ''}` },
      h('span', { class: 'num' }, t.position),
      trackTitle(t),
      t.excluded ? h('span') : h('div', { class: 'scores-cols' }, visible.map((u) => {
        const r = ratingOf(u);
        return h('div', { class: `score-cell${u === session.uid ? ' mine' : ''}` }, showIn(r.trackScores?.[t.id], r.scale, myScale));
      })),
    ));

    const summaryRow = (label, fn, cls = '') => h('li', { class: 'track' }, h('span'), h('div', { class: 'title' }, h('strong', null, label)),
      h('div', { class: 'scores-cols' }, visible.map((u) => h('div', { class: `score-cell ${cls}${u === session.uid ? ' mine' : ''}` }, fn(ratingOf(u))))));

    const box = h('div', null,
      h('div', { class: 'section' }, h('h2', null, visible.length > 1 ? 'Notas do grupo' : 'Suas notas')),
      head,
      list,
      h('ul', { class: 'tracks' },
        summaryRow('Nota do álbum', (r) => showIn(r.albumScore, r.scale, myScale)),
        summaryRow('Nota final /10', (r) => formatScore(r.personalFinal)),
      ),
    );

    if (waiting.length) {
      add(box, h('div', { class: 'notice', style: 'margin-top: 16px' },
        `Aguardando ${waiting.length} de ${members.length}: ${waiting.map((u) => userName(users[u])).join(', ')}.`));
    } else if (score != null) {
      add(box,
        h('div', { class: 'section' }, h('h2', null, 'Resultado')),
        h('div', { class: 'result-grid' },
          members.map((u) => h('div', { class: 'result-cell' }, avatar(users[u], 'md'),
            h('strong', null, formatScore(result.memberScores[u])), h('small', null, userName(users[u])))),
          h('div', { class: 'result-cell', style: (() => { const c = scoreColors(score, appearance.scoreBands); return `background: ${c.bg}; color: ${c.ink}`; })() },
            h('small', { style: 'color: inherit' }, 'Grupo'), h('strong', { style: 'font-size: 30px' }, formatScore(score))),
        ),
      );
    }
    if (mine.adminEdited) add(box, h('p', { class: 'hint', style: 'margin-top: 12px' }, 'Esta avaliação foi ajustada pelo admin.'));
    return box;
  }

  function adminBody() {
    const box = h('div', { class: 'panel', style: 'margin-top: 28px' }, h('h2', null, 'Modo admin'));
    if (!album.retro) {
      for (const u of members) {
        const r = u === session.uid ? mine : others[u];
        const status = r ? (r.status === 'final' ? `finalizada, ${formatScore(r.personalFinal)}` : 'rascunho') : 'sem avaliação';
        const actions = [];
        if (r) {
          actions.push(h('button', { class: 'btn small secondary', onclick: () => editRating(u, r) }, 'Editar notas'));
          if (r.status === 'final') {
            actions.push(h('button', {
              class: 'btn small secondary',
              onclick: async (e) => {
                const ok = await confirmDialog({
                  title: `Reabrir a avaliação de ${userName(users[u])}?`,
                  body: 'Ela volta a ser rascunho e o resultado do álbum é apagado até todos finalizarem de novo.',
                  confirmLabel: 'Reabrir',
                  danger: true,
                });
                if (ok) await withBusy(e.currentTarget, async () => { await db.reopenRating(album.id, u); navigate(`#/album/${album.id}`); });
              },
            }, 'Reabrir'));
          }
        }
        add(box, h('div', { class: 'row', style: 'padding: 10px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap' },
          avatar(users[u], 'md'),
          h('div', { class: 'grow' }, h('div', null, userName(users[u])), h('div', { class: 'small muted' }, status)),
          h('div', { class: 'btn-row' }, actions)));
      }
    }
    add(box, h('div', { class: 'btn-row', style: 'margin-top: 14px' },
      h('a', { class: 'btn secondary', href: `#/album/${album.id}/edit` }, 'Editar álbum'),
    ));
    return box;
  }

  async function editRating(uid, r) {
    const draft = { scale: r.scale, trackScores: { ...r.trackScores }, albumScore: r.albumScore };
    const saved = await sheet((close) => {
      const error = h('p', { class: 'error-text' });
      const field = (label, value, set) => {
        const input = h('input', { class: 'score-input', inputmode: 'decimal', value: value == null ? '' : formatTenths(value) });
        input.addEventListener('input', () => {
          const p = parseScore(input.value, draft.scale);
          input.classList.toggle('invalid', !!p.error);
          if (!p.error) set(p.value);
        });
        return h('div', { class: 'track' }, h('span'), h('div', { class: 'title' }, label), input);
      };
      const rows = countedTracks(album.tracks).map((t) => field(`${t.position}. ${t.title}`, draft.trackScores[t.id], (v) => {
        if (v == null) delete draft.trackScores[t.id]; else draft.trackScores[t.id] = v;
      }));
      rows.push(field(h('strong', null, 'Nota do álbum'), draft.albumScore, (v) => { draft.albumScore = v; }));
      const saveBtn = h('button', {
        class: 'btn block',
        onclick: async () => {
          if (r.status === 'final' && !isComplete(draft, album.tracks)) {
            error.textContent = 'A avaliação finalizada precisa ter todas as notas.';
            return;
          }
          await withBusy(saveBtn, async () => {
            await db.adminSaveRating(album, uid, draft);
            close(true);
          });
        },
      }, 'Salvar notas');
      return h('div', null,
        h('h2', null, `Notas de ${userName(users[uid])}`),
        h('p', { class: 'body' }, `Escala de 0 a ${draft.scale} (máximo ${formatTenths(maxFor(draft.scale))}). A avaliação fica marcada como ajustada pelo admin.`),
        h('div', null, rows),
        error,
        h('div', { class: 'actions', style: 'margin-top: 16px' }, saveBtn,
          h('button', { class: 'btn block secondary', onclick: () => close(false) }, 'Cancelar')),
      );
    });
    if (saved) {
      toast('Notas salvas');
      navigate(`#/album/${album.id}`);
    }
  }
}
