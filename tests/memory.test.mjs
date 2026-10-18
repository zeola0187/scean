import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { Memory, normalized, tokenizeForSparseRecall, bm25, fuseRanks, cosineSimilarity } from '../core/memory.mjs';

// Milestone A: algorithm fixtures explicitly declare public facts; legacy behavior
// is tested separately in memory-milestone-a.test.mjs and is never inferred here.
const record = (id, text, extra = {}) => ({ id, text, version: 1, visibility: 'public', characterIds: [],
  schemaVersion: 2, access: { kind: extra.visibility === 'characters' ? 'private' : 'world_public' }, knowers: [...(extra.characterIds ?? [])],
  epistemic: { kind: 'fact' }, credibility: 'confirmed',
  source: { runId: 'run-1', turn: 1, commitId: 'commit-1', bodyHash: 'synthetic-body-hash' }, ...extra });
const chunk = (id, text, extra = {}) => ({ id, text, sourceId: id, keywords: [], characterIds: [], locationIds: [],
  itemIds: [], storyBeatIds: [], updatedAt: 0, endPosition: 0, ...extra });
const bmInput = query => ({ query, characters: [], locations: [], items: [], storyBeats: [] });
const score = (id, value, extra = {}) => ({ chunk: chunk(id, id, extra), score: value, bm25Score: value, reason: 'bm25' });
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const simpleEmbed = async ({ texts }) => texts.map(text => /harbor|港/u.test(text) ? [1, 0] : [0, 1]);

test('source excerpts and AGPL license hashes are intact; extracted functions match upstream', async () => {
  const provenance = JSON.parse(await readFile(new URL('../licenses/zeolas-source-snippets.json', import.meta.url), 'utf8'));
  assert.equal(provenance.commit, 'a9362c4a18b585f2c322f2bab9e976144fa7eb46');
  assert.equal(fingerprint(await readFile(new URL('../licenses/zeolas-AGPL-3.0.md', import.meta.url))), provenance.license.sha256);
  for (const item of provenance.excerpts) assert.equal(fingerprint(item.text), item.sha256);
  const [norm, tokens, sparse, fuse] = provenance.excerpts.map(item => item.text);
  const source = `${norm}\n${tokens}\nexport class Probe {\n${sparse}\n}\nexport function fuse(input,sparse,dense,poolChunks,includeSticky){\n${fuse}\nreturn fusePool(sparse,dense,poolChunks,includeSticky);\n}`;
  const upstream = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, { mode: 'strip' })).toString('base64'));
  for (const value of ['ＡＢＣ 銀鑰匙', 'Tea tea 茶茶茶', 'ひらがな カタカナ 中文', 'café_29']) {
    assert.deepEqual(tokenizeForSparseRecall(value), upstream.tokenizeForSparseRecall(value));
  }
  const chunks = [chunk('a', '銀鑰匙', { keywords: ['銀鑰匙'] }), chunk('b', '森林'), chunk('c', '銀鑰匙 銀鑰匙')];
  const actual = bm25(bmInput('銀鑰匙'), chunks);
  assert.deepEqual(actual, new upstream.Probe().bm25(bmInput('銀鑰匙'), chunks));
  const dense = [...actual].reverse();
  assert.deepEqual(fuseRanks({}, actual, dense), upstream.fuse({}, actual, dense, [], false));
});

test('NFKC tokenizer retains repeated Chinese unigram/bigram frequencies', () => {
  assert.equal(normalized('ＡＢＣ'), 'abc');
  assert.deepEqual(tokenizeForSparseRecall('Tea tea 茶茶茶'), ['tea', 'tea', '茶', '茶', '茶', '茶茶', '茶茶']);
});

