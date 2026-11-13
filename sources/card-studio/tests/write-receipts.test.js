import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { CardService } from '../cardstudio-bundle/lib/card-service.js';
import { MAX_WRITE_REPLY_BYTES, writeReceipt } from '../cardstudio-bundle/lib/write-receipt.js';
import { decodeCard, pngChunk, canonical } from '../cardstudio-bundle/lib/codec.js';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(workspace, 'test-run-' + randomUUID());
await fs.mkdir(root);
const measurements = [];
after(async () => {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(workspace));
  assert.match(path.basename(root), /^test-run-[a-f0-9-]+$/);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(workspace, 'test-evidence'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'test-evidence/compact-write-results.json'), JSON.stringify({
    source: 'Synthetic fixtures only; raw JSON.stringify({ok:true,value}) before DSH spill',
    maxWriteReplyBytes: MAX_WRITE_REPLY_BYTES, measurements,
    liveDSHUsed: false, modelCalls: 0, privateCardDataUsed: false,
  }, null, 2) + '\n');
});

const longText = 'SYNTHETIC-LONG-BODY-' + '\u9577'.repeat(32768);
function card(count = 38) {
  return { spec: 'chara_card_v3', spec_version: '3.0', opaqueRoot: { preserved: true }, data: {
    name: 'Synthetic large fixture', description: longText, personality: '', scenario: '', first_mes: 'Synthetic hello',
    mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
    alternate_greetings: [], tags: [], creator: 'test', character_version: '1', extensions: { untouched: { keep: true } },
    character_book: { name: 'Synthetic book', extensions: { keep: true }, entries: Array.from({ length: count }, (_, id) => ({
      id, keys: ['synthetic-' + id], content: 'SYNTHETIC-UNRELATED-' + id + '-' + '\u6f22\u5b57\u5167\u5bb9'.repeat(256),
      enabled: true, insertion_order: id, extensions: { opaque: { keep: id } },
    })) },
  } };
}
function png(c) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from('ccv3\0' + Buffer.from(JSON.stringify(c)).toString('base64'))),
    pngChunk('vpAg', Buffer.from('SYNTHETIC-OPAQUE-IMAGE-DATA')), pngChunk('IDAT', deflateSync(Buffer.from([0,1,2,3,255]))),
    pngChunk('IEND', Buffer.alloc(0)), Buffer.from('SYNTHETIC-TRAILER')]);
}
async function fixture(c = card(), format = 'json', type = 'card', options) {
  const dir = path.join(root, randomUUID()); await fs.mkdir(dir);
  const service = new CardService(dir, options); await service.init();
  const source = format === 'png' ? png(c) : Buffer.from(JSON.stringify(c));
  await fs.writeFile(path.join(dir, 'imports/source.' + format), source);
  const imported = await service.operation('import', { path: 'imports/source.' + format, type }, undefined, { sessionId: 'synthetic-write-session' });
  assert.equal(imported.ok, true);
  return { service, id: imported.value.id, source, format };
}
async function write(f, action, args, label = action) {
  const revision = (await f.service.read(f.id)).revision;
  const response = await f.service.operation(action, { document_id: f.id, expected_revision: revision, ...args }, undefined, { sessionId: 'synthetic-write-session' });
  assert.equal(response.ok, true, JSON.stringify(response));
  const text = JSON.stringify(response), receipt = response.value;
  assert.deepEqual(JSON.parse(text), response);
  assert(Buffer.byteLength(text) <= MAX_WRITE_REPLY_BYTES);
  assert(!text.includes('SYNTHETIC-UNRELATED') && !text.includes('SYNTHETIC-LONG-BODY'));
  assert(!text.includes('"before"') && !text.includes('"after"'));
  assert.equal(receipt.id, f.id); assert.equal(receipt.revision, revision + 1);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.changeCount, receipt.changes.length + receipt.changesOmitted);
  const read = await f.service.read(f.id);
  assert.equal(receipt.sha256, read.sha256); assert.equal(receipt.entryCount, read.entryIds.length);
  const fullDiff = await f.service.compare(f.id, revision, receipt.revision);
  const before = Buffer.byteLength(JSON.stringify({ ok: true, value: { id: f.id, revision: receipt.revision, sha256: receipt.sha256, changes: fullDiff.changes, entryCount: receipt.entryCount } }));
  measurements.push({ operation: label, entryCount: receipt.entryCount, beforeBytes: before, afterBytes: Buffer.byteLength(text) });
  return receipt;
}

