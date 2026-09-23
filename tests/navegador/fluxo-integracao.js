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
  const dialog = () => document.querySelector('dialog[open]');
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
    const foto = async (nome, cheia = true) => {
      await new Promise((r) => setTimeout(r, 400));
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

    const errosReais = erros.filter((e) => !/favicon|ERR_INTERNET|coverartarchive|musicbrainz/i.test(e));
    ok('sem erros no console', errosReais.length === 0, errosReais.slice(0, 5).join(' | '));
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
