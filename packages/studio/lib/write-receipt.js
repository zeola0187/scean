import { canonical } from './codec.js';

// Bounds apply to the complete {ok:true,value} JSON sent by both agent and GUI.
// Omitted rows/oversized IDs are explicit; exact values remain in read/diff.
export const MAX_WRITE_REPLY_BYTES = 8192;
const MAX_CHANGE_ROWS = 64;
const entriesPath = '/data/character_book/entries';
const pointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const size = value => Buffer.byteLength(JSON.stringify(value));

export function writeReceipt({ id, revision, sha256, before, after, beforeIds, afterIds, entryId }) {
  const result = {
    id, revision, sha256, entryCount: afterIds.length,
    changes: [], changeCount: 0, changesOmitted: 0,
    detail: { action: 'diff', from: revision - 1, to: revision },
  };
  if (entryId !== undefined) {
    if (size(entryId) <= 2048) result.entry_id = entryId;
    else result.entryIdOmitted = true;
  }
  function add(row) {
    result.changeCount++;
    if (result.changes.length < MAX_CHANGE_ROWS) {
      result.changes.push(row);
      // Leave room for the counters' final digit widths, never slice JSON text.
      if (size({ ok: true, value: result }) <= MAX_WRITE_REPLY_BYTES - 128) return;
      result.changes.pop();
    }
    result.changesOmitted++;
  }
  function walk(a, b, path, identity, had = true, has = true) {
    if (had && has && canonical(a) === canonical(b)) return;
    if (!had || !has || !object(a) || !object(b)) {
      add({ path: path || '/', op: !had ? 'add' : !has ? 'remove' : 'replace', ...identity });
      return;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[key], b[key], path + '/' + pointer(key), identity, Object.hasOwn(a, key), Object.hasOwn(b, key));
    }
  }
  function bookRows(card, ids) {
    const entries = card.data.character_book?.entries;
    if (!entries) return [];
    return Object.entries(entries).map(([key, entry], index) => ({
      id: ids[index], entry, path: entriesPath + '/' + pointer(key),
    }));
  }
  // Traverse card/config fields without ever feeding the whole entry array to
  // generic diff. Entry identity survives insertion, removal, and rollback.
  function cardFields(a, b, path = '', had = true, has = true) {
    if (path === entriesPath) return;
    if (had && has && canonical(a) === canonical(b)) return;
    const ancestor = path === '' || entriesPath.startsWith(path + '/');
    if (ancestor && (object(a) || object(b))) {
      const left = object(a) ? a : {}, right = object(b) ? b : {};
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      // A null/missing/empty book still needs a truthful container change.
      if (path === '/data/character_book' && (!object(a) || !object(b))) {
        add({ path, op: !had ? 'add' : !has ? 'remove' : 'replace' });
      }
      for (const key of keys) cardFields(left[key], right[key], path + '/' + pointer(key), Object.hasOwn(left, key), Object.hasOwn(right, key));
    } else walk(a, b, path, undefined, had, has);
  }
  cardFields(before, after);
  const oldRows = bookRows(before, beforeIds), newRows = bookRows(after, afterIds);
  const oldById = new Map(oldRows.map(row => [row.id, row]));
  const newById = new Map(newRows.map(row => [row.id, row]));
  const oldShared = oldRows.filter(row => newById.has(row.id)).map(row => row.id);
  const newShared = newRows.filter(row => oldById.has(row.id)).map(row => row.id);
  const reordered = canonical(oldShared) !== canonical(newShared);
  for (const row of oldRows) if (!newById.has(row.id)) add({ path: row.path, op: 'remove', entry_id: row.id });
  for (const row of newRows) {
    const old = oldById.get(row.id), identity = { entry_id: row.id };
    if (!old) add({ path: row.path, op: 'add', ...identity });
    else {
      if (reordered && old.path !== row.path) add({ path: row.path, from: old.path, op: 'move', ...identity });
      walk(old.entry, row.entry, row.path, identity);
    }
  }
  return result;
}
