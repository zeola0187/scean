// Reading screen: one story column, a quiet "此刻" margin, a sticky composer.
// Anything not yet committed lives in the pending zone, never in the story.
import {h, replace, friendly} from './s2-core.mjs';
import {PHASES, phaseIndex} from './s2-turn.mjs';
import {proseNodes, changeRows, changeSummary, renderChanges, stateGroups, placeOf, valueText, avatar, castIndex, CATEGORY, clockText} from './s2-render.mjs';
import {renderFrontendDocument} from './frontend-runtime.mjs';

// Post-body settlement reports time problems with these codes; a player time confirmation on a new turn resolves them.
const TIME_CODES = new Set(['POST_TIME_INVALID', 'NEEDS_TIME_PRECISION', 'TIME_CONFIRMATION_ENDPOINT_REQUIRED', 'TEMPORAL_BODY_CONFLICT']);
const timeIssue = f => TIME_CODES.has(f?.code);

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 180;

export function createReader(actions) {
  const {store, ops} = actions;
  const bar = h('header', {class: 'reader-bar'}), flow = h('div', {class: 'flow', role: 'log', 'aria-label': '故事正文'});
  const pending = h('div', {class: 'pending-zone', 'aria-live': 'polite'}), composer = createComposer(actions);
  const margin = h('aside', {class: 'margin', 'aria-label': '此刻'});
  const el = h('div', {class: 'reader'}, bar, h('div', {class: 'reader-grid'}, h('main', {class: 'flow-col'}, flow, pending, composer.el), margin));
  const keys = {}; const changed = (k, v) => { const j = JSON.stringify(v); if (keys[k] === j) return false; keys[k] = j; return true; };
  let lastLen = -1, lastPhase = null, lastSaved = false, workPanel = null;
  function update(s) {
    if (!s.run) { replace(flow, h('p', {class: 'loading'}, '正在打開這場演出…')); composer.update(s); return; }
    const stick = nearBottom();
    if (changed('bar', [s.run.version, s.run.storyClockLabel, s.op?.phase])) replace(bar, renderBar(s, actions));
    const flowChanged = changed('flow', [s.run.version, s.turns.length, s.turns[0]?.commitId, s.highlight, s.confirm, !!s.op, s.op?.kind === 'regenerate' && s.op.phase, s.notice, s.history?.hasMore]);
    if (flowChanged) replace(flow, renderFlow(s, actions));
    // The author's work panel follows the newest committed section only; earlier sections never show it.
    const panelChanged = changed('panel', [s.run.cardFrontend?.status ?? null, s.run.cardFrontend?.projection?.canonical ?? null]);
    if (panelChanged) { workPanel?.remove(); workPanel = renderWorkPanel(s.run); }
    if ((flowChanged || panelChanged) && workPanel) flow.append(workPanel);
    if (changed('pending', [s.op && {...s.op, stage: null}])) replace(pending, s.op ? renderPending(s, actions) : null);
    if (s.op?.phase === 'running') { const at = phaseIndex(s.op.stage); pending.querySelectorAll('.phases li').forEach((li, i) => { li.className = i < at ? 'done' : i === at ? 'now' : ''; if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }); }
    if (changed('margin', [s.run.version, s.run.cardFrontend?.projection?.canonical ?? null])) replace(margin, renderMargin(s, actions));
    composer.update(s);
    if ((stick && (lastLen !== s.turns.length || lastPhase !== (s.op?.phase ?? null))) || (s.op?.savedBody && !lastSaved)) requestAnimationFrame(scrollEnd);
    lastLen = s.turns.length; lastPhase = s.op?.phase ?? null; lastSaved = !!s.op?.savedBody;
  }
  const scrollEnd = () => window.scrollTo({top: document.documentElement.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  const ticker = setInterval(() => { const t = pending.querySelector('.elapsed'); if (t) t.textContent = `${Math.max(0, Math.round((Date.now() - Number(t.dataset.start)) / 1000))} 秒`; }, 1000);
  return {el, update, scrollEnd, dispose() { clearInterval(ticker); composer.dispose(); }};
}

function renderBar(s, actions) {
  const run = s.run, place = placeOf(run);
  return [
    h('button', {class: 'ghost back', type: 'button', 'aria-label': '回到舞台書架', onclick: () => actions.home()}, h('span', {'aria-hidden': 'true'}, '‹'), h('span', {class: 'back-label'}, '舞台')),
    h('div', {class: 'bar-title'}, h('strong', null, run.snapshot?.card?.name ?? '演出'), h('span', {class: 'bar-sub'}, run.playerIdentity?.name ? `${run.playerIdentity.name} 的故事` : `${run.turnCount ?? 0} 段`)),
    run.storyClockLabel || place ? h('button', {class: 'now-chip', type: 'button', onclick: () => actions.sheet('now'), 'aria-label': `此刻：${clockText(run.storyClockLabel)} ${place}`},
      h('span', {class: 'now-clock'}, clockText(run.storyClockLabel) || '此刻'), place ? h('span', {class: 'now-place'}, place) : null) : null,
    h('nav', {class: 'bar-tools', 'aria-label': '故事工具'},
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.sheet('recap')}, '回顧'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.sheet('calendar')}, '日曆'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.sheet('forum')}, '論壇'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.sheet('lore')}, '設定集')),
    h('button', {class: 'ghost more', type: 'button', 'aria-label': '更多', onclick: () => actions.sheet('menu')}, h('span', {'aria-hidden': 'true'}, '⋯')),
  ];
}

