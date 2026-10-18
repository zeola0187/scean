import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlueprint, materializeInitialState, validateBlueprintStateChanges, validateBlueprintState, publicBlueprintState } from '../core/state-blueprint.mjs';
import { publicStateForModel } from '../core/memory-policy.mjs';
import { applyStatProposal } from '../core/stat-contract.mjs';

const characters = [{ id: 'pilot', name: '合成領航員', description: '公開背景' }];
const variable = (patch = {}) => ({ key: 'fuel', displayName: '燃料', scope: 'world', category: 'resources', type: 'number', visibility: 'public', unit: 'L', min: 0, max: 100, ...patch });
const bp = (variables = [variable()], patch = {}) => ({ schemaVersion: 1, id: 'synthetic-ship', version: 1, extensionPolicy: 'allow', variables, ...patch });
const entry = (value, patch = {}) => ({ scope: 'world', category: 'resources', key: 'fuel', value, source: { id: 'synthetic-card', version: 'r1' }, ...patch });
const initial = (values = [entry(90)]) => ({ schemaVersion: 1, blueprintId: 'synthetic-ship', blueprintVersion: 1, values });
const change = (value, patch = {}) => ({ scope: 'world', category: 'resources', key: 'fuel', operation: 'set', value, ...patch });
const opts = { source: { id: 'synthetic-turn', version: 1 } };
const error = code => e => e.code === code;

test('B blueprint: separate revisions, stable keys, unknown missing values and explicit initial source', () => {
  const schema = bp([variable(), variable({ key: 'water', displayName: '飲水' })]);
  const descriptor = initial();
  const { state, provenance } = materializeInitialState(schema, descriptor, characters);
  assert.equal(state.world.resources.fuel, 90);
  assert.equal(Object.hasOwn(state.world.resources, 'water'), false);
  assert.deepEqual(provenance[0].source, { id: 'synthetic-card', version: 'r1' });
  assert.equal(publicBlueprintState(schema, state).declared[1].known, false);
  schema.variables[0].displayName = '改名'; descriptor.values[0].value = 10;
  assert.equal(state.world.resources.fuel, 90);
  assert.throws(() => materializeInitialState(bp([], { version: 2 }), initial(), characters), error('INITIAL_STATE_VERSION'));
});

test('B blueprint: all declared types preserve false, zero and empty string explicitly', () => {
  const vars = [variable({ key: 'zero' }),
    { key: 'name', displayName: '名稱', scope: 'world', category: 'facts', type: 'string', visibility: 'public' },
    { key: 'lit', displayName: '燈已點亮', scope: 'world', category: 'facts', type: 'boolean', visibility: 'public' },
    { key: 'phase', displayName: '階段', scope: 'world', category: 'time', type: 'enum', enumValues: ['day', 'night'], visibility: 'public' },
    { key: 'map', displayName: '地圖', scope: 'world', category: 'locations', type: 'json', visibility: 'public', requiredFields: ['zone'] }];
  const values = [entry(0, { key: 'zero' }), entry('', { key: 'name', category: 'facts' }), entry(false, { key: 'lit', category: 'facts' }), entry('night', { key: 'phase', category: 'time' }), entry({ zone: '塔' }, { key: 'map', category: 'locations' })];
  const result = materializeInitialState(bp(vars), initial(values), characters);
  assert.equal(result.state.world.resources.zero, 0); assert.equal(result.state.world.facts.name, ''); assert.equal(result.state.world.facts.lit, false);
  for (const [v, bad] of [[vars[0], -1], [vars[1], 1], [vars[2], 'false'], [vars[3], 'dawn'], [vars[4], {}]]) {
    assert.throws(() => materializeInitialState(bp([v]), initial([entry(bad, { key: v.key, category: v.category })]), characters));
  }
});

test('B blueprint: malformed schema, units, actor, enum and duplicate identities fail', () => {
  for (const v of [variable({ unit: '' }), variable({ min: 101 }), variable({ type: 'string' }), variable({ scope: 'character', characterId: 'missing' }), variable({ key: '__proto__' }), variable({ formula: 'process.exit()' })]) assert.throws(() => validateBlueprint(bp([v]), characters));
  assert.throws(() => validateBlueprint(bp([variable(), variable()]), characters), error('BLUEPRINT_DUPLICATE'));
  assert.throws(() => validateBlueprint(bp([{ key: 'mode', displayName: '模式', scope: 'world', category: 'facts', type: 'enum', visibility: 'public', enumValues: ['x', 'x'] }]), characters), error('BLUEPRINT_ENUM'));
  assert.throws(() => materializeInitialState(bp(), initial([entry(1, { source: { id: 'x' } })]), characters), error('BLUEPRINT_FIELDS'));
});

