// Read-only and confirmation sheets: right drawer on desktop, bottom sheet on phones.
import {h, friendly} from './s2-core.mjs';
import {stateGroups, changeRows, renderChanges, valueText, avatar, castIndex, CATEGORY, clockText} from './s2-render.mjs';

// Search over saved story text (your inputs and the committed prose). Host-side, newest first, 10 per page.
function recapSearch(s, actions, arg, tabs, sub) {
  const q = (arg.q ?? '').trim(), offset = arg.offset ?? 0;
  const input = h('input', {type: 'search', class: 'recap-query', value: q, placeholder: '人名、地名、一句話…', 'aria-label': '搜尋已保存的原文', 'data-autofocus': true});
  const go = () => { const v = input.value.trim(); if (v) actions.sheet('recap', {tab: 'search', q: v, offset: 0}); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  const form = h('div', {class: 'recap-search'}, input, h('button', {class: 'primary small', type: 'button', onclick: go}, '搜尋'));
  if (!q) return {title: '回顧', sub, body: [tabs, form, h('p', {class: 'fine'}, '只搜尋已保存的正文與你寫下的行動；不會搜尋角色的私密記憶或尚未揭露的設定，也不會呼叫模型。')]};
  const d = useData(s, actions, ['recap-search', q, offset], () => actions.call('historySearch', {runId: s.runId, query: q, mode: 'literal', limit: 10, offset, order: 'newest'}));
  if (!d) return {title: '回顧', sub, body: [tabs, form, wait()]}; if (d.error) return {title: '回顧', sub, body: [tabs, form, failed(d)]};
  const v = d.value, hits = v.hits ?? [];
  return {title: '回顧', sub, body: [tabs, form,
    h('p', {class: 'meta'}, v.total ? `找到 ${v.total} 段，從最新的開始` : '沒有找到。'),
    hits.length ? h('ul', {class: 'hits'}, hits.map(hit => h('li', null, h('button', {class: 'hit-row', type: 'button', onclick: () => actions.sheet('recap', {passage: hit.commitId, q, from: 'search', offset})},
      h('p', {class: 'eyebrow'}, `第 ${hit.turn} 段${hit.snippetField === 'input' ? '・你的行動' : ''}`), h('p', {class: 'hit-text'}, highlight(hit.snippet, q)))))) : null,
    h('div', {class: 'row'}, offset > 0 ? h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('recap', {tab: 'search', q, offset: Math.max(0, offset - 10)})}, '‹ 較新的') : null,
      v.nextOffset !== null && v.nextOffset !== undefined ? h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('recap', {tab: 'search', q, offset: v.nextOffset})}, '較舊的 ›') : null)]};
}

// One saved section (with its neighbours for navigation), exactly as stored.
function recapPassage(s, actions, arg, sub) {
  const d = useData(s, actions, ['recap-passage', arg.passage], () => actions.call('historyRead', {runId: s.runId, commitId: arg.passage, radius: 1}));
  const back = arg.from === 'search' ? h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('recap', {tab: 'search', q: arg.q, offset: arg.offset ?? 0})}, '‹ 回到搜尋結果')
    : arg.chapterId ? h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('recap', {chapterId: arg.chapterId})}, '‹ 回到章節')
    : h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('recap', {tab: 'chapters'})}, '‹ 所有章節');
  const home = h('button', {class: 'primary small', type: 'button', onclick: () => actions.closeSheet()}, '回到目前進度');
  if (!d) return {title: '回顧', sub, body: [back, wait()]}; if (d.error) return {title: '回顧', sub, body: [back, failed(d)]};
  const turns = d.value.turns ?? [], i = turns.findIndex(t => t.commitId === arg.passage), t = turns[i];
  if (!t) return {title: '回顧', sub, body: [back, h('p', {class: 'meta'}, '這一段已不在故事中（可能被收回或重寫）。'), home]};
  const step = other => other ? actions.sheet('recap', {...arg, passage: other.commitId}) : null, prev = turns[i - 1], next = turns[i + 1];
  return {title: `第 ${t.turn} 段`, sub: '已保存的原文', body: [back,
    h('article', {class: 'passage'}, t.input ? h('div', {class: 'you'}, h('span', {class: 'you-tag'}, '你'), h('p', null, highlight(t.input, arg.q))) : null,
      ...String(t.body ?? '').split(/\n+/).filter(x => x.trim()).map(par => h('p', {class: 'narr'}, highlight(par, arg.q)))),
    h('div', {class: 'row passage-nav'}, h('button', {class: 'ghost small', type: 'button', disabled: !prev, onclick: () => step(prev)}, '‹ 上一段'),
      h('button', {class: 'ghost small', type: 'button', disabled: !next, onclick: () => step(next)}, '下一段 ›'), home)]};
}

