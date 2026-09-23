import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeAuth,
  browserLocalPersistence,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// Emulador local para testes: só em localhost e com ?emulador=1 na URL.
const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('emulador');

const config = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-bestsfork', appId: 'demo' }
  : firebaseConfig;

export const configMissing = !config.apiKey || config.apiKey.startsWith('COLE_AQUI');

export const app = configMissing ? null : initializeApp(config);

export const auth = app ? initializeAuth(app, { persistence: [browserLocalPersistence] }) : null;
if (auth) auth.languageCode = 'pt';

let cache;
try {
  cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
} catch {
  cache = undefined;
}
export const db = app ? initializeFirestore(app, cache ? { localCache: cache } : {}) : null;

if (useEmulator && app) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
