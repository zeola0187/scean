import test from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../core/memory.mjs';
import { ownerCharacterContext, ownerStateForModel, ownerData, ownerSummaryContext, publicData, publicCharacter, eligibleMemory, playerHistoryForView } from '../core/memory-policy.mjs';
import { applyStatProposal } from '../core/stat-contract.mjs';
import { validateRoster } from '../core/contracts.mjs';

// Fixed synthetic cases A/B and player-only history. No research card, provider,
// production data or model is used. These assert contracts, not semantic secrecy.
const roster = () => [
  { id: 'kalt', name: 'Kalt', description: 'KALT_COMPLETE_BACKGROUND_A1', identity: { gender: 'female', pronouns: 'she/her', source: 'user-explicit' },
    relationships: { ael: { trust: 'earned', private: 'KALT_OWN_VIEW_OF_AEL' },
      ownNote: { contextScope: { kind: 'character', characterId: 'kalt' }, private: 'KALT_OWN_NOTE' },
      unauthorized: { contextScope: { kind: 'character', characterId: 'ael' }, private: 'AEL_BACKGROUND_SECRET_SENTINEL' },
      scopedMemory: { access: { kind: 'private' }, knowers: ['sio'], text: 'SIO_MEMORY_SECRET_SENTINEL' } }, customMetadata: { retained: true } },
  { id: 'ael', name: 'Ael', description: 'AEL_FULL_BACKGROUND_SENTINEL' },
  { id: 'sio', name: 'Sio', description: 'SIO_FULL_BACKGROUND_SENTINEL' },
];
const state = () => ({ world: { facts: { weather: 'clear' } }, characters: {
  kalt: { public: { duty: 'engineer' }, private: { facts: { own: 'KALT_STATE_SECRET' },
    other: { contextScope: { kind: 'character', characterId: 'ael' }, text: 'AEL_STATE_SECRET_SENTINEL' } } },
  ael: { private: { secret: 'AEL_STATE_SECRET_SENTINEL' } }, sio: { private: { secret: 'SIO_STATE_SECRET_SENTINEL' } },
} });
const source = () => ({ runId: 'case-b', turn: 8, commitId: 't8-commit', bodyHash: 'synthetic-body', snapshotHash: 'snapshot-r1', cardId: 'synthetic-a1', revision: 'r1', rosterHash: 'roster-r1' });
const memory = (id, access, knowers = [], epistemic = 'fact', credibility = 'confirmed') => ({ id, version: 1, schemaVersion: 2, text: `harbor ${id}`, access: { kind: access }, knowers,
  characterIds: [...knowers], visibility: access === 'world_public' ? 'public' : 'characters', epistemic: { kind: epistemic }, credibility,
  participants: { speakers: ['kalt'], actors: ['kalt'], decisionMakers: ['kalt'] }, source: source() });
const historyEntry = () => ({ text: 'The player privately recalled the blue room.', epistemic: { kind: 'experience' }, credibility: 'subjective',
  participants: { speakers: [], actors: ['player'], decisionMakers: [] }, quotes: [{ speakerId: null, text: 'privately recalled the blue room' }] });
const historyProposal = () => ({ contractVersion: 2, stateChanges: [], memories: [], playerHistory: [historyEntry()] });
const body = 'The player privately recalled the blue room.';

test('A: owner CR sees full own biography, female identity and relationships without publicDescription', () => {
  const actor = roster()[0], before = structuredClone(actor);
  assert.equal(publicCharacter(actor).description, undefined); // A baseline intentionally loses this data.
  const own = ownerCharacterContext(actor, { characterId: 'kalt' });
  assert.equal(own.description, 'KALT_COMPLETE_BACKGROUND_A1');
  assert.deepEqual(own.identity, actor.identity);
  assert.equal(own.relationships.ael.private, 'KALT_OWN_VIEW_OF_AEL');
  assert.equal(own.relationships.ownNote.private, 'KALT_OWN_NOTE');
  assert.deepEqual(own.customMetadata, { retained: true });
  assert(!JSON.stringify(own).includes('SENTINEL'));
  assert.deepEqual(actor, before);
  assert.throws(() => ownerCharacterContext(actor, { characterId: 'ael' }), /CHARACTER_CONTEXT_OWNER_MISMATCH/);
});

test('A: ownState includes own private state and never another character container or explicit foreign scope', () => {
  const original = state(), before = structuredClone(original), own = ownerStateForModel(original, 'kalt');
  assert.equal(own.private.facts.own, 'KALT_STATE_SECRET'); assert.equal(own.public.duty, 'engineer');
  assert(!JSON.stringify(own).includes('SENTINEL')); assert(!Object.hasOwn(own, 'ael'));
  own.private.facts.own = 'mutated return'; assert.deepEqual(original, before);
  assert.throws(() => ownerStateForModel(original, 'player'), /RESERVED_ACTOR_ID/);
});

