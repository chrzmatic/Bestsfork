// Roda um comando dentro dos emuladores e depois encerra o Java do emulador,
// que no Windows fica vivo depois do `firebase emulators:exec`.
// Uso: node tools/com-emulador.mjs auth,firestore "comando"
import { spawnSync, execFileSync } from 'node:child_process';

const [only, cmd] = process.argv.slice(2);

function emulatorPids() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*cloud-firestore-emulator*' } | ForEach-Object { $_.ProcessId }"],
    { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

const before = new Set(emulatorPids());
const r = spawnSync(`npx firebase emulators:exec --only ${only} --project demo-bestsfork "${cmd}"`, { stdio: 'inherit', shell: true });
for (const pid of emulatorPids()) {
  if (!before.has(pid)) {
    try { process.kill(pid); } catch { /* já saiu */ }
  }
}
process.exit(r.status ?? 1);
