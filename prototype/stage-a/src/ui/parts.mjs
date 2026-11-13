import {h} from '../lib/h.mjs';

export const avatar = (c, size = 'sm') => h('span', {class: `avatar avatar-${size}`, style: {'--who': `var(--c-${c.color})`}, 'aria-hidden': 'true'}, c.name.slice(0, 1));

const KIND = {location: '地點', item: '物品', task: '任務', effect: '狀態', relation: '關係', fact: '得知', check: '裁定', time: '時間'};
const nameOf = (s, id) => s.run.snapshot.characters.find(c => c.id === id)?.name ?? id;

export function changeRows(t, s) {
  const rows = [];
  if (t.clockAfterLabel !== t.clockBeforeLabel) rows.push({kind: 'time', label: '', value: `${t.clockBeforeLabel} → ${t.clockAfterLabel}`, note: t.timeConfirmed ? '你確認的時間' : null});
  for (const c of t.changes ?? []) {
    if (c.kind === 'location') rows.push({kind: c.kind, label: '', value: c.before ? `${c.before} → ${c.after}` : c.after});
    else if (c.kind === 'item') rows.push({kind: c.kind, label: c.label, value: c.before == null ? `獲得 ${c.after}${c.unit}` : `${c.before} → ${c.after}${c.unit}`, tone: c.sign === '+' ? 'up' : 'down'});
    else if (c.kind === 'task') rows.push({kind: c.kind, label: c.label, value: c.before ? `${c.before} → ${c.after}` : `新任務 · ${c.after}`});
    else if (c.kind === 'effect') rows.push({kind: c.kind, label: c.label, value: c.after, tone: c.after === '解除' ? 'up' : 'down'});
    else if (c.kind === 'relation') rows.push({kind: c.kind, label: nameOf(s, c.who), value: c.before ? `${c.before} → ${c.after}` : c.after, who: c.who});
    else if (c.kind === 'fact') rows.push({kind: c.kind, label: '得知', value: c.label});
    else if (c.kind === 'check') rows.push({kind: c.kind, label: c.label, value: c.after, tone: c.after === '成功' ? 'up' : 'down'});
  }
  return rows;
}

export function changeSummary(t, s) {
  const rows = changeRows(t, s);
  const text = rows.slice(0, 3).map(r => r.kind === 'time' || r.kind === 'location' ? r.value.split(' → ').pop() : r.kind === 'fact' ? '新線索' : `${r.label} ${r.kind === 'item' && r.tone ? (r.tone === 'up' ? '↑' : '↓') : ''}`.trim()).join('　');
  return rows.length > 3 ? `${text}　＋${rows.length - 3}` : text;
}

export function renderChanges(t, s, {actions}) {
  return h('ul', {class: 'changes'}, changeRows(t, s).map(r => h('li', {class: `change kind-${r.kind}${r.tone ? ` tone-${r.tone}` : ''}`},
    h('span', {class: 'change-kind'}, KIND[r.kind]),
    r.who ? h('button', {class: 'link change-label', type: 'button', onclick: () => actions.openSheet('character', r.who)}, r.label) : h('span', {class: 'change-label'}, r.label),
    h('span', {class: 'change-value'}, r.value),
    r.note ? h('span', {class: 'change-note'}, r.note) : null)));
}
