import test from 'node:test';
import assert from 'node:assert/strict';
import { SceanEngine } from '../packages/scean/core/engine.mjs';

// Observe the packaged engine's real stage packets with synthetic model output.
// This is not a persistence/concurrency test or a live-model semantic assessment.
// Store, recall and model ports are all in memory; no provider or profile is used.
const copy = value => structuredClone(value);

class InMemoryStore {
  runs = new Map();
  attempts = new Map();
  async create(run) { this.runs.set(run.runId, copy(run)); return copy(run); }
  async read(runId) { return copy(this.runs.get(runId)); }
  async withRunLock(_runId, fn) { return fn(); }
  async recoverAttempts() {}
  async readAttempts(runId) {
    return [...this.attempts.values()].filter(attempt => attempt.runId === runId).map(copy);
  }
  async writeAttempt(_runId, attempt) { this.attempts.set(attempt.attemptId, copy(attempt)); }
  async commit(runId, expectedVersion, next) {
    assert.equal(this.runs.get(runId).version, expectedVersion);
    this.runs.set(runId, copy(next));
    return copy(next);
  }
}

const fields = {
  description: 'The synthetic crew is waiting in a workshop.',
  personality: 'PUBLIC_VOICE: each crew member has a distinct way of speaking.',
  mes_example: '<START>\n{{char}}: EXAMPLE_WORDS, not a committed event.',
  system_prompt: 'LEGACY_SYSTEM_FIELD: a retained card instruction.',
  post_history_instructions: 'LEGACY_POST_HISTORY_FIELD: a retained card instruction.',
  creator_notes: 'AUTHOR_BACKSTAGE: a possible later development.',
};
const writingGuidance = 'TURN_GUIDANCE: preserve the requested quiet pause.';
const story = 'The synthetic crew pauses without performing another action.';
const privateMarkers = [
  'OWNER_BACKGROUND_A', 'OWNER_BACKGROUND_B',
  'OWNER_CARD_SECRET_A', 'OWNER_CARD_SECRET_B',
  'OWNER_STATE_A', 'OWNER_STATE_B',
  'OWNER_MEMORY_A', 'OWNER_MEMORY_B', 'OWNER_KNOWN_EVENT_A',
  'WITHHELD_ADVICE', 'INTERNAL_ADVICE',
];

function actorFixtures() {
  return [
    { id: 'voice-a', name: 'A', description: 'OWNER_BACKGROUND_A', publicDescription: 'Public profile A', private: { secret: 'OWNER_CARD_SECRET_A' } },
    { id: 'voice-b', name: 'B', description: 'OWNER_BACKGROUND_B', publicDescription: 'Public profile B', private: { secret: 'OWNER_CARD_SECRET_B' } },
  ];
}

function memoryFixture(runId, id, text, access, owner) {
  const knowers = owner ? [owner] : [];
  return {
    schemaVersion: 2, version: 1, id, text, access: { kind: access },
    knowers, characterIds: [...knowers], visibility: access === 'world_public' ? 'public' : 'characters',
    epistemic: { kind: 'fact' }, credibility: 'confirmed',
    participants: { speakers: [], actors: [], decisionMakers: [] }, source: { runId },
  };
}

async function setup({ consult = false } = {}) {
  const store = new InMemoryStore(), calls = [], actors = actorFixtures();
  const model = {
    async generate({ stage, system, input, tools }) {
      calls.push(copy({ stage, system, input, tools }));
      if (stage === 'director') {
        return consult && !input.conversation.length
          ? { text: '', toolCalls: [{ id: 'consult-a', name: 'consult_character', arguments: { characterId: 'voice-a', question: 'Consider this synthetic pause.' } }] }
          : { text: 'Public brief: preserve the quiet pause.' };
      }
      if (stage === 'character') return { text: JSON.stringify({
        adviceVersion: 1, characterId: 'voice-a',
        observable: { attitude: 'calm', intent: 'a possible reply, not an action already taken' },
        publicUtterances: ['PUBLIC_ADVICE'], withheld: ['WITHHELD_ADVICE'],
        internal: { notes: ['INTERNAL_ADVICE'] }, intendedDisclosures: [],
      }) };
      if (stage === 'post_stat') return { text: JSON.stringify({ contractVersion: 2, stateChanges: [], memories: [] }) };
      assert(['draft', 'prose'].includes(stage), `Unexpected stage: ${stage}`);
      return { text: story };
    },
  };
  const engine = new SceanEngine({unconfiguredWritingMode:'current', store, model, memory: {
    async retrieve({ records }) { return { records: copy(records), status: 'synthetic_offline' }; },
  } });
  const snapshot = {
    schemaVersion: 1, cardId: 'native-dialogue-synthetic', revision: 1,
    card: { data: { name: 'Synthetic dialogue card', ...fields, extensions: { scean: { characters: copy(actors) } } } },
    worldbook: { entries: [] }, preset: { style: 'concise' }, characters: actors,
  };
  const initialState = {
    world: { place: 'synthetic workshop' },
    characters: {
      'voice-a': { public: { role: 'engineer' }, private: { secret: 'OWNER_STATE_A' } },
      'voice-b': { public: { role: 'navigator' }, private: { secret: 'OWNER_STATE_B' } },
    },
  };
  const created = await engine.createRun({ runId: consult ? 'dialogue-with-consult' : 'dialogue-without-consult', snapshot, initialState });
  const memories = [
    memoryFixture(created.runId, 'public-memory', 'PUBLIC_MEMORY', 'world_public'),
    memoryFixture(created.runId, 'private-a', 'OWNER_MEMORY_A', 'private', 'voice-a'),
    memoryFixture(created.runId, 'known-a', 'OWNER_KNOWN_EVENT_A', 'known_event', 'voice-a'),
    memoryFixture(created.runId, 'private-b', 'OWNER_MEMORY_B', 'private', 'voice-b'),
  ];
  const run = { ...created, version: 1, memories };
  await store.commit(run.runId, 0, run);
  const result = await engine.turn({ runId: run.runId, requestId: 'dialogue-request', input: 'Pause.', writingGuidance });
  return { store, calls, run, result, initialState };
}

