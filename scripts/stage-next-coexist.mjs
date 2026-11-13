// Coexistence: Stage v2 and the legacy player read/write the same Host data.
// v2 → legacy (same story visible) → back to v2 → commit a turn → legacy sees it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {openSurface, sleep, STAGE_FRAME} from './stage-next-flow.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const conversation = process.argv.find(a => a.startsWith('--conversation='))?.slice(15) ?? '請審閱這份作品';
const {b, surface, label} = await openSurface();
const dir = surface === 'desktop' ? path.join(repo, 'evidence', 'desktop', label, 'coexist') : path.join(repo, 'evidence', 'coexist'); await fs.mkdir(dir, {recursive: true});
const report = {steps: [], errors: []}; let n = 0;
const shot = async name => b.shot(path.join(dir, `${String(++n).padStart(2, '0')}-${name}.png`));
const step = async (name, fn) => { try { await fn(); report.steps.push(`ok   ${name}`); } catch (e) { report.steps.push(`FAIL ${name} — ${e.message}`); await shot('FAIL-' + name).catch(() => {}); throw e; } };
const ui = () => b.evaluate(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi`);
const v2Turns = () => b.evaluate(`[...document.querySelectorAll('.turn:not(.opening) .prose')].map(p=>p.innerText.trim().slice(0,24))`, STAGE_FRAME);
try {
  await step('open-v2', async () => {
    await b.click(conversation); await sleep(2500); await b.click('舞臺');
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 30000});
    await b.click('繼續閱讀', {frame: STAGE_FRAME}); await b.waitFor(`!!document.querySelector('#composer-input')`, {frame: STAGE_FRAME, timeout: 30000}); await sleep(1500);
    report.v2Before = await v2Turns(); await shot('v2');
  });
  await step('switch-to-legacy', async () => {
    await b.click('更多', {frame: STAGE_FRAME}); await sleep(500); await b.click('顯示設定', {frame: STAGE_FRAME}); await sleep(500);
    await b.click('切換到舊版舞台', {frame: STAGE_FRAME});
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='legacy'`, {timeout: 20000}); await sleep(4000);
    const legacyText = await b.evaluate('document.body.innerText', STAGE_FRAME);
    report.legacySeesV2Story = report.v2Before.every(t => legacyText.includes(t.slice(0, 12)));
    await shot('legacy');
    if (!report.legacySeesV2Story) throw Error('legacy view missing committed v2 turns');
  });
  await step('switch-back', async () => {
    await b.click('css:#stage-ui-next', {frame: STAGE_FRAME});
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 20000}); await sleep(2500);
    if ((await b.evaluate('document.body.innerText', STAGE_FRAME)).includes('繼續閱讀')) await b.click('繼續閱讀', {frame: STAGE_FRAME});
    await b.waitFor(`!!document.querySelector('#composer-input')`, {frame: STAGE_FRAME, timeout: 30000}); await sleep(1000); await shot('v2-again');
  });
  await step('v2-turn-then-legacy-reads-it', async () => {
    const before = (await v2Turns()).length, uniqueInput = '我回頭看了一眼走廊（' + Date.now().toString(36) + '）。'; report.uniqueInput = uniqueInput;
    await b.click('css:#composer-input', {frame: STAGE_FRAME}); await b.type(uniqueInput); await b.click('送出行動', {frame: STAGE_FRAME});
    await b.waitFor(`!document.querySelector('.pending-zone')?.children.length && document.querySelectorAll('.turn:not(.opening)').length>${before}`, {frame: STAGE_FRAME, timeout: 90000});
    const newest = (await v2Turns()).at(-1); report.newestTurn = newest;
    await b.click('更多', {frame: STAGE_FRAME}); await sleep(500); await b.click('顯示設定', {frame: STAGE_FRAME}); await sleep(500); await b.click('切換到舊版舞台', {frame: STAGE_FRAME});
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='legacy'`, {timeout: 20000}); await sleep(4000);
    report.legacySeesNewTurn = (await b.evaluate('document.body.innerText', STAGE_FRAME)).includes(uniqueInput);
    await shot('legacy-after-v2-turn');
    await b.click('css:#stage-ui-next', {frame: STAGE_FRAME}); await sleep(1500);
    if (!report.legacySeesNewTurn) throw Error('legacy did not show the turn committed from v2');
  });
} catch (e) { report.errors.push(e.message); }
finally { await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1)); await b.close(); }
