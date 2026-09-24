import {
  doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, collection, collectionGroup, query, where,
  setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp,
  arrayRemove,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { artistKey, resolveArtist } from './artists.js';
import { personalFinal, buildResult, countedTracks, picksComplete } from './scoring.js';
import { SYSTEM_TAG_DEFAULTS, isSystemTag } from './periods.js';
import { genreKey } from './genres.js';
import { findArtistPhoto } from './artist-images.js';
import { isExpired } from './stats.js';

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

// Cria as tags de período que faltarem, com os ids fixos.
export async function ensureDefaultTags() {
  const existing = await listTags();
  const ids = new Set(existing.map((t) => t.id));
  const missing = Object.entries(SYSTEM_TAG_DEFAULTS).filter(([id]) => !ids.has(id));
  if (missing.length === 0) return;
  const batch = writeBatch(db);
  for (const [id, t] of missing) {
    batch.set(doc(db, 'tags', id), { ...t, createdAt: serverTimestamp() });
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
    await setDoc(ref, { ...data, showOnCards: true, createdAt: serverTimestamp() });
  }
  invalidate('tags');
}

export async function setTagVisibility(id, showOnCards) {
  await updateDoc(doc(db, 'tags', id), { showOnCards });
  invalidate('tags');
}

/* Exibição */

export function getDisplay() {
  return cached('display', async () => fromSnap(await getDoc(doc(db, 'config', 'display'))) || {});
}

export async function setDisplay(patch) {
  await setDoc(doc(db, 'config', 'display'), patch, { merge: true });
  invalidate('display');
}

// Apaga a tag e tira ela dos álbuns que a usam. As de período não podem ser apagadas.
export async function deleteTag(id) {
  if (isSystemTag(id)) throw new Error('As tags de período podem ser renomeadas, mas não apagadas.');
  const albums = await listOf(query(collection(db, 'albums'), where('tags', 'array-contains', id)));
  const batch = writeBatch(db);
  for (const a of albums) batch.update(doc(db, 'albums', a.id), { tags: arrayRemove(id) });
  batch.delete(doc(db, 'tags', id));
  await batch.commit();
  invalidate('tags', 'albums');
}

/* Gêneros */

export function listGenres() {
  return cached('genres', async () => {
    const list = await listOf(collection(db, 'genres'));
    return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
}

// Id de um gênero pelo nome, reaproveitando um existente com a mesma chave.
async function genreIdFor(name) {
  const key = genreKey(name || '');
  if (!key) return null;
  const genres = await listGenres();
  return (genres.find((g) => g.id === key || genreKey(g.name) === key) || { id: key }).id;
}

// Garante que o gênero existe e devolve o id.
export async function ensureGenre(name) {
  const id = await genreIdFor(name);
  if (!id) return null;
  const ref = doc(db, 'genres', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { name: name.trim(), createdAt: serverTimestamp() });
    invalidate('genres');
  }
  return id;
}

export async function renameGenre(id, name) {
  await updateDoc(doc(db, 'genres', id), { name: name.trim() });
  invalidate('genres');
}

// Move os álbuns de um gênero para outro e apaga o de origem.
export async function mergeGenres(fromId, toId) {
  if (fromId === toId) return;
  const albums = await listOf(query(collection(db, 'albums'), where('genreId', '==', fromId)));
  const batch = writeBatch(db);
  for (const a of albums) batch.update(doc(db, 'albums', a.id), { genreId: toId });
  batch.delete(doc(db, 'genres', fromId));
  await batch.commit();
  invalidate('genres');
}

// Apaga o gênero; os álbuns dele ficam sem gênero.
export async function deleteGenre(id) {
  const albums = await listOf(query(collection(db, 'albums'), where('genreId', '==', id)));
  const batch = writeBatch(db);
  for (const a of albums) batch.update(doc(db, 'albums', a.id), { genreId: null });
  batch.delete(doc(db, 'genres', id));
  await batch.commit();
  invalidate('genres');
}

export async function setAlbumGenre(albumId, name) {
  const genreId = name ? await ensureGenre(name) : null;
  await updateDoc(doc(db, 'albums', albumId), { genreId });
}

/* Imagens escolhidas pelo admin */

export async function getMedia(id) {
  return fromSnap(await getDoc(doc(db, 'media', id)));
}

// A miniatura fica no documento (listas), a cheia em media/ (só a página abre).
async function setCustomImage(collectionName, prefix, id, field, { thumb, full }) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'media', `${prefix}-${id}`), { data: full, updatedAt: serverTimestamp() });
  batch.update(doc(db, collectionName, id), { [field]: thumb });
  await batch.commit();
}

async function clearCustomImage(collectionName, prefix, id, field) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'media', `${prefix}-${id}`));
  batch.update(doc(db, collectionName, id), { [field]: null });
  await batch.commit();
}

export const setAlbumCustomCover = (id, images) => setCustomImage('albums', 'album', id, 'customCover', images);
export const clearAlbumCustomCover = (id) => clearCustomImage('albums', 'album', id, 'customCover');
export const setArtistCustomPhoto = (id, images) => setCustomImage('artists', 'artist', id, 'customPhoto', images);
export const clearArtistCustomPhoto = (id) => clearCustomImage('artists', 'artist', id, 'customPhoto');

/* Fotos automáticas dos artistas */

