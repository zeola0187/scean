import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { SceanEngine, SYSTEMS, assembleSources, receiptOwnsAttempt } from '../core/engine.mjs';
import { DurableStore } from '../adapters/store.mjs';
import { Memory } from '../core/memory.mjs';
import { hash } from '../core/contracts.mjs';
import { findBans, repairRanges, applyLocalRepairs } from '../core/banlist.mjs';

const characterAdvice = (characterId, speech = 'A public suggestion, not an event.') => JSON.stringify({adviceVersion:1,characterId,observable:{attitude:'calm',intent:'consider the question'},publicUtterances:[speech],withheld:[],internal:{notes:[]},intendedDisclosures:[]});
const snapshot = () => ({ schemaVersion: 1, cardId: 'synthetic-stargazer', revision: 'r1', card: { name: 'Synthetic vessel', description: 'A quiet ship.' }, worldbook: { location: 'harbor' }, preset: { style: 'concise' }, characters: [{ id: 'lin', name: 'Lin', description: 'Navigator' }, { id: 'mei', name: 'Mei', description: 'Engineer' }], chapterSummary: 'Synthetic fixture, not a production session.' });
function scripted(overrides = {}) {
  const calls = [];
  return { calls, async generate(args) {
    calls.push(structuredClone({ ...args, signal: undefined }));
    if (overrides[args.stage]) return overrides[args.stage](args, calls);
    if (args.stage === 'director') return { text: 'A quiet exchange by the harbor.' };
    if (args.stage === 'draft') return { text: 'Lin puts a silver key beside the harbor chart.' };
    if (args.stage === 'prose') return { text: 'Lin placed the silver key beside the harbor chart.' };
    if (args.stage === 'character') return { text: characterAdvice(args.input.character.id) };
    if (args.stage === 'adjudicate') return { text: 'No roll is needed to lift the light crate.' };
    if (args.stage === 'post_stat') return { text: JSON.stringify({ contractVersion: 2, stateChanges: [{ scope: 'world', category: 'facts', key: 'keyLocation', operation: 'set', value: 'harbor chart' }], memories: [{ text: 'Lin placed the silver key beside the harbor chart.', characterIds: [], schemaVersion:2,access:{kind:'world_public'},knowers:[],epistemic:{kind:'fact'},credibility:'confirmed',visibility: 'public', participants: { speakers: [], actors: ['lin'], decisionMakers: [] } }, { text: 'Lin remembers the silver key.', characterIds: ['lin'], visibility: 'characters', participants: { speakers: [], actors: ['lin'], decisionMakers: [] } }] }) };
    throw new Error(`Unexpected stage ${args.stage}`);
  } };
}
async function setup(options = {}) {
  const testRoot = new URL('../.test-data/', import.meta.url); await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(new URL('core-', testRoot));
  const store = new DurableStore({ root, fault: options.fault });
  const model = options.model ?? scripted();
  const memory = options.memory ?? new Memory();
  const engine = new SceanEngine({unconfiguredWritingMode:'current', store, model, memory });
  const run = await engine.createRun({ snapshot: snapshot(), initialState: { world: { place: 'harbor' }, characters: { lin: { secret: 'LIN_PRIVATE', public: { role: 'navigator' } }, mei: { secret: 'MEI_PRIVATE' } } }, ...(options.create ?? {}) });
  return { root, store, model, memory, engine, run };
}
const turn = (env, requestId = 'request-1', extra = {}) => env.engine.turn({ runId: env.run.runId, requestId, input: 'Where is the silver key at the harbor?', ...extra });

