import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import { DurableStore } from '../adapters/store.mjs';
import { hash } from '../core/contracts.mjs';
import { encodeRunBundle,validateRunBundle,parseRunBundle,SAVE_LIMITS } from '../core/save-bundle.mjs';
import {createHistoryFixture,playHistory,historyArgs,historyModel,syntheticHistoryMemory,HISTORY_C} from '../fixtures/synthetic-history-c.mjs';
import {temporalRestore} from '../core/state-operations.mjs';

const copy=structuredClone;
const resign=b=>{b.manifest={...b.manifest,runId:b.run.runId,version:b.run.version,head:b.run.head,snapshotHash:b.run.snapshot.hash,sha256:hash(b.run)};return b;};
const code=c=>e=>e.code===c;
let fixture;
async function source(){
  if(!fixture)fixture=(async()=>{
    const root=await mkdtemp(join(tmpdir(),'scean-save-')),store=new DurableStore({root});let round=0;
    const model={async generate({stage}){
      if(stage==='director'){round++;return{text:'Public scene brief'};}
      if(stage==='draft'||stage==='prose')return{text:round===1?'Kalt privately checks the equipment.':'Kalt tells Xio the equipment is faulty.'};
      if(stage==='post_stat')return{text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'resources',key:'fuel',operation:'set',value:80-round}],memories:[{text:round===1?'SYNTHETIC_KALT_ORIGINAL_PRIVATE':'SYNTHETIC_XIO_LEARNED',schemaVersion:2,characterIds:[round===1?'kalt':'xio'],visibility:'characters',access:{kind:round===1?'private':'known_event'},knowers:[round===1?'kalt':'xio'],epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:['kalt'],decisionMakers:[]}}],playerHistory:[{text:'The player observed round '+round,epistemic:{kind:'experience'},credibility:'confirmed',participants:{speakers:[],actors:['player'],decisionMakers:[]}}]})};throw Error(stage);
    }};
    const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model,memory:{async retrieve(){return{records:[]};}}});
    const snapshot={schemaVersion:1,cardId:'synthetic-save-ship',revision:'r1',card:{data:{name:'Synthetic Ship',extensions:{unknownStory:{token:'fictional copper token',script:'<% never_execute() %>',apiary:'bees'}}}},worldbook:{entries:[]},preset:{style:'plain'},characters:[{id:'kalt',name:'Kalt',description:'Synthetic engineer'},{id:'aier',name:'Aier',description:'Synthetic navigator'},{id:'xio',name:'Xio',description:'Synthetic researcher'}],stateBlueprint:{schemaVersion:1,id:'ship',version:1,extensionPolicy:'allow',variables:[{key:'fuel',displayName:'Fuel',scope:'world',category:'resources',type:'number',visibility:'public',min:0,max:100},{key:'secret',displayName:'Secret',scope:'character',characterId:'kalt',category:'facts',type:'string',visibility:'restricted'}]},initialState:{schemaVersion:1,blueprintId:'ship',blueprintVersion:1,values:[{scope:'world',category:'resources',key:'fuel',value:80,source:{id:'synthetic-card',version:'r1'}},{scope:'character',characterId:'kalt',category:'facts',key:'secret',value:'SYNTHETIC_PRIVATE_STATE',source:{id:'synthetic-card',version:'r1'}}]}};
    await engine.createRun({snapshot,runId:'synthetic-save-run',banList:['bannedword'],modelSelection:{provider:'synthetic',model:'offline'}});
    await engine.turn({runId:'synthetic-save-run',requestId:'request-one',input:'Privately inspect.'});
    await engine.turn({runId:'synthetic-save-run',requestId:'request-two',input:'Share the result.'});
    return store.read('synthetic-save-run');
  })();return copy(await fixture);
}
async function bundle(){return encodeRunBundle(await source());}
async function bad(change,expected){const b=await bundle();change(b);resign(b);assert.throws(()=>validateRunBundle(b),expected?code(expected):undefined);}

