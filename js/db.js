import {
  doc, getDoc, getDocs, collection, collectionGroup, query, where,
  setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp,
  arrayRemove,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { artistKey, resolveArtist } from './artists.js';
import { personalFinal, buildResult, countedTracks } from './scoring.js';

const DEFAULT_TAGS = [
  { id: 'old-testamento', name: 'Old Testamento', yearFrom: 2021, yearTo: 2024 },
  { id: 'new-testamento', name: 'New Testamento', yearFrom: 2025, yearTo: null },
];

// Converte Timestamps do Firestore em Date, recursivamente.
function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

function fromSnap(snap) {
  return snap.exists() ? { id: snap.id, ...plain(snap.data()) } : null;
}

async function listOf(ref) {
  const snap = await getDocs(ref);
  return snap.docs.map(fromSnap);
}

function isPermissionError(err) {
  return err?.code === 'permission-denied';
}

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

// Cache curto em memória para o que muda pouco e é lido em quase toda tela.
const TTL = 60_000;
const cache = new Map();
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = loader().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
export function invalidate(...keys) {
  if (keys.length === 0) cache.clear();
  for (const k of keys) cache.delete(k);
}

/* Membros e usuários */

export function getMemberUids() {
  return cached('members', async () => {
    const d = fromSnap(await getDoc(doc(db, 'config', 'members')));
    return d?.uids || [];
  });
}

export async function getUser(uid) {
  return fromSnap(await getDoc(doc(db, 'users', uid)));
}

export function listUsers() {
  return cached('users', () => listOf(collection(db, 'users')));
}

export async function usersById() {
  const users = await listUsers();
  return Object.fromEntries(users.map((u) => [u.id, u]));
}

export async function updateProfile(uid, { displayName, photo }) {
  const patch = { updatedAt: serverTimestamp() };
  if (displayName !== undefined) patch.displayName = displayName;
  if (photo !== undefined) patch.photo = photo;
  await updateDoc(doc(db, 'users', uid), patch);
  invalidate('users');
}

/* Tags */

export function listTags() {
  return cached('tags', async () => {
    const tags = await listOf(collection(db, 'tags'));
    return tags.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
}

export async function ensureDefaultTags() {
  const existing = await listTags();
  const ids = new Set(existing.map((t) => t.id));
  const missing = DEFAULT_TAGS.filter((t) => !ids.has(t.id));
  if (missing.length === 0) return;
  const batch = writeBatch(db);
  for (const t of missing) {
    batch.set(doc(db, 'tags', t.id), {
      name: t.name, yearFrom: t.yearFrom, yearTo: t.yearTo, createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  invalidate('tags');
}

export async function saveTag(id, { name, yearFrom, yearTo }) {
  const data = { name, yearFrom: yearFrom ?? null, yearTo: yearTo ?? null };
  if (id) {
    await updateDoc(doc(db, 'tags', id), data);
  } else {
    const ref = doc(collection(db, 'tags'));
    await setDoc(ref, { ...data, createdAt: serverTimestamp() });
  }
  invalidate('tags');
}

// Apaga a tag e tira ela dos álbuns que a usam.
export async function deleteTag(id) {
  const albums = await listOf(query(collection(db, 'albums'), where('tags', 'array-contains', id)));
  const batch = writeBatch(db);
  for (const a of albums) batch.update(doc(db, 'albums', a.id), { tags: arrayRemove(id) });
  batch.delete(doc(db, 'tags', id));
  await batch.commit();
  invalidate('tags', 'albums');
}

/* Artistas */

export async function listArtists() {
  const list = await listOf(collection(db, 'artists'));
  return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function getArtist(id) {
  return fromSnap(await getDoc(doc(db, 'artists', id)));
}

export async function renameArtist(id, name) {
  await updateDoc(doc(db, 'artists', id), { name: name.trim() });
  invalidate('artists');
}

// Só apaga artista sem álbuns, para não deixar álbum órfão.
export async function deleteArtist(id) {
  const albums = await getDocs(query(collection(db, 'albums'), where('artistId', '==', id)));
  if (!albums.empty) throw new Error('Este artista ainda tem álbuns. Apague ou mova os álbuns antes.');
  await deleteDoc(doc(db, 'artists', id));
  invalidate('artists');
}

/* Álbuns */

export function listAlbums() {
  return listOf(collection(db, 'albums'));
}

export async function getAlbum(id) {
  return fromSnap(await getDoc(doc(db, 'albums', id)));
}

// Grava artista e álbum na mesma transação, reaproveitando artista existente.
// `result` só vem em registros retroativos.
export async function createAlbum({ album, artistName, artistMbid, result }, uid) {
  const key = artistKey(artistName);
  const candidates = [];
  if (artistMbid) {
    const byMbid = await listOf(query(collection(db, 'artists'), where('musicbrainzId', '==', artistMbid)));
    candidates.push(...byMbid);
  }
  const albumRef = doc(collection(db, 'albums'));

  await runTransaction(db, async (tx) => {
    const byKey = await tx.get(doc(db, 'artists', key));
    const existing = [...candidates];
    if (byKey.exists() && !existing.some((a) => a.id === key)) existing.push(fromSnap(byKey));
    const resolved = resolveArtist(artistName, artistMbid || null, existing);
    const artistRef = doc(db, 'artists', resolved.id);
    if (resolved.isNew) {
      // Outra pessoa pode ter criado o mesmo artista entre a consulta e a transação.
      const again = resolved.id === key ? byKey : await tx.get(artistRef);
      if (!again.exists()) {
        tx.set(artistRef, { ...resolved.data, createdAt: serverTimestamp() });
      }
    } else if (resolved.patch) {
      tx.update(artistRef, resolved.patch);
    }
    tx.set(albumRef, {
      ...album,
      artistId: resolved.id,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    if (result) {
      tx.set(doc(db, 'results', albumRef.id), { ...result, retro: true, completedAt: serverTimestamp() });
    }
  });
  invalidate('albums', 'artists', 'results');
  return albumRef.id;
}

export async function updateAlbum(id, patch) {
  await updateDoc(doc(db, 'albums', id), patch);
  invalidate('albums');
}

// Troca o artista principal de um álbum, criando o artista se preciso.
export async function changeAlbumArtist(albumId, artistName) {
  const key = artistKey(artistName);
  const previous = (await getAlbum(albumId))?.artistId;
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'artists', key);
    const snap = await tx.get(ref);
    if (!snap.exists()) tx.set(ref, { name: artistName.trim(), musicbrainzId: null, createdAt: serverTimestamp() });
    tx.update(doc(db, 'albums', albumId), { artistId: key });
  });
  if (previous && previous !== key) await deleteArtistIfEmpty(previous);
}

async function deleteArtistIfEmpty(id) {
  const others = await getDocs(query(collection(db, 'albums'), where('artistId', '==', id)));
  if (others.empty) await deleteDoc(doc(db, 'artists', id)).catch(() => {});
}

// Apaga álbum com avaliações, progresso e resultado. O artista sai junto se ficar sem álbuns.
export async function deleteAlbum(id) {
  const album = await getAlbum(id);
  const [ratings, progress] = await Promise.all([
    getDocs(collection(db, 'albums', id, 'ratings')),
    getDocs(collection(db, 'albums', id, 'progress')),
  ]);
  const batch = writeBatch(db);
  ratings.docs.forEach((d) => batch.delete(d.ref));
  progress.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'results', id));
  batch.delete(doc(db, 'albums', id));
  await batch.commit();
  if (album?.artistId) await deleteArtistIfEmpty(album.artistId);
}

/* Progresso e resultados */

// Mapa albumId -> { uid: status } de todos os álbuns numa consulta só.
export async function listAllProgress() {
  const snap = await getDocs(collectionGroup(db, 'progress'));
  const out = {};
  for (const d of snap.docs) {
    const albumId = d.ref.parent.parent.id;
    (out[albumId] ??= {})[d.id] = d.data().status;
  }
  return out;
}

export async function getProgress(albumId) {
  const snap = await getDocs(collection(db, 'albums', albumId, 'progress'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().status]));
}

export async function listResults() {
  const list = await listOf(collection(db, 'results'));
  return Object.fromEntries(list.map((r) => [r.id, r]));
}

export async function getResult(albumId) {
  return fromSnap(await getDoc(doc(db, 'results', albumId)));
}

export async function updateRetroResult(albumId, patch) {
  await updateDoc(doc(db, 'results', albumId), patch);
  invalidate('results');
}

/* Avaliações */

export async function getRating(albumId, uid) {
  try {
    return fromSnap(await getDoc(doc(db, 'albums', albumId, 'ratings', uid)));
  } catch (err) {
    if (isPermissionError(err)) return null;
    throw err;
  }
}

// Lê as avaliações que as regras deixam ver. As bloqueadas voltam como null.
export async function getRatings(albumId, uids) {
  const list = await Promise.all(uids.map((u) => getRating(albumId, u)));
  return Object.fromEntries(uids.map((u, i) => [u, list[i]]));
}

export async function createRating(albumId, uid, scale) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'albums', albumId, 'ratings', uid), {
    scale,
    trackScores: {},
    albumScore: null,
    status: 'draft',
    personalFinal: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    finalizedAt: null,
    adminEdited: false,
  });
  batch.set(doc(db, 'albums', albumId, 'progress', uid), { status: 'draft', updatedAt: serverTimestamp() });
  await batch.commit();
}

