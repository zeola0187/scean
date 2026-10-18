import { SceanError, clone, json, parseObject } from './contracts.mjs';

function reject(code) { const error = new SceanError(code); error.category = 'tool'; throw error; }
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject('CHARACTER_ADVICE_FIELDS');
}
function bounded(value, max = 4000) {
  if (typeof value !== 'string' || value.length > max) reject('CHARACTER_ADVICE_SHAPE');
}
function strings(value) {
  if (!Array.isArray(value) || value.length > 20) reject('CHARACTER_ADVICE_SHAPE');
  for (const entry of value) bounded(entry);
}

/**
 * Structural publication boundary, not a semantic secrecy reviewer.
 * A character may propose deliberately disclosing information. Those proposed
 * words remain advice, never an event or an automatic state/memory write.
 * Free text can paraphrase a secret: this projection cannot prove it did not.
 */
export function projectCharacterAdvice(raw, { characterId }) {
  let advice;
  try { advice = parseObject(raw); } catch { reject('CHARACTER_ADVICE_JSON'); }
  fields(advice, ['adviceVersion', 'characterId', 'observable', 'publicUtterances', 'withheld', 'internal', 'intendedDisclosures']);
  if (advice.adviceVersion !== 1) reject('CHARACTER_ADVICE_VERSION');
  if (advice.characterId !== characterId) reject('CHARACTER_ADVICE_IDENTITY');
  fields(advice.observable, ['attitude', 'intent']);
  bounded(advice.observable.attitude); bounded(advice.observable.intent);
  strings(advice.publicUtterances); strings(advice.withheld);
  fields(advice.internal, ['notes']); strings(advice.internal.notes);
  if (!Array.isArray(advice.intendedDisclosures) || advice.intendedDisclosures.length > 20) reject('CHARACTER_ADVICE_SHAPE');
  for (const disclosure of advice.intendedDisclosures) {
    fields(disclosure, ['topic', 'publicText']); bounded(disclosure.topic, 500); bounded(disclosure.publicText);
  }
  if (json(advice).length > 40000) reject('CHARACTER_ADVICE_TOO_LARGE');
  return {
    adviceVersion: 1, characterId, kind: 'advice_not_event',
    observable: clone(advice.observable), publicUtterances: clone(advice.publicUtterances),
    intendedDisclosures: clone(advice.intendedDisclosures),
  };
}
