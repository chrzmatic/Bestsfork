import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth } from './firebase.js';

const MESSAGES = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/user-not-found': 'Não existe conta com esse e-mail.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Digite a senha.',
  'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
  'auth/weak-password': 'A nova senha precisa ter pelo menos 6 caracteres.',
  'auth/requires-recent-login': 'Entre de novo para trocar a senha.',
  'auth/user-disabled': 'Esta conta foi desativada.',
};

export function authMessage(err) {
  return MESSAGES[err?.code] || 'Não foi possível concluir. Tente de novo.';
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export function currentUser() {
  return auth?.currentUser || null;
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  auth.languageCode = 'pt';
  return sendPasswordResetEmail(auth, email.trim());
}

export async function changePassword(current, next) {
  const user = auth.currentUser;
  const cred = EmailAuthProvider.credential(user.email, current);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, next);
}
