import { SceanError, clone, json, safeId, validateState } from './contracts.mjs';
import { publicData } from './memory-policy.mjs';

export const BLUEPRINT_LIMITS = Object.freeze({ variables: 300, depth: 12, nodes: 5000, valueLength: 30000 });
const categories = new Set(['locations', 'tasks', 'resources', 'equipment', 'time', 'effects', 'facts']);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const own = (o, k) => Object.hasOwn(o, k);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fail = code => { throw new SceanError(code); };
const string = (v, max = 500) => typeof v === 'string' && !!v.trim() && v.length <= max;
function fields(v, required, optional = []) {
  if (!record(v) || required.some(k => !own(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail('BLUEPRINT_FIELDS');
}
function bounded(value, { depthLimit = BLUEPRINT_LIMITS.depth, nodeLimit = BLUEPRINT_LIMITS.nodes, lengthLimit = BLUEPRINT_LIMITS.valueLength } = {}) {
  let nodes = 0; const active = new Set();
  function visit(v, depth) {
    if (++nodes > nodeLimit || depth > depthLimit) fail('BLUEPRINT_JSON_LIMIT');
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return;
    if ((!Array.isArray(v) && !record(v)) || active.has(v) || Object.getOwnPropertySymbols(v).length) fail('BLUEPRINT_UNSAFE_JSON');
    active.add(v);
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (forbidden.has(key) || !own(d, 'value') || !d.enumerable || (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key))) fail('BLUEPRINT_UNSAFE_JSON');
      visit(d.value, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail('BLUEPRINT_UNSAFE_JSON');
    active.delete(v);
  }
  visit(value, 0);
  if (json(value).length > lengthLimit) fail('BLUEPRINT_JSON_LIMIT');
}
function target(v, actors) {
  if (!['world', 'character'].includes(v.scope) || !categories.has(v.category)) fail('BLUEPRINT_TARGET');
  safeId(v.key);
  if (v.scope === 'world' ? own(v, 'characterId') : !actors.has(v.characterId)) fail('BLUEPRINT_ACTOR');
}
const targetKey = v => json([v.scope, v.characterId ?? null, v.category, v.key]);
const actorsOf = characters => new Set((characters ?? []).map(c => c.id));
function version(v) { return (typeof v === 'string' && string(v, 100)) || (Number.isSafeInteger(v) && v > 0); }
function source(v) {
  fields(v, ['id', 'version']);
  if (!string(v.id, 500) || !version(v.version)) fail('BLUEPRINT_SOURCE');
  return clone(v);
}

/** Separate creation-time schema; callers freeze its copy in the Run snapshot. */
export function validateBlueprint(blueprint, characters = []) {
  if (blueprint === undefined || blueprint === null) return null;
  bounded(blueprint, { depthLimit: 16, nodeLimit: 30000, lengthLimit: 250000 });
  fields(blueprint, ['schemaVersion', 'id', 'version', 'extensionPolicy', 'variables']);
  if (blueprint.schemaVersion !== 1 || !Number.isSafeInteger(blueprint.version) || blueprint.version < 1 || !['allow', 'deny'].includes(blueprint.extensionPolicy)) fail('BLUEPRINT_VERSION');
  safeId(blueprint.id);
  if (!Array.isArray(blueprint.variables) || blueprint.variables.length > BLUEPRINT_LIMITS.variables) fail('BLUEPRINT_VARIABLE_LIMIT');
  const actors = actorsOf(characters), seen = new Set();
  for (const v of blueprint.variables) {
    fields(v, ['key', 'displayName', 'scope', 'category', 'type', 'visibility'], ['characterId', 'unit', 'min', 'max', 'enumValues', 'readOnly', 'derivedDescription', 'requiredFields','temporalKind','authority']);
    target(v, actors);
    if(v.temporalKind!==undefined&&(!['duration','deadline','timer'].includes(v.temporalKind)||v.category!=='time'))fail('BLUEPRINT_TEMPORAL_KIND');
    if(v.authority!==undefined&&(v.authority!=='story_clock_projection'||v.scope!=='world'||v.category!=='time'||v.key!=='current'||v.type!=='json'||v.visibility!=='public'||v.readOnly!==true||v.temporalKind!==undefined))fail('BLUEPRINT_CLOCK_AUTHORITY');
    if (!string(v.displayName) || !['number', 'string', 'boolean', 'enum', 'json'].includes(v.type) || !['public', 'restricted'].includes(v.visibility)) fail('BLUEPRINT_VARIABLE');
    if (own(v, 'unit') && (!string(v.unit, 100) || v.type !== 'number')) fail('BLUEPRINT_UNIT');
    for (const k of ['min', 'max']) if (own(v, k) && (v.type !== 'number' || !Number.isFinite(v[k]))) fail('BLUEPRINT_RANGE');
    if (own(v, 'min') && own(v, 'max') && v.min > v.max) fail('BLUEPRINT_RANGE');
    if (v.type === 'enum') {
      if (!Array.isArray(v.enumValues) || !v.enumValues.length || v.enumValues.length > 100 || v.enumValues.some(x => !string(x)) || new Set(v.enumValues).size !== v.enumValues.length) fail('BLUEPRINT_ENUM');
    } else if (own(v, 'enumValues')) fail('BLUEPRINT_ENUM');
    if (own(v, 'readOnly') && typeof v.readOnly !== 'boolean') fail('BLUEPRINT_READONLY');
    if (own(v, 'derivedDescription') && !string(v.derivedDescription, 2000)) fail('BLUEPRINT_DERIVED');
    if (own(v, 'requiredFields') && (v.type !== 'json' || !Array.isArray(v.requiredFields) || v.requiredFields.length > 30 || new Set(v.requiredFields).size !== v.requiredFields.length || v.requiredFields.some(k => !string(k, 128) || forbidden.has(k)))) fail('BLUEPRINT_REQUIRED_FIELDS');
    if (v.category === 'tasks' && v.type !== 'json') fail('BLUEPRINT_TASK_TYPE');
    const key = targetKey(v); if (seen.has(key)) fail('BLUEPRINT_DUPLICATE'); seen.add(key);
  }
  return clone(blueprint);
}
function validateValue(v, value, actors) {
  bounded(value);
  if (v.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (v.min !== undefined && value < v.min) || (v.max !== undefined && value > v.max))) fail('BLUEPRINT_VALUE_RANGE');
  if (v.type === 'string' && typeof value !== 'string') fail('BLUEPRINT_VALUE_TYPE');
  if (v.type === 'boolean' && typeof value !== 'boolean') fail('BLUEPRINT_VALUE_TYPE');
  if (v.type === 'enum' && !v.enumValues.includes(value)) fail('BLUEPRINT_VALUE_ENUM');
  if (v.requiredFields?.some(k => !record(value) || !own(value, k))) fail('BLUEPRINT_REQUIRED_VALUE');
  if (v.category === 'tasks') validateTask(value, actors);
}
function validateTask(value, actors) {
  if (!record(value) || !string(value.status, 100) || !Array.isArray(value.assignees) || new Set(value.assignees).size !== value.assignees.length || value.assignees.some(id => id !== 'player' && !actors.has(id)) || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100) fail('BLUEPRINT_TASK_FIELDS');
}
function bucket(state, v, create = false) {
  let root = state.world;
  if (v.scope === 'character') {
    if (create) state.characters[v.characterId] ??= {};
    root = state.characters[v.characterId];
    const visibility = v.visibility === 'restricted' ? 'private' : 'public';
    if (root && create) root[visibility] ??= {};
    root = root?.[visibility];
  }
  if (root && create) root[v.category] ??= {};
  if (root?.[v.category] !== undefined && !record(root[v.category])) fail('BLUEPRINT_STATE_PATH');
  return root?.[v.category];
}
function readValue(state, v) {
  const b = bucket(state, v);
  if (!b || !own(b, v.key)) return { known: false };
  let value = b[v.key];
  if (v.scope === 'world' && v.visibility === 'restricted') {
    if (!record(value) || value.visibility !== 'private' || !own(value, 'value') || Object.keys(value).length !== 2) fail('BLUEPRINT_RESTRICTED_WRAPPER');
    value = value.value;
  }
  return { known: true, value: clone(value) };
}

/** InitialState has its own source/version receipts; missing values remain absent. */
export function materializeInitialState(blueprint, initialState, characters = [], baseState = { world: {}, characters: {} }) {
  const bp = validateBlueprint(blueprint, characters), state = validateState(baseState, characters), provenance = [];
  if (!bp) {
    if (initialState !== undefined && initialState !== null) fail('INITIAL_STATE_WITHOUT_BLUEPRINT');
    return { state, provenance };
  }
  if (initialState === undefined || initialState === null) { validateBlueprintState(bp, state, characters); return { state, provenance }; }
  bounded(initialState, { depthLimit: 18, nodeLimit: 30000, lengthLimit: 250000 });
  fields(initialState, ['schemaVersion', 'blueprintId', 'blueprintVersion', 'values']);
  if (initialState.schemaVersion !== 1 || initialState.blueprintId !== bp.id || initialState.blueprintVersion !== bp.version || !Array.isArray(initialState.values) || initialState.values.length > BLUEPRINT_LIMITS.variables) fail('INITIAL_STATE_VERSION');
  const declarations = new Map(bp.variables.map(v => [targetKey(v), v])), seen = new Set(), actors = actorsOf(characters);
  for (const entry of initialState.values) {
    fields(entry, ['scope', 'category', 'key', 'value', 'source'], ['characterId']); target(entry, actors);
    const key = targetKey(entry), v = declarations.get(key);
    if (!v) fail('INITIAL_STATE_UNDECLARED');
    if (seen.has(key)) fail('INITIAL_STATE_DUPLICATE'); seen.add(key);
    validateValue(v, entry.value, actors);
    const receipt = source(entry.source);
    bucket(state, v, true)[v.key] = v.scope === 'world' && v.visibility === 'restricted' ? { visibility: 'private', value: clone(entry.value) } : clone(entry.value);
    provenance.push({ target: key, kind: 'initial', blueprintId: bp.id, blueprintVersion: bp.version, source: receipt });
  }
  validateBlueprintState(bp, state, characters);
  return { state, provenance };
}

/** Existing no-blueprint runs retain their original state contract. */
export function validateBlueprintState(blueprint, state, characters = []) {
  const bp = validateBlueprint(blueprint, characters), copy = validateState(state, characters);
  if (!bp) return copy;
  for (const v of bp.variables) {
    const found = readValue(copy, v);
    if (found.known) validateValue(v, found.value, actorsOf(characters));
    if (v.scope === 'character') {
      const opposite = v.visibility === 'restricted' ? 'public' : 'private';
      if (own(copy.characters[v.characterId]?.[opposite]?.[v.category] ?? {}, v.key)) fail('BLUEPRINT_VISIBILITY_MISMATCH');
    }
  }
  return copy;
}

/** Check whole-key changes before applyStatProposal. Receipts belong to the atomic commit. */
export function validateBlueprintStateChanges(blueprint, changes, characters = [], { source: changeSource, publicView = true } = {}) {
  const bp = validateBlueprint(blueprint, characters);
  if (!bp) return [];
  if (!Array.isArray(changes)) fail('BLUEPRINT_CHANGES');
  const declarations = new Map(bp.variables.map(v => [targetKey(v), v])), actors = actorsOf(characters), provenance = [];
  for (const change of changes) {
    target(change, actors);
    if (!['set', 'remove'].includes(change.operation) || (change.operation === 'set') !== own(change, 'value')) fail('BLUEPRINT_OPERATION');
    const key = targetKey(change), v = declarations.get(key);
    if (!v && bp.extensionPolicy === 'deny') fail('BLUEPRINT_EXTENSION_FORBIDDEN');
    if (v) {
      if (v.readOnly) fail('BLUEPRINT_READONLY_WRITE');
      if ((publicView && v.visibility === 'restricted') || (change.scope === 'character' && change.visibility !== (v.visibility === 'restricted' ? 'private' : 'public'))) fail('BLUEPRINT_RESTRICTED_WRITE');
      if (change.operation === 'set') {
        let value = change.value;
        if (v.scope === 'world' && v.visibility === 'restricted') {
          if (!record(value) || value.visibility !== 'private' || Object.keys(value).length !== 2 || !own(value, 'value')) fail('BLUEPRINT_RESTRICTED_WRAPPER');
          value = value.value;
        }
        validateValue(v, value, actors);
      }
    } else if (change.operation === 'set') {
      bounded(change.value);
      if (change.category === 'tasks') validateTask(change.value, actors);
    }
    if (!v || changeSource) provenance.push({ target: key, kind: v ? 'declared-update' : 'dynamic', operation: change.operation, blueprintId: bp.id, blueprintVersion: bp.version, source: source(changeSource) });
  }
  return provenance;
}

/** Ordinary UI omits restricted declarations as well as restricted values. */
export function publicBlueprintState(blueprint, state) {
  const actors = Object.keys(state.characters ?? {}).map(id => ({ id }));
  // A declared actor can legitimately have no values yet.
  for (const v of blueprint?.variables ?? []) if (v.scope === 'character' && !actors.some(a => a.id === v.characterId)) actors.push({ id: v.characterId });
  const bp = validateBlueprint(blueprint, actors), declared = [], otherState = [], seen = new Set();
  for (const v of bp?.variables ?? []) {
    seen.add(targetKey(v));
    if (v.visibility !== 'public') continue;
    const { known, value } = readValue(state, v);
    const projected = known ? publicData(value) : undefined;
    declared.push({ key: v.key, displayName: v.displayName, scope: v.scope, ...(v.characterId ? { characterId: v.characterId } : {}), category: v.category, type: v.type, ...(v.unit ? { unit: v.unit } : {}), known: known && projected !== undefined, ...(known && projected !== undefined ? { value: projected } : {}) });
  }
  function scan(root, scope, characterId) {
    for (const category of categories) for (const [key, value] of Object.entries(root?.[category] ?? {})) {
      const t = { scope, ...(characterId ? { characterId } : {}), category, key };
      if (seen.has(targetKey(t))) continue;
      const projected = publicData(value);
      if (projected !== undefined) otherState.push({ ...t, value: projected });
    }
  }
  scan(state.world, 'world');
  for (const [id, value] of Object.entries(state.characters ?? {})) scan(value.public, 'character', id);
  return { declared, otherState };
}