test('original BM25 formula, metadata boosts and source cap remain available', () => {
  const result = bm25({ ...bmInput('銀鑰匙'), characters: [{ id: 'hero', name: '銀鑰匙' }] },
    [chunk('a', '森林', { keywords: ['銀鑰匙'], characterIds: ['hero'] })]);
  assert.equal(result[0].score, 6);
  const rows = [score('a', 3, { sourceId: 'one' }), score('b', 2, { sourceId: 'one' }), score('c', 1, { sourceId: 'one' })];
  assert.equal(fuseRanks({}, rows, []).length, 2);
  assert.equal(fuseRanks({}, rows, [], [], true).length, 1);
  assert.deepEqual(bm25(bmInput('a'), []), []);
});

test('hybrid RRF accumulates both ranks without comparing raw score scales', () => {
  const a = score('a', 10000), b = score('b', 1), c = score('c', 0.3);
  const ranks = fuseRanks({}, [a, b], [b, c]);
  assert.equal(ranks[0].chunk.id, 'b');
  assert.ok(Math.abs(ranks[0].rrfScore - (1 / 62 + 1 / 61)) < 1e-12);
});

test('public and actor scope precedes embeddings, rerank, document frequency and provenance', async () => {
  const sent = [], reranked = [];
  const memory = new Memory({ embed: async input => { sent.push(...input.texts); return simpleEmbed(input); },
    rerank: async ({ candidates }) => { reranked.push(...candidates); return candidates.map((_, index) => ({ index, score: 1 })); } });
  const publicRows = [record('public', 'harbor lantern'), record('public2', 'harbor sail')];
  const secret = record('secret', 'harbor password 123', { visibility: 'characters', characterIds: ['alba'] });
  const foreign = record('foreign', 'harbor other run secret', { source: { runId: 'run-2' } });
  const malformed = { id: 'bad', text: 'harbor hidden malformed', visibility: 'characters', characterIds: ['other'] };
  const packet = await memory.retrieve({ query: 'harbor', runId: 'run-1', records: [...publicRows, secret, foreign, malformed] });
  assert.equal(packet.diagnostics.eligibleCount, 2);
  assert.deepEqual(new Set(packet.records.map(row => row.id)), new Set(['public', 'public2']));
  assert.ok(!sent.some(text => /password|secret|malformed/.test(text)));
  assert.ok(reranked.every(row => row.visibility === 'public'));
  const independent = await new Memory({ embed: simpleEmbed }).retrieve({ query: 'harbor', records: publicRows });
  assert.deepEqual(packet.records.map(row => row.scores.bm25), independent.records.map(row => row.scores.bm25));
  const actor = await memory.retrieve({ query: 'harbor password', records: [...publicRows, secret], characterId: 'alba', audience: 'owner' });
  assert.ok(actor.records.some(row => row.id === 'secret'));
  assert.equal(actor.scope.characterId, 'alba');
  assert.ok(actor.records.every(row => /^[a-f0-9]{64}$/.test(row.sourceHash)));
});

test('ambiguous run, malformed eligible source and duplicate IDs fail mechanically', async () => {
  const memory = new Memory();
  await assert.rejects(memory.retrieve({ query: 'a', records: [record('a', 'a'), record('b', 'b', {
    source: { runId: 'run-2', turn: 1, commitId: 'c2', bodyHash: 'h2' } })] }), /RUN_SCOPE_REQUIRED/);
  await assert.rejects(memory.retrieve({ query: 'a', records: [record('a', 'a'), record('a', 'a')] }), /DUPLICATE_ID/);
  await assert.rejects(memory.retrieve({ query: 'a', records: [record('a', 'a', { source: {} })] }), /RECORD_INVALID/);
});

