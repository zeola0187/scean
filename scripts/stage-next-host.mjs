// Official DSH Web (reviewed 0.2.2-rc.3 SDK) for stage-next integration work.
// Fresh checkout-local DSH home, loopback only, outbound network blocked by
// w19-offline-network.cjs, every model call answered by fixtures/stage-next.mjs.
// Usage: node scripts/stage-next-host.mjs --label=stage-next-<name> [--restart]
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
const repo = path.resolve(import.meta.dirname, '..'), label = process.argv.find(v => v.startsWith('--label='))?.slice(8) ?? 'stage-next-dev';
if (!/^stage-next-[a-z0-9-]{1,40}$/.test(label)) throw Error('FRESH_SYNTHETIC_LABEL_REQUIRED');
const out = path.join(repo, 'evidence', label), home = path.join(out, 'home'), profile = path.join(home, 'profiles/web'), restarting = process.argv.includes('--restart');
const env = {SystemRoot: process.env.SystemRoot ?? 'C:/Windows', WINDIR: 'C:/Windows', ComSpec: 'C:/Windows/System32/cmd.exe', USERPROFILE: path.join(out, 'user'), APPDATA: path.join(out, 'appdata'), LOCALAPPDATA: path.join(out, 'localappdata'), TEMP: path.join(out, 'temp'), TMP: path.join(out, 'temp'), PATH: process.env.PATH, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_DISABLE_TELEMETRY: '1'};
if (!process.argv.includes('--worker')) {
  await fs.mkdir(out, {recursive: true}); for (const dir of ['user', 'temp', 'appdata', 'localappdata']) await fs.mkdir(path.join(out, dir), {recursive: true});
  for (const f of ['stop-request', 'exit.json', 'launch.json']) await fs.unlink(path.join(out, f)).catch(() => {});
  const child = spawn(process.execPath, ['--require', path.join(repo, 'scripts/w19-offline-network.cjs'), import.meta.filename, '--label=' + label, '--worker', ...(restarting ? ['--restart'] : [])], {cwd: out, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const log = await fs.open(path.join(out, 'host-redacted.log'), 'a'); let queue = Promise.resolve();
  for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', chunk => { const safe = chunk.replace(/(?:token|key|authorization)=[^\s"<>]+/gi, 'token=FIXTURE_REDACTED'); queue = queue.then(() => log.write(safe)); process.stdout.write(safe); }); }
  child.on('close', async code => { await queue; await log.close(); process.exitCode = code ?? 1; });
} else {
  if (process.env.DSH_HOME !== home || !home.startsWith(path.join(repo, 'evidence') + path.sep)) throw Error('ISOLATED_HOME_REQUIRED');
  const {internals} = await import('@deepseek-ai/dsh-web-app'); internals.resolveDistIndex = () => path.join(repo, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html');
  const installed = path.join(profile, 'node_modules/@local/dsh-scean-suite'), data = path.join(home, 'scean-synthetic'), workspace = path.join(home, 'card-studio-scean-test/workspace');
  const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
  let port; try { port = JSON.parse(await fs.readFile(path.join(out, 'port.json'), 'utf8')).port; } catch { port = await freePort(); await fs.writeFile(path.join(out, 'port.json'), JSON.stringify({port})); }
  const suite = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  if (!restarting) {
    const {initProfile} = await import('@deepseek-ai/dsh-app-boot'); initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@local/dsh-scean-suite']);
    const {seedStageNextStudio} = await import('../fixtures/stage-next.mjs'); await seedStageNextStudio(workspace);
    const slash = p => p.replaceAll('\\', '/');
    await fs.writeFile(path.join(profile, 'cordis.patch.yml'), `- insert:\n    - id: stage-next-scripted\n      name: ${pathToFileURL(path.join(repo, 'fixtures/stage-next.mjs')).href}\n      config: {}\n- id: local-scean-host\n  config:\n    dataRoot: ${slash(data)}\n    usagePath: ${slash(data)}/usage.jsonl\n    modelSelection:\n      provider: next-scripted\n      model: offline\n      reasoningEffort: off\n    enableExistingEmbedding: false\n    summaryEnabled: false\n    chapterModelsEnabled: false\n    technicalRetries: 0\n- id: local-cardstudio-scean-workspace-loader\n  config:\n    workspace: ${slash(workspace)}\n- id: agent-default-model\n  config:\n    provider: next-scripted\n    model: offline\n    reasoningEffort: off\n- id: ui-settings-account\n  config:\n    version: 1\n    step: done\n    usage: detailed\n    purpose: null\n    process: standard\n    completion: api-key\n`);
  }
  // Test-only window handles for the driver (same pattern as player-six); never shipped.
  const probe = path.join(profile, 'node_modules/@local/stage-next-ui-probe');
  if (!await fs.stat(probe).catch(() => null)) {
    await fs.mkdir(probe, {recursive: true});
    await fs.writeFile(path.join(probe, 'package.json'), JSON.stringify({name: '@local/stage-next-ui-probe', version: '0.0.0', private: true, type: 'module', exports: {'.': './index.js', './client': './client.js'}, dsh: {client: {platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-workspace']}}}));
    await fs.writeFile(path.join(probe, 'index.js'), 'export function apply(){}\n');
    await fs.writeFile(path.join(probe, 'client.js'), "window.__ModuleLoader__.load({id:'@local/stage-next-ui-probe',factory(){return {name:'stage-next-ui-probe',apply(ctx){ctx.inject(['sessions','layout','uiWorkspace'],scope=>{window.__uiSessions=scope.sessions;window.__uiLayout=scope.layout;window.__uiWorkspace=scope.uiWorkspace;})}}}});\n");
    await fs.appendFile(path.join(profile, 'cordis.patch.yml'), '\n- insert:\n    - id: stage-next-ui-probe\n      name: "@local/stage-next-ui-probe"\n      config: {}\n');
  }
  // Always (re)copy the current suite so a restart picks up rebuilt clients; Host data is untouched.
  await fs.mkdir(installed, {recursive: true});
  for (const rel of ['package.json', ...suite.files]) await fs.cp(path.join(repo, rel), path.join(installed, rel), {recursive: true, force: true});
  // Fault injection wraps only this isolated copy of the Host class.
  const {SceanHost} = await import(pathToFileURL(path.join(installed, 'packages/scean/plugin/host.mjs')).href), original = SceanHost.prototype.request;
  let fixtureHost; const requests = [];
  SceanHost.prototype.request = async function (request, signal, authority) {
    fixtureHost = this; requests.push({action: request.action, at: Date.now()}); if (requests.length > 500) requests.shift();
    const ack = path.join(out, 'fault-ack.json');
    if (['turn', 'operationSubmit'].includes(request.action) && await fs.stat(ack).catch(() => null)) {
      await fs.unlink(ack).catch(() => {}); const result = await original.call(this, request, signal, authority);
      if (result.ok) return {ok: false, error: {code: 'CONNECTION_UNKNOWN', message: 'Synthetic acknowledgement lost after canonical publication.'}};
      return result;
    }
    return original.call(this, request, signal, authority);
  };
  const {runProfile} = await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), {createLaunchEnvironmentSnapshot} = await import('@deepseek-ai/dsh-launch-environment');
  const app = await runProfile({profile: 'web', patchFiles: [], args: ['--host', '127.0.0.1', '--port', String(port), '--no-open'], environment: createLaunchEnvironmentSnapshot([{source: 'process', values: env}])}); await app.ctx.loader.await();
  const server = app.ctx.get('webServer'), connection = app.ctx.get('connection'); if (server?.host !== '127.0.0.1' || server?.port !== port || !connection) throw Error('OFFICIAL_HOST_NOT_READY');
  server.register({kind: 'exact', path: '/__next_entry', handler(req, res) { if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; } res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'referrer-policy': 'same-origin'}); res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCEAN 新介面隔離驗收</title><h1>SCEAN 新介面隔離驗收</h1><p>官方 DSH Web 0.2.2-rc.3、隔離資料夾、合成卡片與 scripted adapter；不使用付費模型。</p><form method="post" action="/__next_login"><button type="submit" style="font-size:18px;padding:10px 18px">開啟隔離 DSH</button></form></html>'); }});
  server.register({kind: 'exact', path: '/__next_login', handler(req, res) { if (req.method !== 'POST' || req.headers.host !== `127.0.0.1:${port}` || req.headers.origin !== `http://127.0.0.1:${port}` || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; } const url = new URL(connection.authenticatedUrl(`http://127.0.0.1:${port}/`)); connection.authorizeIndex({method: 'GET', url: url.pathname + url.search, headers: req.headers}, res); }});
  const launch = {pid: process.pid, port, entry: `http://127.0.0.1:${port}/__next_entry`, home, data, workspace, isolated: true, surface: 'official DSH Web 0.2.2-rc.3 with native iframe/RPC', productionWrites: 0, paidModelCalls: 0, restarted: restarting};
  await fs.writeFile(path.join(out, 'launch.json'), JSON.stringify(launch, null, 2) + '\n'); console.log(JSON.stringify(launch));
  let stopping = false;
  const stopTimer = setInterval(async () => {
    try { await fs.writeFile(path.join(out, 'requests.json'), JSON.stringify(requests.slice(-80))); } catch {}
    if (stopping || !await fs.stat(path.join(out, 'stop-request')).catch(() => null)) return; stopping = true; clearInterval(stopTimer);
    await fs.writeFile(path.join(out, 'exit.json'), JSON.stringify({normalDisposeRequested: true, at: new Date().toISOString(), productionWrites: 0, paidModelCalls: 0})); await app.shutdown.shutdown(0);
  }, 500);
  void fixtureHost;
}
