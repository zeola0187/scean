// Reusable steps for driving the isolated official DSH Web through real UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, attach, DESKTOP, PHONE, STAGE_FRAME} from './cdp-driver.mjs';
export {DESKTOP, PHONE, STAGE_FRAME};
const repo = path.resolve(import.meta.dirname, '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function harness(label = 'stage-next-dev') { return JSON.parse(await fs.readFile(path.join(repo, 'evidence', label, 'launch.json'), 'utf8')); }

export async function openDsh({label = 'stage-next-dev', device = DESKTOP} = {}) {
  const h = await harness(label), b = await launch();
  await b.viewport(device);
  await b.goto(h.entry);
  await b.click('開啟隔離 DSH');
  await b.waitFor(`document.title.includes('DeepSeek')`, {timeout: 30000});
  await sleep(2500);
  // First-run preview notice (simplified Chinese button in the DSH shell).
  if (await b.evaluate(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='继续')`)) await b.click('继续');
  return {b, h};
}
export async function text(b, frame = 'main') { return b.evaluate(`document.body.innerText`, frame); }

// DSH Desktop (Electron) preview started by scripts/desktop-preview.mjs with --cdp.
export const previewRoot = path.resolve(repo, '..', 'dsh-desktop-preview');
export async function desktopLaunch(label) { return JSON.parse(await fs.readFile(path.join(previewRoot, label, 'launch.json'), 'utf8')); }
export async function openDesktop({label, device = DESKTOP, size = [1440, 900]} = {}) {
  const l = await desktopLaunch(label); if (!l.cdp) throw Error('DESKTOP_WITHOUT_CDP');
  const b = await attach({port: l.cdp});
  if (device.mobile) await b.viewport(device); else { await b.send('Emulation.clearDeviceMetricsOverride').catch(() => {}); await b.windowSize(size[0], size[1], l.pid); }
  await b.waitFor(`document.title.includes('DeepSeek') && document.body.innerText.includes('新会话')`, {timeout: 60000});
  await sleep(1500);
  if (await b.evaluate(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='继续')`)) await b.click('继续');
  return {b, h: l, out: path.join(previewRoot, label)};
}
// One entry for both surfaces: --desktop=<label> attaches to Desktop, otherwise the Web harness.
export async function openSurface({device = DESKTOP} = {}) {
  const label = process.argv.find(a => a.startsWith('--desktop='))?.slice(10);
  if (label) return {...await openDesktop({label, device}), surface: 'desktop', label};
  const web = process.argv.find(a => a.startsWith('--web='))?.slice(6) ?? 'stage-next-dev';
  const r = await openDsh({label: web, device}); return {...r, out: path.join(repo, 'evidence', web), surface: 'web', label: web};
}