test('committed source version invalidates embedding cache and rebuild reproduces recall', async () => {
  let documentCalls = 0;
  const memory = new Memory({ embeddingModel: 'offline-fixture-v1', embed: async input => {
    if (input.kind === 'document') documentCalls++;
    return simpleEmbed(input);
  } });
  const first = [record('a', 'harbor chart'), record('b', 'forest trail')];
  const p1 = await memory.retrieve({ query: 'harbor', records: first });
  await memory.retrieve({ query: 'harbor', records: first });
  assert.equal(documentCalls, 1);
  const next = [record('a', 'harbor chart updated', { version: 2, source: { ...first[0].source, turn: 2, commitId: 'commit-2' } }), first[1]];
  const p2 = await memory.retrieve({ query: 'harbor', records: next });
  assert.equal(documentCalls, 2);
  assert.notEqual(p1.records.find(row => row.id === 'a').sourceHash, p2.records.find(row => row.id === 'a').sourceHash);
  await memory.rebuild({ records: next });
  const rebuilt = await memory.retrieve({ query: 'harbor', records: next });
  assert.deepEqual(rebuilt.records, p2.records);
  assert.equal(documentCalls, 3);
  assert.deepEqual(first[0], record('a', 'harbor chart'));
});

test('restart restores only integrity checked compatible cache; empty cache rebuild is safe', async () => {
  const records = [record('a', 'harbor chart'), record('b', 'forest trail')];
  const old = new Memory({ embed: simpleEmbed, embeddingModel: 'fixture' });
  const before = await old.retrieve({ query: 'harbor', records });
  const saved = old.exportIndex();
  const fresh = new Memory({ embed: simpleEmbed, embeddingModel: 'fixture' });
  fresh.restoreIndex(JSON.parse(JSON.stringify(saved)));
  const restored = await fresh.retrieve({ query: 'harbor', records });
  assert.equal(restored.diagnostics.cacheHits, 2);
  assert.deepEqual(restored.records, before.records);
  const tampered = structuredClone(saved); tampered.vectors[0][1][0] = 123;
  assert.throws(() => fresh.restoreIndex(tampered), /INDEX_INVALID/);
  assert.throws(() => new Memory({ embeddingModel: 'another-model' }).restoreIndex(saved), /INDEX_INVALID/);
  fresh.clearCache();
  assert.equal(fresh.cacheSize, 0);
  assert.deepEqual((await fresh.retrieve({ query: 'harbor', records })).records, before.records);
});

test('dimension mismatch/nonfinite/zero vectors explicitly degrade to original sparse recall', async () => {
  const records = [record('a', 'harbor'), record('b', 'forest')];
  const fallback = await new Memory().retrieve({ query: 'harbor', records });
  for (const invalid of [[0, 0], [NaN, 1], [1, 0, 0]]) {
    const memory = new Memory({ dimensions: 2, embed: async ({ texts }) => texts.map(() => invalid) });
    const packet = await memory.retrieve({ query: 'harbor', records });
    assert.equal(packet.diagnostics.embedding, 'failed'); assert.equal(packet.status, 'degraded');
    assert.deepEqual(packet.records, fallback.records);
    assert.equal(memory.cacheSize, 0);
  }
  const mismatch = new Memory({ embed: async ({ texts, kind }) => texts.map(() => kind === 'query' ? [1, 0, 0] : [1, 0]) });
  assert.equal((await mismatch.retrieve({ query: 'harbor', records })).diagnostics.embedding, 'failed');
  assert.throws(() => cosineSimilarity([1, 0], [1]), /DIMENSION/);
});

test('provider errors expose fixed failure codes and never arbitrary secret-bearing messages', async () => {
  const memory = new Memory({ embed: async () => { throw new Error('Bearer secret-provider-key'); } });
  const packet = await memory.retrieve({ query: 'harbor', records: [record('a', 'harbor')] });
  assert.deepEqual(packet.diagnostics.failures, ['MEMORY_EMBED_FAILED']);
  assert.ok(!JSON.stringify(packet).includes('secret-provider-key'));
  const transportAbort = new Memory({ embed: async () => { throw Object.assign(new Error('provider cancelled'), { name: 'AbortError' }); } });
  assert.equal((await transportAbort.retrieve({ query: 'harbor', records: [record('a', 'harbor')] })).diagnostics.embedding, 'failed');
});