function renderFlow(s, actions) {
  const run = s.run, out = [], onSpeaker = id => actions.sheet('character', id);
  if (s.history?.hasMore) out.push(h('div', {class: 'earlier'}, h('button', {class: 'ghost small', type: 'button', onclick: () => actions.earlier()}, '載入更早的段落')));
  else {
    out.push(h('header', {class: 'chapter-head'}, h('p', {class: 'eyebrow'}, '開場'), h('h1', null, run.snapshot?.opening?.title && !/已保存主開場/.test(run.snapshot.opening.title) ? run.snapshot.opening.title : run.snapshot?.card?.name ?? '')));
    if (run.openingDisplay) out.push(h('section', {class: 'turn opening'}, h('div', {class: 'prose'}, proseNodes({body: run.openingDisplay}, run, {draft: true}))));
  }
  s.turns.forEach((t, i) => {
    const last = i === s.turns.length - 1, regenerating = last && s.op?.kind === 'regenerate', rows = changeRows(t, run);
    out.push(h('section', {class: `turn${t.commitId === s.highlight ? ' is-new' : ''}${regenerating ? ' is-replacing' : ''}`, id: `turn-${t.turn}`, 'aria-label': `第 ${t.turn} 段`},
      h('div', {class: 'you'}, h('span', {class: 'you-tag'}, '你'), h('p', null, t.input)),
      h('div', {class: 'prose'}, proseNodes(t, run, {onSpeaker})),
      regenerating ? h('p', {class: 'replacing-note'}, '正在重寫這一段；新版本保存前，這段仍是故事的一部分。') : null,
      rows.length ? h('details', {class: 'receipt', open: last || null}, h('summary', null, h('span', {class: 'receipt-title'}, '這一步之後'), h('span', {class: 'receipt-peek'}, changeSummary(rows))), renderChanges(rows)) : null,
      last && !s.op ? lastTools(s, actions) : null));
    if (t.changes?.clock?.changed) out.push(h('div', {class: `time-divider${t.changes.clock.dayChanged ? ' is-day' : ''}`, role: 'separator'}, h('span', null, clockText(t.changes.clock.afterLabel))));
  });
  if (!s.turns.length && !s.op) out.push(h('p', {class: 'first-hint'}, '寫下你想說的話或想做的事，故事就會從這裡繼續。'));
  if (s.notice) out.push(h('p', {class: 'notice', role: 'status'}, s.notice, h('button', {class: 'link', type: 'button', onclick: () => actions.store.set({notice: null})}, '知道了')));
  return out;
}

function lastTools(s, {store, ops}) {
  if (s.confirm === 'regenerate') return h('div', {class: 'confirm-row', role: 'group', 'aria-label': '確認重寫'}, h('p', null, '用同一個行動重新寫這一段？新版本保存成功後才會取代目前這段。'),
    h('button', {class: 'primary small', type: 'button', onclick: () => { store.set({confirm: null}); ops.regenerate(); }}, '重寫'), h('button', {class: 'ghost small', type: 'button', onclick: () => store.set({confirm: null})}, '取消'));
  if (s.confirm === 'rollback') return h('div', {class: 'confirm-row', role: 'group', 'aria-label': '確認收回'}, h('p', null, '收回後，這一步的正文、世界變化、時間和記憶會一起撤銷。'),
    h('button', {class: 'danger small', type: 'button', onclick: () => { store.set({confirm: null}); ops.rollback(); }}, '收回'), h('button', {class: 'ghost small', type: 'button', onclick: () => store.set({confirm: null})}, '取消'));
  return h('div', {class: 'turn-tools'}, h('button', {class: 'link', type: 'button', onclick: () => store.set({confirm: 'regenerate'})}, '重寫這段'), h('button', {class: 'link', type: 'button', onclick: () => store.set({confirm: 'rollback'})}, '收回這一步'));
}

