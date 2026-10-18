import test from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../core/memory.mjs';
import { eligibleMemory, publicCharacter, publicConsultationState, publicStateForModel, publicData } from '../core/memory-policy.mjs';
import { applyStatProposal } from '../core/stat-contract.mjs';

// Synthetic material only: no card, actual player history, provider or paid call.
const actors = [{ id: 'kalt' }, { id: 'ael' }, { id: 'sio' }];
const source = { runId: 'ship', turn: 8, commitId: 'commit-t8', bodyHash: 'synthetic-body', snapshotHash: 'synthetic-snapshot', cardId: 'synthetic', revision: 'r1', rosterHash: 'synthetic-roster' };
const m = (id, kind, knowers = [], epistemic = 'fact', credibility = 'confirmed') => ({ schemaVersion: 2, id, version: 1,
  text: `harbor ${id}`, access: { kind }, knowers, characterIds: [...knowers], visibility: kind === 'world_public' ? 'public' : 'characters',
  epistemic: { kind: epistemic }, credibility, participants: { speakers: [], actors: [], decisionMakers: [] }, source });
const proposal = memories => ({ contractVersion: 2, stateChanges: [], memories: memories.map(({ id, version, source: ignored, ...rest }) => rest) });
const state = () => ({ world: { resources: { fuel: 72 } }, characters: { kalt: { public: { role: 'engineer' }, private: { facts: { secret: 'KALT_PRIVATE_SENTINEL' } } }, ael: { private: { facts: { secret: 'AEL_PRIVATE_SENTINEL' } } } } });

test('v2 world knowledge, knowers and epistemic truth are independent; access fails closed', () => {
  const world = m('world', 'world_public');
  const event = m('event', 'known_event', ['kalt', 'ael']);
  const secret = m('SECRET_SENTINEL', 'private', ['kalt'], 'experience', 'subjective');
  const belief = m('false-belief', 'known_event', ['ael'], 'belief', 'disputed');
  for (const audience of ['public', 'public-consultation']) {
    assert(eligibleMemory(world, { runId: 'ship', audience, characterId: 'kalt' }));
    for (const record of [event, secret, belief]) assert(!eligibleMemory(record, { runId: 'ship', audience, characterId: 'kalt' }));
  }
  assert(eligibleMemory(event, { runId: 'ship', audience: 'owner', characterId: 'ael' }));
  assert(eligibleMemory(secret, { runId: 'ship', audience: 'owner', characterId: 'kalt' }));
  assert(!eligibleMemory(secret, { runId: 'ship', audience: 'owner', characterId: 'ael' }));
  assert(!eligibleMemory(world, { runId: 'other', audience: 'public' }));
  assert(!eligibleMemory({ ...world, schemaVersion: 55 }, { audience: 'owner', characterId: 'kalt' }));
  assert(!eligibleMemory({ ...world, epistemic: { kind: 'belief' } }, {}));
  assert.throws(() => eligibleMemory(world, { audience: 'all' }), /INVALID_MEMORY_AUDIENCE/);
});

test('legacy public is owner-only with explicit knowers; empty owners are quarantined without migration', async () => {
  const legacy = { id: 'legacy', text: 'harbor legacy', version: 1, visibility: 'public', characterIds: ['kalt'], source };
  const before = structuredClone(legacy);
  assert(!eligibleMemory(legacy, { runId: 'ship' }));
  assert(eligibleMemory(legacy, { runId: 'ship', characterId: 'kalt', audience: 'owner' }));
  assert(!eligibleMemory({ ...legacy, characterIds: [] }, { audience: 'owner', characterId: 'kalt' }));
  const memory = new Memory();
  assert.equal((await memory.retrieve({ query: 'harbor', records: [legacy], runId: 'ship' })).records.length, 0);
  assert.equal((await memory.retrieve({ query: 'harbor', records: [legacy], runId: 'ship', characterId: 'kalt', audience: 'owner' })).records.length, 1);
  assert.deepEqual(legacy, before);
});

