// World feed: what became visible in the story world (forum posts and replies, published calendar
// events) that the player has not seen yet. Read-only projection over the public routine reader; it
// never generates anything and never exposes private artifacts. The read cursor is a per-run side
// record outside story state: it only moves when the player views items, never because of polling.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {SceanError, safeId} from '../core/contracts.mjs';
import {publicRoutineRead} from './world-routine-reader.mjs';

const MAX_SEEN = 4000, MAX_ITEMS = 30;
const fail = code => { throw new SceanError(code); };
const cursorFile = (store, runId) => path.join(store.runDir(runId), 'feed-cursor.json');
const empty = () => ({schemaVersion: 1, forumSequence: 0, seenIds: [], updatedAt: null});

export async function readFeedCursor(store, runId) {
  try {
    const v = JSON.parse(await readFile(cursorFile(store, runId), 'utf8'));
    if (v?.schemaVersion !== 1 || !Number.isSafeInteger(v.forumSequence) || v.forumSequence < 0 || !Array.isArray(v.seenIds)) return empty();
    return {schemaVersion: 1, forumSequence: v.forumSequence, seenIds: v.seenIds.filter(id => typeof id === 'string').slice(-MAX_SEEN), updatedAt: v.updatedAt ?? null};
  } catch { return empty(); }
}

/** Unread public world items for one Run. `latest` is what "mark everything shown as seen" should send. */
export function worldFeed(run, cursor) {
  const names = new Map((run.snapshot?.characters ?? []).map(a => [a.id, a.name]));
  const base = {runId: run.runId, version: run.version, status: 'not_enabled', items: [], unread: 0, latest: {forumSequence: cursor.forumSequence, ids: []}};
  if (!run.storyClock || !run.worldRoutine) return base;
  const seen = new Set(cursor.seenIds), items = [], ids = [];
  let maxSequence = cursor.forumSequence;
  const who = a => { const id = a?.author?.kind === 'character' ? a.author.characterId : a?.authorId; return a?.author?.kind === 'ambient' ? `路人・${a.author.displayName}` : names.get(id) ?? id ?? ''; };
  const unseenForum = a => a.sequence > cursor.forumSequence && !seen.has(a.id);
  const forum = publicRoutineRead(run, {kind: 'forum', limit: 20});
  if (forum.status === 'available') for (const post of forum.entries) {
    maxSequence = Math.max(maxSequence, post.sequence);
    if (unseenForum(post)) { items.push({kind: 'forum_post', id: post.id, sequence: post.sequence, threadId: post.id, title: post.title || '（無標題）', excerpt: String(post.text ?? '').slice(0, 120), author: who(post), timeLabel: post.timeLabel}); ids.push(post.id); }
    const thread = publicRoutineRead(run, {kind: 'thread', threadId: post.id, afterSequence: cursor.forumSequence, limit: 20});
    for (const reply of thread.entries ?? []) {
      maxSequence = Math.max(maxSequence, reply.sequence);
      if (unseenForum(reply)) { items.push({kind: 'forum_reply', id: reply.id, sequence: reply.sequence, threadId: post.id, title: post.title || '（無標題）', excerpt: String(reply.text ?? '').slice(0, 120), author: who(reply), timeLabel: reply.timeLabel}); ids.push(reply.id); }
    }
  }
  const calendar = publicRoutineRead(run, {kind: 'calendar'});
  if (calendar.status === 'available') for (const day of calendar.days.filter(d => d.count > 0)) {
    const view = day.day === calendar.selectedDay ? calendar : publicRoutineRead(run, {kind: 'calendar', windowStart: calendar.windowStart, day: day.day});
    // Events authored into the work are part of the script, not news; only routine publications count.
    for (const e of view.entries.filter(e => e.sourceRef?.kind !== 'snapshot_public_event')) if (!seen.has(e.id)) {
      items.push({kind: 'calendar_event', id: e.id, day: day.day, dayLabel: day.label, title: e.label, startLabel: e.startLabel, endLabel: e.endLabel, status: e.status}); ids.push(e.id);
    }
  }
  items.sort((a, b) => (a.kind === 'calendar_event') - (b.kind === 'calendar_event') || (b.sequence ?? 0) - (a.sequence ?? 0));
  return {...base, status: 'available', items: items.slice(0, MAX_ITEMS), unread: items.length, latest: {forumSequence: maxSequence, ids}};
}

/** Record that the player viewed items. Monotonic: the forum high-water mark never moves back. */
export async function markFeedSeen(store, runId, {forumSequence, ids = []} = {}, {now = () => new Date().toISOString()} = {}) {
  if (forumSequence !== undefined && (!Number.isSafeInteger(forumSequence) || forumSequence < 0)) fail('FEED_CURSOR_INVALID');
  if (!Array.isArray(ids) || ids.length > 200) fail('FEED_CURSOR_INVALID');
  for (const id of ids) safeId(id);
  return store.withRunLock(runId, async () => {
    const current = await readFeedCursor(store, runId);
    const next = {schemaVersion: 1, forumSequence: Math.max(current.forumSequence, forumSequence ?? 0), seenIds: [...new Set([...current.seenIds, ...ids])].slice(-MAX_SEEN), updatedAt: now()};
    await store.atomic(cursorFile(store, runId), next, {commit: true});
    return {forumSequence: next.forumSequence, seen: next.seenIds.length};
  }, {namespace: 'world-feed'});
}
