import {h, replace} from '../lib/h.mjs';
import {PHASES, phaseOf} from '../domain/turn-flow.mjs';
import {renderChanges, changeSummary, avatar} from './parts.mjs';

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;

export function createReader(ctx) {
  const {store, flow, actions} = ctx;
  const bar = h('header', {class: 'reader-bar'});
  const flowEl = h('div', {class: 'flow', role: 'log', 'aria-label': '故事正文'});
  const pendingEl = h('div', {class: 'pending-zone', 'aria-live': 'polite'});
  const composer = createComposer(ctx);
  const margin = h('aside', {class: 'margin', 'aria-label': '此刻'});
  const col = h('main', {class: 'flow-col'}, flowEl, pendingEl, composer.el);
  const el = h('div', {class: 'reader'}, bar, h('div', {class: 'reader-grid'}, col, margin));
  const keys = {};
  const changed = (name, key) => { const k = JSON.stringify(key); if (keys[name] === k) return false; keys[name] = k; return true; };

  function update(s) {
    if (!s.run) { replace(flowEl, h('p', {class: 'loading'}, '正在打開存檔…')); return; }
    const stick = nearBottom();
    if (changed('bar', [s.run.version, s.run.newForum, s.op?.phase])) replace(bar, renderBar(s, ctx));
    if (changed('flow', [s.run.version, s.turns.length, s.highlight, s.confirm, s.op?.kind === 'regenerate' && s.op.phase, !!s.op, s.notice])) replace(flowEl, renderFlow(s, ctx));
    if (changed('pending', [s.op && {...s.op, stage: null}])) replace(pendingEl, s.op ? renderPending(s, ctx) : null);
    // Stage progress updates in place so buttons in the card are never replaced mid-click.
    if (s.op?.phase === 'running') { const at = Math.max(0, phaseOf(s.op.stage)); pendingEl.querySelectorAll('.phases li').forEach((li, i) => { li.className = i < at ? 'done' : i === at ? 'now' : ''; if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }); }
    if (changed('margin', [s.run.version, s.turns.length])) replace(margin, renderMargin(s, ctx));
    composer.update(s);
    if (stick && (keys.lastLen !== s.turns.length || keys.lastOp !== (s.op?.phase ?? null))) requestAnimationFrame(() => window.scrollTo({top: document.documentElement.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}));
    keys.lastLen = s.turns.length; keys.lastOp = s.op?.phase ?? null;
  }
  // Elapsed-time ticker for the pending card only.
  const ticker = setInterval(() => { const t = pendingEl.querySelector('.elapsed'); if (t) t.textContent = `${Math.round((Date.now() - Number(t.dataset.start)) / 1000)} 秒`; }, 1000);
  return {el, update, dispose() { clearInterval(ticker); composer.dispose(); }};
}

function renderBar(s, {actions}) {
  const run = s.run, chapter = s.chapters.find(c => c.current) ?? s.chapters.at(-1);
  const forumBadge = run.newForum > 0 ? h('span', {class: 'badge', 'aria-label': `${run.newForum} 則新貼文`}, run.newForum) : null;
  return [
    h('button', {class: 'ghost back', type: 'button', onclick: () => actions.goShelf(), 'aria-label': '回到書架'}, h('span', {'aria-hidden': 'true'}, '‹'), h('span', {class: 'back-label'}, '書架')),
    h('div', {class: 'bar-title'},
      h('strong', null, run.snapshot.title),
      h('span', {class: 'bar-sub'}, chapter ? `第 ${chapter.order} 章 · ${chapter.title}` : '')),
    h('button', {class: 'now-chip', type: 'button', onclick: () => actions.openSheet('world'), 'aria-label': `此刻：${run.storyClockLabel}，${run.state.location}`},
      h('span', {class: 'now-clock'}, run.storyClockLabel), h('span', {class: 'now-place'}, run.state.location)),
    h('nav', {class: 'bar-tools', 'aria-label': '故事工具'},
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('chapters')}, '回顧'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('calendar')}, '日曆'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('forum')}, '論壇', forumBadge),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('lore')}, '設定集')),
    h('button', {class: 'ghost more', type: 'button', onclick: () => actions.openSheet('menu'), 'aria-label': '更多'}, h('span', {'aria-hidden': 'true'}, '⋯'), forumBadge ? h('span', {class: 'dot', 'aria-hidden': 'true'}) : null),
  ];
}

