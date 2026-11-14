// Presentation-only "what changed this turn" projection for the player UI.
// It reads the committed stateBefore/stateAfter and clock of ONE canonical turn
// and never becomes a second state authority. Only public data is used:
// - runs with a State Blueprint expose declared PUBLIC variables only
//   (restricted variables are skipped before any value is read);
// - runs without a Blueprint expose the public world projection only.
// Character private state, memories and diagnostics are never touched.
import {publicBlueprintState} from './state-blueprint.mjs';
import {publicStateForModel} from './memory-policy.mjs';
import {storyClockLabel} from './story-clock.mjs';

export const TURN_CHANGE_LIMITS = Object.freeze({rows: 24, valueChars: 240});
const json = v => JSON.stringify(v ?? null);
function bounded(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.length > TURN_CHANGE_LIMITS.valueChars ? value.slice(0, TURN_CHANGE_LIMITS.valueChars) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  const text = json(value);
  return text.length > TURN_CHANGE_LIMITS.valueChars ? {summary: text.slice(0, TURN_CHANGE_LIMITS.valueChars) + '…'} : value;
}

function declaredRows(blueprint, before, after) {
  const a = publicBlueprintState(blueprint, publicStateForModel(before)).declared;
  const b = publicBlueprintState(blueprint, publicStateForModel(after)).declared;
  const rows = [];
  for (const next of b) {
    const prev = a.find(v => v.scope === next.scope && v.category === next.category && v.key === next.key && v.characterId === next.characterId);
    const was = prev?.known ? prev.value : undefined, now = next.known ? next.value : undefined;
    if (json(was) === json(now)) continue;
    rows.push({scope: next.scope, ...(next.characterId ? {characterId: next.characterId} : {}), category: next.category, key: next.key, label: next.displayName, type: next.type, ...(next.unit ? {unit: next.unit} : {}),
      kind: prev?.known ? (next.known ? 'changed' : 'removed') : 'added', ...(was !== undefined ? {before: bounded(was)} : {}), ...(now !== undefined ? {after: bounded(now)} : {})});
  }
  return rows;
}

function worldRows(before, after) {
  const a = publicStateForModel(before).world, b = publicStateForModel(after).world, rows = [];
  for (const category of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (category === 'time') continue; // the Story Clock is reported separately
    const x = a[category] ?? {}, y = b[category] ?? {};
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (json(x[key]) === json(y[key])) continue;
      rows.push({scope: 'world', category, key, label: key, kind: key in x ? (key in y ? 'changed' : 'removed') : 'added', ...(key in x ? {before: bounded(x[key])} : {}), ...(key in y ? {after: bounded(y[key])} : {})});
    }
  }
  return rows;
}

export function publicTurnChanges(run, turn) {
  if (!turn?.stateBefore || !turn?.stateAfter) return null;
  let rows;
  try { rows = run.snapshot?.stateBlueprint ? declaredRows(run.snapshot.stateBlueprint, turn.stateBefore, turn.stateAfter) : worldRows(turn.stateBefore, turn.stateAfter); }
  catch { return {schemaVersion: 1, status: 'unavailable', rows: []}; }
  const out = {schemaVersion: 1, status: 'available', rows: rows.slice(0, TURN_CHANGE_LIMITS.rows), truncated: rows.length > TURN_CHANGE_LIMITS.rows};
  if (run.snapshot?.storyTimeDefinition && turn.clockBefore && turn.clockAfter) {
    try {
      const beforeLabel = storyClockLabel(run, turn.clockBefore), afterLabel = storyClockLabel(run, turn.clockAfter);
      out.clock = {beforeLabel, afterLabel, changed: beforeLabel !== afterLabel, dayChanged: turn.clockBefore.position.latest.dayOrdinal !== turn.clockAfter.position.latest.dayOrdinal, confirmedByPlayer: !!turn.timeConfirmation};
    } catch { out.clock = {status: 'unavailable'}; }
  }
  return out;
}