function renderPending(s, actions) {
  const {ops} = actions, op = s.op, label = {regenerate: '重寫這段', settlementResume: '繼續整理', rollback: '收回這一步'}[op.kind] ?? '你';
  const input = op.input ? h('div', {class: 'you is-pending'}, h('span', {class: 'you-tag'}, label), h('p', null, op.input), h('span', {class: 'unsaved'}, '尚未保存')) : null;
  const btn = (text, fn, cls = 'ghost') => h('button', {class: `${cls} small`, type: 'button', onclick: fn}, text);
  const card = (tone, title, text, ...buttons) => h('div', {class: `status-card tone-${tone}`, role: tone === 'bad' ? 'alert' : 'status'}, h('strong', {class: 'status-title'}, title), text ? h('p', null, text) : null, buttons.length ? h('div', {class: 'row'}, buttons) : null);
  let status;
  switch (op.phase) {
    case 'running': {
      const at = phaseIndex(op.stage);
      status = h('div', {class: 'status-card tone-busy', role: 'status'},
        op.kind === 'rollback' ? h('strong', {class: 'status-title'}, '正在收回上一步…') : h('ol', {class: 'phases', 'aria-label': '進度'}, PHASES.map((p, i) => h('li', {class: i < at ? 'done' : i === at ? 'now' : ''}, p.label))),
        h('div', {class: 'status-row'},
          op.cancelRefused === 'commit_in_progress' ? h('span', {class: 'meta'}, '已開始保存，來不及取消。') : op.cancelling ? h('span', {class: 'meta'}, '正在取消…') : h('span', {class: 'meta elapsed', 'data-start': String(op.startedAt)}, '0 秒'),
          op.cancelRefused || op.kind === 'rollback' ? null : btn(op.cancelling ? '取消中…' : '取消', () => ops.cancel())));
      break;
    }
    case 'needs_time': status = card('ask', '這一步需要你確認時間', '故事無法判斷這個行動從何時開始或做到何時。確認只套用在這一次送出。', btn('確認時間', () => actions.sheet('time', 'needs'), 'primary'), btn('修改行動', () => ops.dismiss())); break;
    case 'settlement_failed':
      status = h('div', {class: 'status-card tone-warn', role: 'alert'}, h('strong', {class: 'status-title'}, '正文寫好了，世界還沒有更新'),
        h('p', null, '這段正文還不算故事的一部分。「繼續整理世界」會用同一段正文更新狀態與時間，不會重寫。'),
        timeIssue(op.failure) ? h('p', {class: 'time-issue'}, '這次卡在時間：故事無法確定這一步做到何時。你可以指定時間，故事會用同一個行動重新寫這一段（暫存正文會被取代）。') : null,
        op.savedBody ? h('figure', {class: 'draft-body', 'aria-label': '暫存正文，尚未計入故事'}, h('figcaption', null, '暫存正文 · 尚未計入故事'), h('div', {class: 'prose'}, proseNodes({body: op.savedBody}, s.run, {draft: true}))) : null,
        h('div', {class: 'row'}, timeIssue(op.failure) ? btn('指定時間後重寫', () => actions.sheet('time', 'needs'), op.failure?.canResume === false ? 'primary' : undefined) : null, op.failure?.canResume === false ? null : btn('繼續整理世界', () => ops.resume(), 'primary'), op.savedBody ? btn('收起暫存正文', () => ops.hideSaved()) : btn('先讀暫存正文', () => ops.readSaved().catch(e => actions.store.set({notice: friendly(e)}))), btn('放棄這段，修改行動', () => ops.dismiss())),
        op.failure?.canResume === false ? h('p', {class: 'meta'}, timeIssue(op.failure) ? '這段暫存正文已用完整理次數；請指定時間後重寫，或修改行動。' : '這段暫存正文已用完整理次數，請修改行動後重新送出。') : null);
      break;
    case 'unknown': status = card('busy', op.checking ? '正在確認是否已保存…' : '還無法確認是否已保存', op.checking ? '連線在送出途中中斷。正在向存檔查詢這一輪的結果；確認前不會顯示正文。' : '暫時查不到結果。原本的操作可能仍在進行。', op.checking ? null : btn('再查一次', () => ops.recheck(), 'primary')); break;
    case 'not_saved': status = card('bad', '確認結果：這一輪沒有保存', '存檔裡沒有這一輪。可以用同一段行動再試一次，不會重複保存。', btn('再試一次', () => ops.retry(), 'primary'), btn('修改行動', () => ops.dismiss())); break;
    case 'cancelled': status = card('neutral', '已取消，沒有保存任何內容', null, btn('再送一次', () => ops.retry(), 'primary'), btn('修改行動', () => ops.dismiss())); break;
    default: status = card('bad', '這一輪沒有保存', friendly(op.failure) || '操作沒有完成。', op.kind === 'rollback' ? null : btn('再試一次', () => ops.retry(), 'primary'), btn(op.kind === 'turn' ? '修改行動' : '關閉', () => ops.dismiss()));
  }
  return [input, status];
}