function body(segments, s, {actions}, cls = '') {
  const cast = new Map(s.run.snapshot.characters.map(c => [c.id, c]));
  return h('div', {class: `prose ${cls}`}, segments.map(seg => {
    if (seg[0] === 'n') return h('p', {class: 'narr'}, seg[1]);
    const c = cast.get(seg[1]);
    return h('p', {class: 'line', style: {'--who': `var(--c-${c?.color ?? 'slate'})`}},
      h('button', {class: 'who', type: 'button', onclick: () => actions.openSheet('character', seg[1])}, c?.name ?? seg[1]),
      h('span', {class: 'said'}, seg[2]));
  }));
}

function timeDivider(t) {
  if (t.clockAfterLabel === t.clockBeforeLabel) return null;
  const day = t.clockAfter.day !== t.clockBefore.day;
  return h('div', {class: `time-divider${day ? ' is-day' : ''}`, role: 'separator'}, h('span', null, t.clockAfterLabel));
}

function renderFlow(s, ctx) {
  const {actions, flow} = ctx, run = s.run, turns = s.turns, me = run.playerIdentity.name;
  const out = [];
  const firstChapter = s.chapters[0];
  out.push(h('header', {class: 'chapter-head'}, h('p', {class: 'eyebrow'}, '第 1 章'), h('h1', null, firstChapter?.title ?? run.openingTitle)));
  out.push(h('section', {class: 'turn opening'}, body([['n', run.openingDisplay]], s, ctx)));
  turns.forEach((t, i) => {
    const chapter = s.chapters.find(c => c.order > 1 && c.startTurn === t.turn);
    if (chapter) out.push(h('header', {class: 'chapter-head'}, h('p', {class: 'eyebrow'}, `第 ${chapter.order} 章`), h('h2', null, chapter.title)));
    const last = i === turns.length - 1, regenerating = last && s.op?.kind === 'regenerate';
    const changes = t.changes ?? [];
    out.push(h('section', {class: `turn${t.commitId === s.highlight ? ' is-new' : ''}${regenerating ? ' is-replacing' : ''}`, id: `turn-${t.turn}`, 'aria-label': `第 ${t.turn} 段`},
      h('div', {class: 'you'}, h('span', {class: 'you-tag'}, '你'), h('p', null, t.input)),
      body(t.body, s, ctx),
      regenerating ? h('p', {class: 'replacing-note'}, '正在重寫這一段；新版本保存前，這段仍是故事的一部分。') : null,
      changes.length || t.clockAfterLabel !== t.clockBeforeLabel ? h('details', {class: 'receipt', open: last || null},
        h('summary', null, h('span', {class: 'receipt-title'}, '這一步之後'), h('span', {class: 'receipt-peek'}, changeSummary(t, s))),
        renderChanges(t, s, ctx)) : null,
      (t.world ?? []).map(w => h('button', {class: `interlude is-${w.kind}`, type: 'button', onclick: () => actions.openSheet(w.kind, w.kind === 'forum' ? w.id : null)},
        h('span', {class: 'interlude-kind'}, w.kind === 'forum' ? '論壇新貼文' : '日曆新公告'),
        h('strong', null, w.title),
        h('span', {class: 'interlude-meta'}, w.kind === 'forum' ? `${s.run.snapshot.characters.find(c => c.id === w.author)?.name ?? ''} 發表` : '查看日曆'))),
      last && !s.op ? lastTurnTools(s, ctx) : null),
      timeDivider(t));
  });
  if (s.notice) out.push(h('p', {class: 'notice', role: 'status'}, s.notice, h('button', {class: 'link', type: 'button', onclick: () => ctx.store.set({notice: null})}, '知道了')));
  void me; void flow;
  return out;
}

