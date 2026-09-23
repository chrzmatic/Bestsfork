// Testes das regras do Firestore. Precisam do emulador: npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collectionGroup, getDocs, collection,
} from 'firebase/firestore';

const [A, B, C] = ['alice', 'bruno', 'carla'];
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bestsfork',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/members'), { uids: [A, B, C] });
    await setDoc(doc(db, 'users', A), { name: 'Alice', admin: true, displayName: 'Alice', photo: null });
    await setDoc(doc(db, 'users', B), { name: 'Bruno', admin: false, displayName: 'Bruno', photo: null });
    await setDoc(doc(db, 'users', C), { name: 'Carla', admin: false, displayName: 'Carla', photo: null });
    await setDoc(doc(db, 'albums/al1'), { title: 'Disco', tracks: [{ id: 't1' }], retro: false });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const draft = { scale: 5, trackScores: {}, albumScore: null, status: 'draft', personalFinal: null };

async function seedRating(uid, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'albums/al1/ratings', uid), data);
    await setDoc(doc(db, 'albums/al1/progress', uid), { status: data.status });
  });
}

test('quem não é membro não lê nada', async () => {
  const stranger = env.authenticatedContext('zeca').firestore();
  await assertFails(getDoc(doc(stranger, 'albums/al1')));
  await assertFails(getDoc(doc(stranger, 'config/members')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', A)));
});

test('membro lê usuários, config e álbuns', async () => {
  await assertSucceeds(getDoc(doc(as(B), 'users', A)));
  await assertSucceeds(getDoc(doc(as(B), 'config/members')));
  await assertSucceeds(getDoc(doc(as(B), 'albums/al1')));
});

test('perfil: só o dono edita nome e foto, e nada mais', async () => {
  await assertSucceeds(updateDoc(doc(as(B), 'users', B), { displayName: 'Bruninho', photo: 'data:image/jpeg;base64,xx' }));
  await assertFails(updateDoc(doc(as(B), 'users', B), { admin: true }));
  await assertFails(updateDoc(doc(as(B), 'users', C), { displayName: 'X' }));
  await assertFails(updateDoc(doc(as(B), 'users', B), { photo: 'x'.repeat(280001) }));
  await assertFails(setDoc(doc(as(B), 'users', 'novo'), { name: 'Novo' }));
});

test('só admin escreve álbuns, artistas e tags', async () => {
  await assertSucceeds(setDoc(doc(as(A), 'albums/al2'), { title: 'Outro' }));
  await assertSucceeds(setDoc(doc(as(A), 'artists/madonna'), { name: 'Madonna' }));
  await assertSucceeds(setDoc(doc(as(A), 'tags/x'), { name: 'X' }));
  await assertFails(setDoc(doc(as(B), 'albums/al3'), { title: 'Outro' }));
  await assertFails(setDoc(doc(as(B), 'artists/madonna'), { name: 'Madonna' }));
  await assertFails(setDoc(doc(as(B), 'tags/y'), { name: 'Y' }));
  const db = as(B);
  await assertFails(writeBatch(db).delete(doc(db, 'albums/al1')).commit());
});

test('config nunca é escrita pelo app', async () => {
  await assertFails(setDoc(doc(as(A), 'config/members'), { uids: [] }));
});

test('avaliação: cria só a própria e só como rascunho', async () => {
  await assertSucceeds(setDoc(doc(as(B), 'albums/al1/ratings', B), draft));
  await assertFails(setDoc(doc(as(B), 'albums/al1/ratings', C), draft));
  await assertFails(setDoc(doc(as(C), 'albums/al1/ratings', C), { ...draft, status: 'final' }));
});

test('avaliação: dono edita rascunho, finaliza e depois não edita mais', async () => {
  await seedRating(B, draft);
  await assertSucceeds(updateDoc(doc(as(B), 'albums/al1/ratings', B), { trackScores: { t1: 40 } }));
  const db = as(B);
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums/al1/ratings', B), { status: 'final', personalFinal: 8 });
  batch.update(doc(db, 'albums/al1/progress', B), { status: 'final' });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(as(B), 'albums/al1/ratings', B), { albumScore: 10 }));
  await assertFails(updateDoc(doc(as(B), 'albums/al1/progress', B), { status: 'draft' }));
});