test('permissions precede BM25, embedding, rerank and cache rebuild; public metadata strips private labels', async () => {
  const sent = [], ranked = [];
  const memory = new Memory({ embed: async ({ texts }) => { sent.push(...texts); return texts.map(() => [1, 0]); }, rerank: async ({ candidates }) => { ranked.push(...candidates); return candidates.map((_, index) => ({ index, score: 1 })); } });
  const publicRows = [m('world1', 'world_public'), { ...m('world2', 'world_public'), metadata: { private: 'METADATA_SECRET_SENTINEL', location: 'harbor' } }];
  const records = [...publicRows, m('PRIVATE_SENTINEL', 'private', ['kalt']), m('KNOWN_SENTINEL', 'known_event', ['kalt']), m('FOREIGN_SENTINEL', 'world_public')];
  records.at(-1).source = { ...source, runId: 'foreign' };
  const found = await memory.retrieve({ query: 'harbor', records, runId: 'ship', characterId: 'kalt', audience: 'public-consultation' });
  assert.equal(found.diagnostics.eligibleCount, 2);
  assert(!JSON.stringify({ sent, ranked, found }).includes('SENTINEL'));
  const independent = await new Memory().retrieve({ query: 'harbor', records: publicRows, runId: 'ship' });
  assert.deepEqual(found.records.map(row => row.scores.bm25), independent.records.map(row => row.scores.bm25));
  sent.length = 0;
  await memory.rebuild({ records, runId: 'ship', audience: 'public' });
  assert.equal(memory.cacheSize, 2); assert(!JSON.stringify(sent).includes('SENTINEL'));
  const own = await memory.retrieve({ query: 'harbor', records, runId: 'ship', audience: 'owner', characterId: 'kalt' });
  assert.equal(own.diagnostics.eligibleCount, 4);
});

test('false beliefs and rumors retain attribution/uncertainty in owned recall and never become public facts', async () => {
  const belief = m('The hatch is haunted', 'known_event', ['ael'], 'belief', 'disputed');
  const rumor = m('heard a rumor', 'private', ['kalt'], 'rumor', 'unverified');
  const applied = applyStatProposal(proposal([belief, rumor]), state(), actors, 'Ael believed the hatch was haunted. Kalt heard a rumor.');
  assert.deepEqual(applied.memories[0].epistemic, { kind: 'belief' });
  assert.equal(applied.memories[0].credibility, 'disputed');
  assert.deepEqual(applied.state, state());
  const records = applied.memories.map((record, i) => ({ ...record, id: `m-${i}`, version: 1, source }));
  const memory = new Memory();
  assert.equal((await memory.retrieve({ query: 'harbor', records, runId: 'ship' })).records.length, 0);
  const own = await memory.retrieve({ query: 'harbor', records, runId: 'ship', characterId: 'ael', audience: 'owner' });
  assert.equal(own.records.length, 1); assert.equal(own.records[0].credibility, 'disputed');
  assert.throws(() => applyStatProposal(proposal([{ ...belief, access: { kind: 'world_public' }, visibility: 'public' }]), state(), actors, 'Ael believed this.'), /MEMORY_PUBLIC_NOT_FACT/);
});

test('T8 Kalt decision is not player authorization; knowers do not become speakers/decision makers', () => {
  const record = m('Kalt deferred the full cycle until course stable', 'known_event', ['kalt', 'ael']);
  record.participants = { speakers: ['kalt'], actors: ['kalt'], decisionMakers: ['kalt'] };
  record.quotes = [{ speakerId: 'kalt', text: 'I will defer the full cycle.' }];
  const result = applyStatProposal(proposal([record]), state(), actors, 'Kalt said: I will defer the full cycle. The player nodded.');
  assert.deepEqual(result.memories[0].participants, record.participants);
  assert.deepEqual(result.memories[0].knowers, ['kalt', 'ael']);
  assert(!eligibleMemory({ ...result.memories[0], source }, { runId: 'ship', characterId: 'sio', audience: 'owner' }));
  assert.deepEqual(result.state, state());
});

test('public character/state/source projections remove private inputs before public consultation', () => {
  const actor = { id: 'kalt', name: 'Kalt', description: 'BACKGROUND_PRIVATE_SENTINEL', privateDescription: 'ANOTHER_SECRET', publicDescription: 'An engineer.', identity: { gender: 'female', source: 'user-explicit' }, private: 'PRIVATE_SENTINEL' };
  const packet = { character: publicCharacter(actor), ownState: publicConsultationState(state(), 'kalt'), state: publicStateForModel(state()), sources: publicData({ card: { title: 'ship', private: 'CARD_SECRET_SENTINEL' }, entries: [{ access: { kind: 'private' }, text: 'PRIVATE_BOOK_SENTINEL' }, { text: 'public harbor' }] }) };
  assert(!JSON.stringify(packet).includes('SENTINEL'));
  assert.equal(packet.character.description, 'An engineer.');
  assert.equal(packet.state.world.resources.fuel, 72);
  assert.equal(packet.sources.entries.length, 1);
  assert.equal(publicCharacter({ id: 'sio', name: 'Sio', description: 'PRIVATE_ONLY' }).description, undefined);
  assert(state().characters.kalt.private.facts.secret.includes('SENTINEL'));
});

