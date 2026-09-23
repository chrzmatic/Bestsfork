// Cliente mínimo do DevTools Protocol, no mesmo formato dos testes do GymTracker.
// Roda com Deno e não depende de nada além do navegador instalado.

export async function conectar(porta) {
  const pagina = await esperarPagina(porta);
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, erro) => {
    ws.onopen = ok;
    ws.onerror = () => erro(new Error('Não consegui abrir o WebSocket do navegador.'));
  });

  let id = 0;
  const pendentes = new Map();
  const ouvintes = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) ouvintes.forEach((fn) => fn(msg));
    if (!msg.id || !pendentes.has(msg.id)) return;
    const { ok, erro } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    if (msg.error) erro(new Error(JSON.stringify(msg.error)));
    else ok(msg.result);
  };

  const enviar = (metodo, params = {}) => new Promise((ok, erro) => {
    id += 1;
    pendentes.set(id, { ok, erro });
    ws.send(JSON.stringify({ id, method: metodo, params }));
  });

  return {
    enviar,
    ouvir: (fn) => ouvintes.push(fn),
    fechar: () => ws.close(),
    async avaliar(expressao) {
      const r = await enviar('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const e = r.exceptionDetails;
        throw new Error('Erro dentro da página: ' + (e.exception?.description ?? e.text));
      }
      return r.result.value;
    },
  };
}

async function esperarPagina(porta, tentativas = 60) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      const pagina = alvos.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
      if (pagina) return pagina;
    } catch {
      // navegador ainda subindo
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('O navegador não abriu a porta de depuração.');
}

export function acharEdge() {
  const pf = Deno.env.get('ProgramFiles') ?? 'C:\\Program Files';
  const pf86 = Deno.env.get('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)';
  for (const caminho of [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`]) {
    try {
      Deno.statSync(caminho);
      return caminho;
    } catch {
      // próximo
    }
  }
  throw new Error('Não achei o Microsoft Edge instalado.');
}

const FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-domain-reliability',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-breakpad',
  '--no-pings',
  '--metrics-recording-only',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
];

// Sobe o Edge num perfil temporário próprio. `encerrar` fecha, mata só os
// processos desse perfil e apaga a pasta.
export async function lancarEdge({ url, porta }) {
  const perfil = await Deno.makeTempDir({ prefix: 'bestsfork-teste-' });
  const processo = new Deno.Command(acharEdge(), {
    args: [...FLAGS, `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, url],
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  return {
    perfil,
    async encerrar(cdp) {
      if (cdp) {
        try { await cdp.enviar('Browser.close'); } catch { /* já caiu */ }
        try { cdp.fechar(); } catch { /* já fechado */ }
      }
      try {
        await new Deno.Command('taskkill', { args: ['/PID', String(processo.pid), '/T', '/F'], stdout: 'null', stderr: 'null' }).output();
      } catch { /* já encerrou */ }
      await matarPorPerfil(perfil);
      await processo.status;
      await apagarComInsistencia(perfil);
    },
  };
}

// Mata os msedge.exe cuja linha de comando cita o perfil temporário, e só eles.
async function matarPorPerfil(perfil) {
  const nome = perfil.split(/[\\/]/).pop();
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${nome}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    await new Deno.Command('powershell', { args: ['-NoProfile', '-Command', script], stdout: 'null', stderr: 'null' }).output();
  } catch { /* sem PowerShell */ }
}

async function apagarComInsistencia(caminho) {
  for (let i = 0; i < 20; i += 1) {
    try {
      await Deno.remove(caminho, { recursive: true });
      return;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.warn(`[teste] não consegui apagar o perfil temporário: ${caminho}`);
}

export function servir(raiz) {
  const tipos = {
    html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png', woff2: 'font/woff2',
  };
  const servidor = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: () => {} }, async (req) => {
    let caminho = decodeURIComponent(new URL(req.url).pathname);
    if (caminho === '/') caminho = '/index.html';
    if (caminho.includes('..')) return new Response('404', { status: 404 });
    try {
      const arquivo = await Deno.readFile(raiz + caminho);
      return new Response(arquivo, {
        headers: { 'content-type': tipos[caminho.split('.').pop()] ?? 'application/octet-stream', 'cache-control': 'no-store' },
      });
    } catch {
      return new Response('404', { status: 404 });
    }
  });
  return { porta: servidor.addr.port, parar: () => servidor.shutdown() };
}