test('selected saved opening reaches Director without rewriting the original card or replaying it as a new event', async () => {
  const source = { ...snapshot(), card: { name: 'Synthetic vessel', first_mes: 'Unselected harbor opening' }, opening: { id: 'alternate-1', title: 'Deck', text: 'Selected deck opening' } };
  const env = await setup({ create: { snapshot: source } });
  const originalHash = env.run.snapshot.hash;
  await turn(env);
  const inspected = await env.engine.inspect(env.run.runId);
  assert.deepEqual(inspected.attempts[0].assembly.sources.selectedOpening, source.opening);
  assert.equal(inspected.snapshot.card.first_mes, 'Unselected harbor opening');
  assert.equal(inspected.snapshot.hash, originalHash);
  const director = env.model.calls.find(c => c.stage === 'director');
  assert.ok(JSON.stringify(director).includes('Selected deck opening'));
  assert.match(SYSTEMS.director, /selectedOpening.*precedes recentDialogue.*do not replay/s);
});

test('Director explicit requests take priority over default daily zero-tool policy', () => {
  assert.match(SYSTEMS.director, /without an explicit consultation or adjudication request normally use no tools/);
  assert.match(SYSTEMS.director, /explicitly requests consultation.*call consult_character/);
  assert.match(SYSTEMS.director, /explicitly requests Stat adjudication, call adjudicate_action/);
  assert.ok(!SYSTEMS.director.includes('Ordinary daily interaction requires zero consultations'));
});

test('daily turn has zero consultations, full assembly, isolated handoffs and no reasoning persistence', async () => {
  const model = scripted({ director: () => ({ text: 'Public writing brief.', reasoning_content: 'SECRET_REASONING' }) });
  const env = await setup({ model }); const result = await turn(env);
  assert.equal(result.status, 'committed'); assert.equal(result.trace.tools.length, 0);
  assert.deepEqual(model.calls.map(c => c.stage), ['director', 'draft', 'prose', 'post_stat']);
  const assembly = model.calls[0].input.assembly;
  assert.equal(assembly.sources.snapshot.revision, 'r1'); assert.ok(assembly.sources.card); assert.ok(assembly.sources.worldbook); assert.ok(assembly.sources.preset);
  assert.ok(assembly.chapterSummary); assert.deepEqual(assembly.memory.records, []);
  assert.ok(!JSON.stringify(assembly).includes('LIN_PRIVATE')); assert.ok(!JSON.stringify(assembly).includes('MEI_PRIVATE'));
  assert.deepEqual(Object.keys(model.calls[2].input).sort(), ['characterIdentities', 'draft', 'playerInput', 'preset']);
  const inspected = await env.engine.inspect(env.run.runId);
  assert.equal(inspected.availability.directorTools, 'not_called');
  assert.ok(!JSON.stringify(inspected).includes('SECRET_REASONING'));
});

test('two committed rounds recall canonical public memories and restart preserves state/source', async () => {
  const env = await setup(); const first = await turn(env);
  const restarted = new SceanEngine({unconfiguredWritingMode:'current', store: new DurableStore(env.root), model: env.model, memory: new Memory() });
  const second = await restarted.turn({ runId: env.run.runId, requestId: 'request-2', input: 'Tell me where Lin put the silver key beside the harbor chart.' });
  assert.equal(second.version, 2);
  const assembly = env.model.calls.filter(c => c.stage === 'director')[1].input.assembly;
  assert.equal(assembly.worldState.world.facts.keyLocation, 'harbor chart'); assert.equal(assembly.recentDialogue.length, 1);
  assert.ok(assembly.memory.records.length > 0); assert.ok(assembly.memory.records.every(m => m.visibility === 'public'));
  assert.equal(assembly.memory.records[0].source.commitId, first.commitId);
  const run = await env.store.read(env.run.runId); assert.equal(run.turns.length, 2); assert.equal(run.memories.length, 4);
  for (const memory of run.memories) assert.equal(memory.source.bodyHash, run.turns[memory.source.turn - 1].bodyHash);
  const rebuilt = await new Memory().retrieve({ query: 'silver key harbor', records: run.memories, runId: run.runId }); assert.ok(rebuilt.records.length);
});

