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
  for (const bad of [{forumSequence: -1}, {forumSequence: 1.5}, {ids: 'x'}, {ids: ['../escape']}, {ids: Array.from({length: 201}, (_, i) => 'id' + i)}])
    await assert.rejects(markFeedSeen(s, 'run-a', bad));
  assert.equal((await readFeedCursor(s, 'run-a')).forumSequence, 2);
});

test('runs without a world routine report not_enabled and nothing unread', () => {
  const feed = worldFeed({runId: 'run-a', version: 3, snapshot: {characters: []}}, {forumSequence: 0, seenIds: []});
  assert.equal(feed.status, 'not_enabled'); assert.equal(feed.unread, 0); assert.deepEqual(feed.items, []);
});
