import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SceanEngine } from '../core/engine.mjs';
import { DurableStore } from '../adapters/store.mjs';

// All inputs are synthetic. Model responses are deliberately scripted: these tests
// verify the host boundary, never a claim about live model attribution or prose quality.
const characterAdvice = (characterId, speech = 'A public suggestion, not an event.') => JSON.stringify({adviceVersion:1,characterId,observable:{attitude:'calm',intent:'consider the question'},publicUtterances:[speech],withheld:[],internal:{notes:[]},intendedDisclosures:[]});
const identity = { gender: 'female', pronouns: 'she/her', source: 'user-explicit' };
const snapshot = () => ({ schemaVersion: 1, cardId: 'r3-synthetic-handoffs', revision: 'r3', card: { name: 'Synthetic test ship' }, worldbook: { setting: 'test harbor' }, preset: {},
  characters: [{ id: 'engineer', name: 'Engineer', description: 'FULL_BACKGROUND_ENGINEER_SENTINEL', identity: structuredClone(identity) }, { id: 'navigator', name: 'Navigator', description: 'FULL_BACKGROUND_NAVIGATOR_SENTINEL' }],
  recentDialogue: [{ turn: 0, input: 'Earlier synthetic question', body: 'The inspection was requested earlier.' }] });
const initialState = () => ({ world: { resources: { fuel: 80 }, tasks: { inspection: { status: 'pending' } } }, characters: { engineer: { private: { facts: { secret: 'ENGINEER_PRIVATE_SENTINEL' } }, public: { locations: { current: 'workshop' } } }, navigator: { private: { facts: { secret: 'NAVIGATOR_PRIVATE_SENTINEL' } } } } });
const emptyProposal = () => ({ contractVersion: 2, stateChanges: [], memories: [] });
const memory = () => ({ text: 'The engineer completed the inspection.', characterIds: ['engineer'], visibility: 'characters', participants: { speakers: [], actors: ['engineer'], decisionMakers: [] } });
function modelFor(overrides = {}) {
  const calls = [];
  return { calls, async generate(args) {
    calls.push({ stage: args.stage, input: structuredClone(args.input), tools: structuredClone(args.tools) });
    if (overrides[args.stage]) return overrides[args.stage](args);
    const defaults = { director: 'Describe the current quiet scene.', draft: 'The crew waited without taking action.', prose: 'The crew waited without taking action.', character: characterAdvice(args.input.character?.id ?? 'unused'), adjudicate: 'No roll required. Proposed fuel after action: 54.375.', post_stat: JSON.stringify(emptyProposal()) };
    return { text: defaults[args.stage] };
  } };
}
const retrieval = { async retrieve({ records }) { return { records: structuredClone(records), status: 'synthetic_offline' }; } };
async function setup({ model = modelFor(), fault, source = snapshot() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scean-r3-handoffs-'));
  const store = new DurableStore({ root, fault });
  const engine = new SceanEngine({unconfiguredWritingMode:'current', store, model, memory: retrieval });
  const run = await engine.createRun({ snapshot: source, initialState: initialState() });
  return { root, store, engine, model, run };
}
const turn = env => env.engine.turn({ runId: env.run.runId, requestId: 'synthetic-request', input: 'Consider the existing task without performing a new action.' });
function consult(name, args) {
  return ({ input }) => input.conversation.length ? { text: 'Preserve the public result as advice only.' } : { text: '', toolCalls: [{ id: 'consult-1', name, arguments: args }] };
}
async function assertUncommitted(env) {
  const run = await env.store.read(env.run.runId);
  assert.equal(run.version, 0); assert.equal(run.turns.length, 0); assert.equal(run.memories.length, 0);
  assert.deepEqual(run.receipts, {}); assert.deepEqual(run.state, initialState());
  const attempts = await env.store.readAttempts(run.runId); assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'failed');
}