test('A1 Director optional CR has owner scope, Stat remains public, advice never commits', async () => {
  const model = scripted({ director: ({ input }) => input.conversation.length ? { text: 'Use the ruling, keep the event small.' } : { text: '', toolCalls: [{ id: 'cr-1', name: 'consult_character', arguments: { characterId: 'lin', question: 'What do you think about the key?' } }, { id: 'stat-1', name: 'adjudicate_action', arguments: JSON.stringify({ action: 'Lift a light crate' }) }] } });
  const env = await setup({ model }); const result = await turn(env);
  assert.deepEqual(result.trace.tools.map(t => t.name), ['consult_character', 'adjudicate_action']);
  const cr = model.calls.find(c => c.stage === 'character').input;
  assert.equal(cr.character.id, 'lin'); assert.equal(cr.ownState.secret, 'LIN_PRIVATE'); assert.ok(JSON.stringify(cr).includes('LIN_PRIVATE')); assert.ok(!JSON.stringify(cr).includes('MEI_PRIVATE'));
  const post = model.calls.find(c => c.stage === 'post_stat').input;
  assert.deepEqual(Object.keys(post).sort(), ['characters', 'finalBody', 'outputContract', 'previousState']); assert.ok(!JSON.stringify(post).includes('would cautiously'));
  assert.ok(!JSON.stringify(result.memories).includes('advice'));
});

test('unknown actor or forbidden Director tool fails without canonical mutation', async () => {
  for (const tool of [{ id: 'bad', name: 'consult_character', arguments: { characterId: 'unknown', question: 'hello' } }, { id: 'bad', name: 'write_memory', arguments: { text: 'bad' } }]) {
    const env = await setup({ model: scripted({ director: () => ({ text: '', toolCalls: [tool] }) }) });
    await assert.rejects(turn(env), /UNKNOWN_CHARACTER|TOOL_NOT_ALLOWED/);
    const current = await env.store.read(env.run.runId); assert.equal(current.version, 0); assert.equal(current.memories.length, 0);
    assert.equal((await env.engine.inspect(env.run.runId)).attempts[0].status, 'failed');
  }
});

test('mechanical BanList changes only hit sentence; user updates are versioned', async () => {
  const original = 'Keep this sentence. forbidden glimmer appears. Leave this untouched.';
  const model = scripted({ prose: () => ({ text: original }), prose_repair: ({ input }) => ({ text: JSON.stringify({ bodyHash: input.bodyHash, edits: input.ranges.map(r => ({ start: r.start, end: r.end, replacement: r.text.replace('forbidden', 'soft') })) }) }) });
  const env = await setup({ model });
  await env.engine.updateBanList({ runId: env.run.runId, banList: ['forbidden'], expectedVersion: 0 });
  const result = await turn(env);
  assert.equal(result.body, original.replace('forbidden', 'soft')); assert.equal(result.version, 2);
  const repair = model.calls.find(c => c.stage === 'prose_repair'); assert.ok(!JSON.stringify(repair.input).includes('Keep this sentence')); assert.ok(!JSON.stringify(repair.input).includes('Leave this untouched'));
  assert.equal(model.calls.filter(c => c.stage === 'draft').length, 1);
});

test('BanList is literal, handles overlaps, bounded spans, and rejects nonlocal patch', () => {
  const bans = [{ text: 'a+b', caseSensitive: false }]; const body = 'Before. A+B appears. After.';
  const hits = findBans(body, bans); assert.equal(hits.length, 1); assert.equal(findBans('aaab', bans).length, 0);
  const ranges = repairRanges(body, hits); assert.equal(ranges.length, 1);
  assert.throws(() => applyLocalRepairs(body, hash(body), hash(body), ranges, [{ start: 0, end: body.length, replacement: 'replacement' }]), /NONLOCAL/);
  const long = 'x'.repeat(1000) + 'bad' + 'x'.repeat(1000);
  assert.ok(repairRanges(long, [{ start: 1000, end: 1003 }])[0].text.length < 330);
});

test('BanList repair maximum two attempts leaves no partial round', async () => {
  const model = scripted({ prose: () => ({ text: 'forbidden remains.' }), prose_repair: ({ input }) => ({ text: JSON.stringify({ bodyHash: input.bodyHash, edits: input.ranges.map(r => ({ ...r, replacement: r.text })) }) }) });
  const env = await setup({ model, create: { banList: ['forbidden'] } });
  await assert.rejects(turn(env), /BANLIST_REPAIR_EXHAUSTED/);
  assert.equal(model.calls.filter(c => c.stage === 'prose_repair').length, 2); assert.equal((await env.store.read(env.run.runId)).version, 0);
});