test('C save roundtrip preserves private authoritative story, ACL, source, Snapshot, Blueprint, playerHistory and provenance',async()=>{
  const run=await source(),before=copy(run),b=encodeRunBundle(run),restored=validateRunBundle(JSON.stringify(b));
  for(const k of ['snapshot','state','memories','playerHistory','stateProvenance','turns','runId','version'])assert.deepEqual(restored[k],run[k]);
  assert.equal(restored.head,run.turns.at(-1).commitId);assert.deepEqual(run,before);assert(!Object.hasOwn(restored,'modelSelection'));
  assert.equal(restored.snapshot.card.data.extensions.unknownStory.script,'<% never_execute() %>');assert.equal(restored.memories[0].access.kind,'private');
  assert(JSON.stringify(b).includes('SYNTHETIC_PRIVATE_STATE'));assert(JSON.stringify(b).includes('SYNTHETIC_KALT_ORIGINAL_PRIVATE'));
});
test('C save excludes environment root fields and raw receipt tool working traces, without erasing story metadata',async()=>{
  const run=await source();Object.assign(run,{hostLease:'secret',apiKey:'secret',sdk:{huge:'no'},attempts:[{prompt:'secret'}],stageModelSelections:{director:{provider:'local',model:'x'}}});
  run.receipts['request-one'].result.trace.tools=[{privateSource:'RAW_PRIVATE_WORKING_PACKET'}];
  const b=encodeRunBundle(run),s=JSON.stringify(b);for(const marker of ['hostLease','apiKey','RAW_PRIVATE_WORKING_PACKET','stageModelSelections','attempts'])assert(!s.includes(marker));
  assert.equal(validateRunBundle(b).snapshot.card.data.extensions.unknownStory.token,'fictional copper token');
});
test('C save truncated, corrupt digest, duplicate JSON member including escaped spelling and unsupported schema reject',async()=>{
  const b=await bundle(),raw=JSON.stringify(b);assert.throws(()=>validateRunBundle(raw.slice(0,-1)),code('SAVE_JSON'));
  b.run.state.world.resources.fuel=77;assert.throws(()=>validateRunBundle(b),code('SAVE_DIGEST'));
  assert.throws(()=>parseRunBundle('{"a":1,"\\u0061":2}'),code('SAVE_DUPLICATE_MEMBER'));
  assert.throws(()=>parseRunBundle('{"a":{"x":1,"x":2}}'),code('SAVE_DUPLICATE_MEMBER'));
  const unsupported={...await bundle(),schemaVersion:2};assert.throws(()=>validateRunBundle(unsupported),code('SAVE_FORMAT_VERSION'));
});
test('C save bounded data-only structure rejects excessive bytes/depth, getters, unsafe keys and invalid Unicode',async()=>{
  assert.throws(()=>validateRunBundle(' '.repeat(SAVE_LIMITS.bytes+1)),code('SAVE_LIMIT'));
  assert.throws(()=>parseRunBundle('['.repeat(66)+'0'+']'.repeat(66)),code('SAVE_LIMIT'));
  let ran=false;const getter={get format(){ran=true;return'scean.run';}};assert.throws(()=>validateRunBundle(getter),code('SAVE_JSON'));assert.equal(ran,false);
  for(const raw of ['{"__proto__":{}}','{"a":"\\ud800"}','{"a":1e999}'])assert.throws(()=>validateRunBundle(raw));
  const cyclic={};cyclic.x=cyclic;assert.throws(()=>validateRunBundle(cyclic),code('SAVE_JSON'));
});
test('C save rejects nonportable nested credentials, OS paths and external-load directives instead of silently removing them',async()=>{
  for(const [key,value,expected]of[['apiKey','synthetic-secret','SAVE_ENVIRONMENT_FIELD'],['location','C:\\fixture\\private','SAVE_ENVIRONMENT_PATH'],['location','/tmp/fixture','SAVE_ENVIRONMENT_PATH'],['$ref','https://invalid.example/external.json','SAVE_EXTERNAL_REFERENCE'],['filePath','../private.json','SAVE_EXTERNAL_REFERENCE']]){
    const run=await source();run.snapshot.card.data.extensions[key]=value;assert.throws(()=>encodeRunBundle(run),code(expected));
  }
  await bad(b=>{b.run.sdk={};},'SAVE_FIELDS');
});
test('C save catches snapshot, head, state continuity and active commit identity drift',async()=>{
  await bad(b=>{b.run.snapshot.card.data.name='changed';},'SNAPSHOT_HASH_MISMATCH');
  await bad(b=>{b.run.head='other-commit';},'SAVE_HEAD');
  await bad(b=>{b.run.turns[1].stateBefore.world.resources.fuel=1;},'SAVE_STATE_CHAIN');
  await bad(b=>{b.run.state.world.resources.fuel=1;},'SAVE_STATE_CHAIN');
  await bad(b=>{b.run.turns[1].commitId=b.run.turns[0].commitId;},'SAVE_TURN');
  await bad(b=>{b.run.turns[1].requestId=b.run.turns[0].requestId;},'SAVE_TURN');
});
test('C save catches duplicate/orphan records, wrong ownership and all frozen-source linkage fields',async()=>{
  await bad(b=>{b.run.memories.push(copy(b.run.memories[0]));},'SAVE_DUPLICATE_ID');
  await bad(b=>{b.run.turns[0].memoryIds=[];},'SAVE_RECORD_IDS');
  for(const key of ['runId','commitId','bodyHash','requestId','attemptId','snapshotHash','cardId','revision','rosterHash','turn'])await bad(b=>{b.run.memories[0].source[key]='wrong';},'SAVE_SOURCE');
  await bad(b=>{b.run.turns[0].playerHistoryIds=[];},'SAVE_RECORD_IDS');
});
test('C save does not broaden private ACL or permit unknown owners/player-history scope',async()=>{
  await bad(b=>{b.run.memories[0].visibility='public';},'MEMORY_VISIBILITY_MISMATCH');
  await bad(b=>{b.run.memories[0].knowers=['unknown'];b.run.memories[0].characterIds=['unknown'];},'INVALID_STAT_ACTORS');
  await bad(b=>{b.run.playerHistory[0].scope.kind='public';},'SAVE_PLAYER_HISTORY');
  await bad(b=>{b.run.memories[0].participants.speakers=['unknown'];},'SAVE_RECORD_ACTOR');
});
test('C save checks Blueprint values/initial state, provenance source and durable replay receipts',async()=>{
  await bad(b=>{b.run.state.world.resources.fuel=200;});
  await bad(b=>{b.run.turns[0].stateBefore.world.resources.fuel=1;},'SAVE_BASELINE_STATE');
  await bad(b=>{b.run.stateProvenance.find(p=>p.kind!=='initial').source.id='retired';},'SAVE_PROVENANCE');
  await bad(b=>{b.run.receipts['request-one'].result.body='corrupt';},'SAVE_RECEIPT');
  await bad(b=>{delete b.run.receipts['request-one'];},'SAVE_RECEIPT');
  await bad(b=>{b.run.receipts['request-one'].result.trace={attemptId:b.run.turns[0].attemptId,stages:[],tools:[{}]};},'SAVE_FIELDS');
});

