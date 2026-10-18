import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {startServer} from '../isolated/server.mjs';
import {publicSnapshot} from '../core/inspection.mjs';

const snapshot={schemaVersion:1,cardId:'a1-private-inspection',revision:1,
  card:{name:'Synthetic inspection',description:'CARD_PRIVATE_SOURCE'},worldbook:{entries:[]},preset:{instructions:'Test'},
  characters:[{id:'kalt',name:'Kalt',description:'KALT_PRIVATE_BACKGROUND'},{id:'sio',name:'Sio',description:'SIO_PRIVATE_BACKGROUND'}]};
const forbidden=/KALT_PRIVATE_BACKGROUND|SIO_PRIVATE_BACKGROUND|CARD_PRIVATE_SOURCE|KALT_PRIVATE_STATE|WITHHELD_PRIVATE|INTERNAL_PRIVATE|PRIVATE_MEMORY|PLAYER_ONLY_HISTORY/;
const authority={principal:'authenticated-operator',allowPrivateDiagnostics:true};
const consent='show-private-character-context-for-this-run';
async function environment(){
  await mkdir(new URL('../.test-data/',import.meta.url),{recursive:true});
  const root=await mkdtemp(new URL('../.test-data/a1-inspection-',import.meta.url));let now=1;
  const model={async generate({stage,input}){
    if(stage==='director')return input.conversation.length?{text:'A public exchange.'}:{text:'',toolCalls:[{id:'ask-kalt',name:'consult_character',arguments:{characterId:'kalt',question:'What will you say?'}}]};
    if(stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:'kalt',observable:{attitude:'calm',intent:'wait'},publicUtterances:['Let us wait.'],withheld:['WITHHELD_PRIVATE'],internal:{notes:['INTERNAL_PRIVATE']},intendedDisclosures:[]})};
    if(stage==='draft'||stage==='prose')return {text:'Kalt quietly waits.'};
    if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[{schemaVersion:2,text:'PRIVATE_MEMORY',characterIds:['kalt'],knowers:['kalt'],visibility:'characters',access:{kind:'private'},epistemic:{kind:'experience'},credibility:'subjective',participants:{speakers:[],actors:['kalt'],decisionMakers:[]}}],playerHistory:[{text:'PLAYER_ONLY_HISTORY',epistemic:{kind:'experience'},credibility:'subjective',participants:{speakers:[],actors:['player'],decisionMakers:[]}}]})};
    throw Error('Unexpected stage');
  }};
  const host=await new SceanHost({root:join(root,'host'),now:()=>now,engine:new SceanEngine({store:new DurableStore({root:join(root,'store')}),model,memory:new Memory()})}).init();
  const created=await host.createRun({snapshot,initialState:{world:{},characters:{kalt:{private:{secret:'KALT_PRIVATE_STATE'}}}}});
  return {host,root,created,advance:()=>{now+=600001;}};
}
test('ordinary create/turn/receipt/inspect/Studio/banList never serialize private context; explicit diagnostics preserves provenance',async()=>{
  const env=await environment(),{host,created}=env;const runId=created.runId;
  assert.doesNotMatch(JSON.stringify(created),forbidden);
  assert.doesNotMatch(JSON.stringify(await host.turn({runId,requestId:'turn-1',input:'Please ask Kalt.'})),forbidden);
  const read=await host.inspect(runId);assert.doesNotMatch(JSON.stringify(read),forbidden);
  assert.equal(read.attempts.find(a=>a.status==='committed').stages.find(s=>s.stage==='character').prompt.status,'restricted');
  assert.equal(read.playerHistory.count,1);
  const binding=host.issueBinding(runId,'studio-a1',1);
  assert.doesNotMatch(JSON.stringify(await host.inspectFromStudio({runId,binding,authoringSessionId:'studio-a1',generation:1})),forbidden);
  const ban=await host.request({action:'banList',runId,banList:['unused'],expectedVersion:1});assert.equal(ban.ok,true);assert.doesNotMatch(JSON.stringify(ban),forbidden);
  const grant=host.diagnosticsGrant({runId,viewerId:'viewer-1',acknowledgement:consent},authority);
  const detailed=await host.diagnosticsRead({...grant,viewerId:'viewer-1'},authority);
  assert.match(JSON.stringify(detailed),/KALT_PRIVATE_BACKGROUND/);assert.match(JSON.stringify(detailed),/WITHHELD_PRIVATE/);
  assert.equal(detailed.playerHistoryView.records.length,1);assert.equal(detailed.playerHistoryView.records[0].source.runId,runId);
  const metadata=await readFile(join(env.root,'host','host.json'),'utf8');assert.ok(!metadata.includes(grant.grantToken));
  host.close();
});
test('diagnostics require trusted authority and exact acknowledgement; grants bind run/viewer/principal, expire and revoke',async()=>{
  const {host,created,advance}=await environment(),runId=created.runId;
  const req={runId,viewerId:'viewer-1',acknowledgement:consent};
  assert.throws(()=>host.diagnosticsGrant(req),{code:'DIAGNOSTICS_AUTHORIZATION_REQUIRED'});
  assert.throws(()=>host.diagnosticsGrant({...req,acknowledgement:'yes'},authority),{code:'DIAGNOSTICS_AUTHORIZATION_REQUIRED'});
  const grant=host.diagnosticsGrant(req,authority),read={...grant,viewerId:req.viewerId};
  await assert.rejects(host.diagnosticsRead({...read,viewerId:'other'},authority),{code:'DIAGNOSTICS_DENIED'});
  await assert.rejects(host.diagnosticsRead(read,{...authority,principal:'other'}),{code:'DIAGNOSTICS_DENIED'});
  const another=await host.createRun({snapshot});await assert.rejects(host.diagnosticsRead({...read,runId:another.runId},authority),{code:'DIAGNOSTICS_DENIED'});
  host.diagnosticsRevoke(read,authority);await assert.rejects(host.diagnosticsRead(read,authority),{code:'DIAGNOSTICS_DENIED'});
  const timed={...host.diagnosticsGrant(req,authority),viewerId:req.viewerId};advance();await assert.rejects(host.diagnosticsRead(timed,authority),{code:'DIAGNOSTICS_DENIED'});
  const last={...host.diagnosticsGrant(req,authority),viewerId:req.viewerId};host.close();await assert.rejects(host.diagnosticsRead(last,authority),{code:'DIAGNOSTICS_DENIED'});
});
test('grant revoked during a slow diagnostic read cannot return its private payload',async()=>{
  const {host,created}=await environment(),runId=created.runId;
  const req={...host.diagnosticsGrant({runId,viewerId:'viewer-1',acknowledgement:consent},authority),viewerId:'viewer-1'};
  const inspect=host.engine.inspect.bind(host.engine);let release,entered;const pending=new Promise(r=>entered=r);
  host.engine.inspect=async id=>{entered();await new Promise(r=>release=r);return inspect(id);};
  const reading=host.diagnosticsRead(req,authority);await pending;host.diagnosticsRevoke(req,authority);release();
  await assert.rejects(reading,{code:'DIAGNOSTICS_DENIED'});host.close();
});
test('private opening metadata is absent from ordinary snapshots; cancellation during detail read returns no payload',async()=>{
  const projected=publicSnapshot({...snapshot,opening:{id:'one',title:'Public opening',text:'A quiet room.',private:{note:'OPENING_SECRET'}}});
  assert.equal(projected.opening.text,'A quiet room.');assert.ok(!JSON.stringify(projected).includes('OPENING_SECRET'));
  const {host,created}=await environment(),runId=created.runId;
  const request={action:'diagnosticsRead',...host.diagnosticsGrant({runId,viewerId:'viewer-1',acknowledgement:consent},authority),viewerId:'viewer-1'};
  const inspect=host.engine.inspect.bind(host.engine);let release,entered;const pending=new Promise(r=>entered=r);
  host.engine.inspect=async id=>{entered();await new Promise(r=>release=r);return inspect(id);};
  const controller=new AbortController(),reading=host.request(request,controller.signal,authority);await pending;controller.abort();release();
  const result=await reading;assert.equal(result.ok,false);assert.equal(result.error.code,'CANCELLED');assert.equal(result.value,undefined);assert.doesNotMatch(JSON.stringify(result),forbidden);host.close();
});
test('isolated diagnostics enforce Origin and CSRF; read grant never substitutes for the original transport authority',async()=>{
  const {root,host}=await environment();host.close();
  const server=await startServer({scripted:true,port:0,dataRoot:join(root,'server'),gatePath:join(root,'fake-gate.jsonl')});
  try{
    const post=async(body,origin,token=server.token)=>(await(await fetch(server.origin+'/api',{method:'POST',headers:{'Content-Type':'application/json','X-Scean-Token':token,...origin?{Origin:origin}:{}},body:JSON.stringify(body)})).json());
    const created=await server.host.createRun({snapshot});const req={action:'diagnosticsGrant',runId:created.runId,viewerId:'browser-viewer',acknowledgement:consent};
    assert.equal((await post(req)).error.code,'DIAGNOSTICS_ORIGIN_REQUIRED');
    assert.equal((await post(req,server.origin,'invalid')).error.code,'CSRF_DENIED');
    const grant=await post(req,server.origin);assert.equal(grant.ok,true);
    const result=await post({action:'diagnosticsRead',...grant.value,viewerId:'browser-viewer'},server.origin);assert.equal(result.ok,true);assert.equal(result.value.diagnostics.scope,'operator-private');
  }finally{await server.close();}
});
