// Synthetic offline outputs only. Never replay a private player turn or call a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm';
import { createNativeModelPort } from '../plugin/native-model.mjs';
import {safeFailure} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import { DurableStore } from '../adapters/store.mjs';
import { applyStatProposal } from '../core/stat-contract.mjs';
import { postStatOutputContract } from '../core/post-stat-output.mjs';
import { budgetStage } from '../core/context-budget.mjs';
import { publicInspection } from '../core/inspection.mjs';

const characters = [{ id: 'ael', name: 'Ael', description: 'Synthetic Ael background.' }, { id: 'kalt', name: 'Kalt', description: 'Synthetic Kalt background.' }, { id: 'sio', name: 'Sio', description: 'Synthetic Sio background.' }];
const body = 'The player entered the bridge. Kalt stayed by the door.';
const previous = () => ({ world: { facts: { retained: true } }, characters: {} });
const change = extra => ({ scope: 'world', category: 'locations', key: 'player_location', operation: 'set', value: 'bridge', ...extra });
const proposal = changes => ({ contractVersion: 2, stateChanges: changes, memories: [] });
const roles = { speakers: [], actors: ['player'], decisionMakers: [] };
async function evidence(name, data) {
  if (!process.env.SCEAN_SCOPE_EVIDENCE_DIR) return;
  await mkdir(process.env.SCEAN_SCOPE_EVIDENCE_DIR, { recursive: true });
  await writeFile(join(process.env.SCEAN_SCOPE_EVIDENCE_DIR, name + '.json'), JSON.stringify({ synthetic: true, liveProviderCalls: 0, data }, null, 2) + '\n');
}
const legal = () => ({ ...proposal([change(), change({ scope: 'character', characterId: 'kalt', visibility: 'public', key: 'current', value: 'door' })]),
  memories: [{ schemaVersion: 2, text: 'Kalt witnessed the player arrive.', access: { kind: 'known_event' }, knowers: ['kalt'], characterIds: ['kalt'], visibility: 'characters', epistemic: { kind: 'fact' }, credibility: 'confirmed', participants: roles }],
  playerHistory: [{ text: 'A private player experience.', epistemic: { kind: 'experience' }, credibility: 'subjective', participants: roles }] });

