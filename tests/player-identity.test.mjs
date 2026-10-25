import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {buildSavedSnapshot} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {playerName,bindPlayerIdentity,openingDisplay} from '../core/player-identity.mjs';
import {resolvePlayerText,projectPlayerCard,projectTemplateText} from '../core/player-text.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash,clone} from '../core/contracts.mjs';
import {selectWorldbooks} from '../core/worldbook.mjs';
import {renderFrontendDocument} from '../isolated/web/frontend-runtime.mjs';
const code=expected=>error=>error.code===expected;
const source=(alternates=['Alt {{user}}.'])=>({id:'name-card',type:'card',revision:0,sha256:'synthetic-saved-sha',card:{data:{name:'Title {{user}}',description:'Description {{user}}.',personality:'Kind to {{user}}.',scenario:'Meet {{user}}.',first_mes:'Hello {{user}}.',alternate_greetings:alternates,group_only_greetings:['Group {{user}}.'],mes_example:'Example {{user}}.',creator_notes:'Note {{user}}.',system_prompt:'Data for {{user}}.',post_history_instructions:'For {{user}}.',extensions:{unknown:{script:'{{user}}'},scean:{characters:[{id:'guide',name:'Guide',description:'Own {{user}}.',publicDescription:'Public {{user}}.',relationships:'Knows {{user}}.',private:{secret:'PRIVATE_SENTINEL {{user}}'}}]}},character_book:{entries:[]}}}});
function scripted(options={}){
  const calls=[];return {calls,describe:async()=>({capabilities:{contextWindow:128000,outputLimit:4096}}),async generate(args){
    calls.push(clone(args));await options.before?.(args);
    const {stage,input}=args;
    if(stage==='director')return options.tools&&!input.conversation.length?{text:'',toolCalls:[{id:'c1',name:'consult_character',arguments:{characterId:'guide',question:'Ask {{user}}.'}},{id:'a1',name:'adjudicate_action',arguments:{action:'Check {{user}}.',mode:'query'}}]}:{text:'Quiet scene.'};
    if(stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:'guide',observable:{attitude:'calm',intent:''},publicUtterances:[],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
    if(stage==='adjudicate')return {text:'No new event.'};
    if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};
    if(stage==='prose_repair')return {text:JSON.stringify({bodyHash:input.bodyHash,edits:input.ranges.map(r=>({start:r.start,end:r.end,replacement:r.text.replace('badword','quietly')}))})};
    return {text:options.body??'{{user}} waits badword.'};
  }};
}
async function fixture(t,options={}){
  const parent=new URL('../.test-data/',import.meta.url);await mkdir(parent,{recursive:true});const root=await mkdtemp(new URL('player-name-',parent));
  const model=scripted(options),store=new DurableStore({root:join(root,'store')}),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()});
  let host=await new SceanHost({engine,root:join(root,'host')}).init();
  const saved=source(options.alternates),snapshot=buildSavedSnapshot(saved);
  const scope={provider:snapshot.source.provider,cardId:saved.id,authoringSessionId:'name-session',generation:'name-generation',savedRevision:0,savedSha256:saved.sha256};
  const authority={principal:'synthetic-operator',allowGlobalSettings:true,allowPrivateSaves:true,requireCardScope:true,resolveCardScope:async()=>scope};
  const call=async(action,payload={},signal)=>{const response=await host.request({action,sessionId:scope.authoringSessionId,cardScope:scope,...payload},signal,authority);if(!response.ok)throw Object.assign(Error(response.error.message),response.error);return response.value;};
  t.after(()=>host.close());
  return {root,engine,store,model,saved,snapshot,scope,authority,call,get host(){return host;},async restart(){await host.close();host=await new SceanHost({engine,root:join(root,'host')}).init();},async offer(){await host.startFromStudio({snapshot,authoringSessionId:scope.authoringSessionId,generation:scope.generation});return call('openingOffer');},choice:o=>({offerId:o.offerId,cardId:o.cardId,revision:o.revision,snapshotHash:o.snapshotHash,openingIndex:0,playerName:'合成旅人'})};
}
test('bounded Unicode names and one-pass literal projection preserve unknown macros and non-text fields',()=>{
  const name='小雨 $& <img src=x onerror=alert(1)> "';assert.equal(playerName(' '+name+' '),name);
  assert.equal(resolvePlayerText('{{user}} / {{user}} / {{char}} / {{random::x}}',name),name+' / '+name+' / {{char}} / {{random::x}}');
  for(const bad of ['', ' '.repeat(3),'x'.repeat(81),'x\ny','\ud800','{{user}}'])assert.throws(()=>playerName(bad),code('INVALID_PLAYER_NAME'));
  const raw=source().card,projected=projectPlayerCard(raw,name);assert.equal(projected.data.name,raw.data.name);assert.equal(projected.data.extensions.unknown.script,'{{user}}');assert.equal(raw.data.description,'Description {{user}}.');assert.equal(projected.data.description,'Description '+name+'.');
  assert.equal(projectTemplateText('<p title="{{user}}">Hi {{user}}</p><!-- {{user}} --><script>{{user}}</script>',name),'<p title="{{user}}">Hi '+name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;')+'</p><!-- {{user}} --><script>{{user}}</script>');
  assert.equal(projectTemplateText('<p title="broken>{{user}}',name),'<p title="broken>{{user}}');
  const html=renderFrontendDocument({safeCss:'',conditions:{},tree:[{tag:'p',attrs:{},children:[{text:'{{user}} <img>'}]}]},{values:{},freshness:'current',canonical:{version:0}});
  assert(html.includes('{{user}} &lt;img&gt;'));assert(!html.includes('<img>'));
});
test('single and multiple openings always confirm a name; defaults and per-Run override survive restart',async t=>{
  for(const alternates of [[],['Alternative {{user}}.']]){
    const f=await fixture(t,{alternates});
    await assert.rejects(f.call('playerDefaultsSave',{name:'預設旅人',operationId:'defaults-denied',expectedRevision:0},AbortSignal.abort()),()=>true);
    const save={name:'預設旅人',operationId:'defaults-one',expectedRevision:0};assert.equal((await f.call('playerDefaultsSave',save)).revision,1);assert.equal((await f.call('playerDefaultsSave',save)).revision,1);
    const o=await f.offer();assert.equal(o.options.length,1+alternates.length);assert.equal(o.defaultPlayerName,'預設旅人');assert.equal((await f.store.listRuns()).length,0);
    await assert.rejects(f.call('openingStart',{...f.choice(o),playerName:''}),code('INVALID_PLAYER_NAME'));
    const choice={...f.choice(o),openingIndex:alternates.length?1:0,playerName:'逐局旅人'},created=await f.call('openingStart',choice),run=await f.store.read(created.runId);
    assert.equal(run.playerIdentity.name,'逐局旅人');assert.equal(run.snapshot.card.data.first_mes,'Hello {{user}}.');assert.equal(openingDisplay(run),alternates.length?'Alternative 逐局旅人.':'Hello 逐局旅人.');
    assert.deepEqual(await f.call('openingStart',choice),created);await assert.rejects(f.call('openingStart',{...choice,playerName:'另一個名字'}),code('OPENING_ALREADY_STARTED'));
    await f.call('playerDefaultsSave',{name:'新的預設',expectedRevision:1,operationId:'defaults-two'});await f.restart();
    assert.equal((await f.call('playerDefaults')).name,'新的預設');assert.equal((await f.call('runView',{runId:run.runId})).playerIdentity.name,'逐局旅人');
  }
});
test('all seven stage payloads project only explicit text, retain scopes, and commit resolved prose before bans and PostStat',async t=>{
  const f=await fixture(t,{tools:true}),snapshot=clone(f.snapshot);snapshot.worldbook={entries:[{id:'named',enabled:true,keys:['{{user}}'],content:'Book {{user}}.'},{id:'private',constant:true,content:'PRIVATE_BOOK',visibility:'private'}]};delete snapshot.hash;
  const run=await f.engine.createRun({snapshot,playerName:'小雨 $& <img>',banList:['badword']});const frozen=clone(run.snapshot);
  await f.host.refreshRuns();const result=await f.call('turn',{runId:run.runId,input:'小雨 $& <img> arrives; literal {{user}}.',requestId:'name-turn'});
  assert.equal(result.body,'小雨 $& <img> waits quietly.');const after=await f.store.read(run.runId);assert.equal(after.turns[0].bodyHash,hash(result.body));assert.deepEqual(after.snapshot,frozen);assert.equal(after.turns[0].input,'小雨 $& <img> arrives; literal {{user}}.');
  for(const stage of ['director','draft','prose','prose_repair','character','adjudicate','post_stat']){
    const call=f.model.calls.find(c=>c.stage===stage);assert(call,stage);assert.equal(call.input.playerIdentity.actorId,'player');assert.equal(call.input.playerIdentity.name,run.playerIdentity.name);
  }
  const assembly=f.model.calls.find(c=>c.stage==='director').input.assembly;
  assert.equal(assembly.sources.card.data.description,'Description 小雨 $& <img>.');assert.equal(assembly.sources.worldbook.entries[0].content,'Book 小雨 $& <img>.');assert(!JSON.stringify(assembly).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(assembly).includes('PRIVATE_BOOK'));
  const owner=f.model.calls.find(c=>c.stage==='character').input;assert.equal(owner.character.description,'Own 小雨 $& <img>.');assert(owner.character.private.secret.includes('PRIVATE_SENTINEL'));assert.equal(owner.character.id,'guide');
  assert.equal(f.model.calls.find(c=>c.stage==='post_stat').input.finalBody,result.body);
  assert.equal(f.model.calls.find(c=>c.stage==='post_stat').input.outputContract.npcStateIds.includes('player'),false);
});
test('worldbook primary/secondary keys resolve literally, including regex-looking names, without changing raw hashes',()=>{
  const snapshot=buildSavedSnapshot(source()),before=hash(snapshot);snapshot.worldbook={entries:[{id:'k',keys:['{{user}}'],secondary_keys:['{{user}}'],selective:true,enabled:true,content:'Hello {{user}}.'}]};
  const raw=hash(snapshot);const selected=selectWorldbooks(snapshot,{playerName:'/name/',playerInput:'/name/ arrives'});assert.equal(selected.entries[0].content,'Hello /name/.');assert.equal(hash(snapshot),raw);assert(before);
  snapshot.worldbook.entries[0].keys=['/authored.*/'];assert.equal(selectWorldbooks(snapshot,{playerName:'name',playerInput:'authored'}).diagnostics.entries[0].reason,'unsupported_regex');
});
test('legacy adoption is explicit, once-only, idempotent, head/version-bound and portable; no historical hashes change',async t=>{
  const f=await fixture(t),run=await f.engine.createRun({snapshot:f.snapshot});await f.host.refreshRuns();
  await f.call('turn',{runId:run.runId,requestId:'legacy-first',input:'Original {{user}}.'});const before=await f.store.read(run.runId),legacy=encodeRunBundle(before);assert.equal(legacy.schemaVersion,9);assert.equal(validateRunBundle(legacy).playerIdentity,undefined);
  const request={runId:run.runId,name:'補設旅人',operationId:'bind-one',expectedVersion:before.version,expectedHead:before.head};
  await assert.rejects(f.call('playerBind',{...request,expectedVersion:0}),code('VERSION_CONFLICT'));
  await assert.rejects(f.call('playerBind',{...request,expectedHead:null}),code('HISTORY_HEAD_CONFLICT'));
  await assert.rejects(f.call('playerBind',request,AbortSignal.abort()),()=>true);assert.equal((await f.store.read(run.runId)).playerIdentity,undefined);
  const result=await f.call('playerBind',request);assert.deepEqual(await f.call('playerBind',request),result);
  await assert.rejects(f.call('playerBind',{...request,name:'Different'}),code('IDEMPOTENCY_CONFLICT'));await assert.rejects(f.call('playerBind',{...request,operationId:'bind-two'}),code('PLAYER_NAME_ALREADY_BOUND'));
  const named=await f.store.read(run.runId);for(const key of ['snapshot','turns','state','memories','playerHistory','receipts','head'])assert.deepEqual(named[key],before[key],key);
  assert.equal(openingDisplay(named),'Hello {{user}}.');const bundle=encodeRunBundle(named);assert.equal(bundle.schemaVersion,9);assert.deepEqual(encodeRunBundle(validateRunBundle(bundle)),bundle);
  for(const mutate of [b=>b.schemaVersion=1,b=>delete b.run.playerIdentity,b=>b.run.playerIdentity.extra='bad',b=>b.run.playerIdentity.adoption.fingerprint='0'.repeat(64)]){const bad=clone(bundle);mutate(bad);bad.manifest.sha256=hash(bad.run);assert.throws(()=>validateRunBundle(bad));}
  await f.restart();assert.equal((await f.call('runView',{runId:run.runId})).playerIdentity.name,'補設旅人');
  await f.call('turn',{runId:run.runId,requestId:'named-next',input:'Next.'});const next=await f.store.read(run.runId);assert.equal(next.turns[0].body,before.turns[0].body);assert(next.turns[1].body.includes('補設旅人'));
});
test('competing bindings have one winner; publication uncertainty replays the accepted binding',async t=>{
  const f=await fixture(t),run=await f.engine.createRun({snapshot:f.snapshot});await f.host.refreshRuns();
  const q={runId:run.runId,name:'First',operationId:'race-one',expectedVersion:0,expectedHead:null};const results=await Promise.allSettled([f.call('playerBind',q),f.call('playerBind',{...q,name:'Second',operationId:'race-two'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.store.read(run.runId)).version,1);
  const r=await f.engine.createRun({snapshot:f.snapshot});const original=f.store.commit.bind(f.store);f.store.commit=async(...args)=>{await original(...args);throw Object.assign(Error('lost reply'),{code:'COMMIT_OUTCOME_UNKNOWN'});};
  const args={runId:r.runId,name:'Recovered',operationId:'uncertain-bind',expectedVersion:0,expectedHead:null};assert.equal((await bindPlayerIdentity(f.engine,args)).playerIdentity.name,'Recovered');assert.equal((await bindPlayerIdentity(f.engine,args)).version,1);
});
test('active/cancelling generation blocks adoption; cancelled input cannot silently retry under a new binding; rollback/regenerate preserve identity',async t=>{
  let entered,release;const enteredPromise=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const f=await fixture(t,{before:async args=>{if(args.stage==='director'&&args.context.requestId==='cancel-first'){entered();await gate;}}}),run=await f.engine.createRun({snapshot:f.snapshot});await f.host.refreshRuns();
  const turn=f.call('turn',{runId:run.runId,requestId:'cancel-first',input:'Wait.'});await enteredPromise;
  const binding={runId:run.runId,name:'After cancel',operationId:'after-cancel',expectedVersion:0,expectedHead:null};await assert.rejects(f.call('playerBind',binding),code('RUN_BUSY'));
  assert.equal(f.host.cancel({runId:run.runId,operationId:f.host.activeOperations.get(run.runId).operationId}).cancelRequested,true);release();await assert.rejects(turn);await f.call('playerBind',binding);
  await assert.rejects(f.call('turn',{runId:run.runId,requestId:'cancel-first',input:'Wait.'}),code('PLAYER_CONTEXT_CHANGED'));
  await f.call('turn',{runId:run.runId,requestId:'after-bind-turn',input:'Wait.'});let current=await f.store.read(run.runId);const identity=clone(current.playerIdentity);
  await f.call('regenerate',{runId:run.runId,confirmed:true,operationId:'regen-name',requestId:'regen-name-request',expectedVersion:current.version,expectedHead:current.head});current=await f.store.read(run.runId);assert.deepEqual(current.playerIdentity,identity);
  await f.call('rollback',{runId:run.runId,confirmation:'rollback-last-committed-turn',operationId:'rollback-name',expectedVersion:current.version,expectedHead:current.head});current=await f.store.read(run.runId);assert.deepEqual(current.playerIdentity,identity);assert.equal(current.turns.length,0);assert.equal(validateRunBundle(encodeRunBundle(current)).playerIdentity.name,'After cancel');
});
test('authenticated defaults and card-scoped binding cannot be changed by untrusted or unrelated callers',async t=>{
  const f=await fixture(t),run=await f.engine.createRun({snapshot:f.snapshot});await f.host.refreshRuns();
  assert.equal((await f.host.request({action:'playerDefaultsSave',name:'bad',operationId:'bad',expectedRevision:0})).error.code,'PLAYER_SETTINGS_DENIED');
  const other={...f.scope,cardId:'other'};const response=await f.host.request({action:'playerBind',runId:run.runId,sessionId:f.scope.authoringSessionId,cardScope:other,name:'bad',operationId:'bad',expectedVersion:0,expectedHead:null},undefined,f.authority);assert.equal(response.ok,false);assert.equal((await f.store.read(run.runId)).playerIdentity,undefined);
});

test('authenticated v4 backup imports into a distinct store and resumes; legacy v1 remains unnamed',async t=>{
 const first=await fixture(t),second=await fixture(t),named=await first.engine.createRun({snapshot:first.snapshot,playerName:'Portable name'});await first.host.refreshRuns();
 const exported=await first.call('exportRun',{runId:named.runId,acknowledgement:'export-private-run-data'});assert.equal(exported.schemaVersion,9);
 const imported=await second.call('importRun',{bundle:exported,acknowledgement:'import-private-run-data'});assert.equal(imported.runId,named.runId);assert.equal((await second.call('runView',{runId:named.runId})).playerIdentity.name,'Portable name');
 await second.call('turn',{runId:named.runId,input:'Continue.',requestId:'portable-turn'});assert((await second.store.read(named.runId)).turns[0].body.startsWith('Portable name'));
 const old=await first.engine.createRun({snapshot:first.snapshot});await first.host.refreshRuns();const legacy=await first.call('exportRun',{runId:old.runId,acknowledgement:'export-private-run-data'});assert.equal(legacy.schemaVersion,9);
 await second.call('importRun',{bundle:legacy,acknowledgement:'import-private-run-data'});assert.equal((await second.call('runView',{runId:old.runId})).playerIdentity,undefined);
});
