import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {budgetStage} from '../core/context-budget.mjs';
import {publicInspection,publicTurnResult} from '../core/inspection.mjs';
import {hash} from '../core/contracts.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';

const OWNER='CANARY_PRIVATE_OWNER',MID='CANARY_PRIVATE_MEMORY_ID',PATH='CANARY_PRIVATE_PATH',SOURCE='CANARY_PRIVATE_SOURCE';
const secret={text:'CANARY_PRIVATE_BODY'};
const publicSource={sourceID:'PUBLIC_SOURCE',path:'/input/public',visibility:'public',estimate:10,mandatory:true,included:true,reason:'required_core',priority:1000};
function diagnostic(){
  const {diagnostics}=budgetStage('character',{system:'Safe system',input:{character:{id:OWNER,description:'Private background'},ownState:{private:{[PATH]:'private'}},memory:{records:[{id:MID,text:'private'}]}}});
  diagnostics.sources.push(publicSource,{sourceID:SOURCE,path:`/${PATH}`,visibility:'restricted',sourceHash:hash(secret),estimate:20,mandatory:false,included:false,reason:'stage_boundary'});
  return diagnostics;
}
const privateMemory=(runId='privacy-run')=>({schemaVersion:2,id:MID,version:1,text:secret.text,access:{kind:'private'},knowers:[OWNER],characterIds:[OWNER],visibility:'characters',epistemic:{kind:'experience'},credibility:'subjective',source:{runId,id:SOURCE,path:PATH}});
const publicMemory=(runId='privacy-run')=>({schemaVersion:2,id:'public-memory',version:1,text:'Public fact',access:{kind:'world_public'},knowers:[],characterIds:[],visibility:'public',epistemic:{kind:'fact'},credibility:'confirmed',source:{runId,id:'public-source'}});
function fixture(){
  const stage={stage:'character',access:{kind:'character_private',characterId:OWNER},status:'completed',contextBudget:diagnostic(),prompt:secret,result:{text:secret.text}};
  const result={runId:'privacy-run',requestId:'req',body:'Public body',memories:[privateMemory(),publicMemory()],playerHistory:[{id:'PLAYER_PRIVATE_ID'}],trace:{stages:[stage]}};
  return {schemaVersion:1,runId:'privacy-run',version:1,state:{world:{},characters:{}},memories:result.memories,playerHistory:result.playerHistory,
    turns:[{body:'Public body',memoryIds:[MID,'public-memory'],playerHistoryIds:['PLAYER_PRIVATE_ID']}],
    receipts:{req:{result}},attempts:[{contextPreflights:[diagnostic()],stages:[stage],assembly:secret,
      assemblyDiagnostics:{contentHashes:{cardBefore:hash(secret)},worldbook:{books:[{sourceId:SOURCE,path:PATH,status:'excluded',reason:'private_scope'},{sourceId:'public-book',bookId:'safe-book',contentHash:hash(secret),status:'processed'}],entries:[{ref:SOURCE,sourceId:SOURCE,reason:'private_scope',status:'excluded'}],warnings:[{code:'PRIVATE_ENTRY_EXCLUDED',ref:SOURCE}],stageUse:'pending'}}}]};
}
function assertSafe(value){const text=JSON.stringify(value);for(const item of [OWNER,MID,PATH,SOURCE,hash(secret),'CANARY_PRIVATE_BODY','PLAYER_PRIVATE_ID'])assert(!text.includes(item),'restricted metadata leaked: '+item);}

test('B privacy canary: ordinary Inspector removes private metadata while preserving public sources and safe capacity totals',()=>{
  const source=fixture(),before=JSON.stringify(source),view=publicInspection(source);assertSafe(view);assert.equal(JSON.stringify(source),before,'projection must never mutate canonical evidence');
  const budget=view.attempts[0].stages[0].contextBudget;
  assert(budget.sources.some(row=>row.sourceID==='PUBLIC_SOURCE'));assert.equal(budget.contextWindow,0);assert.equal(budget.actualUsage,null);assert(budget.restrictedSources.count>=3);
  assert.deepEqual(view.turns[0].memoryIds,['public-memory']);assert.equal(view.turns[0].playerHistory.count,1);
  assert.equal(view.memories[1].source.id,'public-source');assert.equal(view.attempts[0].assembly.status,'restricted');
});

test('B privacy canary: turn result and nested stage trace use the same fail-closed projection',()=>{
  const result=fixture().receipts.req.result;assertSafe(publicTurnResult(result));
  result.trace.stages[0].contextBudget.sources.push({sourceID:SOURCE,path:PATH,visibility:'future-scope',estimate:1});assertSafe(publicTurnResult(result));
});

