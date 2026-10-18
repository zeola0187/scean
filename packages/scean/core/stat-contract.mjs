import { SceanError, clone, json, safeId, validateState } from './contracts.mjs';
import { normalizeMemoryProposal, validateMemoryPolicy, publicData } from './memory-policy.mjs';

export const STAT_LIMITS = Object.freeze({ changes: 200, memories: 100, keyLength: 128, depth: 24, nodes: 20000, proposalLength: 400000, valueLength: 50000, quotes: 20 });
const categories = new Set(['locations', 'tasks', 'resources', 'equipment', 'time', 'effects', 'facts']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (o, k) => Object.hasOwn(o, k);
const fail = code => { throw new SceanError(code); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Bound JSON before clone/stringification. This is structural validation, not an event judge.
function boundedJSON(value) {
  let nodes = 0;
  const active = new Set();
  function visit(v, depth) {
    if (++nodes > STAT_LIMITS.nodes || depth > STAT_LIMITS.depth) fail('STAT_JSON_LIMIT');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if ((!Array.isArray(v) && !record(v)) || active.has(v)) fail('INVALID_STAT_JSON');
    active.add(v);
    if (Object.getOwnPropertySymbols(v).length) fail('INVALID_STAT_JSON');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (forbidden.has(key) || !own(descriptor, 'value') || !descriptor.enumerable) fail('INVALID_STAT_JSON');
      if (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key)) fail('INVALID_STAT_JSON');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail('INVALID_STAT_JSON');
    active.delete(v);
  }
  visit(value, 0);
  if (json(value).length > STAT_LIMITS.proposalLength) fail('STAT_JSON_LIMIT');
}
function fields(value, required, optional = []) {
  if (!record(value) || required.some(k => !own(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('INVALID_STAT_FIELDS');
}
function actorList(value, known, allowPlayer = false) {
  if (!Array.isArray(value) || value.length > known.size + Number(allowPlayer) || new Set(value).size !== value.length || value.some(id => !known.has(id) && !(allowPlayer && id === 'player'))) fail('INVALID_STAT_ACTORS');
}
function attribution(value, known, finalBody) {
  fields(value.participants, ['speakers', 'actors', 'decisionMakers']);
  for (const role of ['speakers', 'actors', 'decisionMakers']) actorList(value.participants[role], known, true);
  if (own(value, 'quotes')) {
    if (!Array.isArray(value.quotes) || value.quotes.length > STAT_LIMITS.quotes) fail('INVALID_MEMORY_QUOTES');
    for (const quote of value.quotes) {
      fields(quote, ['speakerId', 'text']);
      if (quote.speakerId !== null && quote.speakerId !== 'player' && !known.has(quote.speakerId)) fail('INVALID_QUOTE_SPEAKER');
      if (typeof quote.text !== 'string' || !quote.text.trim() || quote.text.length > 10000 || !finalBody.includes(quote.text)) fail('QUOTE_NOT_IN_FINAL_BODY');
    }
  }
}
function container(parent, key, create) {
  if (!own(parent, key)) { if (!create) return undefined; parent[key] = {}; }
  if (!record(parent[key])) fail('STATE_PATH_CONFLICT');
  return parent[key];
}

/** Prepare one atomic commit, preserving unspecified facts. Does not perform writes or semantic review. */
export function applyStatProposal(proposal, previousState, characters, finalBody, { publicView = false } = {}) {
  boundedJSON(proposal);
  fields(proposal, ['contractVersion', 'stateChanges', 'memories'], ['playerHistory']);
  if (proposal.contractVersion !== 2) fail('STAT_CONTRACT_VERSION');
  if (!Array.isArray(characters) || !characters.length || characters.length > 100) fail('INVALID_STAT_ROSTER');
  const known = new Set();
  for (const character of characters) {
    if (!record(character)) fail('INVALID_STAT_ROSTER');
    safeId(character.id);
    if (character.id === 'player' || known.has(character.id)) fail('INVALID_STAT_ROSTER');
    known.add(character.id);
  }
  if (typeof finalBody !== 'string' || !finalBody.trim() || finalBody.length > 200000) fail('INVALID_STAT_BODY');
  const state = validateState(previousState, characters);
  if (!Array.isArray(proposal.stateChanges) || proposal.stateChanges.length > STAT_LIMITS.changes) fail('INVALID_STATE_CHANGES');
  if (!Array.isArray(proposal.memories) || proposal.memories.length > STAT_LIMITS.memories) fail('INVALID_MEMORIES');
  const targets = new Set();
  for (const [index, change] of proposal.stateChanges.entries()) {
    const scopeFailure = reason => { throw Object.assign(new SceanError('INVALID_STATE_SCOPE'), { validation: { index, path: `/stateChanges/${index}`, reason } }); };
    fields(change, ['scope', 'category', 'key', 'operation'], ['characterId', 'visibility', 'value']);
    if (!['world', 'character'].includes(change.scope) || !categories.has(change.category) || typeof change.key !== 'string' || !change.key.trim() || change.key.length > STAT_LIMITS.keyLength || forbidden.has(change.key)) fail('INVALID_STATE_TARGET');
    if (!['set', 'remove'].includes(change.operation) || (change.operation === 'set') !== own(change, 'value')) fail('INVALID_STATE_OPERATION');
    if (change.scope === 'world' && (own(change, 'characterId') || own(change, 'visibility'))) scopeFailure('invalid_world_fields');
    if (change.scope === 'character') {
      if (!known.has(change.characterId)) scopeFailure(change.characterId === 'player' ? 'reserved_player' : 'unknown_character');
      if (!['public', 'private'].includes(change.visibility)) scopeFailure('invalid_visibility');
    }
    // A model receiving only public prior state has no authority to overwrite a
    // private key it cannot see. Host merges the public delta into the full state.
    if (publicView && change.scope === 'character' && change.visibility === 'private') fail('PRIVATE_STATE_WRITE_FORBIDDEN');
    if (own(change, 'value') && json(change.value).length > STAT_LIMITS.valueLength) fail('STATE_VALUE_TOO_LARGE');
    const target = json([change.scope, change.characterId ?? null, change.visibility ?? null, change.category, change.key]);
    if (targets.has(target)) fail('DUPLICATE_STATE_TARGET');
    targets.add(target);
    const create = change.operation === 'set';
    let root = state.world;
    if (change.scope === 'character') {
      root = container(state.characters, change.characterId, create);
      if (root) root = container(root, change.visibility, create);
    }
    const bucket = root && container(root, change.category, create);
    // Legacy public buckets may contain explicitly restricted nested data. The
    // model saw a projection, so replacing that entire key would erase hidden
    // siblings. Fail atomically rather than silently losing protected values.
    if (publicView && bucket && own(bucket, change.key)) {
      const visible = publicData(bucket[change.key]);
      if (visible === undefined || json(visible) !== json(bucket[change.key])) fail('PRIVATE_STATE_TARGET_FORBIDDEN');
    }
    if (bucket) { if (create) bucket[change.key] = clone(change.value); else delete bucket[change.key]; }
  }
  const memories = [], seen = new Set();
  for (const memory of proposal.memories) {
    fields(memory, ['text', 'characterIds', 'visibility', 'participants'], ['quotes', 'metadata', 'schemaVersion', 'access', 'knowers', 'epistemic', 'credibility']);
    if (typeof memory.text !== 'string' || !memory.text.trim() || memory.text.length > 10000) fail('INVALID_MEMORY_TEXT');
    actorList(memory.characterIds, known);
    if (!['public', 'characters'].includes(memory.visibility) || (memory.visibility === 'characters' && !memory.characterIds.length)) fail('INVALID_MEMORY_SCOPE');
    attribution(memory, known, finalBody);
    const normalized = normalizeMemoryProposal(memory);
    validateMemoryPolicy(normalized, known);
    const fingerprint = json(normalized);
    if (!seen.has(fingerprint)) { memories.push(normalized); seen.add(fingerprint); }
  }
  const playerHistory = [], seenHistory = new Set();
  if (own(proposal, 'playerHistory') && (!Array.isArray(proposal.playerHistory) || proposal.playerHistory.length > STAT_LIMITS.memories)) fail('INVALID_PLAYER_HISTORY');
  for (const entry of proposal.playerHistory ?? []) {
    fields(entry, ['text', 'epistemic', 'credibility', 'participants'], ['quotes', 'metadata', 'schemaVersion', 'role', 'scope']);
    if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 10000) fail('INVALID_PLAYER_HISTORY_TEXT');
    fields(entry.epistemic, ['kind']);
    if (!['fact', 'experience', 'belief', 'rumor', 'unverified'].includes(entry.epistemic.kind) || !['confirmed', 'subjective', 'unverified', 'disputed'].includes(entry.credibility)) fail('INVALID_PLAYER_HISTORY_EPISTEMIC');
    if ((own(entry, 'schemaVersion') && entry.schemaVersion !== 1) || (own(entry, 'role') && entry.role !== 'player_history')) fail('INVALID_PLAYER_HISTORY_SCOPE');
    if (own(entry, 'scope')) { fields(entry.scope, ['kind']); if (entry.scope.kind !== 'player_only') fail('INVALID_PLAYER_HISTORY_SCOPE'); }
    attribution(entry, known, finalBody);
    const normalized = { ...clone(entry), schemaVersion: 1, role: 'player_history', scope: { kind: 'player_only' } };
    const fingerprint = json(normalized);
    if (!seenHistory.has(fingerprint)) { seenHistory.add(fingerprint); playerHistory.push(normalized); }
  }
  return { state: validateState(state, characters), memories, stateChanges: clone(proposal.stateChanges), playerHistory };
}