test('às cegas: só lê as notas dos outros depois de finalizar', async () => {
  await seedRating(B, { ...draft, status: 'final', personalFinal: 7 });
  await seedRating(C, draft);
  await assertFails(getDoc(doc(as(C), 'albums/al1/ratings', B)));
  await assertSucceeds(getDoc(doc(as(C), 'albums/al1/ratings', C)));
  await assertSucceeds(getDoc(doc(as(B), 'albums/al1/ratings', C)));
  await assertSucceeds(getDoc(doc(as(C), 'albums/al1/progress', B)));
});

test('admin lê e edita qualquer avaliação, inclusive finalizada', async () => {
  await seedRating(B, { ...draft, status: 'final', personalFinal: 7 });
  await assertSucceeds(getDoc(doc(as(A), 'albums/al1/ratings', B)));
  await assertSucceeds(updateDoc(doc(as(A), 'albums/al1/ratings', B), { personalFinal: 6, adminEdited: true }));
  await assertSucceeds(updateDoc(doc(as(A), 'albums/al1/progress', B), { status: 'draft' }));
  await assertFails(deleteDoc(doc(as(C), 'albums/al1/ratings', B)));
  await assertSucceeds(deleteDoc(doc(as(A), 'albums/al1/ratings', B)));
});

test('membro lê o progresso de todos numa consulta de grupo', async () => {
  await seedRating(B, draft);
  await assertSucceeds(getDocs(collectionGroup(as(C), 'progress')));
  await assertFails(getDocs(collectionGroup(env.authenticatedContext('zeca').firestore(), 'progress')));
});

test('membro comum não lista a subcoleção de avaliações', async () => {
  await seedRating(B, draft);
  await assertFails(getDocs(collection(as(C), 'albums/al1/ratings')));
  await assertSucceeds(getDocs(collection(as(A), 'albums/al1/ratings')));
});

test('resultado: membro grava quando os três finalizaram com as notas certas', async () => {
  await seedRating(A, { ...draft, status: 'final', personalFinal: 8 });
  await seedRating(B, { ...draft, status: 'final', personalFinal: 7 });
  await seedRating(C, { ...draft, status: 'final', personalFinal: 6 });
  const ok = { memberScores: { [A]: 8, [B]: 7, [C]: 6 }, groupScore: 7, trackAvgs: {}, retro: false };
  await assertFails(setDoc(doc(as(C), 'results/al1'), { ...ok, memberScores: { ...ok.memberScores, [C]: 9 } }));
  await assertFails(setDoc(doc(as(C), 'results/al1'), { ...ok, retro: true }));
  await assertSucceeds(setDoc(doc(as(C), 'results/al1'), ok));
  await assertFails(deleteDoc(doc(as(C), 'results/al1')));
  await assertSucceeds(deleteDoc(doc(as(A), 'results/al1')));
});

test('resultado: membro não grava se alguém ainda está em rascunho', async () => {
  await seedRating(A, { ...draft, status: 'final', personalFinal: 8 });
  await seedRating(B, { ...draft, status: 'final', personalFinal: 7 });
  await seedRating(C, draft);
  await assertFails(setDoc(doc(as(B), 'results/al1'), {
    memberScores: { [A]: 8, [B]: 7, [C]: null }, groupScore: 7, trackAvgs: {}, retro: false,
  }));
});