async function fixture(output, { prepared = false, controller, blueprint } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scean-poststat-scope-'));
  const store = new DurableStore({ root });
  const requests = [], settlements = [];
  const stream = async function* (options) {
    requests.push(options);
    const input = JSON.parse(options.messages[0].content[0].text);
    const post = Object.hasOwn(input, 'finalBody');
    if (post && controller) controller.abort();
    yield { type: 'block-end', index: 0, block: { type: 'text', text: post ? JSON.stringify(output) : body } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const llm = { stream, async resolveModelInfo() { return { context: { contextWindow: 100000 } }; } };
  if (prepared) llm.prepareCall = async config => ({ config, stream });
  const model = createNativeModelPort({ llm, agentDefaultModel: { currentSelection: () => ({ provider: 'offline', model: 'synthetic' }) },
    usageLedger: { async reserve() { return 'synthetic'; }, async settle(_id, entry) { settlements.push(entry); } } });
  const engine = new SceanEngine({postBody:false,unconfiguredWritingMode:'current', store, model, memory: { async retrieve() { return { records: [], status: 'synthetic' }; } } });
  const run = await engine.createRun({ snapshot: { schemaVersion: 1, cardId: 'synthetic-scope', revision: 1, card: { name: 'Synthetic' }, worldbook: {}, preset: {}, characters, ...(blueprint ? { stateBlueprint: blueprint } : {}) }, ...(blueprint ? {} : { initialState: previous() }) });
  return { root, store, engine, run, requests, settlements, turn: () => engine.turn({ runId: run.runId, requestId: 'scope-test', input: 'Enter the bridge.', signal: controller?.signal }) };
}

test('dynamic generation schema bounds state targets to existing NPCs and legal world set/remove forms', () => {
  const contract = postStatOutputContract(characters);
  assert.equal(contract.enforcement, 'prompt_contract_only');
  assert.deepEqual(contract.npcStateIds, ['ael', 'kalt', 'sio']);
  const branches = contract.schema.properties.stateChanges.items.oneOf;
  for (const branch of branches) {
    assert.equal(branch.additionalProperties, false);
    const p = branch.properties;
    if (p.scope.const === 'character') { assert.deepEqual(p.characterId.enum, contract.npcStateIds); assert.equal(p.visibility.const, 'public'); }
    else { assert(!p.characterId); assert(!p.visibility); }
    assert.equal(Object.hasOwn(p, 'value'), p.operation.const === 'set');
  }
  assert.throws(() => postStatOutputContract([...characters, { id: 'player' }]), { code: 'INVALID_STAT_ROSTER' });
  const packet = budgetStage('post_stat', { system: 'Synthetic', input: { outputContract: contract, finalBody: body, previousState: previous(), characters } });
  assert(JSON.stringify(packet).includes('prompt_contract_only'));
});

for (const prepared of [false, true]) test(`engine -> budget -> native ${prepared ? 'prepared.stream' : 'llm.stream'} carries actual schema, no responseFormat fiction`, async () => {
  const env = await fixture(legal(), { prepared });
  const result = await env.turn();
  assert.equal(result.status, 'committed');
  const options = env.requests.at(-1), input = JSON.parse(options.messages[0].content[0].text);
  assert.equal(input.temporal.candidateRef,result.candidateRef);
  assert.deepEqual(input.outputContract, postStatOutputContract(characters,input.temporal.candidateRef));
  assert.match(options.system, /NEVER be used as stateChanges.characterId/);
  assert(!Object.hasOwn(options, 'responseFormat')); assert(!Object.hasOwn(options, 'tools'));
  assert.equal(env.requests.length, 4);
  assert.equal(result.state.world.locations.player_location, 'bridge');
  assert.equal(result.state.characters.kalt.public.locations.current, 'door');
  assert(!result.state.characters.player);
  const restart = new DurableStore({ root: env.root });
  const saved = await restart.read(env.run.runId);
  assert.equal(saved.playerHistory.length, 1); assert.equal(saved.memories.length, 1);
  assert.equal(saved.playerHistory[0].scope.kind, 'player_only');
  const again = await env.turn(); assert.equal(again.commitId, result.commitId); assert.equal(env.requests.length, 4);
  const audit = (await env.store.readAttempts(env.run.runId))[0];
  assert.deepEqual(audit.stages.at(-1).prompt.input.outputContract, input.outputContract);
  await evidence(prepared ? 'prepared-boundary' : 'stream-boundary', { prompt: { system: options.system, input }, before: env.run, after: saved, audit, idempotentCommitId: again.commitId });
});

test('actual shipped DSH LlmRuntime prepared adapter receives JSON contract in message content', async () => {
  const ctx = new Context(); await ctx.plugin(LlmRuntime); let actual;
  class OfflineAdapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream(options) { actual = options; yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(proposal([])) } }; yield { type: 'finish', reason: { kind: 'stop' } }; }
  }
  ctx.llm.registerAdapter(['offline'], new OfflineAdapter());
  try {
    const input = { finalBody: body, characters, outputContract: postStatOutputContract(characters) };
    const port = createNativeModelPort({ llm: ctx.llm, agentDefaultModel: { currentSelection: () => ({ provider: 'offline', model: 'synthetic' }) }, usageLedger: { async reserve() { return 'offline'; }, async settle() {} } });
    await port.generate({ stage: 'post_stat', system: 'Synthetic contract test', input });
    assert.deepEqual(JSON.parse(actual.messages[0].content[0].text), input);
    await evidence('shipped-sdk-boundary', { actualMessages: actual.messages, provider: actual.provider, model: actual.model, enforcement: 'prompt_contract_only' });
  } finally { await ctx.fiber.dispose(); }
});