test('B: owner eligible corpus preserves world/known/private provenance; uninformed Sio is excluded before ranking', async () => {
  const rows = [memory('world', 'world_public'), memory('Kalt-Ael-known', 'known_event', ['kalt', 'ael']), memory('KALT_PRIVATE_SECRET', 'private', ['kalt']), memory('SIO_PRIVATE_SENTINEL', 'private', ['sio'])];
  rows.push({ ...memory('OTHER_RUN_SENTINEL', 'private', ['kalt']), source: { ...source(), runId: 'different-run' } });
  const sent = [], ranked = [];
  const recall = new Memory({ embed: async ({ texts }) => { sent.push(...texts); return texts.map(() => [1, 0]); }, rerank: async ({ candidates }) => { ranked.push(...candidates); return candidates.map((_, index) => ({ index, score: 1 })); } });
  const found = await recall.retrieve({ query: 'harbor', records: rows, runId: 'case-b', characterId: 'kalt', audience: 'owner' });
  assert.deepEqual(new Set(found.records.map(row => row.id)), new Set(['world', 'Kalt-Ael-known', 'KALT_PRIVATE_SECRET']));
  assert(!JSON.stringify({ sent, ranked, found }).includes('SENTINEL'));
  for (const row of found.records) { assert.deepEqual(row.source, source()); assert.equal(row.version, 1); }
  const sio = await recall.retrieve({ query: 'harbor', records: rows, runId: 'case-b', characterId: 'sio', audience: 'owner' });
  assert.deepEqual(new Set(sio.records.map(row => row.id)), new Set(['world', 'SIO_PRIVATE_SENTINEL']));
  const world = await recall.retrieve({ query: 'harbor', records: rows, runId: 'case-b', audience: 'public' });
  assert.deepEqual(world.records.map(row => row.id), ['world']);
});

test('B: beliefs and rumors reach their owning CR unchanged, never become shared facts', async () => {
  const belief = memory('mistaken-hatch-belief', 'known_event', ['kalt'], 'belief', 'disputed');
  const rumor = memory('unverified-harbor-rumor', 'private', ['kalt'], 'rumor', 'unverified');
  const recall = new Memory();
  const own = await recall.retrieve({ query: 'harbor', records: [belief, rumor], runId: 'case-b', characterId: 'kalt', audience: 'owner' });
  assert.equal(own.records.length, 2);
  assert.equal(own.records.find(row => row.id === belief.id).credibility, 'disputed');
  assert.equal(own.records.find(row => row.id === rumor.id).epistemic.kind, 'rumor');
  assert.equal((await recall.retrieve({ query: 'harbor', records: [belief, rumor], runId: 'case-b' })).records.length, 0);
  assert(!eligibleMemory({ ...belief, access: { kind: 'world_public' }, visibility: 'public' }, { runId: 'case-b' }));
});

test('B: owned memory metadata also removes explicitly foreign private blocks; world metadata is never owner-private', async () => {
  const owned = { ...memory('owned', 'private', ['kalt']), metadata: { private: 'own metadata', foreign: { contextScope: { kind: 'character', characterId: 'ael' }, secret: 'FOREIGN_SENTINEL' } } };
  const world = { ...memory('world', 'world_public'), metadata: { private: 'WORLD_PRIVATE_SENTINEL' } };
  const found = await new Memory().retrieve({ query: 'harbor', records: [owned, world], runId: 'case-b', characterId: 'kalt', audience: 'owner' });
  assert.equal(found.records.find(row => row.id === 'owned').metadata.private, 'own metadata');
  assert(!JSON.stringify(found).includes('SENTINEL'));
});

test('legacy public owner recall stays limited; explicit foreign contextScope fails closed', () => {
  const legacy = { ...memory('legacy', 'known_event', ['kalt']) }; delete legacy.schemaVersion; delete legacy.access; delete legacy.knowers; legacy.visibility = 'public';
  assert(eligibleMemory(legacy, { runId: 'case-b', characterId: 'kalt', audience: 'owner' }));
  assert(!eligibleMemory(legacy, { runId: 'case-b', characterId: 'sio', audience: 'owner' }));
  assert(!eligibleMemory(legacy, { runId: 'case-b', audience: 'public' }));
  for (const contextScope of [{ kind: 'character', characterId: 'ael' }, { kind: 'unknown' }, null]) assert.equal(ownerData({ contextScope, secret: 'SENTINEL' }, 'kalt'), undefined);
  assert.equal(publicData({ contextScope: { kind: 'character', characterId: 'kalt' }, text: 'secret' }), undefined);
});