// Author panels run in an opaque, script-less sandbox, so their content height cannot be measured.
// Start at the legacy stage's 460px; the reader can drag it, and the height is kept for this session.
let panelHeight = 460;
function renderWorkPanel(run) {
  if (run.cardFrontend?.status !== 'ready') return null;
  let frame; try { frame = h('iframe', {class: 'card-panel', title: '作品面板（作者製作，唯讀）', sandbox: '', referrerpolicy: 'no-referrer', srcdoc: renderFrontendDocument(run.cardFrontend.frontend, {...run.cardFrontend.projection, freshness: 'current'})}); } catch { return null; }
  const box = h('div', {class: 'panel-frame', style: `height:${panelHeight}px`}, frame);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { const hgt = Math.round(box.getBoundingClientRect().height); if (hgt > 120) panelHeight = hgt; }).observe(box);
  return h('section', {class: 'work-panel', 'aria-label': '作品面板'}, h('p', {class: 'eyebrow'}, '作品面板 · 目前狀態'), box, h('p', {class: 'meta panel-hint'}, '由作者製作，唯讀。可拖曳右下角調整高度。'));
}

function renderMargin(s, actions) {
  const run = s.run, groups = stateGroups(run), cast = run.snapshot?.characters ?? [], idx = castIndex(cast);
  return [
    h('section', {class: 'm-card now'}, h('p', {class: 'eyebrow'}, '此刻'),
      run.storyClockLabel ? h('p', {class: 'm-clock'}, clockText(run.storyClockLabel)) : null,
      ...groups.slice(0, 5).map(([category, rows]) => h('div', {class: 'm-group'}, h('p', {class: 'm-cat'}, CATEGORY[category] ?? category), h('ul', {class: 'm-items'}, rows.slice(0, 6).map(r => h('li', null, h('span', null, r.label), h('strong', null, valueText(r.value, r.unit))))))),
      h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('now')}, '完整狀態與變化紀錄')),
    cast.length ? h('section', {class: 'm-card'}, h('p', {class: 'eyebrow'}, '角色'), h('ul', {class: 'm-cast'}, cast.map(c => h('li', null, h('button', {class: 'cast-row', type: 'button', onclick: () => actions.sheet('character', c.id)}, avatar(c, idx.get(c.id)), h('span', null, h('strong', null, c.name))))))) : null,
    h('section', {class: 'm-card'}, h('p', {class: 'eyebrow'}, '故事世界'), h('div', {class: 'row'}, h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('calendar')}, '日曆'), h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('forum')}, '論壇'))),
  ];
}