function highlight(text, q) {
  const value = String(text ?? ''); if (!q) return value;
  const parts = [], lower = value.toLocaleLowerCase(), needle = q.toLocaleLowerCase(); let at = 0, i;
  while ((i = lower.indexOf(needle, at)) >= 0) { parts.push(value.slice(at, i), h('mark', null, value.slice(i, i + q.length))); at = i + q.length; }
  parts.push(value.slice(at)); return parts;
}

// Notes travel as their own small file: run backups do not include them (see the note in the tab).
function exportNotes(s, notes) {
  const data = {format: 'scean-player-notes', version: 1, runId: s.runId, title: s.run?.snapshot?.card?.name ?? null, exportedAt: new Date().toISOString(),
    notes: notes.filter(n => !n.stale).map(n => ({commitId: n.commitId, turn: n.turn, excerpt: n.excerpt, memo: n.memo ?? ''}))};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], {type: 'application/json'})), a = document.createElement('a');
  a.href = url; a.download = `scean-notes-${String(s.runId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function importNotes(s, actions, file) {
  let data; try { data = JSON.parse(await file.text()); } catch { actions.store.set({notice: '這不是筆記檔案。'}); return; }
  if (data?.format !== 'scean-player-notes' || !Array.isArray(data.notes)) { actions.store.set({notice: '這不是 SCEAN 筆記檔案。'}); return; }
  let added = 0, skipped = 0;
  for (const n of data.notes.slice(0, 500)) { try { await actions.call('playerNoteAdd', {runId: s.runId, commitId: String(n.commitId), excerpt: String(n.excerpt), memo: String(n.memo ?? '')}); added++; } catch { skipped++; } }
  actions.store.set(x => ({...x, sheetData: null, notice: skipped ? `匯入 ${added} 則筆記；${skipped} 則在這場演出裡找不到對應段落，沒有匯入。` : `匯入 ${added} 則筆記。`}));
}

// Viewing the forum or calendar marks exactly the unread feed items that were on screen.
const shownMarked = new Set();
function markShown(s, actions, ids) {
  const unread = new Set((s.feed?.items ?? []).map(i => i.id)), todo = ids.filter(id => unread.has(id) && !shownMarked.has(id));
  if (!todo.length || typeof actions.feedSeen !== 'function') return;
  todo.forEach(id => shownMarked.add(id)); queueMicrotask(() => void actions.feedSeen({ids: todo}));
}
import {resolveTemplateSegments} from './player-text.mjs';

const loading = new Set();
function useData(s, actions, key, loader) {
  const stamp = JSON.stringify([key, s.run?.version ?? null]);
  if (s.sheetData?.stamp === stamp) return s.sheetData;
  if (!loading.has(stamp)) {
    loading.add(stamp);
    loader().then(value => { if (actions.store.get().sheet?.kind === s.sheet.kind) actions.store.set({sheetData: {stamp, value}}); })
      .catch(error => { if (actions.store.get().sheet?.kind === s.sheet.kind) actions.store.set({sheetData: {stamp, error}}); })
      .finally(() => loading.delete(stamp));
  }
  return null;
}
const wait = () => h('p', {class: 'meta sheet-loading'}, '讀取中…');
const failed = (d, retry) => h('div', {class: 'empty-state is-warn'}, h('strong', null, '暫時無法讀取'), h('p', null, friendly(d.error)), retry ? h('button', {class: 'ghost small', type: 'button', onclick: retry}, '重新讀取') : null);
const seg = (name, value, options, onchange) => h('div', {class: 'segmented', role: 'radiogroup', 'aria-label': name}, options.map(([v, label]) => h('button', {type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => onchange(v)}, label)));

export function renderSheet(s, actions) {
  const def = SHEETS[s.sheet.kind]; if (!def) return null;
  const {title, sub, body, wide} = def(s, actions, s.sheet.arg);
  return h('div', {class: 'sheet-layer'}, h('div', {class: 'scrim', onclick: () => actions.closeSheet()}),
    h('section', {class: `sheet sheet-${s.sheet.kind}${wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title'},
      h('span', {class: 'grabber', 'aria-hidden': 'true'}),
      h('header', {class: 'sheet-head'}, h('div', null, h('h2', {id: 'sheet-title'}, title), sub ? h('p', {class: 'sheet-sub'}, sub) : null), h('button', {class: 'ghost sheet-close', type: 'button', onclick: () => actions.closeSheet()}, '關閉')),
      h('div', {class: 'sheet-body'}, body)));
}