function lastTurnTools(s, {store, flow, actions}) {
  if (s.confirm === 'regenerate') return h('div', {class: 'confirm-row', role: 'group', 'aria-label': '確認重寫'},
    h('p', null, '用同一個行動重新寫這一段？新版本保存後會取代目前這段。'),
    h('button', {class: 'primary small', type: 'button', onclick: () => { store.set({confirm: null}); flow.regenerate(); }}, '重寫'),
    h('button', {class: 'ghost small', type: 'button', onclick: () => store.set({confirm: null})}, '取消'));
  if (s.confirm === 'rollback') return h('div', {class: 'confirm-row', role: 'group', 'aria-label': '確認收回'},
    h('p', null, '收回後，這一步的正文、世界變化和時間都會撤銷，行動會放回輸入框。'),
    h('button', {class: 'danger small', type: 'button', onclick: () => actions.rollback()}, '收回'),
    h('button', {class: 'ghost small', type: 'button', onclick: () => store.set({confirm: null})}, '取消'));
  return h('div', {class: 'turn-tools'},
    h('button', {class: 'link', type: 'button', onclick: () => store.set({confirm: 'regenerate'})}, '重寫這段'),
    h('button', {class: 'link', type: 'button', onclick: () => store.set({confirm: 'rollback'})}, '收回這一步'));
}

function renderPending(s, {flow, actions, store}) {
  const op = s.op, label = op.kind === 'regenerate' ? '重寫這段' : op.kind === 'resume' ? '繼續整理' : '你';
  const input = h('div', {class: 'you is-pending'}, h('span', {class: 'you-tag'}, label), h('p', null, op.input), h('span', {class: 'unsaved'}, '尚未保存'));
  const card = (tone, title, text, ...buttons) => h('div', {class: `status-card tone-${tone}`, role: tone === 'bad' ? 'alert' : 'status'},
    h('strong', {class: 'status-title'}, title), text ? h('p', null, text) : null, buttons.length ? h('div', {class: 'status-actions'}, buttons) : null);
  const btn = (text, onclick, cls = 'ghost') => h('button', {class: `${cls} small`, type: 'button', onclick}, text);
  let status;
  switch (op.phase) {
    case 'running': {
      const at = Math.max(0, phaseOf(op.stage)), secs = Math.round((Date.now() - op.startedAt) / 1000);
      status = h('div', {class: 'status-card tone-busy', role: 'status'},
        h('ol', {class: 'phases', 'aria-label': '進度'}, PHASES.map((p, i) => h('li', {class: i < at ? 'done' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null}, p.label))),
        h('div', {class: 'status-row'},
          op.cancelRefused === 'commit_in_progress' ? h('span', {class: 'meta'}, '已開始保存，來不及取消。') : op.cancelling ? h('span', {class: 'meta'}, '正在取消…') : h('span', {class: 'meta elapsed', 'data-start': op.startedAt}, `${secs} 秒`),
          op.cancelRefused ? null : btn(op.cancelling ? '取消中…' : '取消', () => flow.cancel())));
      break;
    }
    case 'needs_time':
      status = card('ask', '這一步需要你確認時間', '故事無法從目前的時間判斷這個行動從何時開始或做到何時。確認只套用在這次送出，會用同一段行動重新送出。',
        btn('確認時間', () => actions.openSheet('time'), 'primary'), btn('修改行動', () => flow.dismiss()));
      break;
    case 'settlement_failed':
      status = h('div', {class: 'status-card tone-warn', role: 'alert'},
        h('strong', {class: 'status-title'}, '正文寫好了，世界還沒有更新'),
        h('p', null, '這段正文還不算故事的一部分。「繼續整理世界」會用同一段正文更新狀態與時間，不會重寫。'),
        op.savedBody ? h('figure', {class: 'draft-body', 'aria-label': '暫存正文，尚未計入故事'},
          h('figcaption', null, '暫存正文 · 尚未計入故事'), body(op.savedBody, s, {actions}, 'is-draft')) : null,
        h('div', {class: 'status-actions'},
          btn('繼續整理世界', () => flow.resumeSettlement(), 'primary'),
          op.savedBody ? btn('收起暫存正文', () => store.set(x => ({...x, op: x.op && {...x.op, savedBody: null}}))) : btn('先讀暫存正文', () => flow.readSavedBody()),
          btn('放棄這段，修改行動', () => flow.dismiss())));
      break;
    case 'unknown':
      status = card('busy', op.checking ? '正在確認是否已保存…' : '還無法確認是否已保存', op.checking ? '連線在保存時中斷。正在向存檔查詢這一輪的結果，在確認前不會顯示正文。' : (op.error?.message ?? ''),
        op.checking ? null : btn('再查一次', () => flow.recheck(), 'primary'));
      break;
    case 'not_saved':
      status = card('bad', '確認結果：這一輪沒有保存', '存檔裡沒有這一輪。可以用同一段行動再試一次，不會重複保存。', btn('再試一次', () => flow.retry(), 'primary'), btn('修改行動', () => flow.dismiss()));
      break;
    case 'cancelled':
      status = card('neutral', '已取消，沒有保存任何內容', null, btn('再送一次', () => flow.retry(), 'primary'), btn('修改行動', () => flow.dismiss()));
      break;
    default:
      status = card('bad', '沒有保存任何內容', op.error?.message ?? '這一輪沒有完成。', btn('再試一次', () => flow.retry(), 'primary'), btn('修改行動', () => flow.dismiss()));
  }
  return [input, status];
}