test('invalid, duplicate, missing and timed out rerank responses preserve RRF without fabricated evidence', async () => {
  const records = [record('a', 'harbor'), record('b', 'harbor sail')];
  const baseline = await new Memory({ embed: simpleEmbed }).retrieve({ query: 'harbor', records });
  for (const result of [[{ index: 8, score: 1 }], [{ index: 0, score: 1 }, { index: 0, score: 2 }], [], [{ index: 0, score: NaN }]]) {
    const packet = await new Memory({ embed: simpleEmbed, rerank: async () => result }).retrieve({ query: 'harbor', records });
    assert.equal(packet.diagnostics.rerank, 'failed'); assert.deepEqual(packet.records, baseline.records);
  }
  const timed = await new Memory({ embed: simpleEmbed, rerankTimeoutMs: 10,
    rerank: () => new Promise(() => {}) }).retrieve({ query: 'harbor', records });
  assert.equal(timed.diagnostics.rerank, 'failed'); assert.deepEqual(timed.records, baseline.records);
  const partial = await new Memory({ embed: simpleEmbed, rerank: async () => [{ index: 1, score: 0.4 }] })
    .retrieve({ query: 'harbor', records });
  assert.equal(partial.diagnostics.rerank, 'used');
  assert.equal(partial.records[0].id, baseline.records[1].id);
  assert.equal(partial.records[1].scores.rerank, null);
});

test('pre-cancel and in-flight cancellation never silently turn into sparse success or partial cache', async () => {
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(new Memory().retrieve({ query: 'a', records: [], signal: stopped.signal }), { name: 'AbortError' });
  const controller = new AbortController(); let calls = 0, receivedSignal;
  const memory = new Memory({ embed: async ({ texts, signal }) => {
    receivedSignal = signal; calls++;
    if (calls === 1) return texts.map(() => [1, 0]);
    controller.abort(); return new Promise(() => {});
  } });
  const records = Array.from({ length: 9 }, (_, index) => record(`r${index}`, `harbor ${index}`));
  await assert.rejects(memory.retrieve({ query: 'harbor', records, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(receivedSignal.aborted, true); assert.equal(memory.cacheSize, 0);
  const rerankController = new AbortController();
  const reranking = new Memory({ embed: simpleEmbed, rerank: async () => {
    rerankController.abort(); return new Promise(() => {});
  } });
  await assert.rejects(reranking.retrieve({ query: 'harbor', records: records.slice(0, 2), signal: rerankController.signal }), { name: 'AbortError' });
});

test('timeout preserves sparse result; clearCache invalidates in-flight publishing', async () => {
  const rows = [record('a', 'harbor')];
  const timed = await new Memory({ embed: () => new Promise(() => {}), embeddingTimeoutMs: 10 })
    .retrieve({ query: 'harbor', records: rows });
  assert.equal(timed.diagnostics.embedding, 'failed'); assert.equal(timed.records[0].id, 'a');
  let release;
  const memory = new Memory({ embed: () => new Promise(resolve => { release = resolve; }) });
  const pending = memory.prepare({ records: rows });
  await new Promise(resolve => setImmediate(resolve));
  memory.clearCache(); release([[1, 0]]); await pending;
  assert.equal(memory.cacheSize, 0);
});

test('empty corpus does not call embedding and BM25-only is labelled degraded', async () => {
  let calls = 0;
  const memory = new Memory({ embed: async () => { calls++; return []; } });
  const empty = await memory.retrieve({ query: 'harbor', records: [] });
  assert.equal(empty.status, 'empty'); assert.equal(calls, 0);
  const sparse = await new Memory().retrieve({ query: 'harbor', records: [record('a', 'harbor')] });
  assert.equal(sparse.status, 'degraded'); assert.equal(sparse.diagnostics.embedding, 'disabled');
});
