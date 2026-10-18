import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatProposal, STAT_LIMITS } from '../core/stat-contract.mjs';
import { publicState } from '../core/contracts.mjs';

const characters = [{ id: 'ael' }, { id: 'kalt' }, { id: 'sio' }];
const body = 'The engineer said: I will defer this task. The crew returned.';
const previous = () => ({ world: { legacy: { preserved: true }, resources: { fuel: 17 }, tasks: { inspection: { status: 'active' } } }, characters: { kalt: { legacyMood: 'calm', private: { facts: { secret: 'kept' } } } }, extra: { preserved: true } });
const proposal = (stateChanges = [], memories = []) => ({ contractVersion: 2, stateChanges, memories });
const change = (extra = {}) => ({ scope: 'world', category: 'facts', key: 'fact', operation: 'set', value: true, ...extra });
const memory = (extra = {}) => ({ text: 'The engineer deferred the task.', characterIds: ['kalt'], visibility: 'characters', participants: { speakers: ['kalt'], actors: ['kalt'], decisionMakers: ['kalt'] }, ...extra });
// Historical r3-shaped proposals gain conservative permission metadata on NEW writes.
// Existing source/roles/quotes must remain exact; this does not migrate stored Runs.
const compatible = m => ({ ...m, schemaVersion: 2, access: { kind: 'known_event' }, knowers: [...m.characterIds], visibility: 'characters', epistemic: { kind: 'unverified' }, credibility: 'unverified' });
const apply = (p, state = previous()) => applyStatProposal(p, state, characters, body);
const rejects = (p, code) => assert.throws(() => apply(p), e => e.code === code);

