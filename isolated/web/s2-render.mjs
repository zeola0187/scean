// Presentation helpers for Stage v2. Story text is always inserted as text.
import {h} from './s2-core.mjs';
import {validDialoguePresentation} from './dialogue.mjs';

export const CATEGORY = {locations: '地點', tasks: '任務', resources: '資源', equipment: '持有物', time: '時間', effects: '狀態', facts: '已知'};
const COLORS = 8;
export function castIndex(characters) { const map = new Map(); characters.forEach((c, i) => map.set(c.id, i % COLORS)); return map; }
export function avatar(c, idx, size = 'sm') { return h('span', {class: `avatar avatar-${size} c${idx ?? 0}`, 'aria-hidden': 'true'}, (c?.name ?? '?').slice(0, 1)); }

export function valueText(v, unit) {
  if (v === undefined) return '未知';
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return unit ? (unit.startsWith('/') ? `${v}${unit}` : `${v} ${unit}`) : String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.status === 'string') return v.status + (Number.isFinite(v.progress) && v.progress > 0 && v.progress < 100 ? `（${v.progress}%）` : '');
  if (typeof v === 'object' && typeof v.summary === 'string') return v.summary;
  const text = JSON.stringify(v); return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

// Body → paragraphs; validated speech spans become speaker-tagged quotes.
export function proseNodes(turn, run, {onSpeaker, draft = false} = {}) {
  const body = turn.body ?? '', actors = run.snapshot?.characters ?? [], idx = castIndex(actors);
  let spans = [];
  if (!draft && turn.dialoguePresentation) {
    try { spans = validDialoguePresentation(turn.dialoguePresentation, {body, bodyHash: turn.bodyHash, runId: run.runId, snapshotHash: run.snapshot?.hash, commitId: turn.commitId, actors})?.spans ?? []; } catch { spans = []; }
  }
  const pieces = []; let at = 0;
  for (const s of spans) { if (s.start > at) pieces.push({text: body.slice(at, s.start)}); pieces.push({text: body.slice(s.start, s.end), speakerId: s.speakerId}); at = s.end; }
  if (at < body.length) pieces.push({text: body.slice(at)});
  // Validated spans cover the spoken words only; their quote marks sit in the neighbouring narration.
  // Move them onto the speech so a split never leaves a stray 「 or 」 behind.
  pieces.forEach((p, i) => {
    if (!p.speakerId) return;
    const prev = pieces[i - 1], next = pieces[i + 1];
    const open = prev && !prev.speakerId ? /[「『“"]$/.exec(prev.text) : null; if (open) { prev.text = prev.text.slice(0, -1); p.text = open[0] + p.text; }
    const close = next && !next.speakerId ? /^[」』”"]/.exec(next.text) : null; if (close) { next.text = next.text.slice(1); p.text += close[0]; }
  });
  const paragraphs = [[]];
  for (const p of pieces) {
    const parts = p.text.split(/\n{2,}|\n/);
    parts.forEach((t, i) => { if (i > 0) paragraphs.push([]); if (t) paragraphs.at(-1).push({...p, text: t}); });
  }
  // A paragraph that mixes a quote with narration is shown as separate pieces: each quote becomes a
  // dialogue line under its speaker, the narration around it stays narration. Text is unchanged.
  const residue = t => /^[\s，。、：；！？,.:;!?…—-]*$/.test(t);
  const line = x => h('p', {class: `line c${idx.get(x.speakerId) ?? 0}`},
    h('button', {class: 'who', type: 'button', disabled: draft || !onSpeaker, onclick: () => onSpeaker?.(x.speakerId)}, actors.find(a => a.id === x.speakerId)?.name ?? x.speakerId),
    h('span', {class: 'said'}, h('span', {class: `speech c${idx.get(x.speakerId) ?? 0}`}, x.text)));
  return paragraphs.filter(p => p.some(x => x.text.trim())).flatMap(parts => {
    if (!parts.some(x => x.speakerId && x.speakerId !== 'player')) return [h('p', {class: 'narr'}, parts.map(x => x.text))];
    const out = []; let narr = [];
    const flush = () => { const text = narr.join('').trim(); if (text && !residue(text)) out.push(h('p', {class: 'narr'}, text)); narr = []; };
    for (const x of parts) { if (x.speakerId && x.speakerId !== 'player') { flush(); out.push(line(x)); } else narr.push(x.text); }
    flush(); return out;
  });
}

// Declared public variables (Blueprint) or the public world projection.
export function stateGroups(run) {
  const groups = new Map(), add = (category, row) => { if (!groups.has(category)) groups.set(category, []); groups.get(category).push(row); };
  const declared = run.worldView?.declared;
  if (Array.isArray(declared)) {
    for (const v of declared) if (v.scope === 'world' && v.category !== 'time') add(v.category, {label: v.displayName, value: v.known ? v.value : undefined, unit: v.unit, key: v.key});
  } else {
    for (const [category, rows] of Object.entries(run.state?.world ?? {})) {
      if (category === 'time' || !rows || typeof rows !== 'object') continue;
      for (const [key, value] of Object.entries(rows)) if (key !== 'story_events') add(category, {label: key, value, key});
    }
  }
  return [...groups.entries()].sort((a, b) => Object.keys(CATEGORY).indexOf(a[0]) - Object.keys(CATEGORY).indexOf(b[0]));
}
export function placeOf(run) {
  for (const [category, rows] of stateGroups(run)) if (category === 'locations') { const row = rows.find(r => /player|你|主角|位置|地點/.test(r.key + r.label)) ?? rows[0]; if (row && row.value !== undefined) return valueText(row.value, row.unit); }
  return '';
}

// "This step changed…" rows from the Host's public per-turn projection.
export function changeRows(turn, run) {
  const c = turn.changes; if (!c || c.status !== 'available') return [];
  const names = new Map((run.snapshot?.characters ?? []).map(a => [a.id, a.name]));
  const rows = [];
  if (c.clock?.changed) rows.push({kind: 'time', label: '時間', value: `${clockText(c.clock.beforeLabel)} → ${clockText(c.clock.afterLabel)}`, note: c.clock.confirmedByPlayer ? '依你確認的時間' : null});
  for (const r of c.rows) {
    const before = r.before === undefined ? null : valueText(r.before, r.unit), after = r.after === undefined ? null : valueText(r.after, r.unit);
    const tone = typeof r.before === 'number' && typeof r.after === 'number' ? (r.after > r.before ? 'up' : 'down') : null;
    rows.push({kind: r.category, label: (r.characterId ? (names.get(r.characterId) ?? r.characterId) + '・' : '') + r.label, value: r.kind === 'removed' ? `${before} → 移除` : before === null ? after : `${before} → ${after}`, tone});
  }
  return rows;
}
export function changeSummary(rows) {
  const parts = rows.slice(0, 3).map(r => r.kind === 'time' ? r.value.split(' → ').pop() : r.tone ? `${r.label}${r.tone === 'up' ? '↑' : '↓'}` : r.label);
  return rows.length > 3 ? parts.join('　') + `　＋${rows.length - 3}` : parts.join('　');
}
export function renderChanges(rows) {
  return h('ul', {class: 'changes'}, rows.map(r => h('li', {class: `change kind-${r.kind}${r.tone ? ' tone-' + r.tone : ''}`},
    h('span', {class: 'change-kind'}, r.kind === 'time' ? '時間' : CATEGORY[r.kind] ?? r.kind), h('span', {class: 'change-label'}, r.kind === 'time' ? '' : r.label),
    h('span', {class: 'change-value'}, r.value), r.note ? h('span', {class: 'change-note'}, r.note) : null)));
}
// Compact Host clock labels for reading; the Host label stays the authority.
export function clockText(label) {
  let t = String(label ?? '').replace('（時段）', '').replace('（範圍）', '').trim();
  const same = /^(.*?) (\d{1,2}:\d{2}) ～ (.*?) (\d{1,2}:\d{2})$/.exec(t);
  if (same && same[1] === same[3]) t = `${same[1]} ${same[2]}–${same[4]}`;
  return t.replace(/(\d{4})年 (\d{1,2})月 (\d{1,2})日/g, '$1年$2月$3日');
}
