// 我已知的設定: the player's own notes, pinned from story text they have read. Nothing is inferred:
// an excerpt must be part of a committed section, so hidden lore can never appear here unless the
// story already showed it. Stored per Run beside the run, outside story state; never sent to models.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {SceanError} from '../core/contracts.mjs';

const MAX_NOTES = 500, MAX_EXCERPT = 600, MAX_MEMO = 300;
const fail = code => { throw new SceanError(code); };
const notesFile = (store, runId) => path.join(store.runDir(runId), 'player-notes.json');

async function readRecord(store, runId) {
  try { const v = JSON.parse(await readFile(notesFile(store, runId), 'utf8')); if (v?.schemaVersion === 1 && Array.isArray(v.notes)) return v; } catch {}
  return {schemaVersion: 1, notes: []};
}

/** Notes for display. A note whose section was rolled back or rewritten is kept but marked stale. */
export async function playerNotes(store, run) {
  const live = new Map((run.turns ?? []).map(t => [t.commitId, t.turn]));
  const {notes} = await readRecord(store, run.runId);
  return {runId: run.runId, notes: notes.map(n => ({...n, turn: live.get(n.commitId) ?? n.turn, stale: !live.has(n.commitId)})).reverse()};
}

export async function addPlayerNote(store, run, {commitId, excerpt, memo = ''}, {now = () => new Date().toISOString()} = {}) {
  if (typeof commitId !== 'string' || typeof excerpt !== 'string' || typeof memo !== 'string') fail('NOTE_INVALID');
  const text = excerpt.trim();
  if (!text || text.length > MAX_EXCERPT || memo.length > MAX_MEMO) fail('NOTE_INVALID');
  const turn = (run.turns ?? []).find(t => t.commitId === commitId);
  if (!turn) fail('NOTE_SOURCE_NOT_FOUND');
  // Only text the player actually read in this committed section; whitespace differences are tolerated.
  const squash = v => v.replace(/\s+/g, '');
  if (!squash(turn.body ?? '').includes(squash(text))) fail('NOTE_NOT_IN_STORY');
  return store.withRunLock(run.runId, async () => {
    const record = await readRecord(store, run.runId);
    // Idempotent: re-importing an exported notes file does not duplicate notes.
    const existing = record.notes.find(n => n.commitId === commitId && n.excerpt === text); if (existing) return existing;
    if (record.notes.length >= MAX_NOTES) fail('NOTE_LIMIT');
    const note = {id: 'note-' + randomUUID(), commitId, turn: turn.turn, excerpt: text, memo: memo.trim(), createdAt: now()};
    await store.atomic(notesFile(store, run.runId), {schemaVersion: 1, notes: [...record.notes, note]}, {commit: true});
    return note;
  }, {namespace: 'player-notes'});
}

export async function deletePlayerNote(store, runId, noteId) {
  if (typeof noteId !== 'string' || !/^note-[0-9a-f-]{36}$/.test(noteId)) fail('NOTE_INVALID');
  return store.withRunLock(runId, async () => {
    const record = await readRecord(store, runId), notes = record.notes.filter(n => n.id !== noteId);
    if (notes.length === record.notes.length) return {deleted: false};
    await store.atomic(notesFile(store, runId), {schemaVersion: 1, notes}, {commit: true});
    return {deleted: true};
  }, {namespace: 'player-notes'});
}