test('player-only history normalizes independently; no NPC knowledge or world-public promotion', () => {
  const original = state(), before = structuredClone(original), result = applyStatProposal(historyProposal(), original, roster(), body, { publicView: true });
  assert.equal(result.memories.length, 0); assert.deepEqual(result.state, before);
  assert.deepEqual(result.playerHistory, [{ ...historyEntry(), schemaVersion: 1, role: 'player_history', scope: { kind: 'player_only' } }]);
  assert.deepEqual(original, before);
  for (const key of ['knowers', 'characterIds', 'access', 'visibility', 'source', 'version']) {
    const p = historyProposal(); p.playerHistory[0][key] = key === 'knowers' || key === 'characterIds' ? ['player'] : 'forged';
    assert.throws(() => applyStatProposal(p, original, roster(), body), /INVALID_STAT_FIELDS/);
  }
  const bad = historyProposal(); bad.playerHistory[0].scope = { kind: 'world_public' };
  assert.throws(() => applyStatProposal(bad, original, roster(), body), /INVALID_PLAYER_HISTORY_SCOPE/);
});

test('player-only history has explicit run-bound view and is excluded from owner/public nested contexts', async () => {
  const normalized = applyStatProposal(historyProposal(), state(), roster(), body).playerHistory[0];
  const persisted = { ...normalized, id: 'history-1', version: 1, source: source() };
  const foreign = { ...persisted, source: { ...source(), runId: 'elsewhere' } };
  assert.throws(() => playerHistoryForView([persisted], { runId: 'case-b', audience: 'public' }), /PLAYER_HISTORY_VIEW_FORBIDDEN/);
  assert.deepEqual(playerHistoryForView([persisted, foreign], { runId: 'case-b', audience: 'player-history' }).records, [persisted]);
  assert.equal(publicData(persisted), undefined); assert.equal(ownerData(persisted, 'kalt'), undefined);
  assert.deepEqual(ownerData({ private: { playerHistory: [persisted] } }, 'kalt'), { private: { playerHistory: [] } });
  assert.equal((await new Memory().retrieve({ query: 'blue room', records: [persisted], runId: 'case-b', characterId: 'kalt', audience: 'owner' })).records.length, 0);
});

test('player-only invalid quote/actor/metadata never partially applies state; old proposals remain compatible', () => {
  const old = state(), before = structuredClone(old);
  const p = historyProposal(); p.stateChanges.push({ scope: 'world', category: 'facts', key: 'weather', operation: 'set', value: 'rain' });
  p.playerHistory[0].quotes[0].text = 'not in final body';
  assert.throws(() => applyStatProposal(p, old, roster(), body), /QUOTE_NOT_IN_FINAL_BODY/); assert.deepEqual(old, before);
  p.playerHistory[0] = historyEntry(); p.playerHistory[0].participants.actors = ['unknown'];
  assert.throws(() => applyStatProposal(p, old, roster(), body), /INVALID_STAT_ACTORS/); assert.deepEqual(old, before);
  assert.deepEqual(applyStatProposal({ contractVersion: 2, stateChanges: [], memories: [] }, old, roster(), body).playerHistory, []);
  assert.equal(applyStatProposal({ ...historyProposal(), playerHistory: [historyEntry(), historyEntry()] }, old, roster(), body).playerHistory.length, 1);
});

test('future character summary contract validates role/source/version without generating or changing canonical data', () => {
  const summary = { schemaVersion: 1, role: 'character_summary', characterId: 'kalt', contextScope: { kind: 'character', characterId: 'kalt' }, version: 2, text: 'Kalt remembers her uncertain hypothesis.', source: source() };
  assert.deepEqual(ownerSummaryContext(summary, { runId: 'case-b', characterId: 'kalt' }), summary);
  for (const altered of [{ role: 'chapter_summary' }, { version: 0 }, { source: { ...source(), runId: 'other' } }, { characterId: 'ael' }]) {
    assert.throws(() => ownerSummaryContext({ ...summary, ...altered }, { runId: 'case-b', characterId: 'kalt' }), /INVALID_CHARACTER_SUMMARY/);
  }
  assert.equal(publicData(summary), undefined);
});

test('roster preserves authored relationship prose/structured metadata; invalid relationship types rejected', () => {
  const actors = roster(); assert.deepEqual(validateRoster(actors), actors);
  actors[0].relationships = 'She trusts Ael but doubts the unverified rumor.'; assert.equal(validateRoster(actors)[0].relationships, actors[0].relationships);
  for (const value of [null, 12, true]) { actors[0].relationships = value; assert.throws(() => validateRoster(actors), /INVALID_ACTOR_RELATIONSHIPS/); }
});