const SHEETS = {
  opening(s, actions, offer) {
    let name = offer.defaultPlayerName ?? '', choice = offer.options?.[0]?.index ?? 0;
    const preview = h('p', {class: 'opening-text'}), err = h('p', {class: 'error', role: 'alert', hidden: true});
    const paint = () => { const o = offer.options.find(x => x.index === choice); preview.textContent = resolveTemplateSegments(o?.text ?? '', name.trim(), o?.textSpans); };
    const submit = h('button', {class: 'primary wide', type: 'submit', 'data-autofocus': true}, '開始這場演出');
    const form = h('form', {class: 'start-form', onsubmit: async e => {
      e.preventDefault(); if (!name.trim()) { err.textContent = '請填寫這一局主角的名字。'; err.hidden = false; return; }
      submit.disabled = true; submit.textContent = '正在建立…';
      try { await actions.startOpening(offer, choice, name.trim()); } catch (error) { err.textContent = friendly(error); err.hidden = false; submit.disabled = false; submit.textContent = '開始這場演出'; }
    }},
      h('fieldset', {class: 'openings'}, h('legend', null, '選擇開場'), offer.options.map((o, i) => h('label', {class: 'opening-choice'},
        h('input', {type: 'radio', name: 'opening', value: String(o.index), checked: i === 0, onchange: () => { choice = o.index; paint(); }}), h('span', null, h('strong', null, o.title), h('span', {class: 'opening-text'}, (o.text ?? '').slice(0, 90) + ((o.text ?? '').length > 90 ? '…' : '')))))),
      h('label', {class: 'field'}, h('span', null, '這一局主角的名字'), h('input', {id: 'player-name', value: name, maxlength: 80, autocomplete: 'off', oninput: e => { name = e.target.value; paint(); }}), h('small', null, '只用在這一局；作品與其他演出不受影響。')),
      h('figure', {class: 'opening-preview'}, h('figcaption', null, '開場預覽'), preview), err, submit);
    paint();
    return {title: '開一場新的演出', sub: `劇本版本 r${offer.revision}`, wide: true, body: form};
  },

  character(s, actions, id) {
    const cast = s.run?.snapshot?.characters ?? [], c = cast.find(x => x.id === id), idx = castIndex(cast);
    if (!c) return {title: '角色', body: h('p', {class: 'meta'}, '找不到這個角色。')};
    const lines = [];
    for (const t of [...s.turns].reverse()) { for (const sp of (t.dialoguePresentation?.spans ?? [])) if (sp.speakerId === id && lines.length < 3) lines.push({turn: t.turn, text: sp.text}); }
    return {title: c.name, sub: c.identity?.pronouns ? `代稱：${c.identity.pronouns}` : null, body: [
      h('div', {class: `char-hero c${idx.get(id)}`}, avatar(c, idx.get(id), 'lg'), h('p', null, c.description ?? '作者沒有提供這個角色的公開介紹。')),
      h('h3', {class: 'sheet-h'}, '最近說過的話'),
      lines.length ? h('ul', {class: 'quotes'}, lines.map(l => h('li', null, h('a', {href: `#turn-${l.turn}`, onclick: () => actions.closeSheet()}, `第 ${l.turn} 段`), h('q', null, l.text)))) : h('p', {class: 'meta'}, '這場演出裡還沒有標記到台詞。'),
      h('p', {class: 'fine'}, '只顯示作品標為公開的角色介紹與已保存的正文。角色的私人狀態與記憶不會出現在玩家畫面。')]};
  },

  now(s, actions) {
    const run = s.run, groups = stateGroups(run), history = s.turns.map(t => ({t, rows: changeRows(t, run)})).filter(x => x.rows.length).reverse();
    return {title: '此刻', sub: clockText(run.storyClockLabel), body: [
      groups.length ? h('div', {class: 'world-grid'}, groups.map(([category, rows]) => h('section', null, h('h3', {class: 'sheet-h'}, CATEGORY[category] ?? category), h('ul', {class: 'm-items'}, rows.map(r => h('li', null, h('span', null, r.label), h('strong', null, valueText(r.value, r.unit)))))))) : h('p', {class: 'meta'}, '這部作品沒有公開的世界狀態。'),
      h('h3', {class: 'sheet-h'}, '變化紀錄'),
      history.length ? h('ol', {class: 'history'}, history.map(({t, rows}) => h('li', null, h('a', {class: 'history-turn', href: `#turn-${t.turn}`, onclick: () => actions.closeSheet()}, `第 ${t.turn} 段`), renderChanges(rows)))) : h('p', {class: 'meta'}, '目前載入的段落沒有記錄到變化。'),
      h('p', {class: 'fine'}, '只顯示已保存的公開狀態；每一項都來自已提交的段落。')]};
  },

  calendar(s, actions, params = {}) {
    const d = useData(s, actions, ['calendar', params], () => actions.call('worldRoutineRead', {runId: s.runId, expectedSnapshotHash: s.run.snapshot?.hash, view: 'player', kind: 'calendar', limit: 12, ...params}));
    if (!d) return {title: '日曆', body: wait()}; if (d.error) return {title: '日曆', body: failed(d, () => actions.sheet('calendar', {...params}))};
    markShown(s, actions, (d.value?.entries ?? []).map(e => e.id));
    const v = d.value, STATUS = {planned_not_occurred: '預定', active: '進行中', completed: '已結束', pending_resolution: '條件未知', did_not_occur: '未發生'};
    if (v.status === 'not_enabled') return {title: '日曆', body: h('div', {class: 'empty-state'}, h('strong', null, '這部作品沒有啟用日曆'), h('p', null, '作者可以在創作時為作品開啟「世界日常」，讓角色和世界有自己的安排。'))};
    return {title: '日曆', sub: v.clockLabel ? '現在：' + clockText(v.clockLabel) : null, body: [
      h('p', {class: 'fine top'}, '這裡是已公告的公共安排。是否真的發生，仍以故事正文為準。'),
      h('nav', {class: 'day-strip', 'aria-label': '故事日期'}, (v.days ?? []).map(day => h('button', {type: 'button', class: day.day === v.selectedDay ? 'on' : '', 'aria-pressed': String(day.day === v.selectedDay), onclick: () => actions.sheet('calendar', {windowStart: v.windowStart, day: day.day})}, h('span', null, clockText(day.label)), day.count ? h('b', null, day.count) : null))),
      (v.entries ?? []).length ? h('ul', {class: 'events'}, v.entries.map(e => h('li', {class: `event status-${e.status}`}, h('span', {class: 'event-label'}, h('strong', null, e.label), h('small', null, clockText(`${e.startLabel} ～ ${e.endLabel}`))), h('span', {class: 'event-status'}, STATUS[e.status] ?? e.status)))) : h('p', {class: 'meta'}, '這一天沒有已公告的安排。'),
      h('div', {class: 'row'}, v.previousWindow !== null && v.previousWindow !== undefined ? h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('calendar', {windowStart: v.previousWindow})}, '‹ 較早七日') : null, v.nextWindow !== null && v.nextWindow !== undefined ? h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('calendar', {windowStart: v.nextWindow})}, '較後七日 ›') : null)]};
  },

  forum(s, actions, params = {}) {
    const thread = params.threadId;
    const d = useData(s, actions, ['forum', params], () => actions.call('worldRoutineRead', {runId: s.runId, expectedSnapshotHash: s.run.snapshot?.hash, view: 'player', kind: thread ? 'thread' : 'forum', limit: 12, ...params}));
    if (!d) return {title: '論壇', body: wait()}; if (d.error) return {title: '論壇', body: failed(d, () => actions.sheet('forum', {...params}))};
    const v = d.value, authors = v.authors ?? [], cast = s.run.snapshot?.characters ?? [], idx = castIndex(cast);
    markShown(s, actions, [v.parent?.id, ...(v.entries ?? []).map(e => e.id)].filter(Boolean));
    if (v.status === 'not_enabled') return {title: '論壇', body: h('div', {class: 'empty-state'}, h('strong', null, '這部作品沒有啟用論壇'), h('p', null, '作者可以在創作時為作品設定論壇媒介。'))};
    const who = row => { const id = row?.author?.kind === 'character' ? row.author.characterId : row?.authorId; return row?.author?.kind === 'ambient' ? {name: '路人・' + row.author.displayName, i: 7} : {name: authors.find(a => a.id === id)?.name ?? cast.find(a => a.id === id)?.name ?? id, i: idx.get(id) ?? 0, id}; };
    const by = row => { const w = who(row); return h('p', {class: 'post-by'}, avatar({name: w.name}, w.i), h('span', null, h('strong', null, w.name), h('small', null, clockText(row.timeLabel ?? '')))); };
    if (thread) return {title: v.parent?.title ?? '文章', sub: v.mediumLabel ?? null, body: [
      h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('forum', {})}, '‹ 所有文章'),
      v.parent ? h('article', {class: 'post'}, by(v.parent), h('p', {class: 'post-text'}, v.parent.text)) : h('p', {class: 'meta'}, '文章目前不可讀。'),
      h('h3', {class: 'sheet-h'}, '留言'), (v.entries ?? []).length ? h('ul', {class: 'replies'}, v.entries.map(r => h('li', null, by(r), h('p', null, r.text)))) : h('p', {class: 'meta'}, '還沒有留言。'),
      h('p', {class: 'fine'}, '角色的發言是他們自己的說法，不代表事實，也不會改變世界狀態。')]};
    return {title: '論壇', sub: v.mediumLabel ?? '故事世界裡的貼文・只能閱讀', body: [
      (v.entries ?? []).length ? h('ul', {class: 'posts'}, v.entries.map(p => h('li', null, h('button', {class: 'post-row', type: 'button', onclick: () => actions.sheet('forum', {threadId: p.id})}, h('strong', null, p.title || '（無標題）'), by(p))))) : h('div', {class: 'empty-state'}, h('strong', null, '還沒有文章'), h('p', null, '角色會在故事時間推進後，依自己的日常發文。')),
      v.nextCursor !== null && v.nextCursor !== undefined ? h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('forum', {beforeSequence: v.nextCursor})}, '更早的文章') : null,
      h('p', {class: 'fine'}, '角色的發言是他們自己的說法，不代表事實。第一版不提供發文。')]};
  },

  lore(s, actions, mode = 'known') {
    const tabs = seg('設定集視角', mode, [['known', '我已知的'], ['public', '公開設定'], ['owner', '完整（含劇透）']], v => actions.sheet('lore', v));
    if (mode === 'known') {
      const d = useData(s, actions, ['notes', s.run?.version], () => actions.call('playerNotes', {runId: s.runId}));
      if (!d) return {title: '設定集', body: [tabs, wait()]}; if (d.error) return {title: '設定集', body: [tabs, failed(d)]};
      const notes = d.value.notes ?? [], live = notes.filter(n => !n.stale), stale = notes.filter(n => n.stale);
      const row = n => h('li', {class: `note${n.stale ? ' is-stale' : ''}`}, h('blockquote', null, n.excerpt), h('p', {class: 'meta'}, n.stale ? '這段已被收回或重寫' : `第 ${n.turn} 段`, ' · ', h('button', {class: 'link', type: 'button', onclick: () => actions.deleteNote(n.id)}, '刪除')));
      return {title: '設定集', body: [tabs,
        h('p', {class: 'fine top'}, '這裡只放你自己記下的內容：在故事裡選取文字，按「記下」。不會自動把作者的設定或尚未揭露的祕密放進來。'),
        live.length ? h('ul', {class: 'notes'}, live.map(row)) : h('div', {class: 'empty-state'}, h('strong', null, '還沒有記下任何事'), h('p', null, '讀到想記住的線索、名字或規則時，選取那段文字，按跳出的「記下」。')),
        stale.length ? h('details', {class: 'stale-notes'}, h('summary', null, `已不在故事中的筆記（${stale.length}）`), h('ul', {class: 'notes'}, stale.map(row))) : null,
        h('div', {class: 'row'}, h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('lore', 'public')}, '看作者公開的設定'),
          notes.length ? h('button', {class: 'ghost small', type: 'button', onclick: () => exportNotes(s, notes)}, '匯出筆記') : null,
          h('label', {class: 'ghost small file-pick'}, '匯入筆記', h('input', {type: 'file', accept: '.json,application/json', hidden: true, onchange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importNotes(s, actions, f); }}))),
        h('p', {class: 'fine'}, '演出備份（進階工坊 › 備份與匯入匯出）不包含筆記與世界動態的已讀紀錄。要保留筆記，請另外「匯出筆記」；重新匯入同一場演出後，再「匯入筆記」就能接回原本的段落。')]};
    }
    if (mode === 'owner' && !s.spoilerOk[s.runId]) return {title: '設定集', body: [tabs, h('div', {class: 'empty-state is-warn'}, h('strong', null, '完整設定集包含劇透'),
      h('p', null, '這是本局固定版本的全部設定，包括故事還沒揭露的祕密。閱讀不會改變角色知道的事。'),
      h('button', {class: 'primary', type: 'button', onclick: () => actions.store.set(x => ({...x, spoilerOk: {...x.spoilerOk, [x.runId]: true}}))}, '我了解，顯示完整設定集'))]};
    const entryId = typeof mode === 'object' ? mode.entryId : null, tier = typeof mode === 'object' ? mode.tier : mode;
    const action = tier === 'owner' ? 'ownerWorldbook' : 'playerWorldbook';
    const d = useData(s, actions, ['lore', tier, entryId], () => actions.call(action, {runId: s.runId, expectedSnapshotHash: s.run.snapshot?.hash, ...(entryId ? {entryId} : {})}));
    const banner = tier === 'owner' ? h('p', {class: 'spoiler-banner', role: 'note'}, '完整設定集・含劇透・不代表你已知') : h('p', {class: 'public-banner', role: 'note'}, '作者標為公開的設定・不代表你在故事中已經得知');
    if (!d) return {title: '設定集', body: [tabs, banner, wait()]}; if (d.error) return {title: '設定集', body: [tabs, banner, failed(d)]};
    const v = d.value;
    if (entryId) return {title: v.entry?.title ?? '設定', body: [h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('lore', tier)}, '‹ 回到列表'), banner, h('p', {class: 'lore-text'}, v.entry?.content ?? '')]};
    return {title: '設定集', body: [typeof mode === 'string' ? tabs : null, banner,
      (v.entries ?? []).length ? h('ul', {class: 'lore'}, v.entries.map(e => h('li', null, h('button', {class: 'lore-row', type: 'button', onclick: () => actions.sheet('lore', {tier, entryId: e.id})}, h('strong', null, e.title || '未命名條目'), e.bookTitle ? h('small', null, e.bookTitle) : null)))) : h('p', {class: 'meta'}, '沒有可以顯示的條目。')]};
  },

  // 回顧: chapters, full summaries, search over saved story text, and a passage view. The passage view
  // reads one saved section (±1 for context) on demand, so long stories never load all history, and
  // the main reader keeps its position: 回到目前進度 simply closes this sheet.
  recap(s, actions, arg = {}) {
    const tab = arg.passage ? 'passage' : arg.chapterId ? 'chapter' : arg.tab ?? 'chapters';
    const tabs = seg('回顧', tab === 'passage' || tab === 'chapter' ? (arg.from ?? 'chapters') : tab, [['chapters', '章節'], ['search', '搜尋原文'], ['known', '我已知的']], v => v === 'known' ? actions.sheet('lore', 'known') : actions.sheet('recap', {tab: v}));
    const sub = `${s.run.turnCount ?? 0} 段已保存的正文`;
    if (tab === 'passage') return recapPassage(s, actions, arg, sub);
    if (tab === 'search') return recapSearch(s, actions, arg, tabs, sub);
    if (tab === 'chapter') {
      const d = useData(s, actions, ['recap-chapter', arg.chapterId], () => actions.call('playerRecap', {runId: s.runId, expectedSnapshotHash: s.run.snapshot?.hash, chapterId: arg.chapterId}));
      if (!d) return {title: '回顧', sub, body: wait()}; if (d.error) return {title: '回顧', sub, body: failed(d)};
      const c = d.value.chapter ?? {}, sum = c.summary ?? null;
      const list = (label, rows) => Array.isArray(rows) && rows.length ? h('p', {class: 'meta'}, `${label}：${rows.map(r => typeof r === 'string' ? r : r?.name ?? r?.title ?? '').filter(Boolean).join('、')}`) : null;
      return {title: c.title ?? '章節', sub: `第 ${c.order ?? '—'} 章・第 ${c.startTurn}–${c.endTurn} 段`, body: [
        h('button', {class: 'link', type: 'button', onclick: () => actions.sheet('recap', {tab: 'chapters'})}, '‹ 所有章節'),
        sum ? h('div', {class: 'chapter-summary'}, ...String(sum.summary ?? '').split(/\n+/).filter(Boolean).map(t => h('p', null, t))) : h('p', {class: 'meta'}, '這一章還沒有摘要。'),
        sum ? list('人物', sum.characters) : null, sum ? list('地點', sum.locations) : null, sum ? list('線索與伏筆', sum.plotThreads) : null,
        c.source?.startCommitId ? h('div', {class: 'row'}, h('button', {class: 'primary small', type: 'button', onclick: () => actions.sheet('recap', {passage: c.source.startCommitId, from: 'chapters', chapterId: arg.chapterId})}, '讀這一章的原文')) : null,
        h('p', {class: 'fine'}, '摘要是閱讀輔助；原文與已保存狀態才是依據。')]};
    }
    const d = useData(s, actions, ['recap'], () => actions.call('playerRecap', {runId: s.runId, expectedSnapshotHash: s.run.snapshot?.hash}));
    if (!d) return {title: '回顧', sub, body: [tabs, wait()]}; if (d.error) return {title: '回顧', sub, body: [tabs, failed(d)]};
    const chapters = d.value.chapters ?? [], open = d.value.unarchived;
    return {title: '回顧', sub, body: [tabs,
      chapters.length ? h('ol', {class: 'chapters'}, chapters.map(c => h('li', null, h('button', {class: 'chapter-row', type: 'button', onclick: () => actions.sheet('recap', {chapterId: c.id})},
        h('p', {class: 'eyebrow'}, `第 ${c.order} 章・第 ${c.startTurn}–${c.endTurn} 段`), h('strong', null, c.title), c.summaryPreview ? h('p', null, c.summaryPreview + (c.summaryTruncated ? '…' : '')) : h('p', {class: 'meta'}, '摘要整理中')))))
        : h('div', {class: 'empty-state'}, h('strong', null, '還沒有整理好的章節'), h('p', null, '故事累積到一定長度、並開啟自動摘要後，章節會自動整理在這裡。也可以直接「搜尋原文」。')),
      open ? h('div', {class: 'unarchived'}, h('p', {class: 'eyebrow'}, `${open.title}・第 ${open.startTurn}–${open.endTurn} 段`), h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('recap', {passage: open.source.startCommitId, from: 'chapters'})}, '從這裡開始讀')) : null,
      h('p', {class: 'fine'}, '摘要是閱讀輔助；原文與已保存狀態才是依據。')]};
  },

  // 這一步要花多久？ Choices come from this work's StoryClock (its periods and minutes per day) and the
  // current clock, and only legal endpoints are offered (never before the current earliest point).
  // One click is the explicit confirmation; the Host still validates the same timeConfirmation contract.
  time(s, actions, purpose) {
    const tc = s.run?.timeControls; if (!tc) return {title: '時間', body: h('p', {class: 'meta'}, '這部作品沒有故事時間設定。')};
    const def = tc.definition ?? {}, perDay = (def.hoursPerDay ?? 24) * (def.minutesPerHour ?? 60);
    const periods = Object.entries(def.periods ?? {}).sort((a, b) => a[1].start - b[1].start);
    const now = s.run.storyClock?.position?.earliest ?? {dayOrdinal: 1, minuteOfDay: 0}, today = now.dayOrdinal, nowMin = now.minuteOfDay ?? 0;
    const op = s.op, needs = purpose === 'needs' && ['needs_time', 'settlement_failed'].includes(op?.phase);
    const hm = m => `${String(Math.floor(m / (def.minutesPerHour ?? 60))).padStart(2, '0')}:${String(m % (def.minutesPerHour ?? 60)).padStart(2, '0')}`;
    const choose = async (role, target, label) => {
      // Re-read the base at the moment of confirming: a background commit may have moved the version.
      let base = tc.base;
      try { const fresh = await actions.call('runView', {runId: s.runId}); if (fresh?.timeControls?.base) { if (fresh.timeControls.base.clockHash !== tc.base?.clockHash) { actions.store.set({notice: '故事時間剛剛更新了，請重新選一次。', sheetData: null}); return; } base = fresh.timeControls.base; } } catch {}
      const value = {schemaVersion: 2, confirmed: true, role, mode: role === 'origin' ? 'refine' : 'advance_to', target, base: structuredClone(base)};
      actions.closeSheet(); if (needs) actions.ops.confirmTime(value); else actions.store.set({attachedTime: {value, label}});
    };
    const quick = [];
    if (nowMin + 30 < perDay) quick.push({label: '片刻', note: `約半小時，到 ${hm(nowMin + 30)} 左右`, target: {dayOrdinal: today, minuteOfDay: nowMin + 30}});
    for (const [id, p] of periods) if (p.start > nowMin) quick.push({label: `到${p.label ?? id}`, note: `今天 ${hm(p.start)} 起`, target: {dayOrdinal: today, periodId: id}});
    quick.push(periods.length ? {label: `到明天${periods[0][1].label ?? ''}`, note: `明天 ${hm(periods[0][1].start)} 起`, target: {dayOrdinal: today + 1, periodId: periods[0][0]}} : {label: '到明天', note: '隔天', target: {dayOrdinal: today + 1}});
    const verb = needs ? '確認並重新送出' : '附加到下一個行動';
    const quickList = h('ul', {class: 'time-quick'}, quick.map(q => h('li', null, h('button', {class: 'time-choice', type: 'button', onclick: () => choose('endpoint', q.target, `${q.label}為止`)},
      h('strong', null, q.label), h('small', null, q.note), h('span', {class: 'time-go'}, verb)))));
    // 指定時間: start or end, day, and a period or an exact time.
    let role = 'endpoint', offset = 0, period = periods.find(([, p]) => p.start > nowMin)?.[0] ?? periods[0]?.[0] ?? null, exact = '';
    const err = h('p', {class: 'error', role: 'alert', hidden: true});
    const advanced = h('details', {class: 'time-advanced'}, h('summary', null, '指定時間…'),
      h('form', {class: 'time-form', onsubmit: e => {
        e.preventDefault();
        let target = {dayOrdinal: today + offset};
        if (exact) { const m = /^(\d{1,2}):(\d{2})$/.exec(exact); const v = m ? Number(m[1]) * (def.minutesPerHour ?? 60) + Number(m[2]) : NaN; if (!(v >= 0 && v < perDay)) { err.textContent = '時間格式是 時:分，例如 18:30。'; err.hidden = false; return; } target.minuteOfDay = v; }
        else if (period) target.periodId = period;
        if (role === 'endpoint' && target.dayOrdinal === today && (target.minuteOfDay ?? periods.find(p => p[0] === target.periodId)?.[1].start ?? perDay) < nowMin) { err.textContent = '結束時間不能早於現在。'; err.hidden = false; return; }
        const label = `${['今天', '明天', '後天'][offset]} ${exact || (periods.find(p => p[0] === period)?.[1]?.label ?? '')}${role === 'origin' ? '開始' : '為止'}`;
        void choose(role, target, label);
      }},
        h('fieldset', null, h('legend', null, '要指定的是'), h('div', {class: 'chips'},
          h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'role', checked: true, onchange: () => { role = 'endpoint'; }}), h('span', null, '做到何時為止')),
          h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'role', onchange: () => { role = 'origin'; }}), h('span', null, '從何時開始')))),
        h('fieldset', null, h('legend', null, '哪一天'), h('div', {class: 'chips'}, ['今天', '明天', '後天'].map((l, i) => h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'day', checked: i === 0, onchange: () => { offset = i; }}), h('span', null, l))))),
        periods.length ? h('fieldset', null, h('legend', null, '哪個時段'), h('div', {class: 'chips'}, periods.map(([id, p]) => h('label', {class: 'chip'}, h('input', {type: 'radio', name: 'period', checked: id === period, onchange: () => { period = id; }}), h('span', null, p.label ?? id))))) : null,
        h('label', {class: 'time-exact'}, h('span', null, '或精確時間'), h('input', {type: 'text', inputmode: 'numeric', placeholder: '18:30', oninput: e => { exact = e.target.value.trim(); }})),
        err, h('button', {class: 'primary wide', type: 'submit'}, needs ? '用這個時間重新送出' : '附加到下一個行動')));
    return {title: needs ? '這一步要花多久？' : '附加時間', sub: '目前：' + clockText(s.run.storyClockLabel), body: [
      needs && op.input ? h('blockquote', {class: 'quoted-input'}, op.input) : h('p', {class: 'fine top'}, '這不是「跳過時間」。它只替你下一次送出的行動補充時間資訊；想讓時間過去，請把等待寫成行動。'),
      needs ? h('p', {class: 'fine'}, op.phase === 'settlement_failed' ? '選好後，故事會用同一個行動重新寫這一段，暫存正文會被取代。' : '選好後就會用這個時間重新送出；只套用在這一次。') : null,
      quickList, advanced]};
  },

  settings(s, actions) {
    return {title: '顯示設定', body: [
      h('div', {class: 'setting'}, h('span', null, '外觀主題'), seg('外觀主題', s.prefs.theme, [['auto', '跟隨作品'], ['neutral', '中性'], ['campus', '校園'], ['road', '公路'], ['fantasy', '奇幻']], v => actions.setPref('theme', v))),
      h('div', {class: 'setting'}, h('span', null, '字級'), seg('字級', s.prefs.size, [['normal', '標準'], ['large', '大字']], v => actions.setPref('size', v))),
      h('p', {class: 'fine'}, '深淺色跟隨 DSH 與系統設定。'),
      h('h3', {class: 'sheet-h'}, '進階'),
      h('div', {class: 'empty-state'}, h('strong', null, '進階工坊'), h('p', null, '模型分派、摘要服務、文風與禁用詞、章節記憶、備份與匯入匯出、診斷與授權。打開後只顯示管理工具，完成後按「回到舞台」。'),
        h('div', {class: 'row'}, h('button', {class: 'primary small', type: 'button', onclick: () => actions.workshop()}, '打開進階工坊'), h('button', {class: 'ghost small', type: 'button', onclick: () => actions.useLegacy()}, '改用舊版舞台閱讀')))]};
  },

  menu(s, actions) {
    const item = (label, note, fn) => h('li', null, h('button', {class: 'menu-row', type: 'button', onclick: fn}, h('span', null, h('strong', null, label), note ? h('small', null, note) : null), h('span', {'aria-hidden': 'true'}, '›')));
    const run = s.run;
    return {title: run?.snapshot?.card?.name ?? '舞台', sub: run?.playerIdentity?.name ? `${run.playerIdentity.name} 的故事` : null, body: h('ul', {class: 'menu'},
      item('此刻', clockText(run?.storyClockLabel), () => actions.sheet('now')),
      item('角色', (run?.snapshot?.characters ?? []).map(c => c.name).join('、'), () => actions.sheet('cast')),
      item('回顧', '章節與摘要', () => actions.sheet('recap')),
      item('日曆', '已公告的安排', () => actions.sheet('calendar')),
      item('論壇', '故事世界裡的貼文', () => actions.sheet('forum')),
      item('設定集', '公開設定與完整版', () => actions.sheet('lore')),
      item('顯示設定', '主題、字級', () => actions.sheet('settings')),
      item('進階工坊', '模型、文風、摘要、備份、診斷', () => actions.workshop()),
      item('回到創作', '修改這部作品', () => actions.nav('studio')),
      item('所有作品', null, () => actions.nav('home')))};
  },

  cast(s, actions) {
    const cast = s.run?.snapshot?.characters ?? [], idx = castIndex(cast);
    return {title: '角色', body: h('ul', {class: 'm-cast'}, cast.map(c => h('li', null, h('button', {class: 'cast-row', type: 'button', onclick: () => actions.sheet('character', c.id)}, avatar(c, idx.get(c.id), 'md'), h('span', null, h('strong', null, c.name), c.description ? h('small', null, c.description.slice(0, 40)) : null)))))};
  },
};