test('public postStat merges full state, preserves private values and rejects private overwrite/removal', () => {
  const p = { contractVersion: 2, memories: [], stateChanges: [{ scope: 'world', category: 'resources', key: 'fuel', operation: 'set', value: 71 }] };
  const result = applyStatProposal(p, state(), actors, 'One fuel unit was consumed.', { publicView: true });
  assert.equal(result.state.world.resources.fuel, 71);
  assert.deepEqual(result.state.characters, state().characters);
  for (const operation of ['set', 'remove']) {
    p.stateChanges = [{ scope: 'character', characterId: 'kalt', visibility: 'private', category: 'facts', key: 'secret', operation, ...(operation === 'set' ? { value: 'overwrite' } : {}) }];
    assert.throws(() => applyStatProposal(p, state(), actors, 'Quiet.', { publicView: true }), /PRIVATE_STATE_WRITE_FORBIDDEN/);
  }
});

test('legacy proposals normalize conservatively; inconsistent v2 metadata fails atomically', () => {
  const legacy = { text: 'Kalt remembers the report.', characterIds: ['kalt'], visibility: 'public', participants: { speakers: [], actors: [], decisionMakers: [] } };
  const p = { contractVersion: 2, stateChanges: [], memories: [legacy] };
  const normalized = applyStatProposal(p, state(), actors, 'Kalt remembered the report.').memories[0];
  assert.equal(normalized.access.kind, 'known_event'); assert.equal(normalized.credibility, 'unverified'); assert.equal(normalized.visibility, 'characters');
  assert.equal(legacy.visibility, 'public'); assert.equal(legacy.schemaVersion, undefined);
  assert.throws(() => applyStatProposal({ ...p, memories: [{ ...legacy, characterIds: [] }] }, state(), actors, 'Quiet.'), /LEGACY_MEMORY_SCOPE_REQUIRED/);
  const invalid = m('invalid', 'known_event', ['kalt']); invalid.knowers = ['sio'];
  assert.throws(() => applyStatProposal(proposal([invalid]), state(), actors, 'Quiet.'), /MEMORY_KNOWERS_MISMATCH/);
});

test('public delta cannot erase hidden nested legacy values while replacing a visible state key', () => {
  const old = state(); old.world.equipment = { hatch: { status: 'closed', private: { code: 'HATCH_SECRET_SENTINEL' } } };
  const before = structuredClone(old);
  const p = { contractVersion: 2, memories: [], stateChanges: [{ scope: 'world', category: 'equipment', key: 'hatch', operation: 'set', value: { status: 'open' } }] };
  assert.throws(() => applyStatProposal(p, old, actors, 'The hatch opened.', { publicView: true }), /PRIVATE_STATE_TARGET_FORBIDDEN/);
  assert.deepEqual(old, before);
  assert(!JSON.stringify(publicStateForModel(old)).includes('SENTINEL'));
});

test('live-discovered player knower contract error is rejected atomically; player remains legal in attribution only', () => {
  // Minimal synthetic reproduction of the live JSON shape; no actual card or trace.
  const body = 'The player said: Please inspect the hatch. Kalt accepted.';
  const record = m('Kalt accepted the player inspection request', 'known_event', ['kalt', 'player']);
  record.participants = { speakers: ['player', 'kalt'], actors: ['kalt'], decisionMakers: ['player'] };
  record.quotes = [{ speakerId: 'player', text: 'Please inspect the hatch.' }];
  const old = state(), before = structuredClone(old);
  const bad = proposal([record]);
  bad.stateChanges = [{ scope: 'world', category: 'tasks', key: 'inspection', operation: 'set', value: { status: 'accepted' } }];
  assert.throws(() => applyStatProposal(bad, old, actors, body, { publicView: true }), { code: 'INVALID_STAT_ACTORS' });
  assert.deepEqual(old, before);
  const corrected = structuredClone(bad);
  corrected.memories[0].knowers = ['kalt']; corrected.memories[0].characterIds = ['kalt'];
  const result = applyStatProposal(corrected, old, actors, body, { publicView: true });
  assert.deepEqual(result.memories[0].participants, record.participants);
  assert.deepEqual(result.memories[0].quotes, record.quotes);
  assert.deepEqual(result.memories[0].knowers, ['kalt']);
  assert.equal(result.state.world.tasks.inspection.status, 'accepted');
  assert.deepEqual(old, before);
});
