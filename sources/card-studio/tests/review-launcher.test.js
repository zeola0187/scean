import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { layout, cleanEnvironment, browserLaunch, ROOT } from '../review/launcher.js';

test('review environment drops provider secrets, Node injection, proxies and daily roots', () => {
  const loc = layout('env-test');
  const env = cleanEnvironment(loc, { SystemRoot: 'C:\\Windows', PATH: 'C:\\untrusted', NODE_OPTIONS: '--import evil.js', NODE_PATH: 'private', API_KEY: 'synthetic-secret', DEEPSEEK_API_KEY: 'synthetic-secret', HTTPS_PROXY: 'secret-proxy', DSH_HOME: 'E:\\daily-home', APPDATA: 'E:\\daily-appdata' });
  assert(!JSON.stringify(env).includes('synthetic-secret'));
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'API_KEY', 'DEEPSEEK_API_KEY', 'HTTPS_PROXY']) assert(!Object.hasOwn(env, key));
  assert(!env.PATH.includes('untrusted')); assert.equal(env.DSH_HOME, loc.home); assert(env.APPDATA.startsWith(loc.base)); assert(env.TEMP.startsWith(loc.base));
});

test('review namespaces cannot select a daily or arbitrary filesystem profile', () => {
  for (const name of ['../daily', 'E:\\daily', '', 'a/b', 'a\\b']) assert.throws(() => layout(name));
  assert.equal(layout().base, path.join(ROOT, 'review-data'));
  assert.notEqual(layout().pipe, layout('test').pipe);
});

test('review network fence rejects wildcard/implicit listeners, remote TCP and UDP', () => {
  const loc = layout('network-test');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'review/network-fence.mjs')).href, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';import net from 'node:net';import dgram from 'node:dgram';
    for(const opts of [{port:0},{port:0,host:'0.0.0.0'},{port:0,host:'::'},{port:0,host:'192.0.2.1'}])assert.throws(()=>net.createServer().listen(opts),/REVIEW_BIND_DENIED/);
    for(const host of ['192.0.2.1','example.invalid'])assert.throws(()=>net.connect({host,port:443}),/REVIEW_OUTBOUND_DENIED/);
    assert.throws(()=>dgram.createSocket('udp4'),/REVIEW_UDP_DENIED/);
    const server=net.createServer(s=>s.end('loopback-ok'));await new Promise(r=>server.listen({port:0,host:'127.0.0.1'},r));
    const socket=net.connect({port:server.address().port,host:'127.0.0.1'});let text='';for await(const part of socket)text+=part;assert.equal(text,'loopback-ok');await new Promise(r=>server.close(r));console.log('passed');
  `], { env: cleanEnvironment(loc), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /passed/);
});

test('explicit Open uses only the dedicated browser profile and unchanged security settings', () => {
  const loc = layout('browser-test'), launch = browserLaunch(loc, 'http://127.0.0.1:34567/?token=synthetic');
  assert(launch.args.includes('--user-data-dir=' + loc.browser));
  assert(launch.args.includes('--proxy-bypass-list=127.0.0.1'));
  assert(!launch.args.some(arg => /no-sandbox|disable-web-security|remote-debugging/.test(arg)));
  assert.equal(launch.options.env.USERPROFILE, path.join(loc.base, 'os-home'));
  for (const url of ['http://localhost:34567', 'http://0.0.0.0:34567', 'https://example.invalid', 'http://127.0.0.1:19387']) assert.throws(() => browserLaunch(loc, url));
});
