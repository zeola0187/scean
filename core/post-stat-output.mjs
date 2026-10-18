import { SceanError, safeId } from './contracts.mjs';
import { STAT_LIMITS } from './stat-contract.mjs';

// A generation contract, not provider-enforced structured output. The existing
// applyStatProposal remains the authoritative mechanical/atomic validator.
export function postStatOutputContract(characters) {
  const npcIds = characters.map(actor => safeId(actor.id));
  if (!npcIds.length || npcIds.length > 100 || npcIds.includes('player') || new Set(npcIds).size !== npcIds.length) throw new SceanError('INVALID_STAT_ROSTER');
  const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
  const ids = values => ({ type: 'array', items: { enum: values }, uniqueItems: true, maxItems: values.length });
  const text = { type: 'string', minLength: 1, maxLength: 10000 };
  const participants = object(Object.fromEntries(['speakers', 'actors', 'decisionMakers'].map(key => [key, ids([...npcIds, 'player'])])));
  const epistemic = object({ kind: { enum: ['fact', 'experience', 'belief', 'rumor', 'unverified'] } });
  const credibility = { enum: ['confirmed', 'subjective', 'unverified', 'disputed'] };
  const quotes = { type: 'array', maxItems: STAT_LIMITS.quotes, items: object({ speakerId: { enum: [...npcIds, 'player', null] }, text }) };
  const common = { category: { enum: ['locations', 'tasks', 'resources', 'equipment', 'time', 'effects', 'facts'] },
    key: { type: 'string', minLength: 1, maxLength: STAT_LIMITS.keyLength, not: { enum: ['__proto__', 'prototype', 'constructor'] } } };
  const stateChanges = { type: 'array', maxItems: STAT_LIMITS.changes, items: { oneOf: ['world', 'character'].flatMap(scope => ['set', 'remove'].map(operation => object({
    scope: { const: scope }, ...(scope === 'character' ? { characterId: { enum: npcIds }, visibility: { const: 'public' } } : {}),
    ...common, operation: { const: operation }, ...(operation === 'set' ? { value: {} } : {}),
  }))) } };
  const memory = object({ schemaVersion: { const: 2 }, text, access: object({ kind: { enum: ['world_public', 'known_event', 'private'] } }),
    knowers: ids(npcIds), characterIds: ids(npcIds), visibility: { enum: ['public', 'characters'] }, epistemic, credibility, participants, quotes },
  ['schemaVersion', 'text', 'access', 'knowers', 'characterIds', 'visibility', 'epistemic', 'credibility', 'participants']);
  const playerEntry = object({ text, epistemic, credibility, participants, quotes }, ['text', 'epistemic', 'credibility', 'participants']);
  return {
    version: 1, enforcement: 'prompt_contract_only', npcStateIds: npcIds,
    rules: [
      'stateChanges scope character targets ONLY npcStateIds. player is reserved and is NEVER a characterId. Do not add a player NPC.',
      'Public observable player location, condition or possessions use existing world category keys (for example player_location); reuse a matching prior key. World changes omit characterId and visibility.',
      'Player-only private experiences belong only in optional playerHistory; do not expose them in world state or invent NPC knowers. playerHistory is history, not a separate player state object.',
      'NPC private state is outside this public invocation. Do not move private facts to world to bypass permissions.',
      'memory characterIds and knowers are identical NPC-only sets. world_public requires visibility public, epistemic fact and credibility confirmed; other access kinds require nonempty knowers and visibility characters.',
      'Quotes must be exact substrings of finalBody. No duplicate state target, unsafe JSON keys, unbounded JSON, or overwrite of hidden prior data. Existing Host validation enforces these additional constraints.',
      'Invalid output rejects the whole turn; Host does not silently drop, retarget or repair invalid changes.',
    ],
    schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...object({ contractVersion: { const: 2 }, stateChanges,
      memories: { type: 'array', maxItems: STAT_LIMITS.memories, items: memory },
      playerHistory: { type: 'array', maxItems: STAT_LIMITS.memories, items: playerEntry },
    }, ['contractVersion', 'stateChanges', 'memories']) },
  };
}
