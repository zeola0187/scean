// End-to-end: Card Studio (prepare, AI review, publish) → Stage v2 (opening,
// turns, failure recovery) through the real official DSH Web UI, on loopback.
// Usage: node scripts/stage-next-e2e.mjs [--phone] [--steps=publish,play,faults]
import fs from 'node:fs/promises';
import path from 'node:path';
import {openDsh, sleep, DESKTOP, PHONE, STAGE_FRAME} from './stage-next-flow.mjs';
const repo = path.resolve(import.meta.dirname, '..'), label = 'stage-next-dev', out = path.join(repo, 'evidence', label);
const phone = process.argv.includes('--phone'), steps = (process.argv.find(a => a.startsWith('--steps='))?.slice(8) ?? 'publish,play').split(',');
const shotDir = path.join(repo, 'evidence', 'e2e'); await fs.mkdir(shotDir, {recursive: true});
const {b} = await openDsh({label, device: phone ? PHONE : DESKTOP});
let n = 0; const shot = async name => { const f = path.join(shotDir, `${phone ? 'm' : 'd'}${String(++n).padStart(2, '0')}-${name}.png`); await b.shot(f); console.log('shot', path.basename(f)); };
const frameText = () => b.evaluate('document.body.innerText', STAGE_FRAME);
const report = {phone, steps: [], errors: []};
const step = async (name, fn) => { const t = Date.now(); try { await fn(); report.steps.push({name, ok: true, ms: Date.now() - t}); } catch (e) { report.steps.push({name, ok: false, error: e.message}); await shot('FAIL-' + name).catch(() => {}); throw e; } };
try {
  await step('open-conversation', async () => {
    if (phone) await b.click('css:button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]').catch(() => {});
    await b.click('請審閱這份作品'); await sleep(2000);
  });
  if (steps.includes('publish')) {
    await step('studio-prepare', async () => {
      await b.click('創作入口'); await sleep(1500); await b.click('創作對話'); await sleep(1500);
      await b.click('檢查並準備'); await b.waitFor(`document.body.innerText.includes('準備進度')`, {timeout: 30000}); await shot('studio-prepared');
    });
    await step('ai-review', async () => {
      await b.click('css:[role=textbox]');
      await b.type('請審閱這份作品'); await b.key('Enter');
      await b.waitFor(`document.body.innerText.includes('審閱完成')`, {timeout: 60000}); await shot('ai-reviewed');
    });
    await step('publish', async () => {
      await b.click('檢查並準備'); await sleep(2500);
      await b.click('送往舞台', {timeout: 30000});
      await b.waitFor(`document.body.innerText.includes('已保存固定劇本')`, {timeout: 60000}); await shot('published'); await b.click('進入舞台');
      await b.waitFor(`!!document.querySelector('iframe[data-scean-native-player]')`, {timeout: 60000}); await sleep(3000); await shot('stage-after-publish');
    });
  } else {
    await step('open-stage', async () => { await b.click('創作入口'); await sleep(1200); await b.click('舞台'); await b.waitFor(`!!document.querySelector('iframe[data-scean-native-player]')`, {timeout: 30000}); await sleep(3000); await shot('stage-shelf'); });
  }
  if (steps.includes('play')) {
    await step('opening', async () => {
      const text = await frameText();
      if (text.includes('繼續閱讀') && !process.argv.includes('--new-performance')) { await b.click('繼續閱讀', {frame: STAGE_FRAME}); await b.waitFor(`!!document.querySelector('#composer-input')`, {frame: STAGE_FRAME, timeout: 30000}); await sleep(1500); await shot('reader-resumed'); if ((await frameText()).includes('修改行動')) await b.click('修改行動', {frame: STAGE_FRAME}); return; }
      if (!text.includes('開一場新的演出') && text.includes('選開場並開演')) await b.click('選開場並開演', {frame: STAGE_FRAME});
      await b.waitFor(`document.body.innerText.includes('開始這場演出')`, {frame: STAGE_FRAME, timeout: 30000}); await b.click('css:#player-name', {frame: STAGE_FRAME}); await b.type('程以安'); await shot('opening-sheet');
      await b.click('開始這場演出', {frame: STAGE_FRAME});
      await b.waitFor(`!!document.querySelector('#composer-input')`, {frame: STAGE_FRAME, timeout: 30000}); await sleep(1500); await shot('reader-opened');
    });
    await step('turn', async () => {
      await b.click('css:#composer-input', {frame: STAGE_FRAME}); await b.type('我停下腳步，抬頭往樓梯上方看。');
      await b.click('送出行動', {frame: STAGE_FRAME}); await sleep(1500); await shot('turn-running');
      await b.waitFor(`!document.querySelector('.pending-zone')?.children.length && document.querySelectorAll('.turn:not(.opening)').length>=1`, {frame: STAGE_FRAME, timeout: 90000});
      await sleep(1200); await shot('turn-committed');
    });
  }
  if (steps.includes('faults')) {
    await step('settlement-failure', async () => {
      await fs.writeFile(path.join(out, 'fault-post_stat.json'), JSON.stringify({fail: true}));
      await b.click('css:#composer-input', {frame: STAGE_FRAME}); await b.type('我們繞到音樂教室後面看看。'); await b.click('送出行動', {frame: STAGE_FRAME});
      await b.waitFor(`document.body.innerText.includes('正文寫好了，世界還沒有更新')`, {frame: STAGE_FRAME, timeout: 90000});
      await b.click('先讀暫存正文', {frame: STAGE_FRAME}); await sleep(1500); await shot('settlement-failed');
      await b.click('繼續整理世界', {frame: STAGE_FRAME});
      await b.waitFor(`!document.querySelector('.pending-zone')?.children.length`, {frame: STAGE_FRAME, timeout: 90000}); await sleep(1200); await shot('settlement-resumed');
    });
    await step('lost-ack', async () => {
      await fs.writeFile(path.join(out, 'fault-ack.json'), '{}');
      await b.click('css:#composer-input', {frame: STAGE_FRAME}); await b.type('隔天早上，我去教室上課。'); await b.click('送出行動', {frame: STAGE_FRAME});
      await sleep(2500); await shot('unknown-checking');
      await b.waitFor(`!document.querySelector('.pending-zone')?.children.length`, {frame: STAGE_FRAME, timeout: 90000}); await sleep(1200); await shot('unknown-resolved');
    });
    await step('cancel', async () => {
      await fs.writeFile(path.join(out, 'fault-writer.json'), JSON.stringify({holdMs: 15000}));
      await b.click('css:#composer-input', {frame: STAGE_FRAME}); await b.type('我舉手問老師一個問題。'); await b.click('送出行動', {frame: STAGE_FRAME});
      await b.waitFor(`document.querySelector('.phases li.now')?.innerText==='書寫正文'`, {frame: STAGE_FRAME, timeout: 30000}); await shot('running-writer');
      await b.click('取消', {frame: STAGE_FRAME});
      await b.waitFor(`document.body.innerText.includes('已取消')`, {frame: STAGE_FRAME, timeout: 40000}); await shot('cancelled');
      await b.click('再送一次', {frame: STAGE_FRAME});
      await b.waitFor(`!document.querySelector('.pending-zone')?.children.length`, {frame: STAGE_FRAME, timeout: 90000}); await sleep(1200); await shot('retried');
    });
  }
  for (const [name, target] of [['now', '完整狀態與變化紀錄'], ['calendar', '日曆'], ['forum', '論壇'], ['lore', '設定集']]) if (steps.includes('sheets')) await step('sheet-' + name, async () => {
    if (phone) { await b.click('更多', {frame: STAGE_FRAME}); await sleep(600); await b.click(name === 'now' ? '此刻' : target, {frame: STAGE_FRAME}); }
    else await b.click(target, {frame: STAGE_FRAME});
    await sleep(2000); await shot('sheet-' + name); await b.click('關閉', {frame: STAGE_FRAME}); await sleep(400);
  });
} catch (e) { report.errors.push(e.message); }
finally {
  report.logs = b.logs.slice(-20);
  try { report.stageText = (await frameText()).slice(-1500); } catch {}
  await fs.writeFile(path.join(shotDir, `${phone ? 'phone' : 'desktop'}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({steps: report.steps, errors: report.errors}, null, 1));
  await b.close();
}
