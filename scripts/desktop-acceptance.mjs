// Real DSH Desktop acceptance beyond the first-run journey (run that first in the same label):
//   node scripts/stage-next-firstrun.mjs --desktop=<label> --genre=trpg --faults
//   node scripts/desktop-acceptance.mjs --desktop=<label> [--from=<phase>]
// Phases: seed2 → stale → versions → turnops → time → race → world → coexist → small → restart.
// The restart phase stops and starts the Desktop instance through scripts/desktop-preview.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDesktop, previewRoot, sleep, STAGE_FRAME} from './stage-next-flow.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const label = process.argv.find(a => a.startsWith('--desktop='))?.slice(10); if (!label) throw Error('--desktop=<label> required');
const from = process.argv.find(a => a.startsWith('--from='))?.slice(7);
const out = path.join(previewRoot, label), dir = path.join(repo, 'evidence', 'desktop', label, 'acceptance'); await fs.mkdir(dir, {recursive: true});
const reportFile = path.join(dir, 'report.json');
const report = from ? JSON.parse(await fs.readFile(reportFile, 'utf8').catch(() => '{"phases":{}}')) : {label, phases: {}};
let {b} = await openDesktop({label});
const F = {frame: STAGE_FRAME}, S = STAGE_FRAME;
let n = 0; const shot = async name => { const f = path.join(dir, `${String(++n).padStart(2, '0')}-${name}.png`); await b.shot(f); return path.basename(f); };
const stageText = () => b.evaluate('document.body.innerText', S);
const settled = `!document.querySelector('.pending-zone')?.children.length`;
const turnCount = () => b.evaluate(`document.querySelectorAll('.turn:not(.opening)').length`, S);
const agentContext = async () => fs.readFile(path.join(out, 'studio-agent-last.json'), 'utf8').catch(() => '');
const adapterCalls = async () => JSON.parse(await fs.readFile(path.join(out, 'adapter-calls.json'), 'utf8').catch(() => '[]'));

async function studioHome() {
  // The SCEAN entry on the DSH start screen, or the product nav when Studio is already open.
  if (await b.evaluate(`!!document.querySelector('[data-product-screen="home"]')`)) await b.click('css:[data-product-screen="home"]');
  else if (await b.evaluate(`!!document.querySelector('.back, .product-nav')`, S).catch(() => false)) {
    // Inside the stage: back to the shelf, then the shared 作品 tab in the stage header.
    if (await b.evaluate(`!!document.querySelector('.back')`, S)) { await b.click('css:.back', F); await sleep(1200); }
    await b.click('作品', F);
  } else await b.click('創作入口');
  await b.waitFor(`document.body.innerText.includes('你的作品')`, {timeout: 40000}); await sleep(1500);
}
async function sidebarConversation(title) { await b.click(`css:a[title="${title}"], [title="${title}"]`, {timeout: 3000}).catch(async () => b.evaluate(`[...document.querySelectorAll('nav a, aside a, [role=treeitem], li')].find(e=>e.innerText.trim().split('\\n')[0]===${JSON.stringify(title)})?.click()`)); await sleep(2000); }
async function rail() { await b.waitFor(`!!document.querySelector('[data-scean-step="check"]')`, {timeout: 40000}); await sleep(800); }
async function chat(text) { await b.click('css:[role=textbox]'); await b.type(text); await b.key('Enter'); }
async function checkReviewPublish() {
  await b.click('css:[data-scean-step="check"]'); await b.waitFor(`!!document.querySelector('[data-scean-step="review-refresh"]:not(:disabled)')`, {timeout: 40000});
  await chat('請審閱這份作品'); await b.waitFor(`!!document.querySelector('[data-scean-step="publish"]:not(:disabled)')`, {timeout: 60000});
  await b.click('css:[data-scean-step="publish"]'); await b.waitFor(`document.body.innerText.includes('開一場新的演出') || document.body.innerText.includes('選開場並開演')`, {...F, timeout: 60000}); await sleep(1500);
}
async function startPerformance(index, name) {
  await b.evaluate(`[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='選開場並開演')[${index}].click()`, S);
  await b.waitFor(`document.body.innerText.includes('開始這場演出')`, {...F, timeout: 30000});
  await b.click('css:#player-name', F); await b.type(name); await b.click('開始這場演出', F);
  await b.waitFor(`!!document.querySelector('#composer-input')`, {...F, timeout: 30000}); await sleep(1000);
}
async function send(text, {wait = true} = {}) {
  const before = await turnCount(); await b.click('css:#composer-input', F); await b.type(text); await b.click('送出行動', F);
  if (wait) await b.waitFor(`${settled} && document.querySelectorAll('.turn:not(.opening)').length>${before}`, {...F, timeout: 90000});
}
async function backToShelf() { await b.click('css:.back', F).catch(() => b.click('舞台', F)); await b.waitFor(`document.body.innerText.includes('開一場新的演出')`, {...F, timeout: 30000}); await sleep(800); }

