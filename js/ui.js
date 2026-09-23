import { formatScore } from './scoring.js';

// Construtor de elementos: h('div', { class: 'x', onclick }, filhos...)
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

// Iguais a append e replaceChildren, mas ignoram null e false como h().
export function add(el, ...children) {
  append(el, children);
  return el;
}

export function put(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  albums: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  artists: '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9" opacity=".5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

export function cover(url, alt = '') {
  const box = h('div', { class: 'cover' });
  if (url) {
    const img = h('img', { src: url, alt, loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.remove(); box.append(icon('disc')); }, { once: true });
    box.append(img);
  } else {
    box.append(icon('disc'));
  }
  return box;
}

export function userName(user) {
  return user?.displayName || user?.name || 'Membro';
}

const AVATAR_COLORS = ['#2743e0', '#c93b3b', '#18804a', '#7b3fd6', '#b05f00', '#007a94'];

function avatarColor(id = '') {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

export function avatar(user, size = '') {
  const name = userName(user);
  const el = h('span', { class: `avatar ${size}`, title: name, 'aria-label': name, role: 'img', style: `background: ${avatarColor(user?.id)}` });
  if (user?.photo) el.append(h('img', { src: user.photo, alt: '' }));
  else el.textContent = name.trim().charAt(0).toUpperCase() || '?';
  return el;
}

export function avatars(users) {
  return h('span', { class: 'avatars' }, users.map((u) => avatar(u)));
}

export function sticker(score, { big = false, pending = null } = {}) {
  if (score == null) {
    return h('div', { class: `sticker pending${big ? ' big' : ''}`, 'aria-label': pending || 'Sem nota' }, pending || '');
  }
  return h('div', { class: `sticker${big ? ' big' : ''}`, 'aria-label': `Nota do grupo ${formatScore(score)}` }, formatScore(score));
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}` }, text);
}

export function loading() {
  return h('div', { class: 'loading', role: 'status', 'aria-label': 'Carregando' }, h('div', { class: 'spinner' }));
}

export function errorState(message, retry) {
  return h('div', { class: 'empty' },
    h('h2', null, 'Algo deu errado'),
    h('p', null, message),
    retry && h('button', { class: 'btn secondary', onclick: retry }, 'Tentar de novo'),
  );
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h2', null, title), text && h('p', null, text), action);
}

export function screenHead(title, { back, actions } = {}) {
  return h('header', { class: 'screen-head' },
    back && h('a', { class: 'back', href: back, 'aria-label': 'Voltar' }, icon('back')),
    h('h1', null, title),
    actions,
  );
}

export function searchBox(placeholder, oninput) {
  const input = h('input', { class: 'input', type: 'search', placeholder, 'aria-label': placeholder, oninput: (e) => oninput(e.target.value) });
  return h('div', { class: 'search' }, icon('search'), input);
}

export function switchField(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label', { class: 'switch' }, h('span', null, label), input);
}

let toastHost;
export function toast(message, { error = false, action, duration = 3500 } = {}) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toast-host', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  if (action) el.append(h('button', { onclick: () => { action.run(); el.remove(); } }, action.label));
  toastHost.append(el);
  if (duration) setTimeout(() => el.remove(), duration);
  return el;
}

// Folha de diálogo. `build(close)` devolve o conteúdo; `close(valor)` resolve a promessa.
export function sheet(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'sheet' });
    let value;
    const close = (v) => { value = v; dlg.close(); };
    dlg.append(build(close));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(value); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(undefined); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog({ title, body, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return sheet((close) => h('div', null,
    h('h2', null, title),
    body && h('div', { class: 'body' }, body),
    h('div', { class: 'actions' },
      h('button', { class: `btn block${danger ? ' danger' : ''}`, onclick: () => close(true) }, confirmLabel),
      h('button', { class: 'btn block secondary', onclick: () => close(false) }, cancelLabel),
    ),
  )).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', confirmLabel = 'Salvar', type = 'text' }) {
  return sheet((close) => {
    const input = h('input', { class: 'input', type, value });
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value); } },
      h('h2', null, title),
      h('label', { class: 'field' }, h('span', null, label), input),
      h('div', { class: 'actions' },
        h('button', { class: 'btn block', type: 'submit' }, confirmLabel),
        h('button', { class: 'btn block secondary', type: 'button', onclick: () => close(undefined) }, 'Cancelar'),
      ),
    );
    setTimeout(() => input.focus(), 50);
    return form;
  });
}

// Executa uma ação com o botão travado e mostra erro em toast.
export async function withBusy(button, fn) {
  const old = button?.disabled;
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), { error: true });
    return undefined;
  } finally {
    if (button) button.disabled = old;
  }
}

export function friendlyError(err) {
  if (err?.code === 'permission-denied') return 'Você não tem permissão para isso.';
  if (err?.code === 'unavailable') return 'Sem conexão com o servidor. Tente de novo.';
  return err?.message && !err.message.startsWith('Firebase') ? err.message : 'Não foi possível concluir. Tente de novo.';
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
export function formatDate(d) {
  return d instanceof Date ? dateFmt.format(d) : '';
}

export function formatLength(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// Entrega um arquivo: compartilhar no celular quando der, senão baixar.
export async function deliverFile(name, content, type) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display: none' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
