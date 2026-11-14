// 我已知的設定: notes only from committed story text; stale after rollback; deletable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {addPlayerNote, playerNotes, deletePlayerNote} from '../plugin/player-notes.mjs';

async function setup(t) {
  const base = resolve(import.meta.dirname, '../.test-data'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'player-notes-')); t.after(() => rm(root, {recursive: true, force: true}));
  const store = new DurableStore({root}); await mkdir(store.runDir('run-a'), {recursive: true});
  const run = {runId: 'run-a', turns: [{turn: 1, commitId: 'c1', body: '鑰匙收在學生會的第二個抽屜。\n周牧把它鎖上了。'}, {turn: 2, commitId: 'c2', body: '天台的門三年前就封起來了。'}]};
  return {store, run};
}

test('a note must quote committed story text (whitespace tolerant)', async t => {
  const {store, run} = await setup(t);
  const note = await addPlayerNote(store, run, {commitId: 'c1', excerpt: '鑰匙收在學生會的第二個抽屜。 周牧把它鎖上了。'});
  assert.equal(note.turn, 1);
  await assert.rejects(addPlayerNote(store, run, {commitId: 'c1', excerpt: '天台的門三年前就封起來了。'}), {code: 'NOTE_NOT_IN_STORY'});
  await assert.rejects(addPlayerNote(store, run, {commitId: 'missing', excerpt: '鑰匙'}), {code: 'NOTE_SOURCE_NOT_FOUND'});
  await assert.rejects(addPlayerNote(store, run, {commitId: 'c1', excerpt: '   '}), {code: 'NOTE_INVALID'});
});

test('notes on rolled-back sections are kept but marked stale; delete removes them', async t => {
  const {store, run} = await setup(t);
  const a = await addPlayerNote(store, run, {commitId: 'c1', excerpt: '第二個抽屜'}), b = await addPlayerNote(store, run, {commitId: 'c2', excerpt: '封起來了'});
  const afterRollback = {...run, turns: run.turns.slice(0, 1)};
  const {notes} = await playerNotes(store, afterRollback);
  assert.deepEqual(notes.map(n => [n.id, n.stale]), [[b.id, true], [a.id, false]]);
  assert.deepEqual(await deletePlayerNote(store, 'run-a', b.id), {deleted: true});
  assert.equal((await playerNotes(store, afterRollback)).notes.length, 1);
  await assert.rejects(deletePlayerNote(store, 'run-a', '../x'), {code: 'NOTE_INVALID'});
});
