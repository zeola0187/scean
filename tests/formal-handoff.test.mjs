import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudioHandoffSnapshot } from '../plugin/studio-handoff.mjs';
import { validateSnapshot } from '../core/contracts.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import { publicSnapshot } from '../core/inspection.mjs';
import { buildSavedSnapshot } from '../vendor/cardstudio-scean/lib/scean-integration.js';

const blueprint = () => ({schemaVersion:1,id:'synthetic-fuel',version:1,extensionPolicy:'allow',variables:[
  {key:'fuel',displayName:'Fuel',scope:'world',category:'resources',type:'number',min:0,max:100,visibility:'public'},
  {key:'unknown',displayName:'Unknown',scope:'world',category:'facts',type:'string',visibility:'public'},
]});
const initial = () => ({schemaVersion:1,blueprintId:'synthetic-fuel',blueprintVersion:1,values:[
  {scope:'world',category:'resources',key:'fuel',value:0,source:{id:'synthetic-card',version:1}},
]});
function source(extension={}) {
  return buildSavedSnapshot({id:'synthetic-card',type:'card',revision:1,sha256:'synthetic-source',card:{data:{
    name:'Synthetic ship',first_mes:'Synthetic saved opening.',alternate_greetings:['Synthetic alternate.'],
    extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Synthetic keeper background.'}],...extension}},
  }}});
}
function resign(snapshot) { delete snapshot.hash; return validateSnapshot(snapshot); }

test('formal handoff verifies original hash before promoting; keeps immutable source and provenance', () => {
  const raw=source({stateBlueprint:blueprint(),initialState:initial()}),before=structuredClone(raw);
  const fixed=normalizeStudioHandoffSnapshot(raw);
  assert.deepEqual(raw,before);
  assert.notEqual(fixed.hash,raw.hash);
  assert.equal(fixed.source.nativeHandoffCompatibility.providerSnapshotHash,raw.hash);
  assert.deepEqual(fixed.source.nativeHandoffCompatibility.promotedFields,['card.data.first_mes','card.data.extensions.scean.stateBlueprint','card.data.extensions.scean.initialState']);
  assert.deepEqual(fixed.characters,raw.characters);
  assert.deepEqual(fixed.card,raw.card);
  assert.deepEqual(validateSnapshot(fixed),fixed);
  assert.deepEqual(normalizeStudioHandoffSnapshot(fixed),fixed);
  const forged=structuredClone(raw);forged.card.data.first_mes='Tampered';
  assert.throws(()=>normalizeStudioHandoffSnapshot(forged),{code:'SNAPSHOT_HASH_MISMATCH'});
  const unsigned=structuredClone(raw);delete unsigned.hash;
  assert.throws(()=>normalizeStudioHandoffSnapshot(unsigned),{code:'STUDIO_SNAPSHOT_HASH_REQUIRED'});
});

test('formal handoff yields native public opening and typed initial state without model or IO', async () => {
  const fixed=normalizeStudioHandoffSnapshot(source({stateBlueprint:blueprint(),initialState:initial()}));
  const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:{create:async run=>run},model:{generate(){assert.fail('No model work permitted');}},memory:{retrieve(){assert.fail('No embedding/retrieval work permitted');}}});
  const run=await engine.createRun({snapshot:fixed});
  assert.equal(run.state.world.resources.fuel,0);
  assert.equal(run.state.world.facts?.unknown,undefined);
  assert.equal(publicSnapshot(run.snapshot).opening.text,'Synthetic saved opening.');
  assert.equal(run.turns.length,0);
});

test('formal handoff preserves existing top-level selections, omission and provider metadata', () => {
  const raw=source({stateBlueprint:blueprint(),initialState:initial()});
  raw.opening={id:'selected-alternate',title:'Selected alternate',text:'Explicit selection'};
  raw.stateBlueprint=blueprint();raw.stateBlueprint.version=2;
  raw.source.studioBridge={providerSnapshotHash:'prior-provenance',kind:'existing-bridge'};
  const signed=resign(raw),fixed=normalizeStudioHandoffSnapshot(signed);
  assert.deepEqual(fixed,signed);
  assert.equal(Object.hasOwn(fixed,'initialState'),false);
  const paired=structuredClone(signed);paired.initialState=initial();paired.initialState.blueprintVersion=2;
  const signedPair=resign(paired);assert.deepEqual(normalizeStudioHandoffSnapshot(signedPair),signedPair);
});

test('formal handoff rejects malformed saved blueprint, orphan initial state and mismatched values', () => {
  assert.throws(()=>normalizeStudioHandoffSnapshot(source({initialState:initial()})),{code:'INITIAL_STATE_WITHOUT_BLUEPRINT'});
  const bad=blueprint();bad.variables[0].scope='character';bad.variables[0].characterId='foreign';
  assert.throws(()=>normalizeStudioHandoffSnapshot(source({stateBlueprint:bad})),{code:'BLUEPRINT_ACTOR'});
  const overflow=initial();overflow.values[0].value=101;
  assert.throws(()=>normalizeStudioHandoffSnapshot(source({stateBlueprint:blueprint(),initialState:overflow})),{code:'BLUEPRINT_VALUE_RANGE'});
  const mismatched=initial();mismatched.blueprintVersion=2;
  assert.throws(()=>normalizeStudioHandoffSnapshot(source({stateBlueprint:blueprint(),initialState:mismatched})),{code:'INITIAL_STATE_VERSION'});
  const topOrphan=source({stateBlueprint:blueprint()});topOrphan.initialState=initial();
  assert.throws(()=>normalizeStudioHandoffSnapshot(resign(topOrphan)),{code:'INITIAL_STATE_WITHOUT_BLUEPRINT'});
});

test('formal handoff does not infer missing fields or apply legacy promotion to other providers', () => {
  const raw=source();delete raw.card.data.first_mes;
  const signed=resign(raw),fixed=normalizeStudioHandoffSnapshot(signed);
  assert.deepEqual(fixed,signed);
  assert.equal(Object.hasOwn(fixed,'opening'),false);
  assert.equal(Object.hasOwn(fixed,'stateBlueprint'),false);
  const unknown=source({stateBlueprint:blueprint(),initialState:initial()});unknown.source.provider='another-provider';
  const other=resign(unknown);assert.deepEqual(normalizeStudioHandoffSnapshot(other),other);
  const noInitial=normalizeStudioHandoffSnapshot(source({stateBlueprint:blueprint()}));
  assert.equal(Object.hasOwn(noInitial,'initialState'),false);
  const explicitEmpty=source();explicitEmpty.card.data.first_mes='';
  assert.equal(normalizeStudioHandoffSnapshot(resign(explicitEmpty)).opening.text,'');
});