test('model failure, malformed state, tool interruption and cancellation produce no half-round', async () => {
  for (const failedStage of ['director', 'draft', 'prose', 'post_stat', 'character']) {
    const overrides = { [failedStage]: () => { throw new Error('synthetic model interruption'); } };
    if (failedStage === 'character') overrides.director = () => ({ text: '', toolCalls: [{ id: 'cr-1', name: 'consult_character', arguments: { characterId: 'lin', question: 'hello' } }] });
    const env = await setup({ model: scripted(overrides) }); await assert.rejects(turn(env));
    const run = await env.store.read(env.run.runId); assert.equal(run.version, 0); assert.equal(run.turns.length, 0); assert.equal(run.memories.length, 0);
  }
  for (const proposal of [{ state: { world: {}, characters: { intruder: {} } }, memories: [] }, { state: { world: {}, characters: {} }, memories: [{ text: 'secret', visibility: 'characters', characterIds: [] }] }]) {
    const env = await setup({ model: scripted({ post_stat: () => ({ text: JSON.stringify(proposal) }) }) }); await assert.rejects(turn(env)); assert.equal((await env.store.read(env.run.runId)).version, 0);
  }
  const controller = new AbortController();
  const env = await setup({ model: scripted({ draft: () => { controller.abort(); return { text: 'discard me' }; } }) });
  await assert.rejects(turn(env, 'request-1', { signal: controller.signal }), /CANCELLED/);
  assert.equal((await env.engine.inspect(env.run.runId)).attempts[0].status, 'cancelled'); assert.equal((await env.store.read(env.run.runId)).version, 0);
});

test('write interruption before publication rolls back; after publication recovers idempotently', async () => {
  for (const point of ['beforeRename', 'afterRename']) {
    let armed = false;
    const env = await setup({ fault: at => { if (armed && at === point) throw new Error(`synthetic ${point}`); } }); armed = true;
    if (point === 'beforeRename') {
      await assert.rejects(turn(env)); assert.equal((await env.store.read(env.run.runId)).version, 0);
      armed = false; await turn(env);
    } else { const result = await turn(env); assert.equal(result.status, 'committed'); }
    const beforeCalls = env.model.calls.length;
    const result = await turn(env); assert.equal(result.turn, 1); assert.equal(env.model.calls.length, beforeCalls);
    assert.equal((await env.store.read(env.run.runId)).memories.length, 2);
    await assert.rejects(turn(env, 'request-1', { input: 'different' }), /IDEMPOTENCY_CONFLICT/);
  }
});

