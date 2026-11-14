// Regression: the save portability boundary must reject machine paths, not story text that starts with "/".
// Before the fix, a Blueprint unit "/24" (or any card/turn text such as "/roll 1d20") passed the Studio
// audit and then failed at 開演 with SAVE_ENVIRONMENT_PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {encodeRunBundle, validateRunBundle, snapshotPortabilityIssue} from '../core/save-bundle.mjs';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
import {buildSavedSnapshot} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {hash} from '../core/contracts.mjs';
import {bindCharacterSources} from '../core/character-sources.mjs';

const SLASH_TEXT = ['/24', '/roll 1d20', '/3 天', '/24/7 營業', '/me waves', '/tmp'];
const MACHINE_PATHS = ['/home/someone/cards/a.png', '/Users/someone/x', 'C:/Users/someone/x', 'C:\\Users\\someone', '\\\\server\\share\\x', 'file:///etc/passwd', '/../etc/passwd', '/data/../x'];

async function run(t, card) {
  const base = resolve(import.meta.dirname, '../.test-data'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'save-portability-')); t.after(() => rm(root, {recursive: true, force: true}));
  const engine = new SceanEngine({postBody: false, store: new DurableStore({root}), memory: new Memory(), model: {generate() { assert.fail('No model in save validation'); }}});
  const worldbook = {entries: []}; card.data.extensions ??= {}; card.data.extensions.scean ??= {};
  const actor = bindCharacterSources({id: 'actor', name: 'Actor', description: 'Synthetic actor.'}, [{kind: 'card_field', path: '/data/description'}], {card, worldbook});
  card.data.extensions.scean.characters = [structuredClone(actor)];
  return engine.createRun({snapshot: {schemaVersion: 1, cardId: 'synthetic-card', revision: 1, card, worldbook, preset: {}, characters: [actor], source: {script: {scriptId: 'synthetic-script', scriptHash: 'a'.repeat(64), sourceSessionId: 'synthetic-publication-session'}, authoring: {sessionId: 'synthetic-entry-session', generation: 1}}}});
}

test('story text starting with "/" is portable: a run with such card fields saves and reloads', async t => {
  const card = {data: {name: 'Synthetic', description: '/24 小時營業的便利商店。', first_mes: '/roll 1d20 決定今晚的天氣。', extensions: {scean: {notes: SLASH_TEXT}}}};
  const r = await run(t, card), bundle = encodeRunBundle(r), back = validateRunBundle(JSON.stringify(bundle));
  assert.deepEqual(back.snapshot.card.data.extensions.scean.notes, SLASH_TEXT);
  for (const text of SLASH_TEXT) assert.equal(snapshotPortabilityIssue({card: {data: {extensions: {scean: {stateBlueprint: {variables: [{key: 'hp', unit: text}]}}}}}}), null, text);
});

test('machine-specific paths are still rejected, with the offending JSON pointer', async t => {
  for (const p of MACHINE_PATHS) {
    const issue = snapshotPortabilityIssue({card: {data: {extensions: {scean: {stateBlueprint: {variables: [{key: 'hp', unit: p}]}}}}}});
    assert.equal(issue?.code, 'SAVE_ENVIRONMENT_PATH', p);
    assert.equal(issue.path, '/card/data/extensions/scean/stateBlueprint/variables/0/unit');
  }
  const r = await run(t, {data: {name: 'Synthetic', description: 'C:/Users/someone/secret.txt'}});
  assert.throws(() => encodeRunBundle(r), {code: 'SAVE_ENVIRONMENT_PATH'});
});

test('Studio audit fails a real path before 開演 and passes slash-leading story text', () => {
  const input = c => { const saved = {id: 'synthetic-audit', type: 'card', revision: 0, sha256: hash(c), card: c}; return {snapshot: buildSavedSnapshot(saved), saved: {id: saved.id, revision: 0, sha256: saved.sha256}, entryIds: []}; };
  const card = unit => ({data: {first_mes: 'Synthetic.', extensions: {scean: {characters: [{id: 'a', name: 'A', description: 'Synthetic.'}], stateBlueprint: {schemaVersion: 1, id: 'bp', version: 1, extensionPolicy: 'deny', variables: [{key: 'hp', displayName: 'HP', scope: 'world', category: 'stats', type: 'number', visibility: 'public', unit}]}}}}});
  const ok = auditSavedSnapshot(input(card('/24'))).items.find(i => i.itemID === 'D.portability');
  assert.equal(ok.status, 'PASS');
  const bad = auditSavedSnapshot(input(card('C:/Users/someone/hp.txt'))).items.find(i => i.itemID === 'D.portability');
  assert.equal(bad.status, 'FAIL'); assert.equal(bad.observed.code, 'SAVE_ENVIRONMENT_PATH');
  assert.match(bad.observed.path, /stateBlueprint\/variables\/0\/unit$/);
});
