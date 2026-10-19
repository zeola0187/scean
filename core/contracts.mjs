import { createHash, randomUUID } from 'node:crypto';
import {derivedFactsPackage} from './derived-facts.mjs';
import { frontendPackage } from './frontend.mjs';
import { validateCharacterSources } from './character-sources.mjs';

export class SceanError extends Error {
  constructor(code, message = code) { super(message); this.name = 'SceanError'; this.code = code; }
}
export const clone = value => structuredClone(value);
// Only these interactive RP calls inherit DSH output settings. Background work
// keeps its existing explicit/default budgets, even when it shares the port.
export const RP_MODEL_STAGES = Object.freeze(['director','character','adjudicate','draft','prose','prose_repair','post_stat']);
export const id = prefix => `${prefix}-${randomUUID()}`;
export function safeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new SceanError('INVALID_ID');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(value)) throw new SceanError('INVALID_ID');
  return value;
}
export function json(value) {
  const seen = new Set();
  function normalize(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || seen.has(v)) throw new SceanError('INVALID_JSON');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new SceanError('INVALID_JSON');
    seen.add(v);
    const out = Array.isArray(v) ? v.map(normalize) : Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])]));
    seen.delete(v); return out;
  }
  return JSON.stringify(normalize(value));
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
export function checkAbort(signal) { if (signal?.aborted) throw new SceanError('CANCELLED'); }
export function object(value, code = 'INVALID_OBJECT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SceanError(code);
  json(value); return value;
}
export function text(value, max = 200000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new SceanError('INVALID_TEXT');
  return value;
}
export function parseObject(value) {
  if (typeof value !== 'string') return object(value);
  const cleaned = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1');
  try { return object(JSON.parse(cleaned)); } catch { throw new SceanError('INVALID_MODEL_JSON'); }
}
export function validateSnapshot(snapshot) {
  object(snapshot);
  if (snapshot.schemaVersion !== 1 || !snapshot.cardId || snapshot.revision === undefined || !snapshot.card || snapshot.worldbook === undefined || snapshot.preset === undefined || !Array.isArray(snapshot.characters)) throw new SceanError('INVALID_SNAPSHOT');
  validateRoster(snapshot.characters);
  for (const actor of snapshot.characters) validateCharacterSources(actor, snapshot);
  derivedFactsPackage(snapshot.derivedFacts,snapshot.stateBlueprint,snapshot.characters);
  if (snapshot.frontend) frontendPackage(snapshot.frontend,snapshot.stateBlueprint,snapshot.characters,snapshot.derivedFacts);
  const copy = clone(snapshot); delete copy.hash;
  const actualHash = hash(copy);
  if (snapshot.hash && snapshot.hash !== actualHash) throw new SceanError('SNAPSHOT_HASH_MISMATCH');
  return { ...copy, hash: actualHash };
}
/** Creation-time contract only: existing frozen runs are never rewritten. */
export function validateRoster(characters) {
  if (!Array.isArray(characters) || !characters.length || characters.length > 100) throw new SceanError('ROSTER_REQUIRED', 'Configure at least one identified character before creating a run.');
  const ids = new Set();
  for (const actor of characters) {
    object(actor, 'INVALID_ACTOR'); safeId(actor.id); text(actor.name, 500);
    if (typeof actor.description !== 'string' || !actor.description.trim() || actor.description.length > 100000) throw new SceanError('ACTOR_BACKGROUND_REQUIRED', 'Each character needs an explicit character-specific background. Unknown background must be stated explicitly.');
    if (actor.id === 'player') throw new SceanError('RESERVED_ACTOR_ID');
    // Relationships may be authored prose or structured owner-scoped data. Keep
    // valid unknown metadata; do not flatten it or infer missing relationships.
    if (actor.relationships !== undefined && (actor.relationships === null ||
        !['string', 'object'].includes(typeof actor.relationships) || json(actor.relationships).length > 100000)) throw new SceanError('INVALID_ACTOR_RELATIONSHIPS');
    if (actor.identity !== undefined) {
      object(actor.identity, 'INVALID_ACTOR_IDENTITY');
      if (!['user-explicit', 'card-explicit'].includes(actor.identity.source) ||
          Object.keys(actor.identity).some(k => !['gender', 'pronouns', 'source'].includes(k)) ||
          !['gender', 'pronouns'].some(k => typeof actor.identity[k] === 'string' && actor.identity[k].trim())) throw new SceanError('INVALID_ACTOR_IDENTITY');
      for (const key of ['gender', 'pronouns']) if (actor.identity[key] !== undefined) text(actor.identity[key], 500);
    }
    if (ids.has(actor.id)) throw new SceanError('DUPLICATE_ACTOR'); ids.add(actor.id);
  }
  return clone(characters);
}
export function validateState(state, characters) {
  object(state); object(state.world); object(state.characters);
  const known = new Set(characters.map(c => c.id));
  for (const [actorId, value] of Object.entries(state.characters)) {
    if (!known.has(actorId)) throw new SceanError('UNKNOWN_STATE_ACTOR'); object(value);
  }
  if (json(state).length > 250000) throw new SceanError('STATE_TOO_LARGE');
  return clone(state);
}
export function validateMemories(memories, characters) {
  if (!Array.isArray(memories) || memories.length > 100) throw new SceanError('INVALID_MEMORIES');
  const known = new Set(characters.map(c => c.id));
  return memories.map(m => {
    object(m); text(m.text, 10000);
    if (!Array.isArray(m.characterIds) || !['public', 'characters'].includes(m.visibility)) throw new SceanError('INVALID_MEMORY_SCOPE');
    if (m.visibility === 'characters' && !m.characterIds.length) throw new SceanError('EMPTY_PRIVATE_SCOPE');
    if (m.characterIds.some(actor => !known.has(actor)) || new Set(m.characterIds).size !== m.characterIds.length) throw new SceanError('UNKNOWN_MEMORY_ACTOR');
    return { text: m.text, characterIds: [...m.characterIds], visibility: m.visibility };
  });
}
export function publicState(state) {
  return { world: clone(state.world), characters: Object.fromEntries(Object.entries(state.characters).map(([k, v]) => [k, { public: clone(v.public ?? {}) }])) };
}
