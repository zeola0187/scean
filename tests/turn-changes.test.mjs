import test from 'node:test';
import assert from 'node:assert/strict';
import {publicTurnChanges} from '../core/turn-changes.mjs';
import {pageHistory} from '../core/history-recall.mjs';
import {storyTimeDefinition, initializeStoryClock} from '../core/story-clock.mjs';

const bp = {schemaVersion: 1, id: 'bp', version: 1, extensionPolicy: 'allow', variables: [
  {scope: 'world', category: 'locations', key: 'player_location', displayName: '位置', type: 'string', visibility: 'public'},
  {scope: 'world', category: 'resources', key: 'fuel', displayName: '油量', type: 'number', unit: '格', visibility: 'public'},
  {scope: 'world', category: 'facts', key: 'backstage_truth', displayName: 'RESTRICTED_LABEL_CANARY', type: 'string', visibility: 'restricted'},
]};
const definition = storyTimeDefinition({schemaVersion: 1, calendar: {id: 'trip', version: 1, kind: 'relative'}, hoursPerDay: 24, minutesPerHour: 60,
  periods: {dawn: {start: 300, end: 479, label: '清晨'}, dusk: {start: 1020, end: 1139, label: '黃昏'}}, initial: {dayOrdinal: 1, precision: 'period', periodId: 'dusk'}});
const world = (loc, fuel, secret) => ({world: {locations: {player_location: loc}, resources: {fuel}, facts: {backstage_truth: secret}}, characters: {zhe: {public: {}, private: {mood: 'PRIVATE_CHAR_CANARY'}}}});
function run() {
  const snapshot = {hash: 'snap', stateBlueprint: bp, storyTimeDefinition: definition, characters: [{id: 'zhe', name: '阿哲'}]};
  const c1 = initializeStoryClock(snapshot), c2 = {...structuredClone(c1), position: {earliest: {dayOrdinal: 2, minuteOfDay: 300}, latest: {dayOrdinal: 2, minuteOfDay: 479}}, periodId: 'dawn', revision: 1, sourceRef: {kind: 'time_resolution'}};
  const turn = {turn: 1, commitId: 'c1', requestId: 'r1', input: '出發', body: '他們上路了。', stateBefore: world('112K', 2, 'RESTRICTED_VALUE_CANARY'), stateAfter: world('128K', 4, 'RESTRICTED_VALUE_CANARY_2'), clockBefore: c1, clockAfter: c2, timeConfirmation: {confirmed: true}};
  return {runId: 'run-1', snapshot, storyClock: c2, turns: [turn], receipts: {}, retired: [], version: 2, head: 'c1'};
}

test('declared public changes only; restricted and private values never leak', () => {
  const r = run(), changes = publicTurnChanges(r, r.turns[0]), text = JSON.stringify(changes);
  assert.equal(changes.status, 'available');
  assert.deepEqual(changes.rows.map(x => [x.key, x.before, x.after, x.kind]), [['player_location', '112K', '128K', 'changed'], ['fuel', 2, 4, 'changed']]);
  assert.equal(changes.rows[1].unit, '格');
  for (const canary of ['RESTRICTED', 'PRIVATE_CHAR_CANARY', 'backstage_truth']) assert.ok(!text.includes(canary), canary);
  assert.deepEqual(changes.clock, {beforeLabel: '故事第 1 日 · 黃昏（時段）', afterLabel: '故事第 2 日 · 清晨（時段）', changed: true, dayChanged: true, confirmedByPlayer: true});
});

test('historyPage attaches changes only when asked', () => {
  const r = run();
  assert.equal(pageHistory(r, {limit: 5}).turns[0].changes, undefined);
  const page = pageHistory(r, {limit: 5, changes: true});
  assert.equal(page.turns[0].changes.rows.length, 2);
  assert.ok(!JSON.stringify(page).includes('CANARY'));
});

test('runs without a blueprint expose public world differences only', () => {
  const r = run(); delete r.snapshot.stateBlueprint; delete r.snapshot.storyTimeDefinition;
  const changes = publicTurnChanges(r, r.turns[0]);
  assert.ok(changes.rows.some(x => x.category === 'resources' && x.key === 'fuel'));
  assert.ok(!JSON.stringify(changes).includes('PRIVATE_CHAR_CANARY'));
  assert.equal(changes.clock, undefined);
});
