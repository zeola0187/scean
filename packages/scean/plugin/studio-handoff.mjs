import { SceanError, clone, validateSnapshot } from '../core/contracts.mjs';
import { validateBlueprint, materializeInitialState } from '../core/state-blueprint.mjs';

const LEGACY_PROVIDER = '@local/dsh-card-studio-scean-test';
const own = (value, key) => Object.hasOwn(value, key);

/** New-Run admission only. The caller retains Studio's live lease/saved-revision
 * checks. This pure adapter neither reads Studio storage nor rewrites old Runs.
 * Hash verification precedes promotion of saved fields to the current contract. */
export function normalizeStudioHandoffSnapshot(input) {
  const snapshot = validateSnapshot(input);
  if (snapshot.source?.provider !== LEGACY_PROVIDER) return snapshot;
  if (typeof input.hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.hash)) {
    throw new SceanError('STUDIO_SNAPSHOT_HASH_REQUIRED');
  }
  const promoted = [], card = snapshot.card?.data;
  for(const key of ['storyTimeDefinition','publicEvents','worldRoutineDefinition'])if(!own(snapshot,key)&&own(card?.extensions?.scean??{},key)){snapshot[key]=clone(card.extensions.scean[key]);promoted.push('card.data.extensions.scean.'+key);}
  if (!own(snapshot, 'opening') && typeof card?.first_mes === 'string') {
    snapshot.opening = { id: 'studio-opening-0', title: '已保存主開場', text: card.first_mes };
    promoted.push('card.data.first_mes');
  }

  // An explicit top-level pair is authoritative. Do not mix a selected modern
  // blueprint with stale nested initial values, or reinterpret an explicit null.
  if (!own(snapshot, 'stateBlueprint') && !own(snapshot, 'initialState')) {
    const saved = card?.extensions?.scean;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      if (own(saved, 'initialState') && !own(saved, 'stateBlueprint')) {
        throw new SceanError('INITIAL_STATE_WITHOUT_BLUEPRINT');
      }
      if (own(saved, 'stateBlueprint')) {
        snapshot.stateBlueprint = validateBlueprint(saved.stateBlueprint, snapshot.characters);
        promoted.push('card.data.extensions.scean.stateBlueprint');
        if (own(saved, 'initialState')) {
          snapshot.initialState = clone(saved.initialState);
          promoted.push('card.data.extensions.scean.initialState');
        }
      }
    }
  }
  // Structural validation only, using the existing Core contract. No inferred
  // state, roster, knowledge, prose, authoring permission or model work.
  const blueprint = validateBlueprint(snapshot.stateBlueprint, snapshot.characters);
  materializeInitialState(blueprint, snapshot.initialState, snapshot.characters);
  if (!promoted.length) return snapshot;
  if (own(snapshot.source, 'nativeHandoffCompatibility')) {
    throw new SceanError('STUDIO_HANDOFF_METADATA_CONFLICT');
  }
  snapshot.source.nativeHandoffCompatibility = {
    schemaVersion: 1,
    kind: 'saved-card-field-promotion',
    providerSnapshotHash: snapshot.hash,
    promotedFields: promoted,
    rosterSource: 'unchanged-provider-explicit-roster',
    admission: 'new-run-only; existing-studio-lease-and-revision-checks',
  };
  delete snapshot.hash;
  return validateSnapshot(snapshot);
}
