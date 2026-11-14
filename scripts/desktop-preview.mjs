// SCEAN Stage v2 preview on the real DSH Desktop (Electron), fully isolated.
//
// Every instance lives in its own folder under the preview root:
//   <root>/app                  copy of the installed DSH Desktop, updater manifest removed
//   <root>/packages/*.tgz       preview suite packages (distinct version, never the release name)
//   <root>/<label>/home         DSH_HOME (profiles/desktop, sessions, SCEAN data)
//   <root>/<label>/userdata     Electron userData (own single-instance lock → runs beside production)
// The production install (E:\DSH) and ~/.dsh are only ever read, never written.
//
// Commands:
//   node scripts/desktop-preview.mjs pack                         build a preview tgz from this worktree
//   node scripts/desktop-preview.mjs setup  --label=L [--scripted] [--tgz=file]
//   node scripts/desktop-preview.mjs update --label=L [--tgz=file]   reinstall the suite, keep all data
//   node scripts/desktop-preview.mjs start  --label=L [--cdp=9333]
//   node scripts/desktop-preview.mjs stop   --label=L
//   node scripts/desktop-preview.mjs launcher --label=L               write <root>/SCEAN-preview-L.cmd (personal use)
// --scripted labels must match stage-next-desk-*: model traffic goes to fixtures/stage-next.mjs only.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') ?? path.join(repo, '..', 'dsh-desktop-preview'));
const productionApp = path.resolve(arg('from') ?? 'E:/DSH');
const productionHome = path.join(process.env.USERPROFILE ?? '', '.dsh');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slash = p => p.replaceAll('\\', '/');
const exists = p => fs.stat(p).then(() => true, () => false);
const appDir = path.join(root, 'app'), exe = path.join(appDir, 'DeepSeek Harness.exe');
const pnpm = path.join(appDir, 'resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs');

function guard(dir) {
  const r = path.resolve(dir);
  for (const forbidden of [productionApp, productionHome]) if (r === forbidden || r.startsWith(forbidden + path.sep)) throw Error('PRODUCTION_PATH_REFUSED: ' + r);
  if (!r.startsWith(root + path.sep)) throw Error('OUTSIDE_PREVIEW_ROOT: ' + r);
  return r;
}
function labelDirs(label) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label ?? '')) throw Error('LABEL_REQUIRED (lowercase, digits, dashes)');
  const base = guard(path.join(root, label));
  return {base, home: path.join(base, 'home'), profile: path.join(base, 'home/profiles/desktop'), userdata: path.join(base, 'userdata'), user: path.join(base, 'user'), temp: path.join(base, 'temp'), store: path.join(base, 'pnpm-store'), launch: path.join(base, 'launch.json')};
}

async function ensureApp() {
  if (await exists(exe)) return;
  console.log('copying DSH Desktop from', productionApp);
  await fs.cp(productionApp, appDir, {recursive: true});
  // Without app-update.yml the packaged updater is disabled, so the preview copy never replaces itself or the production install.
  await fs.rm(path.join(appDir, 'resources/app-update.yml'), {force: true});
}

async function pack() {
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: repo, encoding: 'utf8'}).trim() !== '';
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  // Distinct version: pnpm caches by name@version, and the preview must never be mistaken for the release.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  manifest.version = `${manifest.version}.stagev2-${sha}${dirty ? '.dev' + stamp : ''}`;
  const stage = path.join(root, 'packages', '.stage-' + process.pid);
  await fs.rm(stage, {recursive: true, force: true}); await fs.mkdir(stage, {recursive: true});
  for (const rel of manifest.files) await fs.cp(path.join(repo, rel), path.join(stage, rel), {recursive: true});
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const out = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(root, 'packages')], {cwd: stage, encoding: 'utf8', shell: true});
  await fs.rm(stage, {recursive: true, force: true});
  const file = path.join(root, 'packages', JSON.parse(out)[0].filename);
  console.log(JSON.stringify({file, version: manifest.version, dirty}));
  return file;
}
async function latestTgz() {
  const dir = path.join(root, 'packages'), rows = [];
  for (const f of await fs.readdir(dir).catch(() => [])) if (f.endsWith('.tgz') && f.includes('stagev2')) rows.push({f, t: (await fs.stat(path.join(dir, f))).mtimeMs});
  if (!rows.length) throw Error('NO_PREVIEW_PACKAGE: run pack first');
  return path.join(dir, rows.sort((a, b) => b.t - a.t)[0].f);
}