function rollbackFixture(run){
  const prior=copy(run);
  const t=run.turns.pop(),version=run.version+1,operationId='rollback-save';run.head=run.turns.at(-1)?.commitId??null;run.version=version;run.state=copy(t.stateBefore);
  run.memories=run.memories.filter(m=>m.source.commitId!==t.commitId);run.playerHistory=run.playerHistory.filter(m=>m.source.commitId!==t.commitId);run.stateProvenance=run.stateProvenance.filter(p=>p.source.id!==t.commitId);
  run.retired=[{commitId:t.commitId,requestId:t.requestId,attemptId:t.attemptId,turn:t.turn,worldActivityBefore:copy(t.worldActivityBefore),worldActivityAfter:copy(t.worldActivityAfter),bodyHash:t.bodyHash,reason:'rollback',operationId,retiredAtVersion:version,replacedBy:null}];
  const old=run.receipts[t.requestId];run.receipts[t.requestId]={status:'retired',inputHash:old.inputHash,commitId:t.commitId,attemptId:t.attemptId,retiredBy:operationId,retiredAtVersion:version};
  const request={kind:'rollback',runId:run.runId,operationId,expectedVersion:version-1,expectedHead:t.commitId};
  run.operationReceipts={[operationId]:{kind:'rollback',request,fingerprint:hash(request),result:{status:'committed',kind:'rollback',runId:run.runId,operationId,version,head:run.head,retiredCommitId:t.commitId}}};temporalRestore(prior,run,t,operationId);return run;
}
test('C save rolled-back knowledge stays excluded, private earlier memory survives, receipts and version roundtrip',async()=>{
  const run=rollbackFixture(await source()),restored=validateRunBundle(encodeRunBundle(run));assert.equal(restored.version,3);assert.equal(restored.memories.length,1);assert.equal(restored.memories[0].access.kind,'private');
  const raw=JSON.stringify(restored);assert(!raw.includes('SYNTHETIC_XIO_LEARNED'));assert.equal(restored.receipts['request-two'].status,'retired');assert.deepEqual(restored.operationReceipts,run.operationReceipts);
  const b=encodeRunBundle(run);b.run.retired[0].body='WITHDRAWN_BODY';resign(b);assert.throws(()=>validateRunBundle(b),code('SAVE_FIELDS'));
});
test('C save retirement audit and operation receipts cannot point at unrelated history or carry new arbitrary output',async()=>{
  for(const mutate of [r=>{r.operationReceipts['rollback-save'].result.version=1;},r=>{r.retired[0].operationId='missing';},r=>{r.operationReceipts['rollback-save'].result.body='unexpected';},r=>{r.receipts['request-two'].retiredBy='other';}]){const b=encodeRunBundle(rollbackFixture(await source()));mutate(b.run);resign(b);assert.throws(()=>validateRunBundle(b));}
});
test('C save recomputes rollback receipt fingerprint from its exact semantic request and rejects altered arguments after manifest rehash',async()=>{
  const valid=encodeRunBundle(rollbackFixture(await source()));
  for(const [label,mutate]of[
    ['missing request',r=>{delete r.request;}],
    ['fingerprint',r=>{r.fingerprint='0'.repeat(64);}],
    ['unexpected argument',r=>{r.request.guidance='unexpected';r.fingerprint=hash(r.request);}],
    ['wrong run scope',r=>{r.request.runId='other-run';r.fingerprint=hash(r.request);}],
    ['wrong operation',r=>{r.request.operationId='other-operation';r.fingerprint=hash(r.request);}],
    ['wrong kind',r=>{r.request.kind='regenerate';r.fingerprint=hash(r.request);}],
    ['wrong head',r=>{r.request.expectedHead='other-commit';r.fingerprint=hash(r.request);}],
    ['wrong expected version',r=>{r.request.expectedVersion--;r.fingerprint=hash(r.request);}],
    ['null head',r=>{r.request.expectedHead=null;r.fingerprint=hash(r.request);}],
  ]){const b=copy(valid);mutate(b.run.operationReceipts['rollback-save']);resign(b);assert.throws(()=>validateRunBundle(b),undefined,label);}
});
test('C save checks regeneration request identity, bounded guidance and fingerprint independently of the outer manifest',async()=>{
  const f=await createHistoryFixture();await playHistory(f,'private','original');f.model.mode='quiet';
  await f.engine.regenerate(await historyArgs(f,'regen-request-check',{requestId:'new-candidate',guidance:'Keep this scene brief.'}));
  const valid=encodeRunBundle(await f.store.read(f.run.runId));
  for(const [label,mutate]of[
    ['altered guidance',r=>{r.request.guidance='Different writing instruction';}],
    ['altered fingerprint',r=>{r.fingerprint='1'.repeat(64);}],
    ['other candidate',r=>{r.request.requestId='other-candidate';r.fingerprint=hash(r.request);}],
    ['missing guidance',r=>{delete r.request.guidance;r.fingerprint=hash(r.request);}],
    ['excessive guidance',r=>{r.request.guidance='x'.repeat(10001);r.fingerprint=hash(r.request);}],
    ['nontext guidance',r=>{r.request.guidance={text:'not a string'};r.fingerprint=hash(r.request);}],
  ]){const b=copy(valid);mutate(b.run.operationReceipts['regen-request-check']);resign(b);assert.throws(()=>validateRunBundle(b),undefined,label);}
});
test('C save verifies provenance target operations against each full state transition, including omitted and forged updates',async()=>{
  for(const mutate of [
    r=>{r.stateProvenance.find(p=>p.kind!=='initial').target='["world",null,"resources","other"]';},
    r=>{r.stateProvenance=r.stateProvenance.filter(p=>p.source.id!==r.turns[0].commitId);delete r.turns[0].stateProvenanceAfter;delete r.turns[1].stateProvenanceBefore;delete r.turns[1].stateProvenanceAfter;},
    r=>{r.stateProvenance.find(p=>p.kind!=='initial').source.version=r.version+1;},
  ]){const b=await bundle();mutate(b.run);resign(b);assert.throws(()=>validateRunBundle(b));}
});
test('W29 save refuses deleting baseline fields from a new temporal aggregate; no implicit legacy migration',async()=>{
  const run=await source();for(const k of ['head','baselineState','baselineProvenance','operationReceipts','retired'])delete run[k];
  for(const turn of run.turns)for(const k of ['commitVersion','stateProvenanceBefore','stateProvenanceAfter'])delete turn[k];
  assert.throws(()=>encodeRunBundle(run),code('TEMPORAL_RUN_INVALID'));
});
test('C save actual research ship rollback and zero-memory regeneration export, empty-root import, restart and continuation',async()=>{
  const a=await createHistoryFixture();await playHistory(a,'private','private-origin');await playHistory(a,'share','shared-then-rollback');
  const rollback=await historyArgs(a,'actual-rollback');await a.engine.rollback(rollback);
  await playHistory(a,'share','shared-then-regenerate');a.model.mode='quiet';const regen=await historyArgs(a,'actual-regen',{requestId:'replacement',guidance:'SYNTHETIC_PRIVATE_WRITING_GUIDANCE: Keep the notebook closed.'});await a.engine.regenerate(regen);
  const original=await a.store.read(a.run.runId),encoded=encodeRunBundle(original),validated=validateRunBundle(JSON.stringify(encoded));
  const root=await mkdtemp(join(tmpdir(),'scean-save-destination-')),store=new DurableStore({root});await store.create(validated);
  const restartedStore=new DurableStore({root}),model=historyModel(),memory=syntheticHistoryMemory(),engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:restartedStore,model,memory});
  const restored=await restartedStore.read(original.runId);assert.deepEqual(restored,validated);assert.equal((await restartedStore.listRuns())[0].runId,original.runId);
  for(const field of ['snapshot','turns','baselineState','baselineProvenance','state','memories','playerHistory','stateProvenance','version','head','retired'])assert.deepEqual(restored[field],original[field]);
  const recall=async characterId=>memory.retrieve({query:'research pump seal fault',records:restored.memories,runId:restored.runId,characterId,audience:'owner'});
  assert(JSON.stringify(await recall('kalt')).includes(HISTORY_C.privateText));assert(!JSON.stringify(await recall('sio')).includes(HISTORY_C.sharedText));
  assert.deepEqual(await engine.rollback(rollback),restored.operationReceipts['actual-rollback'].result);assert.deepEqual(await engine.regenerate(regen),restored.operationReceipts['actual-regen'].result);assert.equal(model.calls.length,0);
  assert.equal(restored.operationReceipts['actual-regen'].request.guidance,regen.guidance);
  await assert.rejects(engine.turn({runId:restored.runId,requestId:'shared-then-regenerate',input:'Continue the research ship scene.'}),code('REQUEST_RETIRED'));
  model.mode='quiet';await engine.turn({runId:restored.runId,requestId:'after-import',input:'Continue safely.'});assert.equal((await restartedStore.read(restored.runId)).version,restored.version+1);
});
test('C save a regenerated result retired by later rollback exports only durable tombstones and preserves replay after import',async()=>{
  const f=await createHistoryFixture();await playHistory(f,'private','origin');await playHistory(f,'share','old');f.model.mode='quiet';const regen=await historyArgs(f,'regen-to-retire',{requestId:'new'});await f.engine.regenerate(regen);
  await f.engine.rollback(await historyArgs(f,'rollback-replacement'));
  const restored=validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId))),receipt=restored.operationReceipts['regen-to-retire'].result;
  assert.equal(receipt.status,'retired');for(const key of ['body','state','memories','playerHistory','trace'])assert(!Object.hasOwn(receipt,key));assert.equal(restored.memories.length,1);
});
test('C save validated publication refuses collisions and pre-publication faults leave no partial visible run',async()=>{
  const run=validateRunBundle(await bundle()),root=await mkdtemp(join(tmpdir(),'scean-save-atomic-'));let failBefore=true;
  const store=new DurableStore({root,fault(point){if(point==='beforeRename'&&failBefore)throw Error('synthetic-before-publish');}});
  await assert.rejects(store.create(run),/synthetic-before-publish/);assert.deepEqual(await store.listRuns(),[]);await assert.rejects(store.read(run.runId),code('RUN_NOT_FOUND'));
  failBefore=false;await store.create(run);await assert.rejects(store.create(run),code('RUN_EXISTS'));assert.deepEqual(await store.read(run.runId),run);
  const malformed=await bundle();malformed.run.runId='new-invalid-run';assert.throws(()=>validateRunBundle(malformed));assert.equal((await store.listRuns()).length,1);
});