test('concurrent writer rejected and CAS enforced; no duplicate canonical commit', async () => {
  const env = await setup(); let release;
  const held = env.store.withRunLock(env.run.runId, async () => new Promise(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const other = new DurableStore(env.root);
  await assert.rejects(other.withRunLock(env.run.runId, async () => {}), /RUN_BUSY/);
  release(); await held;
  await assert.rejects(env.store.commit(env.run.runId, 0, { ...env.run, version: 1 }), /LOCK_REQUIRED/);
  await env.store.withRunLock(env.run.runId, async () => {
    await assert.rejects(env.store.commit(env.run.runId, 9, { ...env.run, version: 10 }), /VERSION_CONFLICT/);
  });
  await turn(env); assert.equal((await other.read(env.run.runId)).version, 1);
});

test('real child-process crash leaves lock recoverable and pending attempt becomes failed', async () => {
  const env = await setup();
  const storeUrl = new URL('../adapters/store.mjs', import.meta.url).href;
  const source = `import {DurableStore} from ${JSON.stringify(storeUrl)};const s=new DurableStore(${JSON.stringify(env.root)});await s.withRunLock(${JSON.stringify(env.run.runId)},async()=>{await s.writeAttempt(${JSON.stringify(env.run.runId)},{attemptId:'crash-attempt',requestId:'crash-request',status:'pending'});process.stdout.write('LOCKED\\n');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => { child.stdout.on('data', chunk => { output += chunk; if (output.includes('LOCKED')) resolve(); }); child.once('error', reject); child.once('exit', code => { if (!output.includes('LOCKED')) reject(new Error(`Child exited ${code}`)); }); });
  child.kill('SIGKILL'); await once(child, 'exit');
  const restarted = new SceanEngine({unconfiguredWritingMode:'current', store: new DurableStore(env.root), model: env.model, memory: env.memory });
  await restarted.turn({ runId: env.run.runId, requestId: 'post-crash', input: 'Where is the silver key?' });
  const failed = (await restarted.inspect(env.run.runId)).attempts.find(a => a.attemptId === 'crash-attempt');
  assert.equal(failed.status, 'failed'); assert.equal(failed.recovery, 'interrupted_before_commit');
  assert.equal((await readdir(path.join(env.root, 'runs', env.run.runId, 'writer-tickets'))).filter(n => n.endsWith('.json')).length, 0);
});

test('saved snapshot is fixed; new revision starts independent run and unsafe identifiers rejected', async () => {
  const source = snapshot(); const env = await setup({ create: { snapshot: source } });
  source.card.description = 'changed after create'; source.revision = 'r2';
  const newer = await env.engine.createRun({ snapshot: source });
  assert.equal((await env.engine.inspect(env.run.runId)).snapshot.revision, 'r1'); assert.equal(newer.snapshot.revision, 'r2');
  assert.notEqual(newer.snapshot.hash, env.run.snapshot.hash);
  assert.equal((await env.store.listRuns()).length, 2);
  await assert.rejects(env.store.read('../outside'), /INVALID_ID/);
});

test('Inspector orders attempts by time and reconciles nested commit after actual process exit post-publication', async () => {
  const env = await setup();
  const storeUrl = new URL('../adapters/store.mjs', import.meta.url).href;
  const source = `import {DurableStore} from ${JSON.stringify(storeUrl)};const s=new DurableStore({root:${JSON.stringify(env.root)},fault:(point)=>{if(point==='afterRename')process.exit(77)}});await s.withRunLock(${JSON.stringify(env.run.runId)},async()=>{const r=await s.read(${JSON.stringify(env.run.runId)});await s.writeAttempt(r.runId,{attemptId:'attempt-z-old',requestId:'req-crash',startedAt:'2026-10-15T01:00:00.000Z',status:'pending',directorComplete:true,tools:[],commit:{status:'pending'}});r.version++;r.receipts['req-crash']={commitId:'commit-crash',attemptId:'attempt-z-old',result:{status:'committed'}};await s.commit(r.runId,0,r);});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' }); const [code] = await once(child, 'exit'); assert.equal(code, 77);
  let inspected = await env.engine.inspect(env.run.runId);
  assert.equal(inspected.attempts[0].status, 'committed'); assert.equal(inspected.attempts[0].commit.status, 'committed');
  await env.store.writeAttempt(env.run.runId, { attemptId: 'attempt-a-new', requestId: 'req-new', startedAt: '2026-10-15T02:00:00.000Z', status: 'failed', directorComplete: false, tools: [] });
  inspected = await env.engine.inspect(env.run.runId); assert.equal(inspected.availability.trace, 'failed'); assert.equal(inspected.attempts.at(-1).attemptId, 'attempt-a-new');
  await env.store.withRunLock(env.run.runId, () => env.store.recoverAttempts(env.run.runId));
  const saved = (await env.store.readAttempts(env.run.runId))[0]; assert.equal(saved.status, 'committed'); assert.equal(saved.commit.status, 'committed');
});

test('truncated model response and out-of-role tools are rejected before commit', async () => {
  for (const response of [{ text: 'unfinished', finishReason: 'length' }, { text: 'draft', toolCalls: [{ id: 'bad', name: 'adjudicate_action', arguments: { action: 'anything' } }] }]) {
    const env = await setup({ model: scripted({ draft: () => response }) });
    await assert.rejects(turn(env), /INCOMPLETE_MODEL_RESPONSE|STAGE_TOOL_FORBIDDEN/);
    assert.equal((await env.store.read(env.run.runId)).version, 0);
  }
});

test('four real processes contend safely for aggregate CAS without lost updates', async () => {
  const env = await setup(); const storeUrl = new URL('../adapters/store.mjs', import.meta.url).href;
  const source = `import {DurableStore} from ${JSON.stringify(storeUrl)};const s=new DurableStore(${JSON.stringify(env.root)});for(let n=0;n<5;n++){let done=false;for(let retry=0;retry<500&&!done;retry++){try{await s.withRunLock(${JSON.stringify(env.run.runId)},async()=>{let r=await s.read(${JSON.stringify(env.run.runId)});await s.commit(r.runId,r.version,{...r,version:r.version+1});});done=true}catch(e){if(e.code!=='RUN_BUSY')throw e;await new Promise(r=>setTimeout(r,2));}}if(!done)throw Error('contention did not resolve')}`;
  const children = Array.from({ length: 4 }, () => spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'ignore', 'pipe'] }));
  const results = await Promise.all(children.map(async child => { let stderr = ''; child.stderr.on('data', data => { stderr += data; }); const [code] = await once(child, 'exit'); return { code, stderr }; }));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal((await env.store.read(env.run.runId)).version, 20);
});