// Não espera o servidor: com cache offline a promessa só resolve quando sincroniza.
export function saveDraft(albumId, uid, { scale, trackScores, albumScore }) {
  return updateDoc(doc(db, 'albums', albumId, 'ratings', uid), {
    scale, trackScores, albumScore, updatedAt: serverTimestamp(),
  });
}

export async function finalizeRating(album, uid, rating) {
  if (!isOnline()) throw new Error('Sem conexão. Conecte-se à internet para enviar a avaliação definitiva.');
  const pf = personalFinal(rating, album.tracks);
  if (pf == null) throw new Error('Preencha todas as faixas e a nota do álbum antes de enviar.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums', album.id, 'ratings', uid), {
    scale: rating.scale,
    trackScores: rating.trackScores,
    albumScore: rating.albumScore,
    status: 'final',
    personalFinal: pf,
    finalizedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'albums', album.id, 'progress', uid), { status: 'final', updatedAt: serverTimestamp() });
  await batch.commit();
  // As regras só deixam ler as notas dos outros depois de finalizar, então o resultado vem num segundo passo.
  await ensureResult(album).catch(() => {});
}

// Cria o resultado se todos já finalizaram e ele ainda não existe.
export async function ensureResult(album, progress) {
  if (album.retro) return null;
  const uids = await getMemberUids();
  if (uids.length === 0) return null;
  const prog = progress || (await getProgress(album.id));
  if (!uids.every((u) => prog[u] === 'final')) return null;
  const existing = await getResult(album.id);
  if (existing) return existing;
  const ratings = await getRatings(album.id, uids);
  const result = buildResult(album.tracks, ratings, uids);
  if (!result) return null;
  await setDoc(doc(db, 'results', album.id), { ...result, completedAt: serverTimestamp() });
  invalidate('results');
  return result;
}

