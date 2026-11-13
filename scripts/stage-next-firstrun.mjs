// First-run journey through the redesigned product, in the real official DSH Web:
// new conversation → 作品 → import a card → 創作 (AI edit) → readiness rail
// (check, AI review, save script) → Stage v2 (opening, turns, sheets).
// Usage: node scripts/stage-next-firstrun.mjs [--phone] [--genre=road|campus|trpg]
import fs from 'node:fs/promises';
import path from 'node:path';
import {openDsh, sleep, DESKTOP, PHONE, STAGE_FRAME} from './stage-next-flow.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const phone = process.argv.includes('--phone'), genre = process.argv.find(a => a.startsWith('--genre='))?.slice(8) ?? 'road';
const file = {campus: 'campus-rooftop', road: 'road-ferry', trpg: 'trpg-ashmine'}[genre];
const inputs = {campus: ['我停下腳步，抬頭往樓梯上方看。', '我們繞到音樂教室後面看看。'], road: ['我把車窗搖下來，問加油站老闆前面的路況。', '我們還是決定上路。'], trpg: ['我舉起火把，沿著腳印往下走。', '我伸手碰了碰那扇鐵門。']}[genre];
const shotDir = path.join(repo, 'evidence', 'firstrun'); await fs.mkdir(shotDir, {recursive: true});
const {b} = await openDsh({device: phone ? PHONE : DESKTOP});
const tag = `${phone ? 'm' : 'd'}-${genre}`; let n = 0;
const shot = async name => { const f = path.join(shotDir, `${tag}-${String(++n).padStart(2, '0')}-${name}.png`); await b.shot(f); console.log('shot', path.basename(f)); };
const report = {genre, phone, steps: [], errors: []};
const step = async (name, fn) => { const t = Date.now(); try { await fn(); report.steps.push({name, ok: true, ms: Date.now() - t}); } catch (e) { report.steps.push({name, ok: false, error: e.message}); await shot('FAIL-' + name).catch(() => {}); throw e; } };
const inStage = {frame: STAGE_FRAME};
const revision = () => b.evaluate(`Number((/已保存 r(\d+)/.exec(document.body.innerText)||[])[1]??-1)`);
try {
  await step('home', async () => {
    await b.click('創作入口'); await b.waitFor(`document.body.innerText.includes('你的作品')`, {timeout: 30000}); await sleep(800); await shot('works-home');
    if (await b.evaluate(`!!document.querySelector('[data-scean-home-action="new-work"]')`)) { await b.click('css:[data-scean-home-action="new-work"]'); await b.waitFor(`document.body.innerText.includes('使用現有角色卡')`, {timeout: 30000}); await sleep(800); await shot('new-work-home'); }
  });
  await step('import-card', async () => {
    await b.click('使用現有角色卡'); await sleep(1500);
    await b.click('匯入工作卡副本'); await sleep(500);
    await b.evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value.includes(${JSON.stringify(file)})));s.value=[...s.options].find(o=>o.value.includes(${JSON.stringify(file)})).value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await b.click('匯入副本');
    await b.waitFor(`!!document.querySelector('[data-scean-readiness]')`, {timeout: 40000}); await sleep(1500); await shot('workbench');
  });
  await step('author-theme', async () => {
    const theme = {campus: 'campus', road: 'road', trpg: 'fantasy'}[genre];
    const before = await revision(), already = await b.evaluate(`document.querySelector('[data-scean-theme="${theme}"]')?.getAttribute('aria-checked')==='true'`);
    if (!already) { await b.click(`css:[data-scean-theme="${theme}"]`); await b.waitFor(`document.querySelector('[data-scean-theme="${theme}"]')?.getAttribute('aria-checked')==='true' && document.body.innerText.includes('已保存 r${before + 1}')`, {timeout: 40000}); }
    await sleep(800); await shot('theme-chosen');
  });
  await step('ai-edit-opening', async () => {
    const before = await revision();
    await b.click('css:[role=textbox]'); await b.type('請把開場改得更有懸疑感'); await b.key('Enter');
    await b.waitFor(`document.body.innerText.includes('作品板上的開場已經更新')`, {timeout: 60000});
    await b.waitFor(`document.body.innerText.includes('已保存 r${before + 1}')`, {timeout: 40000}); await sleep(1500); await shot('ai-edited');
  });
  await step('check', async () => {
    const ready = `!!document.querySelector('[data-scean-step="review-refresh"]:not(:disabled)')`;
    await b.click('css:[data-scean-step="check"]');
    try { await b.waitFor(ready, {timeout: 10000}); } catch { report.checkRetry = await b.evaluate(`[...document.querySelectorAll('[role=alert],.workspace-notice,[data-stage-receipt]')].map(e=>e.innerText.trim()).filter(Boolean).join(' || ')`); await shot('check-first-click'); await b.click('css:[data-scean-step="check"]'); await b.waitFor(ready, {timeout: 30000}); }
    await sleep(800); await shot('checked');
  });
  await step('ai-review', async () => {
    await b.click('css:[role=textbox]'); await b.type('請審閱這份作品'); await b.key('Enter');
    await b.waitFor(`document.body.innerText.includes('審閱完成')`, {timeout: 60000});
    // No manual click: the rail updates itself when the conversation settles.
    await b.waitFor(`!!document.querySelector('[data-scean-step="publish"]:not(:disabled)')`, {timeout: 40000}); await sleep(800); await shot('reviewed');
  });
  await step('publish-and-open-stage', async () => {
    await b.click('css:[data-scean-step="publish"]');
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 60000});
    await b.waitFor(`document.body.innerText.includes('選開場並開演')`, {...inStage, timeout: 30000}); await sleep(800); await shot('stage-shelf');
  });
  await step('opening', async () => {
    await b.click('選開場並開演', inStage); await b.waitFor(`document.body.innerText.includes('開始這場演出')`, {...inStage, timeout: 30000});
    await b.click('css:#player-name', inStage); await b.type({campus: '程以安', road: '季遠', trpg: '瑟恩'}[genre]); await sleep(300); await shot('opening-sheet');
    await b.click('開始這場演出', inStage); await b.waitFor(`!!document.querySelector('#composer-input')`, {...inStage, timeout: 30000}); await sleep(1500); await shot('reader');
    report.stageTheme = await b.evaluate('document.documentElement.dataset.genre', STAGE_FRAME);
  });
  for (const [i, text] of inputs.entries()) await step('turn-' + (i + 1), async () => {
    await b.click('css:#composer-input', inStage); await b.type(text); await b.click('送出行動', inStage);
    if (i === 0) { await sleep(1200); await shot('turn-running'); }
    await b.waitFor(`!document.querySelector('.pending-zone')?.children.length && document.querySelectorAll('.turn:not(.opening)').length>=${i + 1}`, {...inStage, timeout: 90000}); await sleep(1200); await shot('turn-' + (i + 1));
  });
  if (process.argv.includes('--faults')) {
    const out = path.join(repo, 'evidence', 'stage-next-dev'), send = async text => { await b.click('css:#composer-input', inStage); await b.type(text); await b.click('送出行動', inStage); };
    const settled = `!document.querySelector('.pending-zone')?.children.length`;
    await step('fault-settlement', async () => {
      await fs.writeFile(path.join(out, 'fault-post_stat.json'), JSON.stringify({fail: true})); await send('（測試）先停下來想一想。');
      await b.waitFor(`document.body.innerText.includes('正文寫好了，世界還沒有更新')`, {...inStage, timeout: 90000}); await shot('fault-settlement');
      await b.click('先讀暫存正文', inStage); await sleep(1200); await shot('fault-saved-draft');
      await b.click('繼續整理世界', inStage); await b.waitFor(settled, {...inStage, timeout: 90000}); await sleep(1000); await shot('fault-resumed');
    });
    await step('fault-lost-ack', async () => {
      await fs.writeFile(path.join(out, 'fault-ack.json'), '{}'); await send('（測試）繼續往前。');
      await sleep(1800); await shot('fault-unknown'); await b.waitFor(settled, {...inStage, timeout: 90000}); await sleep(1000); await shot('fault-unknown-resolved');
    });
    await step('fault-cancel', async () => {
      await fs.writeFile(path.join(out, 'fault-writer.json'), JSON.stringify({holdMs: 15000})); await send('（測試）這一步會被取消。');
      await b.waitFor(`document.querySelector('.phases li.now')?.innerText==='書寫正文'`, {...inStage, timeout: 30000}); await shot('fault-running');
      await b.click('取消', inStage); await b.waitFor(`document.body.innerText.includes('已取消')`, {...inStage, timeout: 40000}); await shot('fault-cancelled');
      await b.click('再送一次', inStage); await b.waitFor(settled, {...inStage, timeout: 90000}); await sleep(1000); await shot('fault-retried');
    });
  }
  await step('ideas', async () => {
    await b.click('想法', inStage); await b.waitFor(`document.querySelectorAll('.idea').length>=5`, {...inStage, timeout: 30000}); await shot('ideas'); await b.click('想法', inStage);
  });
  for (const [name, target] of [['character', null], ['now', '此刻'], ['calendar', '日曆'], ['forum', '論壇'], ['lore', '設定集'], ['menu', null]]) await step('sheet-' + name, async () => {
    if (name === 'character') await b.click('css:.who', inStage);
    else if (name === 'menu') await b.click('更多', inStage);
    else if (phone || name === 'now') { await b.click('更多', inStage); await sleep(500); await b.click(target, inStage); }
    else await b.click(target, inStage);
    await sleep(1800); await shot('sheet-' + name); await b.click('關閉', inStage); await sleep(400);
  });
} catch (e) { report.errors.push(e.message); }
finally {
  report.logs = b.logs.slice(-15);
  try { report.stageText = (await b.evaluate('document.body.innerText', STAGE_FRAME)).slice(-1200); } catch {}
  await fs.writeFile(path.join(shotDir, `${tag}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({steps: report.steps.map(s => `${s.ok ? 'ok ' : 'FAIL'} ${s.name}${s.error ? ' — ' + s.error : ''}`), errors: report.errors}, null, 1));
  await b.close();
}