test('R2 failed retry remains failed after same request commits; pending recovery requires actual attempt identity', async () => {
  assert.equal(receiptOwnsAttempt({ receipts: { legacy: { commitId: 'unknown-owner' } }, turns: [] }, { requestId: 'legacy' }), false);
  let fail = true;
  const env = await setup({ model: scripted({ prose: () => { if (fail) throw Object.assign(new Error('do not retain provider body secret-sentinel'), { code: 'max-tokens' }); return { text: 'A complete synthetic scene.' }; } }) });
  await assert.rejects(turn(env, 'same-request'), { code: 'max-tokens' });
  const failed = (await env.store.readAttempts(env.run.runId))[0];
  assert.equal(failed.error.stage, 'prose'); assert.equal(failed.error.code, 'max-tokens');
  assert.ok(failed.stages.at(-1).finishedAt); assert(!JSON.stringify(failed).includes('secret-sentinel'));
  let inspected = await env.engine.inspect(env.run.runId); assert.equal(inspected.lastFailure.stage, 'prose'); assert.equal(inspected.version, 0);
  fail = false; const result = await turn(env, 'same-request');
  inspected = await env.engine.inspect(env.run.runId);
  assert.equal(inspected.attempts[0].status, 'failed'); assert.equal(inspected.attempts[0].requestOutcome.status, 'committed'); assert.equal(inspected.attempts[0].requestOutcome.ownsCommit, false);
  assert.equal(inspected.attempts[1].status, 'committed'); assert.equal(inspected.attempts[1].requestOutcome.ownsCommit, true); assert.equal(inspected.lastFailure, null);
  assert.equal(result.trace.attemptId, inspected.attempts[1].attemptId);
  const { capacityBudget, ...identityContext } = env.model.calls[0].context;
  assert.deepEqual(identityContext, { runId: env.run.runId, requestId: 'same-request', attemptId: failed.attemptId });
  assert.equal(capacityBudget.contextWindow, 0);
  assert(capacityBudget.includedEstimate > 0);
  // Synthetic stale pending audit for the earlier retry must never inherit the later receipt.
  await env.store.writeAttempt(env.run.runId, { ...failed, status: 'pending' });
  await env.store.withRunLock(env.run.runId, () => env.store.recoverAttempts(env.run.runId));
  const recovered = (await env.store.readAttempts(env.run.runId))[0];
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.recovery, 'interrupted_before_commit'); assert.equal(recovered.commitId, undefined);
  assert.equal((await env.store.read(env.run.runId)).version, 1);
});