test('R3 optional Stat query/calculate/adjudicate modes receive public state, recent dialogue and identity; suggestions never commit', async t => {
  for (const mode of [undefined, 'query', 'calculate', 'adjudicate']) await t.test(mode ?? 'omitted defaults to adjudicate', async () => {
    const args = { action: 'Compute an optional fuel use without performing it.', ...(mode ? { mode } : {}) };
    const env = await setup({ model: modelFor({ director: consult('adjudicate_action', args), adjudicate: () => ({ text: 'Hypothetically fuel decreases to 54.375. No dice are necessary.' }) }) });
    const result = await turn(env);
    const pre = env.model.calls.find(c => c.stage === 'adjudicate').input;
    assert.equal(pre.mode, mode ?? 'adjudicate');
    assert.deepEqual(pre.recentDialogue, env.run.snapshot.recentDialogue);
    assert.deepEqual(pre.characterIdentities[0].identity, identity);
    assert.equal(pre.state.world.resources.fuel, 80);
    assert.equal(pre.state.characters.engineer.public.locations.current, 'workshop');
    for (const call of env.model.calls.filter(c => ['director', 'draft', 'adjudicate', 'prose'].includes(c.stage))) {
      const encoded = JSON.stringify(call.input);
      assert(!encoded.includes('ENGINEER_PRIVATE_SENTINEL')); assert(!encoded.includes('NAVIGATOR_PRIVATE_SENTINEL'));
    }
    assert.deepEqual(result.state, initialState()); assert.equal(result.memories.length, 0);
    assert.equal(result.trace.tools[0].kind, 'ruling_not_commit');
    const secondDirector = env.model.calls.filter(c => c.stage === 'director')[1];
    assert.match(secondDirector.input.conversation.find(c => c.role === 'tool').result.text, /54\.375/);
  });
});

test('R3 invalid Stat mode fails before consultant and leaves no half-turn', async () => {
  const env = await setup({ model: modelFor({ director: consult('adjudicate_action', { action: 'Inspect', mode: 'execute-and-write' }) }) });
  await assert.rejects(turn(env), { code: 'INVALID_STAT_MODE' });
  assert.equal(env.model.calls.some(c => c.stage === 'adjudicate'), false);
  await assertUncommitted(env);
});

test('A1 explicit identity crosses stages, CR receives own full context but excludes the other actor', async () => {
  const env = await setup({ model: modelFor({ director: consult('consult_character', { characterId: 'engineer', question: 'Give your viewpoint.' }) }) });
  await turn(env);
  const byStage = stage => env.model.calls.find(c => c.stage === stage).input;
  assert.deepEqual(byStage('director').assembly.characterIdentities[0].identity, identity);
  assert.deepEqual(byStage('draft').context.characterIdentities[0].identity, identity);
  assert.deepEqual(byStage('character').character.identity, identity);
  assert.deepEqual(byStage('prose').characterIdentities[0].identity, identity);
  assert.deepEqual(byStage('post_stat').characters[0].identity, identity);
  const cr = JSON.stringify(byStage('character'));
  assert(cr.includes('FULL_BACKGROUND_ENGINEER_SENTINEL')); assert(cr.includes('ENGINEER_PRIVATE_SENTINEL'));
  assert(!cr.includes('FULL_BACKGROUND_NAVIGATOR_SENTINEL')); assert(!cr.includes('NAVIGATOR_PRIVATE_SENTINEL'));
  const prose = JSON.stringify(byStage('prose'));
  for (const excluded of ['FULL_BACKGROUND_ENGINEER_SENTINEL', 'FULL_BACKGROUND_NAVIGATOR_SENTINEL', 'ENGINEER_PRIVATE_SENTINEL', 'NAVIGATOR_PRIVATE_SENTINEL', 'ownState', 'previousState']) assert(!prose.includes(excluded));
  assert.equal(Object.hasOwn(byStage('prose').characterIdentities[0], 'description'), false);
  assert.equal((await env.store.read(env.run.runId)).snapshot.characters[0].identity.source, 'user-explicit');
});

test('R3 invalid identity is rejected at create before any persisted Run or model invocation', async () => {
  for (const badIdentity of [{ gender: 'female', source: 'inferred' }, { source: 'user-explicit' }, { gender: 7, source: 'user-explicit' }, { pronouns: 'she', source: 'user-explicit', private: 'not-an-identity-field' }]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scean-r3-handoffs-identity-'));
    const store = new DurableStore(root), model = modelFor(), engine = new SceanEngine({unconfiguredWritingMode:'current', store, model, memory: retrieval });
    const source = snapshot(); source.characters[0].identity = badIdentity;
    await assert.rejects(engine.createRun({ snapshot: source }), { code: 'INVALID_ACTOR_IDENTITY' });
    assert.deepEqual(await store.listRuns(), []); assert.equal(model.calls.length, 0);
  }
});