function renderMargin(s, {actions}) {
  const run = s.run, st = run.state, last = s.turns.at(-1);
  const recentWorld = s.turns.flatMap(t => t.world ?? []).slice(-3).reverse();
  return [
    h('section', {class: 'm-card now'},
      h('p', {class: 'eyebrow'}, '此刻'),
      h('p', {class: 'm-clock'}, run.storyClockLabel),
      h('p', {class: 'm-place'}, st.location),
      st.tasks.length ? h('ul', {class: 'm-list'}, st.tasks.map(t => h('li', null, h('span', null, t.title), h('em', null, t.status)))) : null,
      st.items.length ? h('ul', {class: 'm-items'}, st.items.map(i => h('li', null, h('span', null, i.name), h('strong', null, `${i.qty}${i.unit ?? ''}`)))) : null,
      st.effects.length ? h('p', {class: 'm-effects'}, st.effects.map(e => h('span', {class: 'tag'}, e.label))) : null,
      h('button', {class: 'link', type: 'button', onclick: () => actions.openSheet('world')}, '完整狀態與變化紀錄')),
    h('section', {class: 'm-card'},
      h('p', {class: 'eyebrow'}, '角色'),
      h('ul', {class: 'm-cast'}, run.snapshot.characters.map(c => h('li', null,
        h('button', {class: 'cast-row', type: 'button', onclick: () => actions.openSheet('character', c.id)}, avatar(c), h('span', null, h('strong', null, c.name), h('small', null, st.relations?.[c.id] ?? c.role))))))),
    h('section', {class: 'm-card'},
      h('p', {class: 'eyebrow'}, '世界動態'),
      recentWorld.length ? h('ul', {class: 'm-list'}, recentWorld.map(w => h('li', null, h('button', {class: 'link', type: 'button', onclick: () => actions.openSheet(w.kind, w.kind === 'forum' ? w.id : null)}, `${w.kind === 'forum' ? '論壇' : '日曆'} · ${w.title}`)))) : h('p', {class: 'meta'}, '這一局還沒有新的世界動態。'),
      h('div', {class: 'm-row'}, h('button', {class: 'ghost small', type: 'button', onclick: () => actions.openSheet('calendar')}, '日曆'), h('button', {class: 'ghost small', type: 'button', onclick: () => actions.openSheet('forum')}, '論壇', run.newForum ? h('span', {class: 'badge'}, run.newForum) : null))),
  ];
}