async function install(d, tgz) {
  const manifestPath = path.join(d.profile, 'package.json'), m = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  m.dependencies = {...m.dependencies, '@local/dsh-scean-suite': 'file:' + slash(tgz)};
  const bundles = m.dsh.profile.bundles; if (!bundles.includes('@local/dsh-scean-suite')) bundles.push('@local/dsh-scean-suite');
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2) + '\n');
  // Desktop's own bundled pnpm, a per-instance store, no registry access, no lifecycle scripts.
  execFileSync(process.execPath, [pnpm, 'install', '--offline', '--ignore-scripts', '--store-dir', d.store], {cwd: d.profile, stdio: 'inherit'});
  const installed = JSON.parse(await fs.readFile(path.join(d.profile, 'node_modules/@local/dsh-scean-suite/package.json'), 'utf8'));
  if (!(await fs.readFile(path.join(d.profile, 'node_modules/@local/dsh-scean-suite/packages/scean/plugin/client.js'), 'utf8')).includes('data-scean-stage-ui')) throw Error('INSTALLED_PACKAGE_MISSING_STAGE_V2');
  console.log('installed', installed.version);
}

async function setup(label, {scripted, tgz}) {
  const d = labelDirs(label);
  if (scripted && !/^stage-next-desk-/.test(label)) throw Error('SCRIPTED_LABEL_MUST_START_WITH_stage-next-desk-');
  if (await exists(d.home)) throw Error('LABEL_EXISTS: use update/start, or pick a new label');
  await ensureApp();
  for (const dir of [d.profile, d.userdata, d.user, d.temp]) await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(d.profile, 'package.json'), JSON.stringify({name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}}}, null, 2) + '\n');
  await fs.writeFile(path.join(d.profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  await fs.writeFile(path.join(d.profile, 'cordis.yml'), '[]\n');
  let patch = '';
  if (scripted) {
    const data = path.join(d.home, 'scean-synthetic'), workspace = path.join(d.home, 'card-studio-scean-test/workspace');
    const {seedStageNextStudio} = await import('../fixtures/stage-next.mjs'); await seedStageNextStudio(workspace);
    const hostModule = path.join(d.profile, 'node_modules/@local/dsh-scean-suite/packages/scean/plugin/host.mjs');
    patch += `- insert:\n    - id: stage-next-scripted\n      name: ${pathToFileURL(path.join(repo, 'fixtures/stage-next.mjs')).href}\n      config:\n        hostModule: ${slash(hostModule)}\n- id: local-scean-host\n  config:\n    dataRoot: ${slash(data)}\n    usagePath: ${slash(data)}/usage.jsonl\n    modelSelection:\n      provider: next-scripted\n      model: offline\n      reasoningEffort: off\n    enableExistingEmbedding: false\n    summaryEnabled: false\n    chapterModelsEnabled: false\n    technicalRetries: 0\n- id: local-cardstudio-scean-workspace-loader\n  config:\n    workspace: ${slash(workspace)}\n- id: agent-default-model\n  config:\n    provider: next-scripted\n    model: offline\n    reasoningEffort: off\n`;
  }
  // Scripted instances skip onboarding; a personal preview keeps DSH's own first-run setup (sign-in / model key).
  if (scripted) patch += `- id: ui-settings-account\n  name: "@deepseek-ai/dsh-client-ui-settings-account"\n  config:\n    version: 1\n    step: done\n    usage: detailed\n    purpose: null\n    process: standard\n    completion: api-key\n`;
  // DSH requires a YAML array here, even when there are no overrides.
  await fs.writeFile(path.join(d.profile, 'cordis.patch.yml'), patch || '[]\n');
  await install(d, tgz ?? await latestTgz());
  await fs.writeFile(path.join(d.base, 'preview.json'), JSON.stringify({label, scripted: !!scripted, createdAt: new Date().toISOString(), app: appDir}, null, 2) + '\n');
  if (!scripted) await launcher(label);
  console.log(JSON.stringify({label, base: d.base, scripted: !!scripted}));
}

// Double-click launcher for a personal preview: no Node, no repo, same isolation as `start`.
async function launcher(label) {
  const d = labelDirs(label), file = path.join(root, `SCEAN-preview-${label}.cmd`);
  const lines = ['@echo off', 'rem SCEAN Stage v2 preview on an isolated copy of DSH Desktop. Production DSH and ~/.dsh are not used.',
    `set "DSH_HOME=${d.home}"`, `set "USERPROFILE=${d.user}"`, `set "TEMP=${d.temp}"`, `set "TMP=${d.temp}"`,
    'set "DSH_TELEMETRY_DISABLED=1"', 'set "DSH_DISABLE_TELEMETRY=1"', 'set "NODE_OPTIONS="', 'set "ELECTRON_RUN_AS_NODE="',
    `start "" "${exe}" --user-data-dir="${d.userdata}"`, ''];
  await fs.writeFile(file, lines.join('\r\n')); console.log('launcher', file); return file;
}

// Running instances are found by their userData folder, which also covers ones started from the .cmd launcher.
function instanceRunning(d) {
  const needle = d.userdata.replaceAll("'", "''");
  try { const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' }).Count`], {encoding: 'utf8', windowsHide: true}); return Number(out.trim()) > 0; } catch { return false; }
}

async function cdpBrowser(port) { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return v.webSocketDebuggerUrl; }
async function running(d) { try { const l = JSON.parse(await fs.readFile(d.launch, 'utf8')); process.kill(l.pid, 0); return l; } catch { return null; } }

async function start(label, {cdp}) {
  const d = labelDirs(label); if (!await exists(d.profile)) throw Error('NOT_SET_UP');
  if (await running(d) || instanceRunning(d)) throw Error('ALREADY_RUNNING');
  const meta = JSON.parse(await fs.readFile(path.join(d.base, 'preview.json'), 'utf8'));
  const env = {...process.env, DSH_HOME: d.home, USERPROFILE: d.user, TEMP: d.temp, TMP: d.temp, DSH_TELEMETRY_DISABLED: '1', DSH_DISABLE_TELEMETRY: '1'};
  delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
  const args = [`--user-data-dir=${d.userdata}`];
  if (cdp) args.push(`--remote-debugging-port=${cdp}`);
  // Scripted test instances: the renderer gets a dead proxy (loopback stays direct); Host model traffic is the scripted adapter.
  if (meta.scripted) args.push('--proxy-server=http://127.0.0.1:9');
  const log = fss.openSync(path.join(d.base, 'desktop.log'), 'a');
  const child = spawn(exe, args, {cwd: d.base, env, detached: true, stdio: ['ignore', log, log]}); child.unref();
  const launch = {pid: child.pid, label, cdp: cdp ?? null, startedAt: new Date().toISOString(), scripted: meta.scripted, home: d.home};
  if (cdp) { for (let i = 0; i < 100; i++) { try { await cdpBrowser(cdp); break; } catch { await sleep(300); } } }
  await fs.writeFile(d.launch, JSON.stringify(launch, null, 2) + '\n'); console.log(JSON.stringify(launch));
}

async function stop(label) {
  const d = labelDirs(label), l = await running(d); if (!l) { console.log('not running'); return; }
  if (l.cdp) { try { const ws = new WebSocket(await cdpBrowser(l.cdp)); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.send(JSON.stringify({id: 1, method: 'Browser.close'})); } catch {} }
  else process.kill(l.pid);
  for (let i = 0; i < 60; i++) { try { process.kill(l.pid, 0); await sleep(250); } catch { break; } }
  await fs.rm(d.launch, {force: true}); console.log('stopped', label);
}

const [command] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const label = arg('label');
if (command === 'pack') await pack();
else if (command === 'setup') await setup(label, {scripted: process.argv.includes('--scripted'), tgz: arg('tgz')});
else if (command === 'update') { const d = labelDirs(label); if (await running(d) || instanceRunning(d)) throw Error('CLOSE_THE_PREVIEW_FIRST'); await install(d, arg('tgz') ?? await latestTgz()); }
else if (command === 'launcher') await launcher(label);
else if (command === 'start') await start(label, {cdp: arg('cdp') ? Number(arg('cdp')) : undefined});
else if (command === 'stop') await stop(label);
else { console.log('usage: pack | setup | update | start | stop  (see header)'); process.exitCode = 2; }