// Busca a foto de um artista que ainda não tem. `force` tenta de novo quem já foi buscado.
export async function ensureArtistPhoto(artistId, { force = false } = {}) {
  const artist = await getArtist(artistId);
  if (!artist || artist.customPhoto) return artist;
  if (!force && (artist.photoUrl || artist.photoCheckedAt)) return artist;
  const found = await findArtistPhoto({ musicbrainzId: artist.musicbrainzId || null, name: artist.name });
  const patch = {
    photoUrl: found?.url || null,
    photoThumbUrl: found?.thumbUrl || found?.url || null,
    photoSource: found?.source || null,
    photoCheckedAt: serverTimestamp(),
  };
  await updateDoc(doc(db, 'artists', artistId), patch);
  return { ...artist, ...patch };
}

// Botão do admin: tenta de novo os artistas sem foto automática nem manual.
export async function fetchMissingArtistPhotos(onProgress) {
  const artists = (await listArtists()).filter((a) => !a.photoUrl && !a.customPhoto);
  let found = 0;
  for (let i = 0; i < artists.length; i++) {
    const updated = await ensureArtistPhoto(artists[i].id, { force: true }).catch(() => null);
    if (updated?.photoUrl) found++;
    onProgress?.(i + 1, artists.length, found);
  }
  return { total: artists.length, found };
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
  await deleteDoc(doc(db, 'media', `artist-${id}`)).catch(() => {});
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
export async function createAlbum({ album, artistName, artistMbid, result, genreName }, uid) {
  const key = artistKey(artistName);
  const genreId = await genreIdFor(genreName);
  const candidates = [];
  if (artistMbid) {
    const byMbid = await listOf(query(collection(db, 'artists'), where('musicbrainzId', '==', artistMbid)));
    candidates.push(...byMbid);
  }
  const albumRef = doc(collection(db, 'albums'));

  let artistId = key;
  await runTransaction(db, async (tx) => {
    const byKey = await tx.get(doc(db, 'artists', key));
    const genreSnap = genreId ? await tx.get(doc(db, 'genres', genreId)) : null;
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
    if (genreSnap && !genreSnap.exists()) {
      tx.set(doc(db, 'genres', genreId), { name: genreName.trim(), createdAt: serverTimestamp() });
    }
    artistId = resolved.id;
    tx.set(albumRef, {
      ...album,
      genreId: genreId ?? album.genreId ?? null,
      artistId: resolved.id,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    if (result) {
      tx.set(doc(db, 'results', albumRef.id), { ...result, retro: true, completedAt: serverTimestamp() });
    }
  });
  invalidate('albums', 'artists', 'results', 'genres');
  return { id: albumRef.id, artistId };
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
  if (!others.empty) return;
  await deleteDoc(doc(db, 'artists', id)).catch(() => {});
  await deleteDoc(doc(db, 'media', `artist-${id}`)).catch(() => {});
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
  batch.delete(doc(db, 'media', `album-${id}`));
  batch.delete(doc(db, 'albums', id));
  await batch.commit();
  if (album?.artistId) await deleteArtistIfEmpty(album.artistId);
}

// Apaga uma avaliação vencida só depois de conferir no servidor, e não no cache do aparelho,
// que ela continua sem resultado e sem todos terem enviado.
export async function deleteExpiredAlbum(id) {
  if (!isOnline()) return false;
  const [albumSnap, resultSnap, progressSnap] = await Promise.all([
    getDocFromServer(doc(db, 'albums', id)),
    getDocFromServer(doc(db, 'results', id)),
    getDocsFromServer(collection(db, 'albums', id, 'progress')),
  ]);
  const album = fromSnap(albumSnap);
  if (!album || !isExpired(album, fromSnap(resultSnap))) return false;
  const uids = await getMemberUids();
  const prog = Object.fromEntries(progressSnap.docs.map((d) => [d.id, d.data().status]));
  if (uids.length && uids.every((u) => prog[u] === 'final')) return false;
  await deleteAlbum(id);
  invalidate('albums');
  return true;
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
    favorites: [],
    leastFavorite: null,
    comment: '',
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
// As escolhas de faixas e o comentário só vão quando vêm junto (a normalização não mexe neles).
export function saveDraft(albumId, uid, { scale, trackScores, albumScore, favorites, leastFavorite, comment }) {
  const patch = { scale, trackScores, albumScore, updatedAt: serverTimestamp() };
  if (favorites !== undefined) patch.favorites = favorites;
  if (leastFavorite !== undefined) patch.leastFavorite = leastFavorite;
  if (comment !== undefined) patch.comment = comment;
  return updateDoc(doc(db, 'albums', albumId, 'ratings', uid), patch);
}

export async function finalizeRating(album, uid, rating) {
  if (!isOnline()) throw new Error('Sem conexão. Conecte-se à internet para enviar a avaliação definitiva.');
  const pf = personalFinal(rating, album.tracks);
  if (pf == null) throw new Error('Preencha todas as faixas e a nota do álbum antes de enviar.');
  if (!picksComplete(rating, album.tracks)) throw new Error('Escolha as faixas favoritas e a menos favorita antes de enviar.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums', album.id, 'ratings', uid), {
    scale: rating.scale,
    trackScores: rating.trackScores,
    albumScore: rating.albumScore,
    favorites: rating.favorites,
    leastFavorite: rating.leastFavorite,
    comment: rating.comment || '',
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
  const [users, members, tags, artists, albums, results, genres, display, media] = await Promise.all([
    listUsers(), getMemberUids(), listTags(), listArtists(), listAlbums(), listResults(), listGenres(), getDisplay(),
    listOf(collection(db, 'media')),
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
  return { exportedAt: new Date(), config: { members, display }, users, tags, genres, artists, albums, results, ratings, progress, media };
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
