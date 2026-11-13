// Review screenshots via Chrome DevTools Protocol (no extra dependencies).
// Usage: node tools/shoot.mjs   (needs serve.mjs running on 127.0.0.1:5178)
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
const BASE = 'http://127.0.0.1:5178/';
const DESKTOP = {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false};
const PHONE = {width: 390, height: 844, deviceScaleFactor: 2, mobile: true};
const SHOTS = [
  ['d01-shelf', DESKTOP, 'shelf-light', 1500],
  ['d02-reading-campus', DESKTOP, 'read-campus-light', 1500],
  ['d03-running-road', DESKTOP, 'demo-running-road-light', 3000],
  ['d04-settle-failed-campus', DESKTOP, 'demo-settle-campus-light', 4500],
  ['d05-time-sheet-road', DESKTOP, 'demo-timesheet-road-dark', 4000],
  ['d06-unknown-trpg', DESKTOP, 'demo-unknown-trpg-dark', 9000],
  ['d07-forum-campus', DESKTOP, 'demo-forum-campus-light', 8000],
  ['d08-lore-trpg', DESKTOP, 'demo-lore-trpg-dark', 2000],
  ['d09-character-road', DESKTOP, 'demo-character-road-light', 2000],
  ['d10-work-trpg', DESKTOP, 'work-trpg-dark', 2000],
  ['d11-calendar-campus', DESKTOP, 'demo-calendar-campus-light', 2000],
  ['d12-turn-trpg', DESKTOP, 'demo-turn-trpg-light', 5000],
  ['m01-shelf', PHONE, 'shelf-light', 1500],
  ['m02-reading-road', PHONE, 'read-road-dark', 1500],
  ['m03-running-campus', PHONE, 'demo-running-campus-light', 3000],
  ['m04-settle-failed-trpg', PHONE, 'demo-settle-trpg-dark', 4500],
  ['m05-needs-time-campus', PHONE, 'demo-time-campus-light', 4000],
  ['m06-time-sheet-road', PHONE, 'demo-timesheet-road-light', 4000],
  ['m07-menu-trpg', PHONE, 'demo-menu-trpg-dark', 2000],
  ['m08-forum-campus', PHONE, 'demo-forum-campus-light', 8000],
  ['m09-character-campus', PHONE, 'demo-character-campus-light', 2000],
  ['m10-work-road', PHONE, 'work-road-light', 2000],
  ['m11-world-trpg', PHONE, 'demo-world-trpg-light', 2000],
  ['m12-turn-road', PHONE, 'demo-turn-road-dark', 5000],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'scean-shoot-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, '--remote-debugging-port=9333', 'about:blank'], {stdio: 'ignore'});
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.length) break; } catch {} await sleep(200); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, {once: true}));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  await send('Page.enable');
  for (const [name, device, hash, wait] of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', device);
    await send('Emulation.setTouchEmulationEnabled', {enabled: device.mobile, maxTouchPoints: device.mobile ? 5 : 0});
    await send('Page.navigate', {url: 'about:blank'});
    await sleep(200);
    await send('Page.navigate', {url: `${BASE}#${hash}`});
    await sleep(wait);
    const shot = await send('Page.captureScreenshot', {format: 'png'});
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log(name);
  }
  ws.close();
} finally { chrome.kill(); await sleep(500); try { rmSync(profile, {recursive: true, force: true}); } catch {} }