test('B privacy canary: unknown budget fields, owner access and restricted source extensions cannot pass through',()=>{
  const run=fixture(),d=run.attempts[0].contextPreflights[0];d.privateExtension={owner:OWNER};d.sources.push({visibility:'private',id:MID,owner:OWNER,path:PATH,hash:hash(secret),included:true,reason:SOURCE,estimate:4});
  assertSafe(publicInspection(run));
});

async function hostFixture(){
  const root=await mkdtemp(join(tmpdir(),'scean-b-privacy-'));let now=1000;
  const model={async generate({stage,input}){
    if(stage==='director')return input.conversation.length?{text:'Public brief'}:{text:'',toolCalls:[{id:'consult',name:'consult_character',arguments:{characterId:'kalt',question:'Harbor advice?'}}]};
    if(stage==='character')return{text:JSON.stringify({adviceVersion:1,characterId:'kalt',observable:{attitude:'calm',intent:'wait'},publicUtterances:['We can wait.'],withheld:['PRIVATE_NOTES'],internal:{notes:[]},intendedDisclosures:[]})};
    if(['draft','prose'].includes(stage))return{text:'Public body'};
    return{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};
  }};
  const store=new DurableStore({root:join(root,'store')}),engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model,memory:new Memory()});
  const host=await new SceanHost({engine,root:join(root,'host'),now:()=>now}).init();
  const created=await host.createRun({snapshot:{schemaVersion:1,cardId:'synthetic-privacy',revision:'r1',card:{name:'Synthetic ship'},worldbook:{entries:[]},preset:{},characters:[{id:'kalt',name:'Kalt',description:'Private background'}]}});
  const run=await store.read(created.runId),memory={...privateMemory(created.runId),text:'harbor private equipment',knowers:['kalt'],characterIds:['kalt'],source:{...privateMemory(created.runId).source,turn:0,commitId:'synthetic-seed',bodyHash:'synthetic-body',snapshotHash:run.snapshot.hash}};
  await store.withRunLock(run.runId,()=>store.commit(run.runId,0,{...run,version:1,memories:[memory]}));
  return{host,runId:run.runId,advance:()=>now+=600001};
}
test('B privacy actual Host: inspect, turn/replay, Stage Trace and Studio readonly hide private IDs; authorized detail retains them',async()=>{
  const {host,runId}=await hostFixture();try{
    const request={runId,input:'Please ask Kalt about harbor.',requestId:'canary-turn'};
    assertSafe(await host.turn(request));assertSafe(await host.turn(request));
    const inspected=await host.inspect(runId);assertSafe(inspected);assert(inspected.attempts.some(a=>a.stages.some(s=>s.stage==='character')));
    const binding=host.issueBinding(runId,'studio',1);assertSafe(await host.inspectFromStudio({runId,binding,authoringSessionId:'studio',generation:1}));
    const authority={principal:'operator',allowPrivateDiagnostics:true},viewerId='viewer';
    const grant=host.diagnosticsGrant({runId,viewerId,acknowledgement:'show-private-character-context-for-this-run'},authority);
    const detailed=await host.diagnosticsRead({...grant,viewerId},authority);assert(JSON.stringify(detailed).includes(MID));assert(JSON.stringify(detailed).includes(PATH));assert(JSON.stringify(detailed).includes('character:kalt'));
    host.diagnosticsRevoke({...grant,viewerId},authority);await assert.rejects(host.diagnosticsRead({...grant,viewerId},authority),{code:'DIAGNOSTICS_DENIED'});
  }finally{host.close();}
});
test('B privacy detailed diagnostics retain principal, viewer, Run, expiry and revocation boundaries',async()=>{
  const {host,runId,advance}=await hostFixture();try{
    const authority={principal:'operator',allowPrivateDiagnostics:true},req={runId,viewerId:'viewer',acknowledgement:'show-private-character-context-for-this-run'};
    assert.throws(()=>host.diagnosticsGrant(req),{code:'DIAGNOSTICS_AUTHORIZATION_REQUIRED'});
    const grant={...host.diagnosticsGrant(req,authority),viewerId:req.viewerId};
    for(const changed of [{...grant,viewerId:'other'},{...grant,grantToken:'invalid'}])await assert.rejects(host.diagnosticsRead(changed,authority),{code:'DIAGNOSTICS_DENIED'});
    await assert.rejects(host.diagnosticsRead(grant,{...authority,principal:'other'}),{code:'DIAGNOSTICS_DENIED'});advance();await assert.rejects(host.diagnosticsRead(grant,authority),{code:'DIAGNOSTICS_DENIED'});
  }finally{host.close();}
});
