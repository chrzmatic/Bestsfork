import { h, toast } from '../ui.js';
import { login, resetPassword, authMessage } from '../auth.js';

export function render(root) {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'error-text', role: 'alert' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Entrar');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Entrando…';
      try {
        await login(email.value, password.value);
      } catch (err) {
        error.textContent = authMessage(err);
        submit.disabled = false;
        submit.textContent = 'Entrar';
      }
    },
  },
    h('label', { class: 'field' }, h('span', null, 'E-mail'), email),
    h('label', { class: 'field' }, h('span', null, 'Senha'), password),
    error,
    h('div', { style: 'margin-top: 8px' }, submit),
  );

  const forgot = h('button', {
    class: 'btn ghost block',
    type: 'button',
    style: 'margin-top: 10px',
    onclick: async () => {
      error.textContent = '';
      if (!email.value.trim()) {
        error.textContent = 'Digite seu e-mail acima para receber o link de redefinição.';
        email.focus();
        return;
      }
      forgot.disabled = true;
      try {
        await resetPassword(email.value);
        toast('Enviamos um e-mail com o link para criar uma nova senha.');
      } catch (err) {
        error.textContent = authMessage(err);
      } finally {
        forgot.disabled = false;
      }
    },
  }, 'Esqueci minha senha');

  root.append(h('div', { class: 'login' },
    h('div', { class: 'brand' }, h('div', { class: 'sticker' }, 'B'), h('h1', null, 'Bestsfork')),
    form,
    forgot,
  ));
}
