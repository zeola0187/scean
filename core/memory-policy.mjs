import { SceanError, clone, safeId, json } from './contracts.mjs';

export const MEMORY_SCHEMA_VERSION = 2;
const accessKinds = new Set(['world_public', 'known_event', 'private']);
const epistemicKinds = new Set(['fact', 'experience', 'belief', 'rumor', 'unverified']);
const credibilityKinds = new Set(['confirmed', 'subjective', 'unverified', 'disputed']);
const audiences = new Set(['public', 'public-consultation', 'owner']);
const fail = code => { throw new SceanError(code); };
const exactObject = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ids = value => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0) && new Set(value).size === value.length;

/** Validate independent permission and epistemic dimensions; never judge narrative truth. */
export function validateMemoryPolicy(memory, knownActors) {
  if (memory.schemaVersion !== MEMORY_SCHEMA_VERSION || !exactObject(memory.access, ['kind']) || !accessKinds.has(memory.access.kind) ||
      !exactObject(memory.epistemic, ['kind']) || !epistemicKinds.has(memory.epistemic.kind) || !credibilityKinds.has(memory.credibility) ||
      !ids(memory.knowers) || !ids(memory.characterIds)) fail('INVALID_MEMORY_POLICY');
  if (knownActors && memory.knowers.some(id => !knownActors.has(id))) fail('INVALID_STAT_ACTORS');
  if (memory.characterIds.length !== memory.knowers.length || memory.characterIds.some(id => !memory.knowers.includes(id))) fail('MEMORY_KNOWERS_MISMATCH');
  if (memory.access.kind !== 'world_public' && !memory.knowers.length) fail('INVALID_MEMORY_SCOPE');
  // Public world facts are the only automatic input to the shared Writer pipeline.
  // Beliefs/rumors remain available to their owners, even when stated confidently.
  if (memory.access.kind === 'world_public' && (memory.epistemic.kind !== 'fact' || memory.credibility !== 'confirmed')) fail('MEMORY_PUBLIC_NOT_FACT');
  if (memory.visibility !== (memory.access.kind === 'world_public' ? 'public' : 'characters')) fail('MEMORY_VISIBILITY_MISMATCH');
  return memory;
}

/**
 * Legacy visibility=public was ambiguous. It never grants global knowledge here.
 * Read-time compatibility permits only named owners; no old Run is rewritten.
 * Missing/unknown versions fail closed before embeddings, corpus stats or ranking.
 */
export function eligibleMemory(memory, { runId, characterId, audience = 'public' } = {}) {
  if (!audiences.has(audience)) fail('INVALID_MEMORY_AUDIENCE');
  if (!memory || (runId !== undefined && memory.source?.runId !== runId)) return false;
  if (memory.schemaVersion === undefined || memory.schemaVersion === 1) {
    return audience === 'owner' && !!characterId && ['public', 'characters'].includes(memory.visibility) &&
      ids(memory.characterIds) && memory.characterIds.includes(characterId);
  }
  if (memory.schemaVersion !== MEMORY_SCHEMA_VERSION) return false;
  try { validateMemoryPolicy(memory); } catch { return false; }
  if (memory.access.kind === 'world_public') return true;
  return audience === 'owner' && !!characterId && memory.knowers.includes(characterId);
}

/** Only new legacy-shaped proposals are normalized; persisted evidence is never migrated. */
export function normalizeMemoryProposal(memory) {
  const copy = clone(memory);
  if (copy.schemaVersion !== undefined || copy.access !== undefined || copy.knowers !== undefined || copy.epistemic !== undefined || copy.credibility !== undefined) {
    validateMemoryPolicy(copy);
    return copy;
  }
  if (!copy.characterIds.length) fail('LEGACY_MEMORY_SCOPE_REQUIRED');
  return { ...copy, schemaVersion: MEMORY_SCHEMA_VERSION, access: { kind: 'known_event' },
    knowers: [...copy.characterIds], visibility: 'characters', epistemic: { kind: 'unverified' }, credibility: 'unverified' };
}

const privateKeys = new Set(['private', 'privateState', 'privateMemory', 'privateDescription', 'secrets']);
/** Structured labels only. Unlabelled author prose is public input, not automatically classified. */
export function publicData(value) {
  if (Array.isArray(value)) return value.map(publicData).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'contextScope') || value.scope?.kind === 'player_only' || value.role === 'player_history') return undefined;
  if (value.access?.kind === 'private' || value.access?.kind === 'known_event' || value.visibility === 'private' || value.visibility === 'characters') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key)).map(([key, child]) => [key, publicData(child)]).filter(([, child]) => child !== undefined));
}

