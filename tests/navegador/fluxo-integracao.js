// Fluxo completo no Edge contra os emuladores do Firebase: npm run test:navegador
// Cria três contas, um álbum, avalia com os três e confere a nota do grupo.
// Salva capturas de tela em BESTSFORK_SHOTS (ou numa pasta temporária).

import { conectar, lancarEdge, servir } from './cdp.js';

const raiz = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORTA_DEVTOOLS = 9241;
const PROJETO = 'demo-bestsfork';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099';
const pastaFotos = Deno.env.get('BESTSFORK_SHOTS') || (await Deno.makeTempDir({ prefix: 'bestsfork-shots-' }));

const contas = [
  { email: 'matheus@teste.com', nome: 'Matheus', admin: true },
  { email: 'bia@teste.com', nome: 'Bia', admin: false },
  { email: 'caio@teste.com', nome: 'Caio', admin: false },
];
const SENHA = 'senha123';

const falhas = [];
const ok = (nome, cond, detalhe = '') => {
  console.log(`${cond ? '✔' : '✖'} ${nome}${cond ? '' : `  (${detalhe})`}`);
  if (!cond) falhas.push(nome);
};

function campo(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(campo) } };
  return { stringValue: String(v) };
}

async function gravar(caminho, dados) {
  const fields = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, campo(v)]));
  const r = await fetch(`${FS}/${caminho}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`Falha ao gravar ${caminho}: ${await r.text()}`);
}

async function preparar() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJETO}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' });
  for (const c of contas) {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: SENHA, returnSecureToken: true }),
    });
    c.uid = (await r.json()).localId;
    await gravar(`users/${c.uid}`, { name: c.nome, admin: c.admin, displayName: c.nome, photo: null });
  }
  await gravar('config/members', { uids: contas.map((c) => c.uid) });
}

const PRELUDIO = String.raw`
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000, what = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch {}
      await sleep(100);
    }
    throw new Error('Tempo esgotado esperando: ' + what);
  };
  const dialog = () => [...document.querySelectorAll('dialog[open]')].pop();
  const byText = (text, root = document) => [...root.querySelectorAll('button, a')]
    .find((e) => e.textContent.trim() === text && !e.disabled && e.offsetParent !== null);
  const click = async (text, inDialog = false) => {
    const el = await until(() => byText(text, inDialog ? dialog() : document), 15000, text);
    el.click();
    await sleep(200);
  };
  const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const h1 = () => $('h1')?.textContent.trim();