function createComposer({store, transport, flow, actions}) {
  const input = h('textarea', {id: 'composer-input', rows: 1, maxlength: 20000, placeholder: '你要說什麼、做什麼？', 'aria-label': '你的行動或對話', 'aria-keyshortcuts': 'Control+Enter Meta+Enter'});
  const send = h('button', {class: 'send', type: 'submit', 'aria-label': '送出行動'}, h('span', {class: 'send-label'}, '送出'), h('span', {'aria-hidden': 'true'}, '↑'));
  const ideasBtn = h('button', {class: 'tool', type: 'button', 'aria-expanded': 'false'}, '想法');
  const waitBtn = h('button', {class: 'tool', type: 'button', 'aria-expanded': 'false'}, '等待…');
  const hint = h('span', {class: 'composer-hint'}, 'Ctrl + Enter 送出');
  const tray = h('div', {class: 'tray', hidden: true});
  const blocked = h('p', {class: 'composer-blocked', hidden: true});
  const form = h('form', {class: 'composer'}, tray, blocked, h('div', {class: 'composer-box'}, input, send), h('div', {class: 'composer-tools'}, ideasBtn, waitBtn, hint));
  let trayKind = null, lastDraft = null;

  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, Math.max(120, innerHeight * 0.28)) + 'px'; };
  input.addEventListener('input', () => { store.set({draft: input.value}); autosize(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); if (!input.value.trim() || store.get().op) return; closeTray(); flow.submit(input.value); });
  const insert = text => { input.value = input.value.trim() ? `${input.value.trim()}\n${text}` : text; store.set({draft: input.value}); autosize(); input.focus(); closeTray(); };
  const closeTray = () => { trayKind = null; tray.hidden = true; ideasBtn.setAttribute('aria-expanded', 'false'); waitBtn.setAttribute('aria-expanded', 'false'); };

  ideasBtn.addEventListener('click', async () => {
    if (trayKind === 'ideas') return closeTray();
    trayKind = 'ideas'; ideasBtn.setAttribute('aria-expanded', 'true'); waitBtn.setAttribute('aria-expanded', 'false'); tray.hidden = false;
    replace(tray, h('p', {class: 'meta'}, '正在想幾個方向…'));
    const s = store.get();
    try {
      const {ideas} = await transport.call('playerIdeas', {runId: s.runId, version: s.run.version});
      if (trayKind !== 'ideas') return;
      replace(tray, h('p', {class: 'tray-note'}, '點一個想法放進輸入框，可以再修改；不會自動送出。'),
        h('ul', {class: 'ideas'}, ideas.map(i => h('li', null, h('button', {class: 'idea', type: 'button', onclick: () => insert(i.text)}, h('span', {class: 'idea-cat'}, i.category), h('span', null, i.text))))));
    } catch (e) { replace(tray, h('p', {class: 'error'}, `沒有取得想法：${e.message}`)); }
  });
  waitBtn.addEventListener('click', () => {
    if (trayKind === 'wait') return closeTray();
    trayKind = 'wait'; waitBtn.setAttribute('aria-expanded', 'true'); ideasBtn.setAttribute('aria-expanded', 'false'); tray.hidden = false;
    const s = store.get(), periods = s.run.timeControls.definition.periods, i = periods.findIndex(p => p.id === s.run.storyClock.period);
    const next = periods[i + 1], place = s.run.state.location;
    const options = [['稍等片刻', `我在${place}稍等一下，看看接下來會發生什麼。`], next ? [`等到${next.label}`, `我在${place}等到${next.label}。`] : null, [`等到隔天${periods[0].label}`, `今天先到這裡，我等到隔天${periods[0].label}再行動。`]].filter(Boolean);
    replace(tray, h('p', {class: 'tray-note'}, '等待會寫成你的一個行動放進輸入框。實際經過多久由故事判斷，不會直接撥動時鐘。'),
      h('ul', {class: 'ideas'}, options.map(([label, text]) => h('li', null, h('button', {class: 'idea', type: 'button', onclick: () => insert(text)}, h('span', {class: 'idea-cat'}, label), h('span', null, text))))));
  });

  return {
    el: form,
    update(s) {
      if (s.draft !== lastDraft && s.draft !== input.value) { input.value = s.draft; autosize(); }
      lastDraft = s.draft;
      const busy = !!s.op;
      input.disabled = busy; ideasBtn.disabled = busy; waitBtn.disabled = busy;
      send.disabled = busy || !input.value.trim();
      blocked.hidden = !busy; blocked.textContent = s.op?.phase === 'running' ? '這一輪處理中。' : '請先處理上面這一輪，再寫下一個行動。';
      if (busy) closeTray();
    },
    dispose() {},
  };
}