test('delta retains legacy, unrelated categories, private and top-level state; set replaces one value', () => {
  const result = apply(proposal([change({ category: 'tasks', key: 'inspection', value: { status: 'completed' } }), change({ category: 'resources', key: 'fuel', value: 54.375 })]));
  assert.equal(result.state.world.resources.fuel, 54.375);
  assert.deepEqual(result.state.world.tasks.inspection, { status: 'completed' });
  assert.deepEqual(result.state.world.legacy, { preserved: true });
  assert.deepEqual(result.state.extra, { preserved: true });
  assert.equal(result.state.characters.kalt.private.facts.secret, 'kept');
  assert.equal(result.state.characters.kalt.legacyMood, 'calm');
});
test('remove requires absent value and preserves other entries', () => {
  const deletion = { scope: 'world', category: 'resources', key: 'fuel', operation: 'remove' };
  const absent = { scope: 'character', characterId: 'sio', visibility: 'private', category: 'effects', key: 'gone', operation: 'remove' };
  const result = apply(proposal([deletion, absent]));
  assert.equal(Object.hasOwn(result.state.world.resources, 'fuel'), false);
  assert.equal(Object.hasOwn(result.state.characters, 'sio'), false);
  assert.equal(result.state.world.tasks.inspection.status, 'active');
});
test('location/task/time/effect/equipment contracts allow concrete numbers and JSON values', () => {
  const changes = [change({ category: 'locations', key: 'crew', value: 'bridge' }), change({ category: 'tasks', key: 'inspection', value: { status: 'done', completedBy: ['kalt'] } }), change({ category: 'time', key: 'elapsed', value: 127 }), change({ category: 'effects', key: 'warm', value: { until: 300, active: true } }), change({ category: 'equipment', key: 'pipe', value: { temperature: 54.375 } })];
  const result = apply(proposal(changes));
  assert.equal(result.state.world.time.elapsed, 127);
  assert.equal(result.state.world.equipment.pipe.temperature, 54.375);
  assert.deepEqual(result.stateChanges, changes);
});
test('explicit public and private actor facts remain separated from Director public projection', () => {
  const result = apply(proposal(['public', 'private'].map(visibility => change({ scope: 'character', characterId: 'ael', visibility, category: 'locations', key: 'current', value: visibility }))));
  assert.equal(result.state.characters.ael.private.locations.current, 'private');
  assert.equal(publicState(result.state).characters.ael.public.locations.current, 'public');
  assert.equal(Object.hasOwn(publicState(result.state).characters.ael, 'private'), false);
});
test('empty delta is valid and pure; invalid later memory cannot mutate input state', () => {
  const old = previous(), input = proposal([], [memory()]), oldCopy = structuredClone(old), inputCopy = structuredClone(input);
  const out = apply(input, old);
  assert.deepEqual(out.state, old); assert.notEqual(out.state, old);
  out.state.world.resources.fuel = 0; out.memories[0].participants.actors.push('sio');
  assert.deepEqual(old, oldCopy); assert.deepEqual(input, inputCopy);
  assert.throws(() => apply(proposal([change()], [memory({ participants: { speakers: ['unknown'], actors: [], decisionMakers: [] } })]), old));
  assert.deepEqual(old, oldCopy);
});
test('memory metadata and original text survive; only fully identical records deduplicate', () => {
  const original = memory({ quotes: [{ speakerId: 'kalt', text: 'I will defer this task.' }], metadata: { sourceType: 'dialogue', certainty: 'stated' } });
  const differentScope = memory({ ...original, characterIds: ['sio'] });
  const differentRoles = memory({ ...original, participants: { speakers: [], actors: ['kalt'], decisionMakers: [] } });
  const result = apply(proposal([], [original, structuredClone(original), differentScope, differentRoles]));
  assert.equal(result.memories.length, 3);
  assert.deepEqual(result.memories[0], compatible(original));
});
test('roles distinguish player from knowers; empty roles and unknown speaker null are valid', () => {
  const m = memory({ participants: { speakers: ['player'], actors: ['kalt'], decisionMakers: ['player'] }, quotes: [{ speakerId: null, text: 'The crew returned.' }] });
  assert.deepEqual(apply(proposal([], [m])).memories[0], compatible(m));
  assert.equal(apply(proposal([], [memory({ participants: { speakers: [], actors: [], decisionMakers: [] } })])).memories.length, 1);
  rejects(proposal([], [memory({ characterIds: ['player'] })]), 'INVALID_STAT_ACTORS');
});
test('quote check is exact substring only and does not rewrite/semantically judge attribution', () => {
  rejects(proposal([], [memory({ quotes: [{ speakerId: 'kalt', text: 'I will finish this task.' }] })]), 'QUOTE_NOT_IN_FINAL_BODY');
  const m = memory({ quotes: [{ speakerId: 'ael', text: 'I will defer this task.' }] });
  assert.deepEqual(apply(proposal([], [m])).memories[0], compatible(m));
  rejects(proposal([], [memory({ quotes: [{ speakerId: 'unknown', text: 'The crew returned.' }] })]), 'INVALID_QUOTE_SPEAKER');
});
test('v2 required, full replacement prohibited, unknown fields prohibited', () => {
  rejects({ state: previous(), memories: [] }, 'INVALID_STAT_FIELDS');
  rejects({ ...proposal(), contractVersion: 1 }, 'STAT_CONTRACT_VERSION');
  rejects({ ...proposal(), state: previous() }, 'INVALID_STAT_FIELDS');
  rejects(proposal([change({ unexpected: true })]), 'INVALID_STAT_FIELDS');
  rejects(proposal([], [{ text: 'x', characterIds: ['kalt'], visibility: 'characters' }]), 'INVALID_STAT_FIELDS');
});
test('target scope, visibility, operation, category, actor and duplicate validations', () => {
  for (const extra of [{ characterId: 'kalt' }, { visibility: 'public' }, { scope: 'character', characterId: 'unknown', visibility: 'private' }, { scope: 'character', characterId: 'kalt' }]) rejects(proposal([change(extra)]), 'INVALID_STATE_SCOPE');
  rejects(proposal([change({ category: 'arbitrary' })]), 'INVALID_STATE_TARGET');
  rejects(proposal([change({ operation: 'remove' })]), 'INVALID_STATE_OPERATION');
  const noValue = change(); delete noValue.value;
  rejects(proposal([noValue]), 'INVALID_STATE_OPERATION');
  rejects(proposal([change(), change({ value: false })]), 'DUPLICATE_STATE_TARGET');
});
test('unsafe keys, prototype injection and non-JSON values rejected', () => {
  for (const key of ['', ' ', 'x'.repeat(129), '__proto__', 'prototype', 'constructor']) rejects(proposal([change({ key })]), 'INVALID_STATE_TARGET');
  for (const value of [undefined, NaN, Infinity, new Date(), () => 1, JSON.parse('{"__proto__":{"polluted":true}}')]) rejects(proposal([change({ value })]), 'INVALID_STAT_JSON');
  const cyclic = {}; cyclic.self = cyclic;
  rejects(proposal([change({ value: cyclic })]), 'INVALID_STAT_JSON');
  assert.equal({}.polluted, undefined);
});
test('bounded changes, memories, value, depth, key, quote and final state limits', () => {
  rejects(proposal(Array.from({ length: STAT_LIMITS.changes + 1 }, (_, i) => change({ key: String(i) }))), 'INVALID_STATE_CHANGES');
  rejects(proposal([], Array.from({ length: STAT_LIMITS.memories + 1 }, () => memory())), 'INVALID_MEMORIES');
  rejects(proposal([change({ value: 'x'.repeat(STAT_LIMITS.valueLength) })]), 'STATE_VALUE_TOO_LARGE');
  let deep = {}; for (let i = 0; i < 30; i++) deep = { deep };
  rejects(proposal([change({ value: deep })]), 'STAT_JSON_LIMIT');
  rejects(proposal([], [memory({ quotes: Array.from({ length: 21 }, () => ({ speakerId: null, text: 'The crew returned.' })) })]), 'INVALID_MEMORY_QUOTES');
  const large = previous(); large.world.old = 'x'.repeat(249800);
  assert.throws(() => apply(proposal([change({ value: 'x'.repeat(1000) })]), large), e => e.code === 'STATE_TOO_LARGE');
});
test('existing non-object path fails without erasing legacy fact', () => {
  const old = previous(); old.world.facts = 'legacy-string';
  assert.throws(() => apply(proposal([change()]), old), e => e.code === 'STATE_PATH_CONFLICT');
  assert.equal(old.world.facts, 'legacy-string');
});
test('unknown/duplicate actors and private memory without knowers are rejected', () => {
  for (const field of ['speakers', 'actors', 'decisionMakers']) {
    const m = memory(); m.participants[field] = ['unknown'];
    rejects(proposal([], [m]), 'INVALID_STAT_ACTORS');
  }
  rejects(proposal([], [memory({ characterIds: ['kalt', 'kalt'] })]), 'INVALID_STAT_ACTORS');
  rejects(proposal([], [memory({ characterIds: [] })]), 'INVALID_MEMORY_SCOPE');
  const old = previous(); old.characters.unknown = {};
  assert.throws(() => apply(proposal(), old), e => e.code === 'UNKNOWN_STATE_ACTOR');
  for (const roster of [[], [{ id: 'player' }], [{ id: 'ael' }, { id: 'ael' }]]) {
    assert.throws(() => applyStatProposal(proposal(), previous(), roster, body), e => e.code === 'INVALID_STAT_ROSTER');
  }
});
test('non-JSON accessors, symbols and sparse arrays never enter the commit', () => {
  let getterCalled = false;
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { getterCalled = true; return 1; } });
  rejects(proposal([change({ value: getter })]), 'INVALID_STAT_JSON');
  assert.equal(getterCalled, false);
  rejects(proposal([change({ value: { [Symbol('x')]: 1 } })]), 'INVALID_STAT_JSON');
  rejects(proposal([change({ value: new Array(2) })]), 'INVALID_STAT_JSON');
});
test('a failed duplicate operation leaves original state and proposal untouched', () => {
  const old = previous(), p = proposal([change({ category: 'resources', key: 'fuel', value: 55 }), change({ category: 'resources', key: 'fuel', value: 60 })]);
  const beforeState = structuredClone(old), beforeProposal = structuredClone(p);
  assert.throws(() => apply(p, old), e => e.code === 'DUPLICATE_STATE_TARGET');
  assert.deepEqual(old, beforeState); assert.deepEqual(p, beforeProposal);
});
