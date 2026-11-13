// Development build: regenerate both clients, then mirror canonical sources
// into packages/ exactly as BUILD-MAP.json declares. No deploy, SDK or model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
execFileSync('python', ['-X', 'utf8', path.join(root, 'sources/card-studio/build_cardstudio.py'), '--client-only'], {stdio: 'inherit'});
execFileSync(process.execPath, [path.join(root, 'scripts/build-player-native.mjs')], {stdio: 'inherit'});
const map = JSON.parse(await fs.readFile(path.join(root, 'BUILD-MAP.json'), 'utf8'));
let copied = 0, unchanged = 0;
for (const row of map.runtime) {
  const from = path.join(root, row.source), to = path.join(root, row.path);
  const [a, b] = await Promise.all([fs.readFile(from), fs.readFile(to).catch(() => null)]);
  if (b && Buffer.compare(a, b) === 0) { unchanged++; continue; }
  await fs.mkdir(path.dirname(to), {recursive: true}); await fs.writeFile(to, a); copied++; console.log('sync', row.path);
}
console.log(JSON.stringify({copied, unchanged}));