const phases = {
  async seed2(r) {
    await b.click('新会话'); await sleep(1500); await studioHome();
    r.newConversationEmpty = !(await b.evaluate(`document.body.innerText.includes('這個對話的作品')`));
    await b.click('使用角色卡開始'); await sleep(1500); await b.click('匯入工作卡副本'); await sleep(500);
    await b.evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value.includes('campus-rooftop')));s.value=[...s.options].find(o=>o.value.includes('campus-rooftop')).value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await b.click('匯入副本'); await b.waitFor(`!!document.querySelector('[data-scean-readiness]')`, {timeout: 40000}); await sleep(1500);
    await chat('這張卡的世界觀你怎麼看？'); await b.waitFor(`document.body.innerText.includes('收到：「這張卡的世界觀')`, {timeout: 60000}); await sleep(800);
    const ctx = await agentContext(); r.agentContextHasOtherSeed = /灰燼礦坑|往南的末班渡輪/.test(ctx); r.agentContextBoundToCampus = ctx.includes('Exact document_id=');
    r.shot = await shot('seed2-bound');
    if (!r.newConversationEmpty || r.agentContextHasOtherSeed) throw Error('seed isolation failed');
  },
  async stale(r) {
    // AI edits the card from the plain DSH chat while the Studio panel is closed, then the user opens 作品.
    await b.click('css:[data-product-screen="home"]').catch(() => {}); await sleep(800);
    await b.evaluate(`document.querySelector('[aria-label="關閉"],[data-panel-close]')?.click()`).catch(() => {});
    const title = await b.evaluate(`document.title`);
    await sidebarConversation('創作對話'); r.title = title;
    const before = await adapterCalls();
    await chat('請把開場改得更有懸疑感'); await b.waitFor(`document.body.innerText.includes('作品板上的開場已經更新')`, {timeout: 60000}); await sleep(1500);
    r.studioAgentCalls = (await adapterCalls()).length - before.length;
    await studioHome(); await sleep(2500);
    const home = await b.evaluate(`document.querySelector('[data-scean-home]')?.innerText ?? ''`);
    r.homeRevision = /工作卡 r(\d+)/.exec(home)?.[1]; r.misleadingDraftBanner = home.includes('草稿仍保留') || home.includes('未保存的編輯仍保留');
    r.shot = await shot('stale-home');
    if (r.misleadingDraftBanner || r.homeRevision === '0') throw Error('home stayed stale after an AI edit in the plain chat');
  },
  async versions(r) {
    // v1 = the card as edited above. Publish, play A; edit again; publish v2, play B.
    if (!await b.evaluate(`!!document.querySelector('[data-scean-home]')`)) await studioHome();
    await b.click('繼續創作'); await rail(); await checkReviewPublish(); r.shelfV1 = await shot('shelf-v1');
    await startPerformance(0, '程以安'); await send('我停下腳步，抬頭往樓梯上方看（A場）。');
    r.openingA = (await b.evaluate(`document.querySelector('.turn.opening')?.innerText ?? ''`, S)).slice(-60);
    await backToShelf(); await b.click('創作', F).catch(async () => { await b.click('css:[data-product-screen="studio"]'); }); await rail();
    const ctxBefore = await agentContext(); await chat('請把開場改得更有懸疑感'); await b.waitFor(`document.body.innerText.split('作品板上的開場已經更新').length>2`, {timeout: 60000}).catch(() => {}); await sleep(2500);
    r.secondEditApplied = (await agentContext()) !== ctxBefore;
    await checkReviewPublish(); const shelf = await stageText(); r.shelfV2 = await shot('shelf-v2');
    r.versionsListed = [...shelf.matchAll(/劇本版本 r(\d+)(?: · 保存於 [^·\n]+)? · (\d+) 場演出/g)].map(m => ({revision: Number(m[1]), runs: Number(m[2])}));
    await startPerformance(0, '林若'); const openingB = await b.evaluate(`document.querySelector('.turn.opening')?.innerText ?? ''`, S);
    await send('我推開天台的門（B場）。'); await backToShelf();
    r.openingsDiffer = openingB.slice(-60) !== r.openingA; r.continueRows = (await stageText()).match(/繼續/g)?.length ?? 0; await shot('shelf-two-runs');
    if (r.versionsListed.length < 2 || !r.openingsDiffer) throw Error('script versions not separated');
  },
  async turnops(r) {
    await ensureReader(); await sleep(1000);
    // Leftovers from an interrupted run: an open confirmation row or a typed draft.
    if (await b.evaluate(`!!document.querySelector('.confirm-row')`, S)) { await b.evaluate(`[...document.querySelectorAll('.confirm-row button')].find(x => x.innerText.trim() === '取消')?.click()`, S); await sleep(500); }
    await b.evaluate(`(() => { const i = document.querySelector('#composer-input'); if (i && i.value) { i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); } })()`, S);
    const last = () => b.evaluate(`[...document.querySelectorAll('.turn:not(.opening) .prose')].at(-1)?.innerText.slice(0,40)`, S);
    const t0 = await turnCount(), p0 = await last();
    await b.click('重寫這段', F); await b.click('重寫', F); await sleep(1000); r.regenRunning = await shot('regen-running');
    await b.waitFor(`${settled} && !document.querySelector('.status-card')`, {...F, timeout: 90000}); await sleep(800);
    r.regenerate = {sameCount: (await turnCount()) === t0, changed: (await last()) !== p0}; await shot('regen-done');
    await send('我們繞到音樂教室後面看看（將被收回）。');
    await b.click('收回這一步', F); await b.click('css:.confirm-row .danger', F);
    await b.waitFor(`${settled} && document.querySelectorAll('.turn:not(.opening)').length===${t0}`, {...F, timeout: 60000}); await sleep(800);
    r.rollback = {count: await turnCount(), gone: !(await stageText()).includes('將被收回')}; await shot('rollback-done');
    if (!r.regenerate.sameCount || !r.regenerate.changed || r.rollback.count !== t0 || !r.rollback.gone) throw Error('regenerate/rollback mismatch');
  },
  async time(r) {
    // Two conflicts resolved through 這一步要花多久？ one-click choices: the first (片刻) and the last (到明天…).
    r.cases = [];
    for (const [pick, text] of [['first', '我在天台等到他出現為止（需要確認時間）。'], ['last', '我在社辦等雨停（需要確認時間）。']]) {
      await ensureReader(); const t0 = await turnCount();
      await b.click('css:#composer-input', F); await b.type(text); await b.click('css:.send', F);
      await b.waitFor(`document.body.innerText.includes('這一步需要你確認時間') || document.body.innerText.includes('這次卡在時間')`, {...F, timeout: 90000}); await sleep(600);
      const mode = (await stageText()).includes('這次卡在時間') ? 'post-body settlement' : 'pre-body', noTurnCommitted = (await turnCount()) === t0;
      await b.click(mode === 'pre-body' ? '確認時間' : '指定時間後重寫', F); await sleep(800); await shot('time-sheet-' + pick);
      const choices = await b.evaluate(`[...document.querySelectorAll('.time-choice strong')].map(e => e.innerText)`, S);
      await b.evaluate(`[...document.querySelectorAll('.time-choice')].at(${pick === 'first' ? 0 : -1}).click()`, S);
      await b.waitFor(`${settled} && document.querySelectorAll('.turn:not(.opening)').length>${t0}`, {...F, timeout: 90000}); await sleep(1000);
      const committed = (await turnCount()) === t0 + 1, note = (await stageText()).includes('依你確認的時間'); await shot('time-committed-' + pick);
      r.cases.push({pick, mode, choices, noTurnCommitted, committed, note});
      if (!noTurnCommitted || !committed) throw Error('time confirmation flow failed for ' + pick);
    }
  },
  async race(r) {
    // Background world-routine jobs (calendar, forum) commit right after each turn. Send immediately, three times.
    const t0 = await turnCount(), failures = [];
    for (const [i, text] of ['我拿出手機看了一眼（連送一）。', '我把申請表塞回書包（連送二）。', '我們往樓梯口走（連送三）。'].entries()) {
      await b.waitFor(`!!document.querySelector('#composer-input') && !document.querySelector('#composer-input').disabled`, {...F, timeout: 60000});
      await send(text, {wait: false});
      await b.waitFor(`${settled} || !!document.querySelector('.status-card.tone-bad, .status-card.tone-ask, .status-card.tone-warn')`, {...F, timeout: 90000});
      const bad = await b.evaluate(`document.querySelector('.status-card.tone-bad, .status-card.tone-ask, .status-card.tone-warn')?.innerText ?? null`, S); if (bad) failures.push({i, bad: bad.slice(0, 160)});
    }
    r.turnsAdded = (await turnCount()) - t0; r.failures = failures; r.backgroundCalls = (await adapterCalls()).filter(c => ['calendar_plan', 'forum_post', 'forum_reply'].includes(c.stage)).length; await shot('race-done');
    if (failures.length || r.turnsAdded !== 3) throw Error('turns lost or rejected during background commits');
  },
  async world(r) {
    for (const [name, label] of [['calendar', '日曆'], ['forum', '論壇'], ['now', null], ['character', null]]) {
      if (name === 'now') await b.click('css:.now-chip', F); else if (name === 'character') await b.click('css:.who', F); else await b.click(label, F);
      await sleep(1500); const t = await b.evaluate(`document.querySelector('[role=dialog]')?.innerText ?? ''`, S);
      r[name] = {chars: t.length, sample: t.slice(0, 120).replace(/\n/g, ' / ')}; await shot('sheet-' + name); await b.click('關閉', F); await sleep(300);
    }
    r.calendarHasEvent = /社團|發表|集會|演出|活動/.test(r.calendar.sample + JSON.stringify(r.calendar)); r.forumHasPost = r.forum.chars > 40;
  },
  async coexist(r) {
    const unique = '我回頭看了一眼走廊（' + Date.now().toString(36) + '）。'; await send(unique);
    await b.click('更多', F); await sleep(400); await b.click('顯示設定', F); await sleep(400); await b.click('改用舊版舞台閱讀', F);
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='legacy'`, {timeout: 20000}); await sleep(4000);
    r.legacyShowsTurn = (await stageText()).includes(unique); await shot('legacy');
    await b.click('css:#stage-ui-next', F); await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 20000}); await sleep(2500);
    r.backToNext = true; r.unique = unique; if (!r.legacyShowsTurn) throw Error('legacy did not show the v2 turn');
  },
  async small(r) {
    const l = JSON.parse(await fs.readFile(path.join(out, 'launch.json'), 'utf8'));
    r.size = await b.windowSize(960, 680, l.pid); await sleep(800);
    if ((await stageText()).includes('繼續閱讀')) await b.click('繼續閱讀', F);
    await sleep(1200); r.reader = await shot('small-reader');
    r.horizontalOverflow = await b.evaluate(`document.documentElement.scrollWidth > innerWidth + 1`, S);
    await b.click('更多', F); await sleep(500); r.menu = await shot('small-menu'); await b.click('關閉', F); await sleep(300);
    await studioHome(); r.home = await shot('small-studio-home');
    await b.click('繼續創作').catch(() => {}); await sleep(2000); r.studio = await shot('small-studio');
    r.studioOverflow = await b.evaluate(`[...document.querySelectorAll('[data-scean-workbench],[data-scean-home]')].some(e=>e.scrollWidth>e.clientWidth+1)`);
    await b.windowSize(1440, 900, l.pid);
    await b.click('css:[data-product-screen="stage"]').catch(() => {}); await b.waitFor(`document.body.innerText.includes('繼續閱讀')`, {...F, timeout: 40000}); await b.click('繼續閱讀', F); await b.waitFor(`!!document.querySelector('#composer-input')`, {...F, timeout: 30000});
    if (r.size.w > 1000 || r.horizontalOverflow || r.studioOverflow) throw Error('small window layout problem');
  },
  async workshop(r) {
    await ensureReader(); await b.click('更多', F); await sleep(400); await b.click('進階工坊', F);
    await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='workshop'`, {timeout: 20000}); await sleep(5000); await shot('workshop');
    const labels = await b.evaluate(`[...document.querySelectorAll('.workshop-tool strong')].map(e=>e.innerText)`, S); r.tools = {};
    for (const label of labels) {
      await b.evaluate(`[...document.querySelectorAll('.workshop-tool')].find(x=>x.querySelector('strong').innerText===${JSON.stringify(label)}).click()`, S); await sleep(1000);
      r.tools[label] = await b.evaluate(`[...document.querySelectorAll('dialog[open]')].map(d=>d.id).join(',')`, S);
      await b.evaluate(`for (const d of document.querySelectorAll('dialog[open]')) d.close()`, S); await sleep(200);
    }
    await b.click('css:#stage-ui-next', F); await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 20000}); await sleep(2500);
    if (Object.values(r.tools).some(v => !v) || labels.length < 9) throw Error('workshop tool did not open its dialog');
  },
  async feed(r) {
    await ensureReader(); await sleep(2500);
    const feed = () => b.evaluate(`document.querySelectorAll('.feed .feed-item').length`, S);
    r.unreadShown = await feed(); await shot('feed');
    if (r.unreadShown) {
      await b.click('論壇', F).catch(async () => { await b.click('更多', F); await sleep(300); await b.click('論壇', F); }); await sleep(2500); await b.click('關閉', F); await sleep(2500);
      r.afterForumList = await feed();
      if (r.afterForumList) { await b.click('看過了', F); await sleep(2500); }
      r.afterSeen = await feed();
      if (r.afterSeen !== 0 || r.afterForumList > r.unreadShown) throw Error('feed read marking failed');
    } else r.note = 'no unread items in this run (routine produced none since the last view)';
  },
  async notes(r) {
    await ensureReader();
    const target = await b.evaluate(`(() => { const p = [...document.querySelectorAll('.turn[data-commit] .prose .narr')].at(-1); p.scrollIntoView({block: 'center'}); const q = p.getBoundingClientRect(); return {x: q.left + 20, y: q.top + q.height / 2, text: p.innerText.trim()}; })()`, S);
    const off = await b.evaluate(`(() => { const q = document.querySelector('iframe[data-scean-native-player]').getBoundingClientRect(); return {x: q.left, y: q.top}; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', {type, x: off.x + target.x, y: off.y + target.y, button: 'left', clickCount: 3});
    await sleep(600); r.pin = await b.evaluate(`!document.querySelector('.pin-note').hidden`, S); await b.click('css:.pin-note', F); await sleep(1500);
    await b.click('設定集', F).catch(async () => { await b.click('更多', F); await sleep(300); await b.click('設定集', F); }); await sleep(2500); await shot('notes');
    r.known = await b.evaluate(`[...document.querySelectorAll('.note:not(.is-stale) blockquote')].map(q => q.innerText.trim())`, S); await b.click('關閉', F);
    if (!r.pin || !r.known.includes(target.text)) throw Error('note was not pinned');
  },
  async lease(r) {
    await ensureReader(); r.before = await b.evaluate('JSON.stringify(window.__SCEAN_STAGE_LEASE__)');
    await sleep(150000); r.after = await b.evaluate('JSON.stringify(window.__SCEAN_STAGE_LEASE__)');
    r.scope = await b.evaluate(`(async () => { const c = await globalThis.__SCEAN_NATIVE__.request('native.context', {}); return !!c.cardScope; })()`, S);
    const t0 = await turnCount(); await send('（久置之後）我把窗戶關上。'); r.turnOk = (await turnCount()) === t0 + 1;
    if (!r.scope || !r.turnOk || !JSON.parse(r.after).held) throw Error('stage lost its card scope while left open');
  },
  async resume(r) {
    await ensureReader(); const t0 = await turnCount();
    await fs.writeFile(path.join(out, 'fault-writer.json'), JSON.stringify({holdMs: 8000}));
    await b.click('css:#composer-input', F); await b.type('（中途離開測試）我把門推開一條縫。'); await b.click('css:.send', F); await sleep(1500);
    await b.click('css:.back', F); await sleep(800); await b.click('作品', F); await sleep(4000);
    await b.click('css:[data-product-screen="stage"]'); await b.waitFor(`document.body.innerText.includes('繼續閱讀')`, {...F, timeout: 40000}); await b.click('繼續閱讀', F);
    await b.waitFor(`!!document.querySelector('#composer-input')`, {...F, timeout: 30000}); r.sawPending = await b.evaluate(`!!document.querySelector('.pending-zone')?.children.length`, S);
    await b.waitFor(`${settled} && document.querySelectorAll('.turn:not(.opening)').length>${t0}`, {...F, timeout: 90000}); r.committedAfterReturn = true; await shot('resume');
  },
  async phone(r) {
    await b.viewport({width: 390, height: 844, deviceScaleFactor: 2, mobile: true}); await sleep(1200); await ensureReader();
    r.overflow = await b.evaluate(`document.documentElement.scrollWidth > innerWidth + 1`, S); await shot('phone-reader');
    await b.click('更多', F); await sleep(500); await shot('phone-menu'); r.menu = await b.evaluate(`[...document.querySelectorAll('.menu-row strong')].map(e=>e.innerText)`, S);
    await b.click('日曆', F); await sleep(2000); await shot('phone-calendar'); await b.click('關閉', F); await sleep(300);
    const t0 = await turnCount(); await send('（手機）我回頭看了一眼。'); r.turnOk = (await turnCount()) === t0 + 1; await shot('phone-turn');
    await b.send('Emulation.clearDeviceMetricsOverride'); await b.send('Emulation.setTouchEmulationEnabled', {enabled: false}); await sleep(800);
    if (r.overflow || !r.turnOk) throw Error('phone layout or turn failed');
  },
  async restart(r) {
    const before = {turns: await turnCount(), text: (await stageText()).slice(-400)};
    const cdp = JSON.parse(await fs.readFile(path.join(out, 'launch.json'), 'utf8')).cdp;
    await b.close(); execFileSync(process.execPath, [path.join(repo, 'scripts/desktop-preview.mjs'), 'stop', '--label=' + label], {stdio: 'inherit'});
    execFileSync(process.execPath, [path.join(repo, 'scripts/desktop-preview.mjs'), 'start', '--label=' + label, '--cdp=' + cdp], {stdio: 'inherit'}); await sleep(8000);
    ({b} = await openDesktop({label}));
    await studioHome(); r.homeAfterRestart = (await b.evaluate(`document.querySelector('[data-scean-home]')?.innerText ?? ''`)).includes('放學後的天台'); await shot('home-after-restart');
    await b.click('css:[data-product-screen="stage"]'); await b.waitFor(`document.querySelector('iframe[data-scean-native-player]')?.dataset.sceanStageUi==='next'`, {timeout: 40000});
    await b.waitFor(`document.body.innerText.includes('繼續閱讀')`, {...F, timeout: 40000}); await b.click('繼續閱讀', F);
    await b.waitFor(`!!document.querySelector('#composer-input')`, {...F, timeout: 30000}); await sleep(1500);
    r.turnsPreserved = (await turnCount()) === before.turns; r.uiPreferenceKept = true;
    await send('重新啟動後，我繼續往前走。'); r.turnAfterRestart = (await turnCount()) === before.turns + 1; await shot('after-restart-turn');
    if (!r.homeAfterRestart || !r.turnsPreserved || !r.turnAfterRestart) throw Error('state lost across restart');
  },
};

async function ensureReader() {
  if (await b.evaluate(`!!document.querySelector('#composer-input')`, S).catch(() => false)) return;
  if (!await b.evaluate(`!!document.querySelector('iframe[data-scean-native-player]')`)) {
    // DSH shows the SCEAN entries on the conversation view; fall back to the Studio nav when a panel is open.
    try { await b.click('舞臺', {timeout: 6000}); } catch { await b.click('創作入口', {timeout: 6000}).catch(() => {}); await sleep(3000); await b.click('css:[data-product-screen="stage"]', {timeout: 6000}).catch(() => {}); }
  }
  await b.waitFor(`document.body.innerText.includes('繼續閱讀') || !!document.querySelector('#composer-input')`, {...F, timeout: 60000});
  if (!await b.evaluate(`!!document.querySelector('#composer-input')`, S)) { await b.click('繼續閱讀', F); await b.waitFor(`!!document.querySelector('#composer-input')`, {...F, timeout: 30000}); }
  await sleep(1200);
}
const order = Object.keys(phases); let started = !from;
if (from && ['time', 'race', 'world', 'coexist', 'small', 'workshop', 'feed', 'notes', 'lease', 'resume', 'phone', 'restart'].includes(from)) { await sidebarConversation('創作對話'); await ensureReader(); }
try {
  for (const name of order) {
    if (!started && name === from) started = true; if (!started) continue;
    const r = {}; const t = Date.now();
    try { await phases[name](r); report.phases[name] = {ok: true, ms: Date.now() - t, ...r}; console.log('ok  ', name); }
    catch (e) { report.phases[name] = {ok: false, error: e.message, ...r}; console.log('FAIL', name, e.message); await shot('FAIL-' + name).catch(() => {}); break; }
    finally { await fs.writeFile(reportFile, JSON.stringify(report, null, 2)); }
  }
} finally {
  const calls = await adapterCalls(); report.adapter = {calls: calls.length, paid: calls.filter(c => c.paid).length};
  report.logs = b.logs.slice(-20); await fs.writeFile(reportFile, JSON.stringify(report, null, 2)); await b.close();
}