test('one entry metadata edit stays small for 38 and 380 long entries, with precise stable-ID paths', async () => {
  for (const count of [38, 380]) {
    const f = await fixture(card(count));
    const result = await write(f, 'book_patch', { entry_id: 'id:21', changes: { enabled: false, extensions: { probability: 70 } } }, 'entry metadata ' + count);
    assert.equal(result.entry_id, 'id:21'); assert.equal(result.changesOmitted, 0);
    assert.deepEqual(result.changes, [
      { path: '/data/character_book/entries/21/enabled', op: 'replace', entry_id: 'id:21' },
      { path: '/data/character_book/entries/21/extensions/probability', op: 'add', entry_id: 'id:21' },
    ]);
    const read = await f.service.read(f.id);
    assert.equal(read.card.data.character_book.entries[21].enabled, false);
    assert.equal(read.card.data.character_book.entries[20].content, card(count).data.character_book.entries[20].content);
  }
  assert(Math.abs(measurements[0].afterBytes - measurements[1].afterBytes) < 10);
});

test('all commit-based writers return value-free receipts; read, explicit diff, history and rollback remain complete', async () => {
  const original = card(), f = await fixture(original);
  await write(f, 'patch_text', { field: 'description', old_text: longText, new_text: longText + ' changed' });
  await write(f, 'patch', { patches: [{ op: 'replace', path: '/data/personality', value: longText }] });
  await write(f, 'book_patch', { entry_id: 'id:21', changes: { content: longText } }, 'entry long body');
  await write(f, 'book_upsert', { entry_id: 'id:21', entry: { content: longText + ' upsert' } }, 'existing upsert');
  const added = await write(f, 'book_upsert', { entry: { keys: [], content: longText, enabled: true, insertion_order: 50, extensions: {} } }, 'new entry');
  assert.equal(added.entry_id, 'id:38'); assert.deepEqual(added.changes, [{ path: '/data/character_book/entries/38', op: 'add', entry_id: 'id:38' }]);
  await write(f, 'book_patch_config', { changes: { extensions: { longSetting: longText } } });
  const deleted = await write(f, 'book_delete', { entry_id: 'id:21' });
  assert.deepEqual(deleted.changes, [{ path: '/data/character_book/entries/21', op: 'remove', entry_id: 'id:21' }]);
  assert.equal(deleted.entry_id, 'id:21');
  const rollback = await write(f, 'rollback', { to: 0 });
  assert(rollback.changes.some(row => row.entry_id === 'id:21' && row.op === 'add'));
  assert.equal(canonical((await f.service.read(f.id)).card), canonical(original));
  assert.equal((await f.service.history(f.id)).revisions.length, 9);
  const diff = await f.service.compare(f.id, 0, 1);
  assert.equal(diff.changes[0].before, longText); assert.equal(diff.changes[0].after, longText + ' changed');
  const entry = await f.service.book(f.id, 'read', { entry_id: 'id:21' });
  assert.equal(entry.entry.content, original.data.character_book.entries[21].content);
  assert.deepEqual(await fs.readFile(path.join(f.service.root, 'imports/source.json')), f.source);
});

test('receipt bounds cover many fields, huge metadata paths and IDs without truncating JSON or changing data', async () => {
  const f = await fixture();
  const patches = Array.from({ length: 90 }, (_, i) => ({ op: 'add', path: '/data/extensions/key' + i, value: longText }));
  patches.push({ op: 'add', path: '/data/extensions/' + 'x'.repeat(10000), value: true });
  const result = await write(f, 'patch', { patches }, '91 metadata fields');
  assert.equal(result.changeCount, 91); assert.equal(result.changes.length, 64); assert.equal(result.changesOmitted, 27);
  assert.deepEqual(result.detail, { action: 'diff', from: 0, to: 1 });
  const read = await f.service.read(f.id); assert.equal(read.card.data.extensions.key89, longText);
  const c = card(1); c.data.character_book.entries[0].id = 'x'.repeat(10000);
  const huge = await fixture(c), entry_id = 'id-string:' + c.data.character_book.entries[0].id;
  const receipt = await write(huge, 'book_patch', { entry_id, changes: { enabled: false } }, 'oversized stable ID');
  assert.equal(receipt.entryIdOmitted, true); assert.equal(receipt.changesOmitted, 1);
  assert.equal((await huge.service.read(huge.id)).entryIds[0], entry_id);
});