/* Admin */

// Recalcula personalFinal das finalizadas e reescreve o resultado de um álbum.
async function recalcAlbum(album, uids, batch) {
  if (album.retro) return false;
  const ratings = await getRatings(album.id, uids);
  const existing = await getResult(album.id);
  const updated = {};
  for (const uid of uids) {
    const r = ratings[uid];
    if (!r) continue;
    if (r.status === 'final') {
      const pf = personalFinal(r, album.tracks);
      updated[uid] = { ...r, personalFinal: pf };
      if (pf !== r.personalFinal) batch.update(doc(db, 'albums', album.id, 'ratings', uid), { personalFinal: pf });
    } else {
      updated[uid] = r;
    }
  }
  const result = buildResult(album.tracks, updated, uids);
  if (result) {
    batch.set(doc(db, 'results', album.id), {
      ...result,
      completedAt: existing?.completedAt || serverTimestamp(),
    });
  } else if (existing) {
    batch.delete(doc(db, 'results', album.id));
  }
  return true;
}

export async function recalcAllResults(onProgress) {
  const uids = await getMemberUids();
  invalidate('albums');
  const albums = await listAlbums();
  let done = 0;
  for (const album of albums) {
    const batch = writeBatch(db);
    if (await recalcAlbum(album, uids, batch)) await batch.commit();
    onProgress?.(++done, albums.length);
  }
  invalidate('results');
}