function createComposer(actions) {
  const {store, ops, call} = actions;
  const input = h('textarea', {id: 'composer-input', rows: 1, maxlength: 20000, placeholder: '你要說什麼、做什麼？', 'aria-label': '你的行動或對話', 'aria-keyshortcuts': 'Control+Enter Meta+Enter'});
  const send = h('button', {class: 'send', type: 'submit', 'aria-label': '送出行動'}, h('span', {class: 'send-label'}, '送出'), h('span', {'aria-hidden': 'true'}, '↑'));
  const ideasBtn = h('button', {class: 'tool', type: 'button', 'aria-expanded': 'false'}, '想法'), waitBtn = h('button', {class: 'tool', type: 'button', 'aria-expanded': 'false'}, '時間…');
  const attached = h('span', {class: 'attached', hidden: true}), hint = h('span', {class: 'composer-hint'}, 'Ctrl + Enter 送出');
  const tray = h('div', {class: 'tray', hidden: true}), blocked = h('p', {class: 'composer-blocked', hidden: true});
  const form = h('form', {class: 'composer'}, tray, blocked, h('div', {class: 'composer-box'}, input, send), h('div', {class: 'composer-tools'}, ideasBtn, waitBtn, attached, hint));
  let trayKind = null, lastDraft = null;
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, Math.max(120, innerHeight * .28)) + 'px'; };
  input.addEventListener('input', () => { store.set({draft: input.value}); autosize(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); const s = store.get(); if (!input.value.trim() || s.op) return; close(); const text = input.value, time = s.attachedTime?.value; store.set({draft: '', attachedTime: null}); input.value = ''; autosize(); ops.send(text, time); });
  const insert = text => { input.value = input.value.trim() ? `${input.value.trim()}\n${text}` : text; store.set({draft: input.value}); autosize(); input.focus(); close(); };
  const close = () => { trayKind = null; tray.hidden = true; ideasBtn.setAttribute('aria-expanded', 'false'); waitBtn.setAttribute('aria-expanded', 'false'); };
  const open = (kind, btn) => { trayKind = kind; tray.hidden = false; ideasBtn.setAttribute('aria-expanded', String(btn === ideasBtn)); waitBtn.setAttribute('aria-expanded', String(btn === waitBtn)); };
  ideasBtn.addEventListener('click', async () => {
    if (trayKind === 'ideas') return close(); open('ideas', ideasBtn); replace(tray, h('p', {class: 'meta'}, '正在想幾個方向…'));
    const s = store.get();
    try {
      // Background routines can move the head at any time: read it fresh, retry once if stale.
      const ask = async () => { const fresh = await call('runView', {runId: s.runId}); return call('playerIdeas', {runId: s.runId, expectedHead: fresh.head ?? fresh.lastTurn?.commitId ?? null, expectedVersion: fresh.version, requestId: globalThis.crypto.randomUUID()}, {timeout: 180000}); };
      let value; try { value = await ask(); } catch (e) { if (e.code !== 'IDEAS_STALE') throw e; value = await ask(); }
      if (trayKind !== 'ideas') return;
      replace(tray, h('p', {class: 'tray-note'}, '點一個想法放進輸入框，可以再修改；不會自動送出。'), h('ul', {class: 'ideas'}, (value.ideas ?? []).map(i => h('li', null, h('button', {class: 'idea', type: 'button', onclick: () => insert(i.text)}, h('span', {class: 'idea-cat'}, i.category), h('span', null, i.text))))));
    } catch (e) { replace(tray, h('p', {class: 'error'}, `沒有取得想法：${friendly(e)}`)); }
  });
  waitBtn.addEventListener('click', () => {
    if (trayKind === 'wait') return close(); open('wait', waitBtn);
    const s = store.get(), periods = Object.entries(s.run.timeControls?.definition?.periods ?? {}), place = placeOf(s.run) || '這裡';
    const current = s.run.storyClock?.periodId, i = periods.findIndex(([id]) => id === current), next = periods[i + 1], first = periods[0];
    const label = p => p?.[1]?.label ?? p?.[0];
    const options = [['稍等片刻', `我在${place}稍等一下，看看接下來會發生什麼。`], next ? [`等到${label(next)}`, `我在${place}等到${label(next)}。`] : null, first ? [`等到隔天${label(first)}`, `今天先到這裡，我等到隔天${label(first)}再行動。`] : null].filter(Boolean);
    replace(tray, h('p', {class: 'tray-note'}, '等待會寫成你的一個行動放進輸入框；實際經過多久由故事判斷，不會直接撥動時鐘。'),
      h('ul', {class: 'ideas'}, options.map(([l, text]) => h('li', null, h('button', {class: 'idea', type: 'button', onclick: () => insert(text)}, h('span', {class: 'idea-cat'}, l), h('span', null, text))))),
      s.run.timeControls ? h('button', {class: 'link', type: 'button', onclick: () => { close(); actions.sheet('time', 'attach'); }}, '進階：替下一個行動指定確切時間') : null);
  });
  return {
    el: form,
    update(s) {
      if (s.draft !== lastDraft && s.draft !== input.value) { input.value = s.draft; autosize(); }
      lastDraft = s.draft;
      const busy = !!s.op || !s.run; input.disabled = busy; ideasBtn.disabled = busy; waitBtn.disabled = busy || !s.run?.timeControls && !Object.keys(s.run?.state?.world ?? {}).length;
      send.disabled = busy || !input.value.trim();
      blocked.hidden = !s.op; blocked.textContent = s.op?.phase === 'running' ? '這一輪處理中。' : '請先處理上面這一輪，再寫下一個行動。';
      attached.hidden = !s.attachedTime; replace(attached, s.attachedTime ? [`已附加時間：${s.attachedTime.label}`, h('button', {class: 'link', type: 'button', 'aria-label': '移除附加時間', onclick: () => store.set({attachedTime: null})}, '✕')] : null);
      if (busy) close();
    },
    dispose() {},
  };
}