test('R2 Assembly removes only canonically identical embedded worldbook; frozen source and differing metadata remain intact', async () => {
  const book = { name: 'Synthetic book', entries: [{ keys: ['harbor'], content: 'A lighthouse.', enabled: true }], extension: { priority: 2 } };
  const snap = { ...snapshot(), hash: 'synthetic-frozen-snapshot', card: { data: { name: 'Vessel', character_book: structuredClone(book), extensions: { keep: true } } }, worldbook: structuredClone(book) };
  const before = hash(snap); const same = assembleSources(snap);
  assert.equal(same.diagnostics.status, 'identical_book_single_injection'); assert(same.diagnostics.savedBytes > 0);
  assert.equal(same.sources.card.data.character_book, undefined); assert.deepEqual(same.sources.worldbook, book); assert.equal(hash(snap), before);
  assert.equal(same.diagnostics.contentHashes.embeddedWorldbook, same.diagnostics.contentHashes.worldbook);
  assert.deepEqual(same.sources.preset, snap.preset); assert.deepEqual(same.sources.card.data.extensions, { keep: true });
  snap.worldbook = { extension: { priority: 2 }, entries: structuredClone(book.entries), name: 'Synthetic book' };
  assert.equal(assembleSources(snap).diagnostics.status, 'identical_book_single_injection');
  snap.worldbook.entries[0].enabled = false;
  const different = assembleSources(snap); assert.equal(different.diagnostics.status, 'different_books_retained'); assert.equal(different.diagnostics.savedBytes, 0); assert.deepEqual(different.sources.card.data.character_book, book);
  const { hash: ignoredHash, ...rawSnapshot } = snap;
  const env = await setup({ create: { snapshot: { ...rawSnapshot, worldbook: book } } }); await turn(env);
  const read = await env.engine.inspect(env.run.runId);
  assert.deepEqual(read.snapshot.card.data.character_book, book); assert.equal(read.attempts[0].assembly.sources.card.data.character_book, undefined);
  assert.equal(read.attempts[0].assemblyDiagnostics.status, 'identical_book_single_injection');
});

test('R2 uncoded mechanical legacy error retains code; arbitrary provider text is not persisted', async () => {
  for (const [message, code] of [['BUDGET_USD_EXHAUSTED', 'BUDGET_USD_EXHAUSTED'], ['HTTP failure: Bearer private-sentinel', 'TURN_FAILED']]) {
    const env = await setup({ model: scripted({ director: () => { throw new Error(message); } }) });
    await assert.rejects(turn(env)); const view = await env.engine.inspect(env.run.runId);
    assert.equal(view.lastFailure.code, code); assert.equal(view.lastFailure.stage, 'director'); assert.equal(view.turns.length, 0); assert(!JSON.stringify(view).includes('private-sentinel'));
  }
});

