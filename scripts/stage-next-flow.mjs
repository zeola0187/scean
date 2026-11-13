// Reusable steps for driving the isolated official DSH Web through real UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, DESKTOP, PHONE, STAGE_FRAME} from './cdp-driver.mjs';
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
