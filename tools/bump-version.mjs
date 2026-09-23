// Atualiza a versão do app para 1.0.N, em que N é o número do commit que está sendo feito.
// Troca junto a versão do cache do service worker, para os aparelhos baixarem os arquivos novos.
// Roda sozinho pelo gancho em tools/git-hooks/pre-commit.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

let count = 0;
try {
  count = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  count = 0;
}
const version = `1.0.${count + 1}`;

writeFileSync('js/version.js', `export const APP_VERSION = '${version}';\n`);
const sw = readFileSync('sw.js', 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'v${version}';`);
writeFileSync('sw.js', sw);
console.log(`versão ${version}`);
