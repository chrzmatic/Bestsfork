import { configMissing } from './firebase.js';
import { h, icon, loading, errorState, toast, friendlyError, add, put } from './ui.js';
import { session, getPref, applyTheme, setAppearance } from './state.js';

const app = document.getElementById('app');
const tabbar = document.querySelector('.tabbar');

const TABS = [
  { id: 'albums', label: 'Álbuns', icon: 'albums', href: '#/albums' },
  { id: 'artists', label: 'Artistas', icon: 'artists', href: '#/artists' },
  { id: 'stats', label: 'Estatísticas', icon: 'stats', href: '#/stats' },
  { id: 'profile', label: 'Perfil', icon: 'profile', href: '#/profile' },
];

// padrão da rota, aba destacada, módulo
const ROUTES = [
  [/^albums$/, 'albums', () => import('./views/albums.js')],
  [/^album\/new$/, 'albums', () => import('./views/album-new.js')],
  [/^album\/([^/]+)$/, 'albums', () => import('./views/album.js')],
  [/^album\/([^/]+)\/normalize$/, 'albums', () => import('./views/normalize.js')],
  [/^album\/([^/]+)\/edit$/, 'albums', () => import('./views/album-edit.js')],
  [/^artists$/, 'artists', () => import('./views/artists.js')],
  [/^artist\/([^/]+)$/, 'artists', () => import('./views/artist.js')],
  [/^stats$/, 'stats', () => import('./views/stats.js')],
  [/^profile$/, 'profile', () => import('./views/profile.js')],
  [/^admin$/, 'profile', () => import('./views/admin.js')],
  [/^admin\/import$/, 'profile', () => import('./views/import.js')],
];

let cleanup = null;
let renderToken = 0;

function renderTabs(active) {
  put(tabbar, ...TABS.map((t) => h('a', {
    href: t.href,
    'aria-current': t.id === active ? 'page' : null,
  }, icon(t.icon), t.label)));
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

export function refresh() {
  route();
}

async function route() {
  if (!session.uid || !session.user) return;
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'albums';
  const match = ROUTES.map(([re, tab, load]) => ({ m: path.match(re), tab, load })).find((r) => r.m);
  if (!match) return navigate('#/albums', { replace: true });

  const token = ++renderToken;
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (err) { console.error(err); }
  }
  cleanup = null;
  document.body.classList.remove('no-tabs');
  renderTabs(match.tab);
  put(app, loading());

  try {
    const mod = await match.load();
    if (token !== renderToken) return;
    const root = h('div');
    const result = await mod.render(root, match.m.slice(1), session);
    if (token !== renderToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = result;
    put(app, root);
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    put(app, errorState(friendlyError(err), () => route()));
  }
}

function showStandalone(node) {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  renderToken++;
  document.body.classList.add('no-tabs');
  put(tabbar);
  put(app, node);
}

function configScreen() {
  return h('div', { class: 'login' },
    h('div', { class: 'brand' }, h('div', { class: 'sticker' }, 'B'), h('h1', null, 'Bestsfork')),
    h('div', { class: 'notice' }, 'Falta configurar o Firebase. Cole a config do app Web em js/firebase-config.js e recarregue.'),
  );
}

async function deniedScreen(logout) {
  return h('div', { class: 'login' },
    h('div', { class: 'brand' }, h('div', { class: 'sticker' }, 'B'), h('h1', null, 'Bestsfork')),
    h('h2', null, 'Acesso negado'),
    h('p', { class: 'muted', style: 'margin: 8px 0 24px' }, 'Esta conta não faz parte do grupo. Fale com o Matheus se isso for um engano.'),
    h('button', { class: 'btn block secondary', onclick: logout }, 'Sair'),
  );
}

async function start() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  registerServiceWorker();

  if (configMissing) {
    showStandalone(configScreen());
    return;
  }

  const [{ onAuth, logout }, db] = await Promise.all([import('./auth.js'), import('./db.js')]);
  put(app, loading());

  onAuth(async (fbUser) => {
    session.uid = fbUser?.uid || null;
    session.user = null;
    if (!fbUser) {
      const { render } = await import('./views/login.js');
      const root = h('div');
      render(root);
      showStandalone(root);
      return;
    }
    showStandalone(loading());
    try {
      const user = await db.getUser(fbUser.uid);
      if (!user) {
        showStandalone(await deniedScreen(() => logout()));
        return;
      }
      session.user = user;
      session.isAdmin = user.admin === true;
      session.adminMode = session.isAdmin && getPref('adminMode', false);
      session.members = await db.getMemberUids();
      setAppearance(await db.getDisplay().catch(() => ({})));
      if (session.isAdmin) db.ensureDefaultTags().catch((err) => console.error(err));
      route();
    } catch (err) {
      console.error(err);
      if (err?.code === 'permission-denied') {
        showStandalone(await deniedScreen(() => logout()));
      } else {
        showStandalone(errorState('Não foi possível carregar seus dados. Verifique a conexão.', () => location.reload()));
      }
    }
  });

  window.addEventListener('hashchange', route);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      toast('Nova versão disponível, toque para atualizar', {
        duration: 0,
        action: { label: 'Atualizar', run: () => worker.postMessage('skipWaiting') },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.error(err));
}

start();