`;

async function main() {
  await preparar();
  const site = servir(raiz);
  const url = `http://127.0.0.1:${site.porta}/?emulador=1#/albums`;
  const edge = await lancarEdge({ url: 'about:blank', porta: PORTA_DEVTOOLS });
  let cdp;
  try {
    cdp = await conectar(PORTA_DEVTOOLS);
    const erros = [];
    cdp.ouvir((m) => {
      if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails?.exception?.description || 'erro');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        erros.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    await cdp.enviar('Runtime.enable');
    await cdp.enviar('Page.enable');
    await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar('Page.navigate', { url });

    const rodar = (corpo) => cdp.avaliar(`(async () => { ${PRELUDIO}\n${corpo} })()`);
    let n = 0;
    // Texto que escapou do código para a tela, como "false" ou "null".
    const lixo = () => cdp.avaliar(`(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const achados = [];
      while (w.nextNode()) {
        const t = w.currentNode.textContent.trim();
        const solto = ['false', 'true', 'null', 'undefined', 'NaN'].some((p) => t.startsWith(p) && t.split(p).join('') === '');
        if (solto || t.includes('[object ') || t.includes('undefined') || t.includes('NaN')) achados.push(t);
      }
      return achados;
    })()`);
    const foto = async (nome, cheia = true) => {
      await new Promise((r) => setTimeout(r, 400));
      const sujeira = await lixo();
      ok(`tela "${nome}" sem texto solto de código`, sujeira.length === 0, sujeira.join(', '));
      const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: cheia });
      await Deno.writeFile(`${pastaFotos}/${String(++n).padStart(2, '0')}-${nome}.png`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    };

    const entrar = async (c) => {
      await rodar(`
        await until(() => $('input[type=email]'), 20000, 'tela de login');
        typeIn($('input[type=email]'), '${c.email}');
        typeIn($('input[type=password]'), '${SENHA}');
        await click('Entrar');
        await until(() => h1() === 'Álbuns', 20000, 'lista de álbuns');
      `);
    };
    const sair = async () => {
      await rodar(`
        location.hash = '#/profile';
        await until(() => h1() === 'Perfil', 10000, 'perfil');
        await click('Sair');
        await click('Sair', true);
        await until(() => $('input[type=email]'), 15000, 'login depois de sair');
      `);
    };

    // Login e lista vazia
    await rodar(`await until(() => $('input[type=email]'), 20000, 'tela de login');`);
    // Recarrega com o service worker já no controle, como acontece na segunda visita.
    await rodar(`await until(() => navigator.serviceWorker.controller, 20000, 'service worker ativo'); return true;`);
    await cdp.enviar('Page.reload', { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 1500));
    const voltou = await rodar(`
      try { await until(() => $('input[type=email]'), 20000, 'login após recarregar'); } catch { return false; }
      return !!navigator.serviceWorker.controller;
    `).catch(() => false);
    ok('app abre de novo com o service worker no controle', voltou);
    await foto('login', false);
    await rodar(`
      typeIn($('input[type=email]'), '${contas[0].email}');
      typeIn($('input[type=password]'), 'errada');
      await click('Entrar');
      await until(() => $('.error-text')?.textContent, 10000, 'erro de senha');
    `);
    ok('senha errada mostra mensagem', await rodar(`return /incorret/.test($('.error-text').textContent)`));
    await entrar(contas[0]);
    await foto('albuns-vazio', false);

    // Busca no MusicBrainz (rede real, uma busca e uma lista de edições)
    const mbOk = await rodar(`
      location.hash = '#/album/new';
      await until(() => h1() === 'Novo álbum', 10000, 'novo álbum');
      typeIn($('input[type=search]'), 'the fame lady gaga');
      await click('Buscar');
      try {
        await until(() => $$('.result-list button').length > 0, 25000, 'resultados do MusicBrainz');
      } catch { return false; }
      return true;
    `);
    ok('busca no MusicBrainz traz resultados', mbOk, 'sem rede ou MusicBrainz fora do ar');
    if (mbOk) {
      await foto('mb-resultados');
      const confirmou = await rodar(`
        $$('.result-list button')[0].click();
        await until(() => $('.option-list') || $('form .edit-track'), 30000, 'edições ou confirmação');
        if ($('.option-list')) $$('.option-list button')[0].click();
        await until(() => $('form .edit-track'), 30000, 'tela de confirmação');
        return $$('form .edit-track').length;
      `);
      ok('confirmação do MusicBrainz traz faixas', confirmou > 5, `faixas: ${confirmou}`);
      await foto('mb-confirmacao');
      await rodar(`
        await click('Salvar álbum');
        await until(() => $('.album-title'), 20000, 'página do álbum do MusicBrainz');
      `);
      await foto('mb-album-salvo', false);
    }

    // Álbum manual com uma faixa que não conta
    await rodar(`
      location.hash = '#/album/new';
      await until(() => h1() === 'Novo álbum', 10000, 'novo álbum');
      await click('Preencher à mão');
      await until(() => $('textarea'), 10000, 'formulário manual');
      const inputs = $$('form input.input');
      typeIn(inputs[0], 'Disco de Teste');
      typeIn(inputs[1], 'Beyoncé');
      typeIn(inputs[3], '2016');
      typeIn($('textarea'), ['Intro', 'Primeira', 'Segunda', 'Terceira'].join(String.fromCharCode(10)));
      await click('Usar estas faixas');
      await until(() => $$('.edit-track').length === 4, 5000, 'faixas no editor');
      const sw = $$('.edit-track input[type=checkbox]')[0];
      sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await foto('manual-confirmacao');
    await rodar(`
      await click('Salvar álbum');
      await until(() => $('.album-title h1')?.textContent === 'Disco de Teste', 20000, 'álbum manual salvo');
    `);
    const albumHash = await rodar(`return location.hash`);
    ok('álbum manual abre com "Começar avaliação"', await rodar(`return !!byText('Começar avaliação')`));

    // Avaliação de cada um. Faixas que contam: Primeira, Segunda, Terceira.
    const avaliar = async (notas, album, escala10 = false, normalizar = false) => {
      await rodar(`
        location.hash = '${albumHash}';
        await until(() => byText('Começar avaliação'), 15000, 'começar');
        ${'' /* às cegas: antes de começar não pode haver notas de ninguém */}
        window.__cego = !$('.cols-head');
        await click('Começar avaliação');
        await until(() => $$('.score-input').length === 4, 15000, 'campos de nota');
        ${escala10 ? `await click('0 a 10'); await until(() => $('.album-score-row .hint')?.textContent.includes('0 a 10'), 10000, 'escala 10');` : ''}
        const campos = $$('.track .score-input');
        ${JSON.stringify(notas)}.forEach((v, i) => typeIn(campos[i], v));
        typeIn($('.album-score-row .score-input'), '${album}');
        await until(() => $('.save-state')?.textContent === 'Rascunho salvo', 10000, 'rascunho salvo');
      `);
      if (normalizar) {
        await foto('rascunho-preenchido');
        const r = await rodar(`
          await click('Normalizar notas');
          await until(() => h1() === 'Normalizar notas', 10000, 'normalizar');
          for (let i = 0; i < 20 && $('.duel-btn'); i++) { $$('.duel-btn')[0].click(); await sleep(120); }
          await until(() => !$('.duel-btn'), 5000, 'fim das comparações');
          return $('.change-row') ? 'sugestoes' : ($('.empty h2')?.textContent || '?');
        `);
        ok('normalização termina com sugestões ou confirmação', r === 'sugestoes' || r === 'Tudo certo', r);
        await foto('normalizacao-fim');
        await rodar(`
          location.hash = '${albumHash}';
          await until(() => $$('.score-input').length === 4, 15000, 'volta ao rascunho');
        `);
      }
      await rodar(`
        await until(() => byText('Enviar definitivo'), 10000, 'botão enviar habilitado');
        await click('Enviar definitivo');
        await until(() => dialog()?.textContent.includes('Enviar definitivo?'), 5000, 'primeira confirmação');
        await click('Enviar definitivo', true);
        await until(() => dialog()?.textContent.includes('Tem certeza?'), 5000, 'segunda confirmação');
        await click('Sim, enviar', true);
        await until(() => $('.cols-head'), 20000, 'avaliação finalizada');
      `);
      return rodar(`return window.__cego`);
    };

    ok('Matheus não via notas antes de avaliar', await avaliar(['4,5', '3.8', '4'], '4'));
    await foto('matheus-finalizado');
    await sair();

    await entrar(contas[1]);
    await foto('lista-bia');
    ok('lista mostra quem já finalizou', await rodar(`return $$('.album-item .avatars .avatar').length >= 1`));
    ok('Bia não via notas antes de avaliar', await avaliar(['9', '7,5', '8'], '8', true, true));
    ok('Bia vê as notas de Matheus depois de finalizar', await rodar(`return $$('.cols-head .avatar').length === 2`));
    await sair();

    await entrar(contas[2]);
    ok('Caio não via notas antes de avaliar', await avaliar(['3', '3,5', '5'], '3'));
    await rodar(`await until(() => $('.album-hero .sticker.big:not(.pending)'), 20000, 'nota do grupo');`);
    const nota = await rodar(`return $('.album-hero .sticker.big').textContent`);
    // (4,1+4,0) + (4,0833+4,0) + (3,8333+3,0) = 8,1 + 8,0833 + 6,8333 → média 7,67
    ok('nota do grupo é 7,67', nota === '7,67', nota);
    await foto('album-concluido');
    await foto('album-concluido-topo', false);

    await rodar(`location.hash = '#/albums'; await until(() => h1() === 'Álbuns' && $('.album-item'), 10000, 'lista');`);
    ok('lista mostra o adesivo com a nota', await rodar(`return $$('.album-item .sticker:not(.pending)').some((s) => s.textContent === '7,67')`));
    await foto('lista-concluida', false);
    await rodar(`location.hash = '#/stats'; await until(() => $('.totals'), 10000, 'estatísticas');`);
    ok('estatísticas contam 1 concluído', await rodar(`return $('.totals strong').textContent === '1'`));
    await foto('estatisticas');
    await rodar(`location.hash = '#/artists'; await until(() => h1() === 'Artistas', 10000, 'artistas');`);
    await foto('artistas', false);
    await rodar(`
      location.hash = '#/profile';
      await until(() => h1() === 'Perfil', 10000, 'perfil');
      await click('Escuro');
    `);
    await foto('perfil-escuro');
    await rodar(`location.hash = '${albumHash}'; await until(() => $('.cols-head'), 10000, 'álbum');`);
    await foto('album-escuro', false);
    await rodar(`location.hash = '#/profile'; await until(() => h1() === 'Perfil', 10000, 'perfil'); await click('Sistema');`);
    await sair();

    // Admin: modo admin, registro retroativo com tag automática e recálculo
    await entrar(contas[0]);
    await rodar(`
      location.hash = '#/profile';
      await until(() => h1() === 'Perfil', 10000, 'perfil');
      const sw = [...document.querySelectorAll('.switch')].find((l) => l.textContent.includes('Modo admin')).querySelector('input');
      sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true }));
      location.hash = '#/album/new';
      await until(() => h1() === 'Novo álbum', 10000, 'novo álbum');
      const r = [...document.querySelectorAll('.switch')].find((l) => l.textContent.includes('retroativo')).querySelector('input');
      r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
      await click('Preencher à mão');
      await until(() => $('.panel h2')?.textContent === 'Registro retroativo', 10000, 'formulário retroativo');
      const inputs = $$('form input.input');
      typeIn(inputs[0], 'Álbum Antigo');
      typeIn(inputs[1], 'Madonna');
      typeIn(inputs[3], '1998');
    `);
    const tagMarcada = await rodar(`
      const evalYear = [...document.querySelectorAll('.panel label.field')].find((l) => l.textContent.includes('avaliado')).querySelector('input');
      typeIn(evalYear, '2022');
      const groupInput = [...document.querySelectorAll('.panel label.field')].find((l) => l.textContent.includes('Nota do grupo')).querySelector('input');
      typeIn(groupInput, '8,25');
      await sleep(100);
      return [...document.querySelectorAll('.chip[aria-pressed=true]')].map((c) => c.textContent);
    `);
    ok('ano 2022 marca Old Testamento', tagMarcada.includes('Old Testamento'), JSON.stringify(tagMarcada));
    await foto('retroativo-form');
    await rodar(`
      await click('Salvar registro retroativo');
      await until(() => $('.album-title h1')?.textContent === 'Álbum Antigo', 20000, 'retroativo salvo');
    `);
    ok('retroativo mostra 8,25', await rodar(`return $('.album-hero .sticker.big')?.textContent === '8,25'`));
    await foto('retroativo-album', false);
    await rodar(`location.hash = '${albumHash}'; await until(() => $('.panel h2')?.textContent === 'Modo admin', 15000, 'painel admin');`);
    await foto('admin-album');
    const recalc = await rodar(`
      location.hash = '#/admin';
      await until(() => h1() === 'Admin', 10000, 'admin');
      await click('Recalcular resultados');
      await click('Recalcular', true);
      await until(() => $('.hint') && [...document.querySelectorAll('.hint')].some((p) => p.textContent === 'Resultados recalculados.'), 20000, 'recálculo');
      location.hash = '${albumHash}';
      await until(() => $('.album-hero .sticker.big:not(.pending)'), 15000, 'nota após recálculo');
      return $('.album-hero .sticker.big').textContent;
    `);
    ok('recálculo mantém 7,67', recalc === '7,67', recalc);
    await rodar(`location.hash = '#/admin'; await until(() => h1() === 'Admin', 10000, 'admin');`);
    await foto('admin');


    // Ciclo de vida das tags, visualizações, gêneros, capa manual e importação.
    await cdp.enviar('DOM.enable');
    const setFile = async (seletor, caminho) => {
      const { result } = await cdp.enviar('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(seletor)})` });
      await cdp.enviar('DOM.setFileInputFiles', { files: [caminho], objectId: result.objectId });
    };
    const AJUDA = String.raw`
      const card = (t) => $$('.album-item, .album-grid li').find((li) => li.querySelector('h3')?.textContent === t || li.querySelector('a')?.getAttribute('aria-label')?.startsWith(t + ','));
      const badgesOf = (t) => [...(card(t)?.querySelectorAll('.badge') || [])].map((b) => b.textContent);
      const titles = () => $$('.album-item h3, .album-grid h3').map((e) => e.textContent);
      const goAlbums = async (period) => {
        location.hash = '#/albums';
        await until(() => h1() === 'Álbuns' && $('.period-picker'), 10000, 'álbuns');
        const b = $$('.period-picker button')[{ all: 0, new: 1, old: 2 }[period]];
        b.click();
        await sleep(250);
      };
      const tagRow = (name) => $$('.menu li').find((li) => li.querySelector('div > div')?.textContent.startsWith(name));
      const toggleTag = async (name, on) => {
        const input = tagRow(name).querySelector('.switch input');
        if (input.checked === on) return;
        const antes = $('.menu');
        input.checked = on; input.dispatchEvent(new Event('change', { bubbles: true }));
        // A tela de admin se redesenha depois de gravar.
        await until(() => h1() === 'Admin' && $('.menu') && $('.menu') !== antes && tagRow(name)?.querySelector('.switch input').checked === on, 10000, 'tag ' + name);
      };
      const goAdmin = async () => {
        location.hash = '#/profile';
        await until(() => h1() === 'Perfil', 10000, 'perfil');
        location.hash = '#/admin';
        await until(() => h1() === 'Admin' && $$('.menu li').length > 0, 10000, 'admin');
      };
      const editAlbum = async (t) => {
        await goAlbums('all');
        card(t).querySelector('a').click();
        await until(() => $('.album-title h1')?.textContent === t, 10000, 'álbum ' + t);
        location.hash = location.hash + '/edit';
        await until(() => h1() === 'Editar álbum', 10000, 'editar ' + t);
      };
      const toggleChip = (name, on) => {
        const chip = $$('form .chip').find((c) => c.textContent === name);
        if ((chip.getAttribute('aria-pressed') === 'true') !== on) chip.click();
      };
      const saveEdit = async (t) => {
        await click('Salvar alterações');
        await until(() => $('.album-title h1')?.textContent === t, 15000, 'salvou ' + t);
      };
    `;
    const passo = (corpo) => rodar(AJUDA + corpo);

    // Álbum criado pelo fluxo normal: nasce em New, tag oculta no card e visível na página.
    let r = await passo(`
      await goAlbums('new'); const inNew = titles();
      await goAlbums('old'); const inOld = titles();
      await goAlbums('all'); const inAll = titles();
      return { inNew, inOld, inAll, discoBadges: badgesOf('Disco de Teste'), antigoBadges: badgesOf('Álbum Antigo') };
    `);
    ok('álbum normal aparece em New', r.inNew.includes('Disco de Teste') && !r.inNew.includes('Álbum Antigo'), JSON.stringify(r.inNew));
    ok('retroativo de 2022 aparece só em Old', r.inOld.includes('Álbum Antigo') && !r.inOld.includes('Disco de Teste'), JSON.stringify(r.inOld));
    ok('Todos mostra tudo', r.inAll.includes('Disco de Teste') && r.inAll.includes('Álbum Antigo'));
    ok('tag New oculta no card por padrão', !r.discoBadges.includes('New Testamento'), JSON.stringify(r.discoBadges));
    ok('tag Old visível no card e selo Retroativo oculto', r.antigoBadges.includes('Old Testamento') && !r.antigoBadges.includes('Retroativo'), JSON.stringify(r.antigoBadges));
    r = await passo(`
      card('Disco de Teste').querySelector('a').click();
      await until(() => $('.album-title h1')?.textContent === 'Disco de Teste', 10000, 'álbum');
      return [...document.querySelectorAll('.album-title .badge')].map((b) => ({ t: b.textContent, faint: b.classList.contains('faint') }));
    `);
    ok('página do álbum mostra New Testamento em estilo discreto', r.some((b) => b.t === 'New Testamento' && b.faint), JSON.stringify(r));

    // Estatísticas antes de mexer na visibilidade, para comparar depois.
    const statsTexto = () => passo(`
      location.hash = '#/stats';
      await until(() => h1() === 'Estatísticas' && $('.totals'), 10000, 'stats');
      await sleep(200);
      return $$('.totals strong, .rank li').map((e) => e.textContent).join('|');
    `);
    const statsAntes = await statsTexto();

    // Ocultar e reexibir tags e o selo Retroativo.
    await passo(`await goAdmin(); await toggleTag('New Testamento', true);`);
    r = await passo(`await goAlbums('all'); return badgesOf('Disco de Teste');`);
    ok('reexibir New mostra a tag no card', r.includes('New Testamento'), JSON.stringify(r));
    await passo(`await goAdmin(); await toggleTag('New Testamento', false); await toggleTag('Old Testamento', false);`);
    r = await passo(`await goAlbums('all'); return { disco: badgesOf('Disco de Teste'), antigo: badgesOf('Álbum Antigo') };`);
    ok('ocultar tira a tag dos cards', !r.disco.includes('New Testamento') && !r.antigo.includes('Old Testamento'), JSON.stringify(r));
    ok('estatísticas iguais com tags ocultas', (await statsTexto()) === statsAntes);
    await passo(`
      await goAdmin(); await toggleTag('Old Testamento', true);
      const sw = [...document.querySelectorAll('.switch')].find((l) => l.textContent.includes('selo Retroativo')).querySelector('input');
      sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(800);
    `);
    r = await passo(`await goAlbums('all'); return badgesOf('Álbum Antigo');`);
    ok('selo Retroativo aparece no card quando ligado', r.includes('Retroativo'), JSON.stringify(r));
    await passo(`
      await goAdmin();
      const sw = [...document.querySelectorAll('.switch')].find((l) => l.textContent.includes('selo Retroativo')).querySelector('input');
      sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(800);
    `);
    r = await passo(`await goAlbums('all'); return badgesOf('Álbum Antigo');`);
    ok('selo Retroativo some do card quando desligado', !r.includes('Retroativo'), JSON.stringify(r));

    // Renomear as tags de período: o seletor muda o rótulo e continua filtrando pelo id.
    await passo(`
      await goAdmin();
      tagRow('Old Testamento').querySelector('button').click();
      await until(() => dialog(), 5000, 'editar tag');
      ok0 = !byText('Apagar tag', dialog());
      typeIn(dialog().querySelector('input'), 'Antigo Testamento');
      await click('Salvar tag', true);
      await until(() => tagRow('Antigo Testamento'), 10000, 'renomeada');
      window.__semApagar = ok0;
    `.replace('ok0 =', 'let ok0 ='));
    ok('tags de período não têm botão de apagar', await rodar(`return window.__semApagar === true`));
    r = await passo(`
      const nome = tagRow('Antigo Testamento').querySelector('.switch input').checked;
      await goAlbums('old');
      return { label: $$('.period-picker button')[2].textContent, inOld: titles(), shown: nome, badges: badgesOf('Álbum Antigo') };
    `);
    ok('seletor mostra o nome novo e filtra certo', r.label === 'Antigo Testamento' && r.inOld.includes('Álbum Antigo'), JSON.stringify(r));
    ok('renomear mantém a visibilidade', r.shown === true && r.badges.includes('Antigo Testamento'), JSON.stringify(r.badges));
    await passo(`
      await goAdmin();
      tagRow('New Testamento').querySelector('button').click();
      await until(() => dialog(), 5000, 'editar tag new');
      typeIn(dialog().querySelector('input'), 'Novo Testamento');
      await click('Salvar tag', true);
      await until(() => tagRow('Novo Testamento'), 10000, 'renomeada new');
    `);
    r = await passo(`await goAlbums('new'); return { label: $$('.period-picker button')[1].textContent, inNew: titles(), badges: badgesOf('Disco de Teste') };`);
    ok('New renomeada continua filtrando e oculta', r.label === 'Novo Testamento' && r.inNew.includes('Disco de Teste') && !r.badges.includes('Novo Testamento'), JSON.stringify(r));

    // Tag comum: nasce visível, ocultar e apagar sem quebrar nada.
    await passo(`
      await goAdmin();
      await click('Nova tag');
      await until(() => dialog(), 5000, 'nova tag');
      typeIn(dialog().querySelector('input'), 'Favoritos');
      await click('Salvar tag', true);
      await until(() => tagRow('Favoritos'), 10000, 'criada');
    `);
    ok('tag nova nasce visível', await passo(`return tagRow('Favoritos').querySelector('.switch input').checked === true && !tagRow('Favoritos').querySelector('.faint')`));
    await passo(`await editAlbum('Disco de Teste'); toggleChip('Favoritos', true); await saveEdit('Disco de Teste');`);
    r = await passo(`await goAlbums('all'); return badgesOf('Disco de Teste');`);
    ok('tag nova aparece no card', r.includes('Favoritos'), JSON.stringify(r));
    await passo(`await goAdmin(); await toggleTag('Favoritos', false);`);
    r = await passo(`
      await goAlbums('all'); const cardB = badgesOf('Disco de Teste');
      card('Disco de Teste').querySelector('a').click();
      await until(() => $('.album-title h1')?.textContent === 'Disco de Teste', 10000, 'álbum');
      return { cardB, page: [...document.querySelectorAll('.album-title .badge')].map((b) => b.textContent) };
    `);
    ok('tag oculta some do card e fica na página', !r.cardB.includes('Favoritos') && r.page.includes('Favoritos'), JSON.stringify(r));
    await passo(`
      await goAdmin();
      tagRow('Favoritos').querySelector('button').click();
      await until(() => dialog(), 5000, 'editar favoritos');
      await click('Apagar tag', true);
      await until(() => dialog()?.textContent.includes('Apagar a tag'), 5000, 'confirmar');
      await click('Apagar tag', true);
      await until(() => h1() === 'Admin' && !tagRow('Favoritos'), 10000, 'apagada');
    `);
    r = await passo(`
      await goAlbums('all'); const cardB = badgesOf('Disco de Teste');
      card('Disco de Teste').querySelector('a').click();
      await until(() => $('.album-title h1')?.textContent === 'Disco de Teste', 10000, 'álbum');
      return { cardB, page: [...document.querySelectorAll('.album-title .badge')].map((b) => b.textContent) };
    `);
    ok('tag apagada some do álbum sem quebrar', !r.cardB.includes('Favoritos') && !r.page.includes('Favoritos'), JSON.stringify(r));
    await foto('album-sem-tag-apagada', false);

    // Sem período e com os dois períodos.
    await passo(`await editAlbum('Disco de Teste'); toggleChip('Novo Testamento', false); await saveEdit('Disco de Teste');`);
    r = await passo(`
      await goAlbums('new'); const inNew = titles();
      await goAlbums('all');
      return { inNew, inAll: titles(), badges: badgesOf('Disco de Teste') };
    `);
    ok('sem tag de período: fora de New, dentro de Todos, com aviso', !r.inNew.includes('Disco de Teste') && r.inAll.includes('Disco de Teste') && r.badges.includes('Sem período'), JSON.stringify(r));
    await passo(`await editAlbum('Disco de Teste'); toggleChip('Novo Testamento', true); toggleChip('Antigo Testamento', true); await saveEdit('Disco de Teste');`);
    r = await passo(`
      await goAlbums('old'); const inOld = titles(); const badges = badgesOf('Disco de Teste');
      await goAlbums('new');
      return { inOld, inNew: titles(), badges };
    `);
    ok('com as duas: aparece em Old com aviso', r.inOld.includes('Disco de Teste') && !r.inNew.includes('Disco de Teste') && r.badges.includes('Old e New ao mesmo tempo'), JSON.stringify(r));
    await passo(`await editAlbum('Disco de Teste'); toggleChip('Antigo Testamento', false); await saveEdit('Disco de Teste');`);

    // Tentar apagar uma tag de período direto pela camada de dados: as regras recusam.
    r = await rodar(`
      const db = await import('/js/db.js');
      try { await db.deleteTag('old-testamento'); return 'apagou'; } catch (e) { return e.message; }
    `);
    ok('apagar tag de período é bloqueado', r !== 'apagou', r);

    // Gênero: trocar no álbum, ver na página do artista e nas estatísticas.
    await passo(`
      await editAlbum('Disco de Teste');
      typeIn([...document.querySelectorAll('label.field')].find((l) => l.textContent.startsWith('Gênero')).querySelector('input'), 'Pop');
      await saveEdit('Disco de Teste');
    `);
    r = await passo(`
      const genre = $('.album-title .genre')?.textContent;
      $('.album-title .artist a').click();
      await until(() => $('.artist-head'), 10000, 'artista');
      return { genre, chips: [...document.querySelectorAll('.artist-head .badge')].map((b) => b.textContent) };
    `);
    ok('gênero aparece no álbum e no artista', r.genre === 'Pop' && r.chips.includes('Pop'), JSON.stringify(r));
    await foto('artista-com-genero', false);
    r = await passo(`
      location.hash = '#/stats';
      await until(() => h1() === 'Estatísticas' && $('.totals'), 10000, 'stats');
      return [...document.querySelectorAll('.section h2')].map((e) => e.textContent);
    `);
    ok('estatísticas mostram média por gênero', r.includes('Média por gênero'), JSON.stringify(r));

    // Capa escolhida da galeria e volta para a automática.
    await passo(`await editAlbum('Disco de Teste');`);
    await setFile('form input[type=file]', `${raiz}icons/icon-512.png`);
    r = await passo(`
      await until(() => !$$('form .btn').find((b) => b.textContent === 'Voltar para a automática')?.hidden, 15000, 'capa trocada');
      await goAlbums('all');
      return card('Disco de Teste').querySelector('img')?.src.startsWith('data:image/jpeg') || false;
    `);
    ok('capa da galeria aparece na lista como miniatura', r === true);
    await passo(`
      await editAlbum('Disco de Teste');
      await click('Voltar para a automática');
      await until(() => $$('form .btn').find((b) => b.textContent === 'Voltar para a automática')?.hidden, 10000, 'voltou');
    `);

    // Visualizações: grade grande, grade compacta e memória da escolha.
    r = await passo(`
      await goAlbums('all');
      const btn = $$('.list-tools .icon-btn')[0];
      btn.click(); await sleep(200); const g2 = $('.album-grid.grid2') ? $$('.album-grid li').length : 0;
      return g2;
    `);
    ok('grade grande com 2 por linha', r > 0, String(r));
    await foto('albuns-grade-grande', false);
    r = await passo(`$$('.list-tools .icon-btn')[0].click(); await sleep(200); return !!$('.album-grid.grid3');`);
    ok('grade compacta', r);
    await foto('albuns-grade-compacta', false);
    await passo(`$$('.period-picker button')[2].click(); await sleep(200);`);
    await cdp.enviar('Page.reload');
    await new Promise((res) => setTimeout(res, 1500));
    r = await passo(`
      await until(() => h1() === 'Álbuns' && $('.period-picker'), 20000, 'álbuns após recarregar');
      return { grid3: !!$('.album-grid.grid3'), old: $$('.period-picker button')[2].getAttribute('aria-pressed') };
    `);
    ok('visualização e período lembrados após recarregar', r.grid3 && r.old === 'true', JSON.stringify(r));
    await passo(`$$('.period-picker button')[0].click(); await sleep(100); $$('.list-tools .icon-btn')[0].click(); await sleep(200);`);

    // Importação: nomes das tags no CSV casam mesmo depois de renomear, e a prévia mostra o que não foi achado.
    const csv = await Deno.makeTempFile({ prefix: 'bestsfork-import-', suffix: '.csv' });
    await Deno.writeTextFile(csv, [
      'album,artista,edicao,genero,tag,nota',
      'Blackout,Britney Spears,,Pop,Old Testamento,7.7',
      'Positions,Ariana Grande,deluxe,Pop,Old Testamento,8.1',
      'Disco Que Não Existe Qwz,Ninguém Zyxw,,Rock,New Testamento,6.5',
    ].join('\n'));
    try {
      await passo(`location.hash = '#/admin/import'; await until(() => h1() === 'Importar retroativos' && $('input[type=file]'), 10000, 'importar');`);
      await setFile('input[type=file]', csv);
      r = await passo(`
        await until(() => $$('.import-row').length === 3, 90000, 'prévia');
        const rows = $$('.import-row').map((row) => ({
          badges: [...row.querySelectorAll('.badge')].map((b) => b.textContent),
          title: row.querySelector('input.input').value,
          tag: row.querySelector('select').selectedOptions[0]?.textContent,
        }));
        return rows;
      `);
      await foto('importacao-previa');
      ok('prévia acha Blackout no MusicBrainz', r[0].badges.includes('Encontrado'), JSON.stringify(r[0]));
      ok('edição deluxe vira "Positions (Deluxe)"', r[1].title === 'Positions (Deluxe)', JSON.stringify(r[1]));
      ok('linha sem correspondência marcada na prévia', r[2].badges.includes('Sem correspondência'), JSON.stringify(r[2]));
      ok('tag do CSV casa com a tag renomeada', r[0].tag === 'Antigo Testamento' && r[2].tag === 'Novo Testamento', JSON.stringify(r.map((x) => x.tag)));
      r = await passo(`
        await click('Importar marcados');
        await click('Importar', true);
        await until(() => $('.empty h2')?.textContent === 'Importação concluída', 120000, 'importação');
        await goAlbums('old'); const inOld = titles();
        await goAlbums('new'); const inNew = titles();
        return { inOld, inNew };
      `);
      ok('importados caem em Old pela tag', r.inOld.includes('Blackout') && r.inOld.includes('Positions (Deluxe)'), JSON.stringify(r.inOld));
      ok('importado com New Testamento cai em New', r.inNew.includes('Disco Que Não Existe Qwz'), JSON.stringify(r.inNew));
      r = await passo(`
        location.hash = '#/artists';
        await until(() => h1() === 'Artistas' && $('.artist-row'), 10000, 'artistas');
        const row = $$('.artist-row').find((li) => li.textContent.includes('Britney Spears'));
        const img = row?.querySelector('img');
        if (!img) return { src: '', loaded: false };
        await until(() => img.complete, 15000, 'foto carregar').catch(() => {});
        await until(() => $$('.artist-row img').every((i) => i.complete), 15000, 'fotos').catch(() => {});
        return { src: img.src, loaded: img.naturalWidth > 0 };
      `);
      console.log(`  foto da Britney Spears: ${r.src || '(nenhuma, depende da rede)'} ${r.loaded ? '(carregou)' : '(não carregou)'}`);
      await foto('artistas-com-fotos', false);
      r = await passo(`
        location.hash = '#/stats';
        await until(() => h1() === 'Estatísticas' && $('.totals'), 10000, 'stats');
        return $$('.totals strong').map((e) => e.textContent);
      `);
      ok('estatísticas contam os retroativos importados', r[2] === '4', JSON.stringify(r));
    } finally {
      await Deno.remove(csv).catch(() => {});
    }

    const errosReais = erros.filter((e) => !/favicon|ERR_INTERNET|coverartarchive|musicbrainz/i.test(e));
    ok('sem erros no console', errosReais.length === 0, errosReais.slice(0, 5).join(' | '));
  } catch (err) {
    try {
      const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png' });
      await Deno.writeFile(`${pastaFotos}/erro.png`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
      console.log('Tela no momento do erro:', await cdp.avaliar(`document.querySelector('#app')?.innerText.slice(0, 400)`));
    } catch { /* navegador já caiu */ }
    throw err;
  } finally {
    await edge.encerrar(cdp);
    await site.parar();
  }
  console.log(`\nCapturas em ${pastaFotos}`);
  if (falhas.length) {
    console.log(`${falhas.length} verificação(ões) falharam.`);
    Deno.exit(1);
  }
  console.log('Tudo certo.');
}

try {
  await main();
} catch (err) {
  console.error(err);
  Deno.exit(1);
}