test('R3 completed prose and v2 delta persist concrete objective values without a dice prerequisite', async () => {
  const finalBody = 'The engineer completed the inspection. The measured fuel was 54.375 units.';
  const proposal = { contractVersion: 2, stateChanges: [{ scope: 'world', category: 'resources', key: 'fuel', operation: 'set', value: 54.375 }, { scope: 'world', category: 'tasks', key: 'inspection', operation: 'set', value: { status: 'completed' } }], memories: [memory()] };
  const env = await setup({ model: modelFor({ draft: () => ({ text: finalBody }), prose: () => ({ text: finalBody }), post_stat: ({ input }) => { assert.equal(input.finalBody, finalBody); return { text: JSON.stringify(proposal) }; } }) });
  const result = await turn(env);
  assert.equal(result.state.world.resources.fuel, 54.375); assert.equal(result.state.world.tasks.inspection.status, 'completed');
  assert.equal(result.state.characters.engineer.private.facts.secret, 'ENGINEER_PRIVATE_SENTINEL');
  assert.equal(env.model.calls.some(c => c.stage === 'adjudicate'), false);
  const restarted = new DurableStore(env.root), saved = await restarted.read(env.run.runId);
  assert.equal(saved.turns.length, 1); assert.deepEqual(saved.state, result.state); assert.deepEqual(saved.turns[0].stateAfter, result.state);
  assert.deepEqual(saved.memories[0].participants, memory().participants);
  assert.equal(saved.memories[0].source.commitId, saved.turns[0].commitId);
});

test('R3 malformed postStat or missing exact quote discards staged prose/state/memory together', async t => {
  const cases = [
    ['legacy state replacement', { state: initialState(), memories: [] }, 'INVALID_STAT_FIELDS'],
    ['missing participant roles', { ...emptyProposal(), memories: [{ text: 'Synthetic event', characterIds: ['engineer'], visibility: 'characters' }] }, 'INVALID_STAT_FIELDS'],
    ['quote absent from final body', { ...emptyProposal(), stateChanges: [{ scope: 'world', category: 'resources', key: 'fuel', operation: 'set', value: 12 }], memories: [{ ...memory(), quotes: [{ speakerId: 'engineer', text: 'This quote was never spoken.' }] }] }, 'QUOTE_NOT_IN_FINAL_BODY'],
  ];
  for (const [label, proposal, code] of cases) await t.test(label, async () => {
    const env = await setup({ model: modelFor({ post_stat: () => ({ text: JSON.stringify(proposal) }) }) });
    await assert.rejects(turn(env), { code }); await assertUncommitted(env);
    assert(env.model.calls.some(c => c.stage === 'prose'));
  });
});

test('R3 lost acknowledgement after rename survives restart with exactly one v2 commit', async () => {
  let armed = false, faults = 0;
  const proposal = { contractVersion: 2, stateChanges: [{ scope: 'world', category: 'tasks', key: 'inspection', operation: 'set', value: { status: 'completed' } }], memories: [memory()] };
  const env = await setup({ fault: point => { if (armed && point === 'afterRename') { faults++; throw new Error('SYNTHETIC_ACK_LOST'); } }, model: modelFor({ prose: () => ({ text: 'The engineer completed the inspection.' }), post_stat: () => ({ text: JSON.stringify(proposal) }) }) });
  armed = true;
  const result = await turn(env); assert.equal(result.status, 'committed'); assert.equal(faults, 1);
  const model = { async generate() { throw new Error('IDEMPOTENT_REPLAY_MUST_NOT_CALL_MODEL'); } };
  const store = new DurableStore(env.root), engine = new SceanEngine({unconfiguredWritingMode:'current', store, model, memory: retrieval });
  const replay = await turn({ ...env, engine }); assert.deepEqual(replay, result);
  const saved = await engine.inspect(env.run.runId);
  assert.equal(saved.version, 1); assert.equal(saved.turns.length, 1); assert.equal(saved.memories.length, 1); assert.equal(Object.keys(saved.receipts).length, 1);
  assert.equal(saved.state.world.tasks.inspection.status, 'completed');
  assert.equal(saved.attempts.length, 1); assert.equal(saved.attempts[0].recovery, 'published_before_error'); assert.equal(saved.attempts[0].commit.contractVersion, 2);
  assert.deepEqual(saved.attempts[0].commit.stateChanges, proposal.stateChanges);
});
