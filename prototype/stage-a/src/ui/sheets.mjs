import {h} from '../lib/h.mjs';
import {avatar, renderChanges} from './parts.mjs';
import {cover} from './shelf.mjs';

const loading = new Set();
// Loads read-only data for a sheet once per (sheet, run version).
function useData(s, {store, transport}, key, loader) {
  const stamp = JSON.stringify([key, s.run?.version ?? null]);
  if (s.sheetData?.stamp === stamp) return s.sheetData;
  if (!loading.has(stamp)) {
    loading.add(stamp);
    loader().then(value => { if (JSON.stringify(store.get().sheet?.kind) === JSON.stringify(s.sheet.kind)) store.set({sheetData: {stamp, value}}); })
      .catch(error => store.set({sheetData: {stamp, error}}))
      .finally(() => loading.delete(stamp));
  }
  return null;
}
const wait = h('p', {class: 'meta sheet-loading'}, '讀取中…');

export function renderSheet(s, ctx) {
  const {actions} = ctx, {kind, arg} = s.sheet;
  const def = SHEETS[kind]; if (!def) return null;
  const {title, sub, body, wide, footer} = def(s, ctx, arg);
  return h('div', {class: 'sheet-layer'},
    h('div', {class: 'scrim', onclick: () => actions.closeSheet()}),
    h('section', {class: `sheet sheet-${kind}${wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title'},
      h('span', {class: 'grabber', 'aria-hidden': 'true'}),
      h('header', {class: 'sheet-head'},
        h('div', null, h('h2', {id: 'sheet-title'}, title), sub ? h('p', {class: 'sheet-sub'}, sub) : null),
        h('button', {class: 'ghost sheet-close', type: 'button', onclick: () => actions.closeSheet()}, '關閉')),
      h('div', {class: 'sheet-body'}, body),
      footer ? h('footer', {class: 'sheet-foot'}, footer) : null));
}

const segmented = (name, value, options, onchange) => h('div', {class: 'segmented', role: 'radiogroup', 'aria-label': name},
  options.map(([v, label]) => h('button', {type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => onchange(v)}, label)));

const SHEETS = {
  work(s, ctx, workId) {
    const data = useData(s, ctx, ['work', workId], () => ctx.transport.call('scriptGet', {workId}));
    if (!data) return {title: '作品', body: wait};
    const w = data.value, saves = s.saves.filter(r => r.workId === workId);
    const form = h('form', {class: 'start-form', onsubmit: async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const name = String(f.get('player') ?? '').trim(); const err = e.currentTarget.querySelector('.error');
      if (!name) { err.textContent = '請填寫這一局的主角名字。'; err.hidden = false; return; }
      e.currentTarget.querySelector('button[type=submit]').disabled = true;
      await ctx.actions.startNew({workId, openingId: f.get('opening'), playerName: name});
    }},
      h('fieldset', {class: 'openings'}, h('legend', null, '選擇開場'),
        w.openings.map((o, i) => h('label', {class: 'opening-choice'}, h('input', {type: 'radio', name: 'opening', value: o.id, checked: i === 0}),
          h('span', null, h('strong', null, o.title), h('span', {class: 'opening-text'}, o.text))))),
      h('label', {class: 'field', htmlFor: 'player-name'}, h('span', null, '這一局的主角名字'), h('input', {id: 'player-name', name: 'player', value: w.playerDefault, maxlength: 80, autocomplete: 'off'}),
        h('small', null, '只用在這一局，正文中的「你」會以這個名字被稱呼。')),
      h('p', {class: 'error', role: 'alert', hidden: true}),
      h('button', {class: 'primary wide', type: 'submit', 'data-autofocus': true}, '開始新故事'));
    return {title: w.title, sub: `版本 r${w.revision} · ${w.startLabel} 開始`, wide: true, body: [
      h('div', {class: 'work-hero'}, cover(w.genre, w.coverGlyph, 'lg'), h('div', null, h('p', {class: 'lede'}, w.tagline), h('p', null, w.description))),
      h('h3', {class: 'sheet-h'}, '登場角色'),
      h('ul', {class: 'cast-grid'}, w.characters.map(c => h('li', {class: 'cast-card'}, avatar(c, 'md'), h('div', null, h('strong', null, c.name), h('small', null, c.role), h('p', null, c.bio))))),
      saves.length ? [h('h3', {class: 'sheet-h'}, '這個作品的存檔'), h('ul', {class: 'save-list compact'}, saves.map(r => h('li', null, h('button', {class: 'save-row', type: 'button', onclick: () => ctx.actions.openRun(r.runId)},
        h('span', {class: 'save-copy'}, h('strong', null, `${r.playerName} 的故事`), h('span', null, `${r.clockLabel} · ${r.turnCount} 段`)), h('span', {class: 'meta'}, '繼續 ›')))))] : null,
      h('h3', {class: 'sheet-h'}, '開一局新的'), form]};
  },

  character(s, ctx, id) {
    const c = s.run.snapshot.characters.find(x => x.id === id);
    const lines = s.turns.flatMap(t => t.body.filter(seg => seg[0] === 'l' && seg[1] === id).map(seg => ({turn: t.turn, text: seg[2]}))).slice(-3).reverse();
    const relation = s.run.state.relations?.[id];
    return {title: c.name, sub: c.role, body: [
      h('div', {class: 'char-hero', style: {'--who': `var(--c-${c.color})`}}, avatar(c, 'lg'), h('div', null, relation ? h('p', {class: 'tag-row'}, h('span', {class: 'tag'}, `目前：${relation}`)) : null, h('p', null, c.bio))),
      h('h3', {class: 'sheet-h'}, '和你的關係'), h('p', null, c.relation),
      h('h3', {class: 'sheet-h'}, '最近說過的話'),
      lines.length ? h('ul', {class: 'quotes'}, lines.map(l => h('li', null, h('a', {href: `#turn-${l.turn}`, onclick: () => ctx.actions.closeSheet()}, `第 ${l.turn} 段`), h('q', null, l.text)))) : h('p', {class: 'meta'}, '這一局裡還沒有台詞。'),
      h('p', {class: 'fine'}, '這裡只顯示作品的公開角色資料與已保存的正文。角色私人狀態與記憶不在玩家畫面出現。')]};
  },

  world(s, ctx) {
    const st = s.run.state, history = s.turns.filter(t => (t.changes ?? []).length || t.clockAfterLabel !== t.clockBeforeLabel).slice().reverse();
    return {title: '此刻', sub: `${s.run.storyClockLabel} · ${st.location}`, body: [
      h('div', {class: 'world-grid'},
        h('section', null, h('h3', {class: 'sheet-h'}, '任務'), st.tasks.length ? h('ul', {class: 'm-list'}, st.tasks.map(t => h('li', null, h('span', null, t.title), h('em', null, t.status)))) : h('p', {class: 'meta'}, '沒有進行中的任務。')),
        h('section', null, h('h3', {class: 'sheet-h'}, '持有與資源'), st.items.length ? h('ul', {class: 'm-items'}, st.items.map(i => h('li', null, h('span', null, i.name), h('strong', null, `${i.qty}${i.unit ?? ''}`)))) : h('p', {class: 'meta'}, '沒有記錄的物品。')),
        h('section', null, h('h3', {class: 'sheet-h'}, '狀態'), st.effects.length ? h('p', {class: 'tag-row'}, st.effects.map(e => h('span', {class: 'tag'}, e.label))) : h('p', {class: 'meta'}, '沒有特殊狀態。')),
        st.facts?.length ? h('section', null, h('h3', {class: 'sheet-h'}, '已確認的事'), h('ul', {class: 'bullets'}, st.facts.map(f => h('li', null, f)))) : null),
      h('h3', {class: 'sheet-h'}, '變化紀錄'),
      h('ol', {class: 'history'}, history.map(t => h('li', null, h('a', {class: 'history-turn', href: `#turn-${t.turn}`, onclick: () => ctx.actions.closeSheet()}, `第 ${t.turn} 段`), renderChanges(t, s, ctx)))),
      h('p', {class: 'fine'}, '只顯示已保存的公開狀態。每一項都來自已提交的回合。')]};
  },

  calendar(s, ctx) {
    const data = useData(s, ctx, ['calendar'], () => ctx.transport.call('worldRoutineRead', {runId: s.runId, kind: 'calendar'}));
    if (!data) return {title: '日曆', body: wait};
    const cal = data.value, STATUS = {planned: '預定', done: '已發生', ongoing: '進行中'};
    return {title: '日曆', sub: `現在：${cal.nowLabel}`, body: [
      h('p', {class: 'fine'}, '日曆上是已公告的公共計畫。是否真的發生，仍以故事正文為準。'),
      h('ol', {class: 'days'}, cal.days.map(d => h('li', {class: `day${d.day === cal.now.day ? ' is-today' : ''}${d.day < cal.now.day ? ' is-past' : ''}`},
        h('div', {class: 'day-head'}, h('strong', null, d.label), d.day === cal.now.day ? h('span', {class: 'tag'}, '今天') : null),
        d.events.length ? h('ul', {class: 'events'}, d.events.map(e => h('li', {class: `event status-${e.unknown ? 'unknown' : e.status}`},
          h('span', {class: 'event-time'}, e.periodLabel), h('span', {class: 'event-label'}, h('strong', null, e.label), e.note ? h('small', null, e.note) : null),
          h('span', {class: 'event-status'}, e.unknown ? '條件未知' : STATUS[e.status] ?? e.status)))) : h('p', {class: 'meta'}, '沒有公告的安排。'))))]};
  },

  forum(s, ctx, postId) {
    const data = useData(s, ctx, ['forum'], () => ctx.transport.call('worldRoutineRead', {runId: s.runId, kind: 'forum'}));
    if (!data) return {title: '論壇', body: wait};
    const forum = data.value, cast = new Map(s.run.snapshot.characters.map(c => [c.id, c]));
    const author = id => cast.get(id) ?? {name: id, color: 'slate'};
    const post = postId && forum.posts.find(p => p.id === postId);
    if (post) return {title: post.title, sub: `${forum.board} · ${author(post.author).name} · ${post.timeLabel}`, body: [
      h('button', {class: 'link back-link', type: 'button', onclick: () => ctx.store.set(x => ({...x, sheet: {...x.sheet, arg: null}}))}, '‹ 所有貼文'),
      h('article', {class: 'post'}, h('header', {class: 'post-head'}, avatar(author(post.author), 'md'), h('div', null, h('strong', null, author(post.author).name), h('small', null, post.timeLabel))), h('p', null, post.body)),
      h('h3', {class: 'sheet-h'}, `留言 ${post.replies.length}`),
      post.replies.length ? h('ul', {class: 'replies'}, post.replies.map(r => h('li', null, avatar(author(r.author)), h('div', null, h('strong', null, author(r.author).name), h('small', null, r.timeLabel), h('p', null, r.text))))) : h('p', {class: 'meta'}, '還沒有留言。'),
      h('p', {class: 'fine'}, '角色的發言是他們自己的說法，不代表事實，也不會改變世界狀態。')]};
    return {title: forum.board, sub: '故事世界裡的論壇 · 只能閱讀', body: [
      h('ul', {class: 'posts'}, forum.posts.map(p => h('li', null, h('button', {class: 'post-row', type: 'button', onclick: () => ctx.store.set(x => ({...x, sheet: {...x.sheet, arg: p.id}}))},
        avatar(author(p.author), 'md'), h('span', {class: 'post-copy'}, h('strong', null, p.title), h('span', {class: 'meta'}, `${author(p.author).name} · ${p.timeLabel} · ${p.replies.length} 則留言`), h('span', {class: 'post-snip'}, p.body)))))),
      h('p', {class: 'fine'}, '角色的發言是他們自己的說法，不代表事實。第一版不提供發文。')]};
  },

  lore(s, ctx, mode = 'known') {
    const ok = s.spoilerOk[s.runId];
    const tabs = segmented('設定集視角', mode, [['known', '我已知的設定'], ['full', '完整設定集']], v => ctx.store.set(x => ({...x, sheet: {...x.sheet, arg: v}})));
    if (mode === 'known') return {title: '設定集', body: [tabs,
      h('div', {class: 'empty-state'}, h('strong', null, '還無法顯示「你已知的設定」'),
        h('p', null, '要知道你在故事裡已經得知哪些設定，存檔需要記錄每段正文觸發過的設定條目。這需要新的「已揭露設定」功能（revealedLore），目前尚未實作。'),
        h('p', null, '在那之前，這裡不會用完整設定集代替，以免把劇透當成你已經知道的內容。'))]};
    if (!ok) return {title: '設定集', body: [tabs,
      h('div', {class: 'empty-state is-warn'}, h('strong', null, '完整設定集包含劇透'),
        h('p', null, '這是作品的全部設定，包括故事還沒揭露的祕密。內容不代表你或任何角色已經知道。'),
        h('button', {class: 'primary', type: 'button', onclick: () => ctx.store.set(x => ({...x, spoilerOk: {...x.spoilerOk, [x.runId]: true}}))}, '我了解，顯示完整設定集'))]};
    const data = useData(s, ctx, ['lore'], () => ctx.transport.call('playerWorldbook', {runId: s.runId}));
    if (!data) return {title: '設定集', body: [tabs, wait]};
    return {title: '設定集', body: [tabs,
      h('p', {class: 'spoiler-banner', role: 'note'}, '完整設定集 · 含劇透 · 不代表你已知的內容'),
      h('ul', {class: 'lore'}, data.value.entries.map(e => h('li', null, h('strong', null, e.title), h('p', null, e.text))))]};
  },

  chapters(s, ctx) {
    return {title: '回顧', sub: `${s.turns.length} 段已保存的正文`, body: [
      h('ol', {class: 'chapters'}, s.chapters.map(c => h('li', null,
        h('p', {class: 'eyebrow'}, `第 ${c.order} 章${c.current ? ' · 進行中' : ''}`), h('strong', null, c.title),
        h('p', null, c.summary || '這一章的摘要會在章節整理後出現。'),
        c.endTurn >= c.startTurn ? h('a', {class: 'link', href: `#turn-${c.startTurn}`, onclick: () => ctx.actions.closeSheet()}, `從第 ${c.startTurn} 段讀起`) : null))),
      h('p', {class: 'fine'}, '摘要是閱讀輔助，原文與已保存狀態才是依據。原文搜尋會在 P1 接上。')]};
  },

  time(s, ctx) {
    const op = s.op; if (!op || op.phase !== 'needs_time') return {title: '確認時間', body: h('p', {class: 'meta'}, '目前沒有需要確認的時間。')};
    const {definition, base} = op.timeControls, periods = definition.periods;
    const form = h('form', {class: 'time-form', onsubmit: e => {
      e.preventDefault(); const f = new FormData(e.currentTarget), err = e.currentTarget.querySelector('.error');
      if (f.get('confirm') !== 'yes') { err.textContent = '請勾選確認。沒有確認不會改變故事時間。'; err.hidden = false; return; }
      const mode = f.get('mode'), day = base.day + Number(f.get('day')), period = f.get('period');
      ctx.actions.closeSheet();
      // rc3 timeConfirmation schemaVersion 2: an explicit, structured confirmation for THIS input only.
      ctx.flow.confirmTime({schemaVersion: 2, confirmed: true, role: mode === 'refine' ? 'origin' : 'endpoint', mode, target: {dayOrdinal: day, ...(period ? {periodId: period} : {})}, base});
    }},
      h('fieldset', null, h('legend', null, '要確認的是'),
        h('label', {class: 'choice'}, h('input', {type: 'radio', name: 'mode', value: 'refine', checked: true}), h('span', null, h('strong', null, '這個行動從何時開始'), h('small', null, '故事仍可依行動內容往後推進時間。'))),
        h('label', {class: 'choice'}, h('input', {type: 'radio', name: 'mode', value: 'advance_to'}), h('span', null, h('strong', null, '這個行動做到何時為止'), h('small', null, '故事會在這個時間點結束這一段。')))),
      h('fieldset', null, h('legend', null, '哪一天'), h('div', {class: 'chips'}, [['0', '今天'], ['1', '明天'], ['2', '後天']].map(([v, l], i) => h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'day', value: v, checked: i === 0}), h('span', null, l))))),
      h('fieldset', null, h('legend', null, '哪個時段'), h('div', {class: 'chips'}, periods.map(p => h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'period', value: p.id, checked: p.id === base.period}), h('span', null, p.label))))),
      h('label', {class: 'choice confirm'}, h('input', {type: 'checkbox', name: 'confirm', value: 'yes'}), h('span', null, '我確認這個時間只用在這一次送出的行動。')),
      h('p', {class: 'error', role: 'alert', hidden: true}),
      h('button', {class: 'primary wide', type: 'submit'}, '用這個時間重新送出'));
    return {title: '確認這一步的時間', sub: `目前故事時間：${s.run.storyClockLabel}`, body: [
      h('blockquote', {class: 'quoted-input'}, op.input), form,
      h('p', {class: 'fine'}, '這只是補充時間資訊，不是「跳過時間」的指令。想讓時間過去，請把等待寫成行動。')]};
  },

  settings(s, ctx) {
    const set = ctx.actions.setPref;
    return {title: '顯示設定', body: [
      h('div', {class: 'setting'}, h('span', null, '外觀'), segmented('外觀', s.prefs.theme, [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], v => set('theme', v))),
      h('div', {class: 'setting'}, h('span', null, '字級'), segmented('字級', s.prefs.size, [['normal', '標準'], ['large', '大字']], v => set('size', v))),
      h('div', {class: 'setting'}, h('span', null, '題材外觀'), segmented('題材外觀', s.prefs.skin, [['genre', '跟隨作品'], ['neutral', '統一中性']], v => set('skin', v))),
      h('h3', {class: 'sheet-h'}, '進階'),
      h('div', {class: 'door is-off'}, h('strong', null, '工坊'), h('span', null, '模型分派、摘要服務、備份匯入與診斷會集中在這裡，不出現在遊玩畫面。'), h('em', null, 'P0 未包含'))]};
  },

  lab(s, ctx) {
    const lab = ctx.transport.lab.get();
    const set = patch => { ctx.transport.lab.set(patch); ctx.store.set({sheetData: {stamp: Math.random()}}); };
    return {title: '原型控制台', sub: '只存在於原型，正式版不會出現', body: [
      h('p', null, '指定下一次送出行動時要模擬的結果。所有回應都來自 Mock Transport，不會呼叫任何模型。'),
      h('fieldset', {class: 'lab-outcomes'}, h('legend', null, '下一次送出的結果'),
        Object.entries(ctx.transport.lab.outcomes).map(([k, label]) => h('label', {class: 'choice'}, h('input', {type: 'radio', name: 'outcome', value: k, checked: lab.next === k, onchange: () => set({next: k})}), h('span', null, label)))),
      h('label', {class: 'choice'}, h('input', {type: 'checkbox', checked: lab.sticky, onchange: e => set({sticky: e.target.checked})}), h('span', null, '每次送出都套用（否則用一次後回到正常）')),
      h('div', {class: 'setting'}, h('span', null, '模擬速度'), segmented('模擬速度', lab.speed, [[1, '1×'], [2, '2×'], [4, '4×']], v => set({speed: v}))),
      h('p', {class: 'fine'}, '資料只存在這個分頁的記憶體裡。重新整理頁面會回到初始範例。')]};
  },

  menu(s, ctx) {
    const go = (k, a) => () => ctx.actions.openSheet(k, a);
    const item = (label, note, onclick, badge) => h('li', null, h('button', {class: 'menu-row', type: 'button', onclick}, h('span', null, h('strong', null, label), h('small', null, note)), badge ? h('span', {class: 'badge'}, badge) : h('span', {'aria-hidden': 'true'}, '›')));
    return {title: s.run.snapshot.title, sub: `${s.run.playerIdentity.name} 的故事`, body: h('ul', {class: 'menu'},
      item('此刻', `${s.run.storyClockLabel} · ${s.run.state.location}`, go('world')),
      item('角色', s.run.snapshot.characters.map(c => c.name).join('、'), go('cast')),
      item('回顧', '章節與摘要', go('chapters')),
      item('日曆', '已公告的安排', go('calendar')),
      item('論壇', '故事世界裡的貼文', go('forum'), s.run.newForum || null),
      item('設定集', '作品設定（完整版含劇透）', go('lore')),
      item('顯示設定', '外觀、字級', go('settings')),
      item('原型控制台', '模擬生成結果', go('lab')))};
  },

  cast(s, ctx) {
    return {title: '角色', body: h('ul', {class: 'm-cast'}, s.run.snapshot.characters.map(c => h('li', null,
      h('button', {class: 'cast-row', type: 'button', onclick: () => ctx.actions.openSheet('character', c.id)}, avatar(c, 'md'), h('span', null, h('strong', null, c.name), h('small', null, s.run.state.relations?.[c.id] ?? c.role))))))};
  },
};