test('resultado: quem finaliza por último grava no mesmo batch', async () => {
  await seedRating(A, { ...draft, status: 'final', personalFinal: 8 });
  await seedRating(B, { ...draft, status: 'final', personalFinal: 7 });
  await seedRating(C, draft);
  const db = as(C);
  const batch = writeBatch(db);
  batch.update(doc(db, 'albums/al1/ratings', C), { status: 'final', personalFinal: 6 });
  batch.update(doc(db, 'albums/al1/progress', C), { status: 'final' });
  batch.set(doc(db, 'results/al1'), { memberScores: { [A]: 8, [B]: 7, [C]: 6 }, groupScore: 7, trackAvgs: {}, retro: false });
  await assertSucceeds(batch.commit());
});

test('resultado retroativo só pelo admin', async () => {
  await assertSucceeds(setDoc(doc(as(A), 'results/al1'), { memberScores: {}, groupScore: 7.5, trackAvgs: {}, retro: true }));
  await assertFails(setDoc(doc(as(B), 'results/al1'), { memberScores: {}, groupScore: 9, trackAvgs: {}, retro: true }));
});

test('tags de período: admin renomeia e oculta, ninguém apaga', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tags/old-testamento'), { name: 'Old Testamento', showOnCards: true });
    await setDoc(doc(db, 'tags/new-testamento'), { name: 'New Testamento', showOnCards: false });
    await setDoc(doc(db, 'tags/comum'), { name: 'Comum', showOnCards: true });
  });
  await assertSucceeds(updateDoc(doc(as(A), 'tags/old-testamento'), { name: 'Antigo' }));
  await assertSucceeds(updateDoc(doc(as(A), 'tags/new-testamento'), { showOnCards: true }));
  await assertFails(deleteDoc(doc(as(A), 'tags/old-testamento')));
  await assertFails(deleteDoc(doc(as(A), 'tags/new-testamento')));
  await assertSucceeds(deleteDoc(doc(as(A), 'tags/comum')));
});

test('membro não altera showOnCards nem apaga tags', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tags/comum'), { name: 'Comum', showOnCards: true });
  });
  await assertFails(updateDoc(doc(as(B), 'tags/comum'), { showOnCards: false }));
  await assertFails(deleteDoc(doc(as(B), 'tags/comum')));
  await assertSucceeds(getDoc(doc(as(B), 'tags/comum')));
});

test('config/display: admin altera, membro só lê; members continua travado', async () => {
  await assertSucceeds(setDoc(doc(as(A), 'config/display'), { showRetroBadge: true }));
  await assertFails(setDoc(doc(as(B), 'config/display'), { showRetroBadge: false }));
  await assertSucceeds(getDoc(doc(as(B), 'config/display')));
  await assertFails(setDoc(doc(as(A), 'config/members'), { uids: [A] }));
  await assertFails(setDoc(doc(as(A), 'config/outro'), { x: 1 }));
});

test('gêneros: só admin escreve, membros leem', async () => {
  await assertSucceeds(setDoc(doc(as(A), 'genres/pop'), { name: 'Pop' }));
  await assertFails(setDoc(doc(as(B), 'genres/rock'), { name: 'Rock' }));
  await assertSucceeds(getDoc(doc(as(C), 'genres/pop')));
  await assertFails(getDoc(doc(env.authenticatedContext('zeca').firestore(), 'genres/pop')));
  await assertSucceeds(deleteDoc(doc(as(A), 'genres/pop')));
});

test('imagens: só admin grava, com limite de tamanho', async () => {
  await assertSucceeds(setDoc(doc(as(A), 'media/album-al1'), { data: 'data:image/jpeg;base64,xx' }));
  await assertFails(setDoc(doc(as(A), 'media/album-al2'), { data: 'x'.repeat(900001) }));
  await assertFails(setDoc(doc(as(B), 'media/album-al1'), { data: 'data:image/jpeg;base64,yy' }));
  await assertSucceeds(getDoc(doc(as(B), 'media/album-al1')));
  await assertFails(deleteDoc(doc(as(B), 'media/album-al1')));
});