test('entry receipt handles ST dictionary paths, missing book creation, no-op and rollback reorder', async () => {
  const book = { name: 'Synthetic standalone', entries: { 3: { uid: 3, key: [], content: longText, disable: false, order: 1, extensions: {} } } };
  const f = await fixture(book, 'json', 'worldbook');
  const result = await write(f, 'book_patch', { entry_id: 'uid:3', changes: { enabled: false } });
  assert.deepEqual(result.changes, [{ path: '/data/character_book/entries/3/disable', op: 'replace', entry_id: 'uid:3' }]);
  const noop = await write(f, 'book_patch', { entry_id: 'uid:3', changes: { enabled: false } }, 'no-op');
  assert.equal(noop.entry_id, 'uid:3'); assert.equal(noop.changeCount, 0);
  const c = card(); delete c.data.character_book; const empty = await fixture(c);
  const created = await write(empty, 'book_upsert', { entry: { keys: [], content: longText, enabled: true, insertion_order: 0, extensions: {} } }, 'first book entry');
  assert.equal(created.entry_id, 'id:0'); assert(created.changes.some(row => row.path.endsWith('/entries/0')));
  const before = card(2), after = structuredClone(before); after.data.character_book.entries.reverse();
  const moved = writeReceipt({ id: 'synthetic', revision: 1, sha256: '0'.repeat(64), before, after, beforeIds: ['id:0','id:1'], afterIds: ['id:1','id:0'] });
  assert(moved.changes.every(row => row.op === 'move' && row.entry_id)); assert.equal(moved.changeCount, 2);
});

test('failed and stale writes retain revision, snapshots and stable-ID guards', async () => {
  const f = await fixture();
  await write(f, 'book_patch', { entry_id: 'id:21', changes: { enabled: false } });
  for (const [action, args, code] of [
    ['book_patch', { expected_revision: 0, entry_id: 'id:21', changes: { content: longText } }, 'REVISION_CONFLICT'],
    ['book_patch', { expected_revision: 1, entry_id: 'id:21', changes: { id: 99 } }, 'ENTRY_PATCH'],
    ['patch', { expected_revision: 1, patches: [{ op: 'replace', path: '/data/character_book/entries/0/content', value: longText }] }, 'ENTRY_TOOL'],
    ['book_delete', { expected_revision: 1, entry_id: 'id:21', references: [{ source_entry_id: 'id:20', target_entry_id: 'id:21' }] }, 'ENTRY_REFERENCED'],
  ]) {
    const result = await f.service.operation(action, { document_id: f.id, ...args }, undefined, { sessionId: 'synthetic-write-session' });
    assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.equal((await f.service.read(f.id)).revision, 1);
  }
  f.service.beforeCommit = () => { throw new Error('synthetic failed publish'); };
  const failed = await f.service.operation('book_patch', { document_id: f.id, expected_revision: 1, entry_id: 'id:21', changes: { enabled: true } }, undefined, { sessionId: 'synthetic-write-session' });
  assert.equal(failed.ok, false); assert.equal((await f.service.history(f.id)).revisions.length, 2);
  assert.equal((await f.service.read(f.id)).card.data.character_book.entries[21].enabled, false);
});

test('large PNG edits and rollback keep complete snapshots, opaque chunks, image and exports', async () => {
  const c = card(), f = await fixture(c, 'png');
  await write(f, 'book_patch', { entry_id: 'id:21', changes: { content: longText } }, 'PNG entry long body');
  const exported = await f.service.export(f.id, 1, 'synthetic.png', undefined, 'synthetic-write-session');
  const decoded = decodeCard(await fs.readFile(path.join(f.service.root, exported.path))), original = decodeCard(f.source);
  assert.equal(decoded.card.data.character_book.entries[21].content, longText);
  assert.deepEqual(decoded.chunks.filter(x => !x.text).map(x => x.raw), original.chunks.filter(x => !x.text).map(x => x.raw));
  assert.deepEqual(decoded.trailer, original.trailer);
  await write(f, 'rollback', { to: 0 }, 'PNG rollback');
  assert.deepEqual((await f.service.read(f.id)).card, c);
  assert.deepEqual((await f.service.load(f.id, 0)).decoded.card, c);
  assert.deepEqual(await fs.readFile(path.join(f.service.root, 'imports/source.png')), f.source);
});