test('A1 CR receives one owner context and only projected advice enters the shared Writer chain', async () => {
  const source = snapshot();
  source.characters[0].description = 'LIN_BACKGROUND_ONLY: synthetic navigator.';
  source.characters[1].description = 'MEI_BACKGROUND_ONLY: synthetic engineer.';
  source.characters[0].publicDescription = 'LIN_PUBLIC_DESCRIPTION';
  source.characters[1].publicDescription = 'MEI_PUBLIC_DESCRIPTION';
  const model = scripted({
    director: ({ input }) => input.assembly.recentDialogue.length && !input.conversation.length ? { text: '', toolCalls: [
      { id: 'ask-lin', name: 'consult_character', arguments: { characterId: 'lin', question: 'What do you privately recall about the harbor key?' } },
      { id: 'ask-mei', name: 'consult_character', arguments: { characterId: 'mei', question: 'What do you privately recall about the harbor key?' } },
    ] } : { text: 'Give the player a quiet public scene.' },
    character: ({ input }) => ({ text: characterAdvice(input.character.id, `${input.character.name} gives a public suggestion, not an event.`) }),
    post_stat: ({ input }) => ({ text: JSON.stringify({ contractVersion: 2, stateChanges: [], memories: [
      { text: 'Harbor key PUBLIC_MEMORY_SENTINEL is visible.', characterIds: [], schemaVersion:2,access:{kind:'world_public'},knowers:[],epistemic:{kind:'fact'},credibility:'confirmed',visibility: 'public', participants: { speakers: [], actors: [], decisionMakers: [] } },
      { text: 'Harbor key LIN_MEMORY_ONLY private recollection.', characterIds: ['lin'], visibility: 'characters', participants: { speakers: [], actors: ['lin'], decisionMakers: [] } },
      { text: 'Harbor key MEI_MEMORY_ONLY private recollection.', characterIds: ['mei'], visibility: 'characters', participants: { speakers: [], actors: ['mei'], decisionMakers: [] } },
    ] }) }),
  });
  const env = await setup({ model, create: { snapshot: source } });
  await turn(env, 'scope-seed'); await turn(env, 'scope-consult');
  const directors = model.calls.filter(c => c.stage === 'director');
  for (const call of directors) assert.deepEqual(call.input.assembly.characters, [{ id: 'lin', name: 'Lin' }, { id: 'mei', name: 'Mei' }]);
  const consulted = model.calls.filter(c => c.stage === 'character'); assert.equal(consulted.length, 2);
  for (const [index, own, other] of [[0, 'LIN', 'MEI'], [1, 'MEI', 'LIN']]) {
    const payload = consulted[index].input; const encoded = JSON.stringify(payload);
    assert.equal(payload.character.id, own.toLowerCase()); assert.equal(Array.isArray(payload.character), false);
    assert.match(encoded, new RegExp(`${own}_PUBLIC_DESCRIPTION`));
    for (const suffix of ['BACKGROUND_ONLY', 'PRIVATE', 'MEMORY_ONLY']) assert(encoded.includes(`${own}_${suffix}`));
    for (const suffix of ['BACKGROUND_ONLY', 'PRIVATE', 'MEMORY_ONLY']) assert(!encoded.includes(`${other}_${suffix}`));
    assert(encoded.includes('PUBLIC_MEMORY_SENTINEL'));
    assert(payload.memory.records.every(m => m.visibility === 'public' || m.characterIds.includes(own.toLowerCase())));
  }
  const directorAfterSeed = directors.find(c => c.input.assembly.recentDialogue.length);
  const directorText = JSON.stringify(directorAfterSeed.input);
  assert(!directorText.includes('LIN_MEMORY_ONLY')); assert(!directorText.includes('MEI_MEMORY_ONLY'));
  assert(!directorText.includes('LIN_PRIVATE')); assert(!directorText.includes('MEI_PRIVATE'));
  const view = await env.engine.inspect(env.run.runId); assert.equal(view.turns.length, 2);
  const ownRecall=await env.memory.retrieve({query:'Harbor key',records:view.memories,runId:view.runId,characterId:'lin',audience:'owner'});
  assert(ownRecall.records.some(m=>m.text.includes('LIN_MEMORY_ONLY')));
  assert(!ownRecall.records.some(m=>m.text.includes('MEI_MEMORY_ONLY')));
  assert(view.attempts.at(-1).tools.every(t => t.kind === 'advice_not_event'));
  assert(!JSON.stringify(view.memories).includes('public suggestion'));
});

test('R2 CR rejects an array or combined actor identity instead of silently consulting main or multiple actors', async () => {
  for (const characterId of [['lin', 'mei'], 'lin,mei', 'main']) {
    const model = scripted({ director: () => ({ text: '', toolCalls: [{ id: 'bad-actor-list', name: 'consult_character', arguments: { characterId, question: 'Ask both actors.' } }] }) });
    const env = await setup({ model }); await assert.rejects(turn(env), { code: 'UNKNOWN_CHARACTER' });
    assert.equal(model.calls.filter(c => c.stage === 'character').length, 0);
    const view = await env.engine.inspect(env.run.runId); assert.equal(view.version, 0); assert.equal(view.memories.length, 0); assert.equal(view.lastFailure.stage, 'consult_character');
  }
});
