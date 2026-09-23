import { h, screenHead, avatar, userName, toast, sheet, withBusy, switchField, confirmDialog } from '../ui.js';
import * as db from '../db.js';
import { changePassword, logout, authMessage, currentUser } from '../auth.js';
import { photoToDataUrl } from '../photo.js';
import { session, getPref, setPref, applyTheme } from '../state.js';

export async function render(root) {
  const user = session.user;
  const avatarBox = h('div');
  const drawAvatar = () => avatarBox.replaceChildren(avatar(session.user, 'lg'));
  drawAvatar();

  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display: none' });
  const photoBtn = h('button', { class: 'btn small secondary', onclick: () => fileInput.click() }, 'Trocar foto');
  const removeBtn = h('button', {
    class: 'btn small ghost', hidden: !user.photo,
    onclick: () => withBusy(removeBtn, async () => {
      await db.updateProfile(session.uid, { photo: null });
      session.user = { ...session.user, photo: null };
      drawAvatar();
      removeBtn.hidden = true;
      toast('Foto removida');
    }),
  }, 'Remover foto');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    await withBusy(photoBtn, async () => {
      const photo = await photoToDataUrl(file);
      await db.updateProfile(session.uid, { photo });
      session.user = { ...session.user, photo };
      drawAvatar();
      removeBtn.hidden = false;
      toast('Foto atualizada');
    });
  });

  const nameInput = h('input', { class: 'input', value: userName(user), maxlength: '40', autocomplete: 'nickname' });
  const nameBtn = h('button', { class: 'btn small', type: 'submit' }, 'Salvar');
  const nameForm = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const displayName = nameInput.value.trim();
      if (!displayName) { toast('O nome não pode ficar vazio.', { error: true }); return; }
      withBusy(nameBtn, async () => {
        await db.updateProfile(session.uid, { displayName });
        session.user = { ...session.user, displayName };
        drawAvatar();
        toast('Nome salvo');
      });
    },
  }, h('label', { class: 'field', style: 'margin: 0' }, h('span', null, 'Nome de exibição'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, nameInput), nameBtn)));

  const segmented = (label, options, current, onpick) => {
    const buttons = options.map(([value, text]) => h('button', {
      'aria-pressed': String(current === value),
      onclick: () => {
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === value)));
        onpick(value);
      },
    }, text));
    return h('div', { class: 'row', style: 'justify-content: space-between; min-height: 50px; flex-wrap: wrap' },
      h('span', null, label), h('div', { class: 'segmented', role: 'group', 'aria-label': label }, buttons));
  };

  const prefs = h('div', { class: 'panel' },
    h('h2', null, 'Preferências'),
    segmented('Escala padrão', [[5, '0 a 5'], [10, '0 a 10']], getPref('scale', 5), (v) => setPref('scale', v)),
    h('p', { class: 'hint', style: 'margin-bottom: 8px' }, 'Vale para as próximas avaliações que você começar.'),
    segmented('Tema', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']], getPref('theme', 'system'), (v) => {
      setPref('theme', v);
      applyTheme(v);
    }),
  );

  const adminLink = h('a', { class: 'btn block secondary', href: '#/admin', hidden: !session.adminMode, style: 'margin-top: 10px' }, 'Tags, recálculo e backup');
  const adminPanel = session.isAdmin && h('div', { class: 'panel' },
    h('h2', null, 'Admin'),
    switchField('Modo admin', session.adminMode, (on) => {
      session.adminMode = on;
      setPref('adminMode', on);
      adminLink.hidden = !on;
      toast(on ? 'Modo admin ligado. Você vê as notas de todos.' : 'Modo admin desligado');
    }),
    h('p', { class: 'hint' }, 'Com o modo ligado você edita e apaga álbuns, vê e ajusta avaliações de todos e cria registros retroativos.'),
    adminLink,
  );

  const logoutBtn = h('button', {
    class: 'btn block secondary',
    onclick: async () => {
      if (!(await confirmDialog({ title: 'Sair da conta?', body: 'Para entrar de novo você vai precisar do e-mail e da senha.', confirmLabel: 'Sair' }))) return;
      db.invalidate();
      history.replaceState(null, '', '#/albums');
      await logout();
    },
  }, 'Sair');

  root.append(
    screenHead('Perfil'),
    h('div', { class: 'profile-head' }, avatarBox, h('div', { class: 'btn-row', style: 'justify-content: center' }, photoBtn, removeBtn), fileInput),
    h('div', { class: 'panel' }, nameForm),
    prefs,
    h('div', { class: 'panel' },
      h('h2', null, 'Conta'),
      h('p', { class: 'muted small', style: 'margin-bottom: 12px' }, currentUser()?.email || ''),
      h('button', { class: 'btn block secondary', onclick: openPasswordSheet }, 'Trocar senha')),
    adminPanel,
    logoutBtn,
  );
}

function openPasswordSheet() {
  return sheet((close) => {
    const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
    const again = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
    const error = h('p', { class: 'error-text', role: 'alert' });
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'Trocar senha');
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        if (next.value.length < 6) { error.textContent = 'A nova senha precisa ter pelo menos 6 caracteres.'; return; }
        if (next.value !== again.value) { error.textContent = 'As duas senhas novas não são iguais.'; return; }
        submit.disabled = true;
        try {
          await changePassword(current.value, next.value);
          toast('Senha trocada');
          close(true);
        } catch (err) {
          error.textContent = authMessage(err);
          submit.disabled = false;
        }
      },
    },
      h('h2', null, 'Trocar senha'),
      h('label', { class: 'field' }, h('span', null, 'Senha atual'), current),
      h('label', { class: 'field' }, h('span', null, 'Nova senha'), next),
      h('label', { class: 'field' }, h('span', null, 'Repita a nova senha'), again),
      error,
      h('div', { class: 'actions' }, submit, h('button', { class: 'btn block secondary', type: 'button', onclick: () => close(false) }, 'Cancelar')),
    );
  });
}