test('B blueprint: restricted world and character values never appear in public projection', () => {
  const world = variable({ key: 'secret', visibility: 'restricted' });
  const actor = variable({ key: 'reserve', scope: 'character', characterId: 'pilot', visibility: 'restricted' });
  const schema = bp([variable(), world, actor]);
  const { state } = materializeInitialState(schema, initial([entry(90), entry(77, { key: 'secret' }), entry(12, { key: 'reserve', scope: 'character', characterId: 'pilot' })]), characters);
  assert.deepEqual(state.world.resources.secret, { visibility: 'private', value: 77 });
  assert.equal(state.characters.pilot.private.resources.reserve, 12);
  assert.deepEqual(publicStateForModel(state).world.resources, { fuel: 90 });
  assert.deepEqual(publicBlueprintState(schema, state).declared.map(x => x.key), ['fuel']);
  assert.throws(() => validateBlueprintStateChanges(schema, [change(1, { key: 'secret' })], characters, opts), error('BLUEPRINT_RESTRICTED_WRITE'));
  const compromised = structuredClone(state); compromised.characters.pilot.public = { resources: { reserve: 12 } };
  assert.throws(() => validateBlueprintState(schema, compromised, characters), error('BLUEPRINT_VISIBILITY_MISMATCH'));
});

test('B blueprint: tasks require status/assignees/progress on whole-key replace and permit extensions', () => {
  const task = { key: 'reachTower', displayName: '抵達魔塔', scope: 'world', category: 'tasks', type: 'json', visibility: 'public' };
  const schema = bp([task]);
  const taskChange = value => change(value, { category: 'tasks', key: 'reachTower' });
  const valid = { status: 'active', assignees: ['pilot', 'player'], progress: 20, destination: '魔塔' };
  const { state } = materializeInitialState(schema, initial([entry(valid, { category: 'tasks', key: 'reachTower' })]), characters);
  for (const v of [{ status: 'done' }, { ...valid, assignees: ['alien'] }, { ...valid, progress: 101 }, { ...valid, progress: '20' }]) assert.throws(() => validateBlueprintStateChanges(schema, [taskChange(v)], characters, opts), error('BLUEPRINT_TASK_FIELDS'));
  const next = { status: 'completed', assignees: ['pilot'], progress: 100 };
  validateBlueprintStateChanges(schema, [taskChange(next)], characters, opts);
  const applied = applyStatProposal({ contractVersion: 2, stateChanges: [taskChange(next)], memories: [] }, state, characters, '抵達魔塔。');
  assert.deepEqual(applied.state.world.tasks.reachTower, next);
  assert.equal(Object.hasOwn(applied.state.world.tasks.reachTower, 'destination'), false);
});

test('B blueprint: legal dynamic items have provenance, extension-deny rejects, public display groups others', () => {
  const dynamic = change('港口', { category: 'locations', key: 'destination' });
  assert.equal(validateBlueprintStateChanges(bp(), [dynamic], characters, opts)[0].kind, 'dynamic');
  assert.throws(() => validateBlueprintStateChanges(bp(), [dynamic], characters), error('BLUEPRINT_FIELDS'));
  assert.throws(() => validateBlueprintStateChanges(bp(undefined, { extensionPolicy: 'deny' }), [dynamic], characters, opts), error('BLUEPRINT_EXTENSION_FORBIDDEN'));
  const state = { world: { locations: { destination: '港口' } }, characters: {} };
  assert.deepEqual(publicBlueprintState(bp(), state).otherState, [{ scope: 'world', category: 'locations', key: 'destination', value: '港口' }]);
});

test('B blueprint: readonly values reject writes, derived text is never executed', () => {
  const schema = bp([variable({ readOnly: true, derivedDescription: 'globalThis.blueprintExecuted = true' })]);
  const { state } = materializeInitialState(schema, initial(), characters);
  assert.equal(state.world.resources.fuel, 90); assert.equal(globalThis.blueprintExecuted, undefined);
  assert.throws(() => validateBlueprintStateChanges(schema, [change(50)], characters, opts), error('BLUEPRINT_READONLY_WRITE'));
  assert.throws(() => validateBlueprintStateChanges(schema, [{ scope: 'world', category: 'resources', key: 'fuel', operation: 'remove' }], characters, opts), error('BLUEPRINT_READONLY_WRITE'));
});

test('B blueprint: safe JSON rejects cycles/prototypes/getters/deep or oversized input', () => {
  const v = { key: 'data', displayName: '資料', scope: 'world', category: 'facts', type: 'json', visibility: 'public' }, schema = bp([v]);
  const cyclic = {}; cyclic.self = cyclic; let deep = {}; for (let i = 0; i < 20; i++) deep = { child: deep };
  const getter = {}; Object.defineProperty(getter, 'payload', { enumerable: true, get() { throw new Error('getter executed'); } });
  for (const value of [cyclic, deep, getter, JSON.parse('{"__proto__":1}'), { text: 'a'.repeat(30001) }, new Date()]) assert.throws(() => materializeInitialState(schema, initial([entry(value, { category: 'facts', key: 'data' })]), characters), e => e.code?.startsWith('BLUEPRINT_'));
});

test('B blueprint: legacy runs retain state and old stat behavior with no migration', () => {
  const legacy = { world: { arbitrary: { old: true }, tasks: { old: 'legacy task' } }, characters: {} };
  assert.deepEqual(materializeInitialState(undefined, undefined, characters, legacy), { state: legacy, provenance: [] });
  assert.deepEqual(validateBlueprintStateChanges(undefined, [change('anything')], characters), []);
  assert.deepEqual(validateBlueprintState(null, legacy, characters), legacy);
  assert.throws(() => materializeInitialState(undefined, initial(), characters), error('INITIAL_STATE_WITHOUT_BLUEPRINT'));
});