function assertSharedStageRouting({ calls }) {
  const director = calls.find(call => call.stage === 'director');
  const draft = calls.find(call => call.stage === 'draft');
  for (const assembly of [director.input.assembly, draft.input.context]) {
    for (const [field, value] of Object.entries(fields)) assert.equal(assembly.sources.card.data[field], value);
    assert.equal(assembly.writingGuidance, writingGuidance);
    assert.deepEqual(assembly.memory.records.map(record => record.id), ['public-memory']);
    assert.deepEqual(assembly.sources.card.data.extensions.scean.characters, [
      { id: 'voice-a', name: 'A', description: 'Public profile A' },
      { id: 'voice-b', name: 'B', description: 'Public profile B' },
    ]);
  }
  for (const call of calls) assert.notEqual(call.system, fields.system_prompt);
  for (const call of calls.filter(call => call.stage !== 'character')) {
    const packet = JSON.stringify(call.input);
    for (const marker of privateMarkers) assert(!packet.includes(marker), `${call.stage} exposed ${marker}`);
  }
  const prose = calls.find(call => call.stage === 'prose').input;
  assert.deepEqual(Object.keys(prose).sort(), ['characterIdentities', 'draft', 'playerInput', 'preset']);
  assert.equal(prose.draft, story);
  assert.deepEqual(prose.preset, { style: 'concise' });
  const postStat = calls.find(call => call.stage === 'post_stat').input;
  assert.deepEqual(Object.keys(postStat).sort(), ['characters', 'finalBody', 'outputContract', 'previousState']);
  assert.equal(postStat.finalBody, story);
  for (const call of calls.filter(call => ['prose', 'post_stat'].includes(call.stage))) {
    const packet = JSON.stringify(call.input);
    for (const value of [...Object.values(fields), writingGuidance]) assert(!packet.includes(value), `${call.stage} received a direct card/guidance field`);
  }
}

test('native dialogue: ordinary four-stage turn routes retained tavern fields as card data and still runs PostStat', async t => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; assert.fail('No network in dialogue contract acceptance'); });
  const env = await setup();
  assertSharedStageRouting(env);
  assert.deepEqual(env.calls.map(call => call.stage), ['director', 'draft', 'prose', 'post_stat']);
  assert.deepEqual(env.result.trace.tools, []);
  assert.deepEqual(env.result.memories, []);
  assert.deepEqual(env.result.state, env.initialState);
  assert.equal(env.result.status, 'committed');
  assert.equal(networkCalls, 0);
});

test('native dialogue: consultation gets only its owner context and projects advice without creating events or memories', async t => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; assert.fail('No network in dialogue contract acceptance'); });
  const env = await setup({ consult: true });
  assertSharedStageRouting(env);
  assert.deepEqual(env.calls.map(call => call.stage), ['director', 'character', 'director', 'draft', 'prose', 'post_stat']);
  const owner = env.calls.find(call => call.stage === 'character').input;
  assert.equal(owner.character.id, 'voice-a');
  assert.equal(owner.character.description, 'OWNER_BACKGROUND_A');
  assert.deepEqual(owner.character.private, { secret: 'OWNER_CARD_SECRET_A' });
  assert.deepEqual(owner.ownState.private, { secret: 'OWNER_STATE_A' });
  assert.deepEqual(owner.publicWorld, env.initialState.world);
  assert.deepEqual(owner.memory.records.map(record => record.id), ['public-memory', 'private-a', 'known-a']);
  assert.equal(owner.lastCommittedTurn, null);
  for (const otherMarker of ['OWNER_BACKGROUND_B', 'OWNER_CARD_SECRET_B', 'OWNER_STATE_B', 'OWNER_MEMORY_B']) {
    assert(!JSON.stringify(owner).includes(otherMarker), `Owner packet exposed ${otherMarker}`);
  }
  const publicToolResult = env.calls.filter(call => call.stage === 'director')[1].input.conversation.find(message => message.role === 'tool').result;
  assert.equal(publicToolResult.advice.kind, 'advice_not_event');
  assert.deepEqual(publicToolResult.advice.publicUtterances, ['PUBLIC_ADVICE']);
  assert.equal(publicToolResult.advice.withheld, undefined);
  assert.equal(publicToolResult.advice.internal, undefined);
  assert.equal(env.result.trace.tools[0].kind, 'advice_not_event');
  assert.deepEqual(env.result.memories, []);
  assert.deepEqual(env.result.state, env.initialState);
  const saved = await env.store.read(env.run.runId);
  assert.deepEqual(saved.memories, env.run.memories);
  assert.equal(saved.turns.length, 1);
  assert.equal(networkCalls, 0);
});
