import { SceanError, text } from './contracts.mjs';

export function normalizeBanList(entries = []) {
  if (!Array.isArray(entries) || entries.length > 200) throw new SceanError('INVALID_BANLIST');
  return entries.map(entry => {
    const value = typeof entry === 'string' ? { text: entry } : entry;
    text(value?.text, 200);
    return { text: value.text, caseSensitive: value.caseSensitive === true };
  });
}
export function findBans(body, entries) {
  const hits = [];
  for (const entry of entries) {
    // Literal matching only: no user regex execution or semantic review.
    const pattern = entry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(pattern, entry.caseSensitive ? 'gu' : 'giu');
    for (const match of body.matchAll(regex)) hits.push({ start: match.index, end: match.index + match[0].length, term: entry.text });
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end);
}
export function repairRanges(body, hits) {
  const ranges = [];
  const boundary = /[.!?。！？\n]/u;
  for (const hit of hits) {
    let start = hit.start, end = hit.end;
    while (start > 0 && !boundary.test(body[start - 1]) && hit.start - start < 160) start--;
    while (end < body.length && !boundary.test(body[end]) && end - hit.end < 160) end++;
    if (end < body.length && boundary.test(body[end]) && body[end] !== '\n') end++;
    const overlap = ranges.find(r => start < r.end && end > r.start);
    if (overlap) { overlap.start = Math.min(overlap.start, start); overlap.end = Math.max(overlap.end, end); }
    else ranges.push({ start, end });
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(range => ({ ...range, text: body.slice(range.start, range.end) }));
}
export function applyLocalRepairs(body, expectedHash, actualHash, ranges, edits) {
  if (expectedHash !== actualHash) throw new SceanError('STALE_PROSE_PATCH');
  if (!Array.isArray(edits) || edits.length !== ranges.length) throw new SceanError('INVALID_PROSE_PATCH');
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 0; i < ranges.length; i++) {
    const edit = sorted[i], range = ranges[i];
    if (edit.start !== range.start || edit.end !== range.end || typeof edit.replacement !== 'string' || !edit.replacement.trim() || edit.replacement.length > 50000) throw new SceanError('NONLOCAL_PROSE_PATCH');
    if (i && edit.start < sorted[i - 1].end) throw new SceanError('OVERLAPPING_PROSE_PATCH');
  }
  let out = body;
  for (const edit of sorted.reverse()) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  return out;
}