// Muda a tracklist. Se já houver avaliações, recalcula finalizadas e o resultado.
export async function updateTracks(album, tracks) {
  if (countedTracks(tracks).length === 0) throw new Error('O álbum precisa ter pelo menos uma faixa que conta.');
  const uids = await getMemberUids();
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums', album.id), { tracks });
  await recalcAlbum({ ...album, tracks }, uids, batch);
  await batch.commit();
  invalidate('albums', 'results');
}

export async function adminSaveRating(album, uid, rating) {
  const uids = await getMemberUids();
  const current = await getRating(album.id, uid);
  const isFinal = current?.status === 'final';
  const pf = isFinal ? personalFinal(rating, album.tracks) : null;
  if (isFinal && pf == null) throw new Error('A avaliação finalizada precisa ter todas as notas.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums', album.id, 'ratings', uid), {
    scale: rating.scale,
    trackScores: rating.trackScores,
    albumScore: rating.albumScore,
    personalFinal: pf,
    adminEdited: true,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  if (isFinal) {
    const b2 = writeBatch(db);
    await recalcAlbum(album, uids, b2);
    await b2.commit();
  }
  invalidate('results');
}

export async function reopenRating(albumId, uid) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums', albumId, 'ratings', uid), {
    status: 'draft', personalFinal: null, finalizedAt: null, updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'albums', albumId, 'progress', uid), { status: 'draft', updatedAt: serverTimestamp() });
  batch.delete(doc(db, 'results', albumId));
  await batch.commit();
  invalidate('results');
}

export async function deleteRating(albumId, uid) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'albums', albumId, 'ratings', uid));
  batch.delete(doc(db, 'albums', albumId, 'progress', uid));
  batch.delete(doc(db, 'results', albumId));
  await batch.commit();
  invalidate('results');
}

// Dump completo para o backup do admin, inclusive rascunhos.
export async function fullBackup() {
  invalidate();
  const [users, members, tags, artists, albums, results] = await Promise.all([
    listUsers(), getMemberUids(), listTags(), listArtists(), listAlbums(), listResults(),
  ]);
  const ratings = {};
  const progress = {};
  for (const a of albums) {
    const [r, p] = await Promise.all([
      getDocs(collection(db, 'albums', a.id, 'ratings')),
      getDocs(collection(db, 'albums', a.id, 'progress')),
    ]);
    ratings[a.id] = Object.fromEntries(r.docs.map((d) => [d.id, plain(d.data())]));
    progress[a.id] = Object.fromEntries(p.docs.map((d) => [d.id, plain(d.data())]));
  }
  return { exportedAt: new Date(), config: { members }, users, tags, artists, albums, results, ratings, progress };
}

// Avaliações finalizadas de todos, para o export completo.
export async function ratingsForExport(albums, uids) {
  const out = {};
  for (const a of albums) {
    if (a.retro) continue;
    const r = await getRatings(a.id, uids);
    out[a.id] = Object.fromEntries(Object.entries(r).filter(([, v]) => v && v.status === 'final'));
  }
  return out;
}