export function publicCharacter(actor) {
  return { id: actor.id, name: actor.name,
    ...(actor.identity ? { identity: publicData(actor.identity) } : {}),
    ...(typeof actor.publicDescription === 'string' ? { description: actor.publicDescription } : {}) };
}

export function publicStateForModel(state) {
  return { world: publicData(state.world) ?? {}, characters: Object.fromEntries(Object.entries(state.characters).map(([id, value]) =>
    [id, { public: publicData(value.public ?? {}) ?? {} }])) };
}

export function publicConsultationState(state, actorId) {
  return { public: publicData(state.characters?.[actorId]?.public ?? {}) ?? {} };
}

/**
 * An actor's own definition/state is an owner-authorized container. Nested
 * explicit contextScope overrides that inherited ownership and fails closed.
 * This structural projection cannot classify secrets in unlabelled free prose.
 */
export function ownerData(value, characterId) {
  safeId(characterId);
  if (characterId === 'player') fail('RESERVED_ACTOR_ID');
  function project(item) {
    if (Array.isArray(item)) return item.map(project).filter(v => v !== undefined);
    if (!item || typeof item !== 'object') return item;
    if (item.scope?.kind === 'player_only' || item.role === 'player_history') return undefined;
    if (Object.hasOwn(item, 'contextScope')) {
      const scope = item.contextScope;
      if (!exactObject(scope, ['kind', 'characterId']) || scope.kind !== 'character' || scope.characterId !== characterId) return undefined;
    }
    // Reuse declared memory permissions when a memory-shaped block is nested in
    // relationships or state; ownership never follows the person being discussed.
    if (['private', 'known_event'].includes(item.access?.kind) && (!ids(item.knowers) || !item.knowers.includes(characterId))) return undefined;
    if (item.visibility === 'characters' && !item.access && (!ids(item.characterIds) || !item.characterIds.includes(characterId))) return undefined;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, project(child)]).filter(([, child]) => child !== undefined));
  }
  json(value);
  return project(value);
}

export function ownerCharacterContext(actor, { characterId = actor?.id } = {}) {
  if (!actor || actor.id !== characterId) fail('CHARACTER_CONTEXT_OWNER_MISMATCH');
  const projected = ownerData(actor, characterId);
  if (!projected) fail('CHARACTER_CONTEXT_OWNER_MISMATCH');
  return projected;
}

export function ownerStateForModel(state, characterId) {
  safeId(characterId);
  if (characterId === 'player') fail('RESERVED_ACTOR_ID');
  return ownerData(state.characters?.[characterId] ?? {}, characterId) ?? {};
}

/** Explicit Host-authorized player view only; this function does not grant a lease. */
export function playerHistoryForView(records, { runId, audience } = {}) {
  safeId(runId);
  if (audience !== 'player-history') fail('PLAYER_HISTORY_VIEW_FORBIDDEN');
  if (!Array.isArray(records)) fail('INVALID_PLAYER_HISTORY');
  return { schemaVersion: 1, role: 'player_history_view', scope: { kind: 'player_only' }, runId,
    records: records.filter(row => row?.schemaVersion === 1 && row.role === 'player_history' &&
      exactObject(row.scope, ['kind']) && row.scope.kind === 'player_only' && row.source?.runId === runId &&
      Number.isSafeInteger(row.version) && row.version > 0 && Number.isSafeInteger(row.source.turn) && row.source.turn > 0 &&
      typeof row.source.commitId === 'string' && row.source.commitId && typeof row.source.bodyHash === 'string' && row.source.bodyHash &&
      typeof row.text === 'string' && row.text.trim() && !['knowers', 'characterIds', 'access', 'visibility'].some(key => Object.hasOwn(row, key))).map(clone) };
}

/** Future per-character summary input contract only: no writer, trigger or storage. */
export function ownerSummaryContext(summary, { runId, characterId } = {}) {
  safeId(runId); safeId(characterId);
  if (summary?.schemaVersion !== 1 || summary.role !== 'character_summary' || summary.characterId !== characterId ||
      !Number.isSafeInteger(summary.version) || summary.version < 1 || summary.source?.runId !== runId ||
      !Number.isSafeInteger(summary.source.turn) || summary.source.turn < 0 ||
      typeof summary.source.commitId !== 'string' || !summary.source.commitId || typeof summary.source.bodyHash !== 'string' || !summary.source.bodyHash ||
      !exactObject(summary.contextScope, ['kind', 'characterId']) || summary.contextScope.kind !== 'character' || summary.contextScope.characterId !== characterId ||
      typeof summary.text !== 'string' || !summary.text.trim() || summary.text.length > 50000) fail('INVALID_CHARACTER_SUMMARY');
  return ownerData(summary, characterId);
}
