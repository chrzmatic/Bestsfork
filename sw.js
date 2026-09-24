// A versão muda sozinha a cada commit (tools/bump-version.mjs), e os aparelhos baixam os arquivos novos.
const VERSION = 'v1.0.17';
const CACHE = `bestsfork-${VERSION}`;

const FILES = [
  './',
  'manifest.webmanifest',
  'css/styles.css',
  'fonts/bricolage-latin.woff2',
  'fonts/bricolage-latin-ext.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/firebase-config.js',
  'js/firebase.js',
  'js/auth.js',
  'js/db.js',
  'js/state.js',
  'js/ui.js',
  'js/musicbrainz.js',
  'js/scoring.js',
  'js/normalize.js',
  'js/artists.js',
  'js/stats.js',
  'js/export.js',
  'js/photo.js',
  'js/periods.js',
  'js/genres.js',
  'js/genre-lookup.js',
  'js/import.js',
  'js/images.js',
  'js/ordering.js',
  'js/version.js',
  'js/score-colors.js',
  'js/artist-images.js',
  'js/views/login.js',
  'js/views/albums.js',
  'js/views/album.js',
  'js/views/normalize.js',
  'js/views/album-new.js',
  'js/views/album-edit.js',
  'js/views/artists.js',
  'js/views/artist.js',
  'js/views/stats.js',
  'js/views/social.js',
  'js/views/profile.js',
  'js/views/admin.js',
  'js/views/track-editor.js',
  'js/views/import.js',
];

// Alguns servidores redirecionam (index.html vira ./). O navegador recusa resposta
// redirecionada numa navegação, então guarda só o conteúdo final.
async function store(cache, file) {
  const res = await fetch(file, { cache: 'reload' });
  if (!res.ok) throw new Error(`Falha ao guardar ${file}`);
  const clean = res.redirected ? new Response(await res.blob(), { status: 200, headers: res.headers }) : res;
  await cache.put(file, clean);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => store(c, f)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bestsfork-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Só responde arquivos do próprio app. Firebase, MusicBrainz e capas vão direto para a rede.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./', { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