test('illegal player targets at synthetic indices 6 and 12 remain rejected with safe exact location, never retargeted', () => {
  for (const index of [6, 12]) {
    const changes = Array.from({ length: index + 1 }, (_, i) => change({ key: `synthetic_${i}` }));
    changes[index] = change({ scope: 'character', characterId: 'player', visibility: 'public' });
    const old = previous(), input = proposal(changes);
    assert.throws(() => applyStatProposal(input, old, characters, body, { publicView: true }), error => {
      assert.equal(error.code, 'INVALID_STATE_SCOPE');
      assert.deepEqual(error.validation, { index, path: `/stateChanges/${index}`, reason: 'reserved_player' });
      const shown = safeFailure(error, 'post_stat');
      assert.match(shown.message, /均未保存/); assert(shown.message.includes(`第 ${index + 1} 筆`)); return true;
    });
    assert.deepEqual(old, previous()); assert.equal(input.stateChanges[index].characterId, 'player');
  }
});

test('invalid returned output preserves canonical bytes: no prose/state/memory/history/receipt half commit', async () => {
  const output = legal(); output.stateChanges.push(change({ scope: 'character', characterId: 'player', visibility: 'public', key: 'condition' }));
  const env = await fixture(output);
  const file = join(env.root, 'runs', env.run.runId, 'current.json'), before = await readFile(file);
  await assert.rejects(env.turn(), { code: 'INVALID_STATE_SCOPE' });
  assert.deepEqual(await readFile(file), before); assert.equal(env.requests.length, 4);
  const inspection = publicInspection(await env.engine.inspect(env.run.runId));
  assert.match(inspection.lastFailure.message, /Post-Stat.*均未保存/);
  assert.equal(inspection.lastFailure.validation.index, 2);
  const attempt = (await env.store.readAttempts(env.run.runId))[0];
  assert.equal(attempt.status, 'failed'); assert.equal(attempt.commit ?? null, null);
  assert.equal(attempt.stages.at(-1).status, 'completed'); // transport completion is distinct from validation
  await evidence('rejected-output', { before: JSON.parse(before), after: await env.store.read(env.run.runId), byteIdentical: true, attempt, publicFailure: inspection.lastFailure });
});

test('unknown character, illegal world fields and private state remain rejected; public error cannot echo payload', () => {
  for (const [extra, code] of [[{ scope: 'character', characterId: 'unknown', visibility: 'public' }, 'INVALID_STATE_SCOPE'], [{ characterId: 'player' }, 'INVALID_STATE_SCOPE'], [{ visibility: 'public' }, 'INVALID_STATE_SCOPE'], [{ scope: 'character', characterId: 'kalt', visibility: 'private' }, 'PRIVATE_STATE_WRITE_FORBIDDEN']]) {
    assert.throws(() => applyStatProposal(proposal([change(extra)]), previous(), characters, body, { publicView: true }), { code });
  }
  const error = safeFailure({ code: 'INVALID_STATE_SCOPE', message: 'SECRET', validation: { index: 7, reason: 'SECRET', path: 'SECRET' } }, 'post_stat');
  assert(!JSON.stringify(error).includes('SECRET')); assert(!error.validation);
});

test('Blueprint runs use the same state scope diagnosis before additional Blueprint validation', async () => {
  const blueprint = { schemaVersion: 1, id: 'synthetic-scope', version: 1, extensionPolicy: 'allow', variables: [] };
  const env = await fixture(proposal([change({ scope: 'character', characterId: 'player', visibility: 'public' })]), { blueprint });
  await assert.rejects(env.turn(), error => error.code === 'INVALID_STATE_SCOPE' && error.validation.index === 0);
  assert.equal((await env.store.read(env.run.runId)).turns.length, 0);
});

test('cancellation during settlement never accepts output or commits a half turn', async () => {
  const controller = new AbortController(), env = await fixture(legal(), { controller });
  const before = await env.store.read(env.run.runId);
  await assert.rejects(env.turn(), { code: 'CANCELLED' });
  assert.deepEqual(await env.store.read(env.run.runId), before);
  assert.equal((await env.store.readAttempts(env.run.runId))[0].status, 'cancelled');
});
