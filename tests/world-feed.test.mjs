// World feed read cursor: moves only forward, records viewed ids, survives restarts (a file),
// and a fetch alone never changes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {markFeedSeen, readFeedCursor, worldFeed} from '../plugin/world-feed.mjs';

async function store(t) {
  const base = resolve(import.meta.dirname, '../.test-data'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'world-feed-')); t.after(() => rm(root, {recursive: true, force: true}));
  const s = new DurableStore({root}); await mkdir(s.runDir('run-a'), {recursive: true}); return s;
}

test('cursor starts empty, moves forward only and accumulates viewed ids', async t => {
  const s = await store(t);
  assert.deepEqual((await readFeedCursor(s, 'run-a')).forumSequence, 0);
  await markFeedSeen(s, 'run-a', {forumSequence: 7, ids: ['post-1']});
  await markFeedSeen(s, 'run-a', {forumSequence: 3, ids: ['event-9']});
  const c = await readFeedCursor(s, 'run-a');
  assert.equal(c.forumSequence, 7); assert.deepEqual(c.seenIds, ['post-1', 'event-9']);
});

test('invalid cursor input is rejected without touching the record', async t => {
  const s = await store(t);
  await markFeedSeen(s, 'run-a', {forumSequence: 2});
  for (const bad of [{forumSequence: -1}, {forumSequence: 1.5}, {ids: 'x'}, {ids: ['../escape']}, {ids: Array.from({length: 2001}, (_, i) => 'id' + i)}])
    await assert.rejects(markFeedSeen(s, 'run-a', bad));
  assert.equal((await readFeedCursor(s, 'run-a')).forumSequence, 2);
});

test('runs without a world routine report not_enabled and nothing unread', () => {
  const feed = worldFeed({runId: 'run-a', version: 3, snapshot: {characters: []}}, {forumSequence: 0, seenIds: []});
  assert.equal(feed.status, 'not_enabled'); assert.equal(feed.unread, 0); assert.deepEqual(feed.items, []);
});

// A fake reader that pages exactly like the public routine reader: threads newest first (20 per page,
// beforeSequence), replies oldest first (20 per page, afterSequence).
function fakeRun(threads, repliesByThread) {
  const run = {runId: 'run-a', version: 9, storyClock: {}, worldRoutine: {}, snapshot: {characters: [{id: 'a', name: 'A'}]}};
  const read = (_, q) => {
    if (q.kind === 'calendar') return {status: 'available', days: [], entries: [], selectedDay: 1, windowStart: 1};
    if (q.kind === 'forum') {
      const all = threads.filter(t => t.sequence < (q.beforeSequence ?? Infinity)).sort((a, b) => b.sequence - a.sequence), page = all.slice(0, q.limit);
      return {status: 'available', entries: page, nextCursor: all.length > page.length ? page.at(-1).sequence : null};
    }
    const all = (repliesByThread[q.threadId] ?? []).filter(r => r.sequence > q.afterSequence).sort((a, b) => a.sequence - b.sequence), page = all.slice(0, q.limit);
    return {status: 'available', entries: page, nextCursor: all.length > page.length ? page.at(-1).sequence : null};
  };
  return {run, read};
}
const post = (id, sequence) => ({id, sequence, title: id, text: 'x', author: {kind: 'character', characterId: 'a'}, timeLabel: ''});

test('an old thread beyond the newest 20 and a thread with many unread replies are all listed', () => {
  const threads = Array.from({length: 25}, (_, i) => post('t' + i, i + 1));
  const replies = {t0: Array.from({length: 45}, (_, i) => post('r' + i, 100 + i))};
  const seenAll = threads.map(t => t.id);
  const {run, read} = fakeRun(threads, replies), feed = worldFeed(run, {forumSequence: 0, seenIds: seenAll}, {read});
  assert.equal(feed.unread, 45);
  assert.deepEqual(new Set(feed.latest.ids), new Set(replies.t0.map(r => r.id)));
});

test('marking what the feed listed never covers messages it did not list', async t => {
  const s = await store(t);
  const threads = Array.from({length: 3}, (_, i) => post('t' + i, i + 1)), {run, read} = fakeRun(threads, {});
  const first = worldFeed(run, await readFeedCursor(s, 'run-a'), {read});
  await markFeedSeen(s, 'run-a', {ids: first.latest.ids});
  threads.push(post('late', 2.5)); // becomes visible later with a lower sequence than seen items
  const second = worldFeed(run, await readFeedCursor(s, 'run-a'), {read});
  assert.deepEqual(second.latest.ids, ['late']);
});
