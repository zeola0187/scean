import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { AuthoringCardService } from '../cardstudio-bundle/lib/authoring-service.js';
import { validateGateRule,evaluateGate,compileGate,partitionDiagnostics } from '../cardstudio-bundle/lib/worldbook-gating.js';
import { compileTarget,TARGET_PROFILE } from '../cardstudio-bundle/lib/target-profile.js';
import { targetInputStamp } from '../cardstudio-bundle/lib/target-state.js';

const fields={progress:{type:'number',min:0,max:100},event_done:{type:'boolean'},location:{type:'string',enum:['garden','hall','shop']},inventory:{type:'array',maxItems:8},clock:{type:'string',maxLength:5},quest_stage:{type:'string',maxLength:40}};
const initial={progress:0,event_done:false,location:'hall',inventory:[],clock:'18:30',quest_stage:'arrival'};
const target={config:{profile:TARGET_PROFILE,namespace:'story_state',fields},definitionDigest:'test-digest'};
const expected={profile:TARGET_PROFILE,digest:'test-digest'};
const snap=(values=initial)=>({profile:TARGET_PROFILE,definition:'test-digest',state:{values},error:null});
const rule=(predicate,partition)=>({schemaVersion:1,predicate,...partition?{partition}: {}});
const cmp=(op,value,path='values.progress')=>({op,path,value});
const evaluate=(r,values)=>evaluateGate(validateGateRule(r,fields),fields,snap(values),expected);
const range=(min,max,includeMax=false)=>rule({op:'range',path:'values.progress',min,max,includeMin:true,includeMax},{id:'stages',path:'values.progress'});

test('numeric partitions cover 29/30/69/70 and relock on decreasing custom progress',()=>{
  const stages=[range(0,30),range(30,70),range(70,100,true)];
  for(const [value,index] of [[29,0],[30,1],[69,1],[70,2],[99,2],[30,1],[0,0],[100,2]])assert.deepEqual(stages.map(r=>evaluate(r,{progress:value}).eligible),stages.map((_,i)=>i===index));
  const card={data:{character_book:{entries:stages.map((r,i)=>({id:i,enabled:true}))}}};
  const authoring={target,gating:{entries:stages.map((r,i)=>({cardEntryId:i,entryId:'id:'+i,rule:r}))}};
  assert.deepEqual(partitionDiagnostics(card,authoring),[]);
  authoring.gating.entries[0].rule=range(0,31);
  assert.ok(partitionDiagnostics(card,authoring).some(d=>d.code==='GATE_PARTITION_OVERLAP'&&d.value===30));
  authoring.gating.entries[0].rule=range(0,29);
  assert.ok(partitionDiagnostics(card,authoring).some(d=>d.code==='GATE_PARTITION_GAP'&&d.value===29));
});

test('boolean, enum/string, set and string-array operators use exact types',()=>{
  const cases=[
    [rule(cmp('eq',true,'values.event_done')),{event_done:true},true],
    [rule(cmp('eq',true,'values.event_done')),{event_done:'true'},false],
    [rule(cmp('eq','chapter_2','values.quest_stage')),{quest_stage:'chapter_2'},true],
    [rule({op:'in',path:'values.location',values:['garden','shop']}),{location:'garden'},true],
    [rule({op:'in',path:'values.location',values:['garden','shop']}),{location:'hall'},false],
    [rule({op:'contains',path:'values.inventory',value:'key'}),{inventory:['key','map']},true],
    [rule({op:'contains',path:'values.inventory',value:'key'}),{inventory:'key'},false],
  ];
  for(const [r,values,pass] of cases)assert.equal(evaluate(r,values).eligible,pass);
  for(const p of [cmp('gt',true,'values.event_done'),cmp('eq',3,'values.location'),{op:'in',path:'values.inventory',values:['key']},{op:'contains',path:'values.quest_stage',value:'key'},cmp('eq','unknown','values.location')])assert.throws(()=>validateGateRule(rule(p),fields),{code:'GATE_TYPE'});
});

test('missing/wrong types/bounds fail closed including OR; nested rules remain bounded',()=>{
  const r=rule({op:'or',args:[cmp('gte',30),cmp('eq',true,'values.event_done')]});
  assert.equal(evaluate(r,{progress:70}).status,'unknown');
  assert.equal(evaluate(r,{progress:'70',event_done:true}).eligible,false);
  for(const value of [NaN,Infinity,-1,101,null,'30'])assert.equal(evaluate(rule(cmp('gte',30)),{progress:value}).eligible,false);
  assert.equal(evaluate(r,{progress:70,event_done:false}).status,'pass');
  assert.equal(evaluate(rule({op:'and',args:[cmp('gte',30),{op:'or',args:[cmp('eq',true,'values.event_done'),cmp('eq','garden','values.location')]}]}),{progress:40,event_done:false,location:'garden'}).eligible,true);
  let p=cmp('gte',30);for(let i=0;i<4;i++)p={op:'and',args:[p,cmp('gte',0)]};assert.throws(()=>validateGateRule(rule(p),fields),{code:'GATE_LIMIT'});
  assert.throws(()=>validateGateRule(rule({op:'or',args:Array(9).fill(cmp('gte',0))}),fields),{code:'GATE_RULE'});
  for(const path of ['global.progress','chat.progress','values.__proto__','values.constructor','values.progress.x','values.missing'])assert.throws(()=>validateGateRule(rule(cmp('eq',1,path)),fields),{code:'GATE_PATH'});
  assert.throws(()=>validateGateRule({...rule(cmp('eq',1)),permanent:true},fields),{code:'GATE_SCHEMA'});
});

test('HH:mm is optional and strict; half-open windows cross midnight without date assumptions',()=>{
  const night=rule({op:'time_window',path:'values.clock',start:'22:00',end:'06:00'});
  for(const [clock,pass] of [['21:59',false],['22:00',true],['23:59',true],['00:00',true],['05:59',true],['06:00',false],['12:00',false]])assert.equal(evaluate(night,{clock}).eligible,pass);
  for(const clock of ['6:00','24:00','23:60','2026-10-06',600,null])assert.equal(evaluate(night,{clock}).status,'unknown');
  assert.throws(()=>validateGateRule(rule({...night.predicate,start:'06:00'}),fields),{code:'GATE_TIME'});
  assert.throws(()=>validateGateRule(rule({op:'date_after',path:'values.clock',value:'2026-10-06'}),fields),{code:'GATE_OPERATOR'});
});

test('native expression catches lookup exceptions and checks message/scope/digest/freshness once',()=>{
  const r=rule(cmp('gte',30)),source=compileGate(r,target);assert.equal(source.split('\n').length,1);
  const message={mes:'completed response',swipe_id:0},snapshot={...snap({progress:70}),input:{schemaVersion:1,messageId:0,swipeId:0,stamp:targetInputStamp(message.mes)}};
  let calls=0;const context={SillyTavern:{chat:[message]},getvar:(name,options)=>{calls++;assert.equal(name,'story_state');assert.deepEqual(JSON.parse(JSON.stringify(options)),{scope:'message',withMsg:{id:-1},noCache:true,defaults:null});return snapshot;}};
  const run=()=>vm.runInNewContext(source.slice(5),context,{timeout:100});
  assert.equal(run(),true);assert.equal(calls,1);
  message.mes='edited, not yet saved by writer';assert.equal(run(),false);message.mes='completed response';
  snapshot.definition='other-schema';assert.equal(run(),false);snapshot.definition='test-digest';
  snapshot.error='parse error';assert.equal(run(),false);snapshot.error=null;
  snapshot.state.values.progress='70';assert.equal(run(),false);
  context.getvar=()=>{throw Error('lookup failed');};assert.equal(run(),false);
  delete context.getvar;assert.equal(run(),false);
});

const repo=fileURLToPath(new URL('..',import.meta.url)),session='synthetic-gates';
async function setup(t){
  const root=path.join(repo,'test-gates-'+randomUUID());await fs.mkdir(root);const service=new AuthoringCardService(root);await service.init();await service.synchronizeArchiveState([]);
  t.after(async()=>{await service.close();assert.equal(path.dirname(root),path.resolve(repo));await fs.rm(root,{recursive:true,force:true});});
  const op=async(action,args)=>{const r=await service.operation(action,args,undefined,{sessionId:session});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  const {id}=await op('create',{name:'Synthetic variable gates'});
  const mutate=async(action,args)=>op(action,{document_id:id,expected_revision:(await service.load(id)).record.revision,...args});
  await mutate('visual_contract',{action:'create',contract:{characters:{clerk:{}}}});
  const config={...target.config,initialState:{values:initial,characters:{clerk:{expression:'neutral'}}},source:'<p>Plain synthetic status</p>'};
  await mutate('target',{action:'configure',config});
  const add=async(content='Inert lore',extra={})=>{await mutate('book_upsert',{entry:{keys:['door'],content,enabled:true,constant:false,insertion_order:10,extensions:{scan_depth:3,prevent_recursion:true,unknown:{keep:42}},...extra}});return (await service.load(id)).record.entryIds.at(-1);};
  const gate=async(action,entry_id,r)=>{const read=await op('gating',{action:'read',document_id:id,entry_id});return mutate('gating',{action,entry_id,expected_source_hash:read.source_hash,...r?{rule:r}:{}});};
  return {root,service,id,op,mutate,add,gate,config};
}

test('stable-ID gate edits preserve entry/book metadata, export bytes and joint rollback',async t=>{
  const {root,service,id,op,mutate,add,gate}=await setup(t),entry_id=await add('Keep {{user}} exactly.');
  await mutate('book_patch_config',{changes:{scan_depth:7,token_budget:512,recursive_scanning:true,extensions:{book_unknown:'keep'}}});
  const before=await service.state(id),original=(await op('book_read',{document_id:id,entry_id})).entry;
  await gate('create',entry_id,rule(cmp('eq',true,'values.event_done')));
  const active=await service.state(id),read=await op('gating',{action:'read',document_id:id,entry_id});
  assert.deepEqual({...read.entry,content:original.content},original);
  assert.deepEqual(active.decoded.card.data.character_book.extensions,before.decoded.card.data.character_book.extensions);
  const simulation=await op('gating',{action:'evaluate',document_id:id,values:{event_done:true}});
  assert.equal(simulation.entries.find(e=>e.entry_id===entry_id).status,'pass');assert.equal(simulation.fixtureOnly,true);assert.match(simulation.coverage,/not|still apply/);
  const exported=await mutate('export_target',{name:'conditions'});assert.equal(exported.ready,true);assert.equal(exported.runtimeVerified,false);
  assert.deepEqual(await fs.readFile(path.join(root,exported.path,exported.card)),Buffer.from(active.record.bytes,'base64'));
  await gate('patch',entry_id,rule(cmp('eq',false,'values.event_done')));
  assert.equal((await op('gating',{action:'evaluate',document_id:id,values:{event_done:true}})).entries.find(e=>e.entry_id===entry_id).status,'fail');
  await mutate('rollback',{to:active.record.revision});assert.deepEqual((await service.state(id)).authoring.gating,active.authoring.gating);
  await gate('remove',entry_id);assert.deepEqual((await op('book_read',{document_id:id,entry_id})).entry,original);
  await mutate('rollback',{to:before.record.revision});assert.equal((await service.state(id)).authoring.gating,undefined);
});

test('foreign EJS/decorators, stale hashes and hand edits never silently become certified',async t=>{
  const {service,id,op,mutate,add,gate}=await setup(t);
  for(const content of ['@@if userCode()\nUnknown','<% if (unknown) { %>Lore<% } %>','@@activate\nExisting']){
    const entry_id=await add(content),read=await op('gating',{action:'read',document_id:id,entry_id});assert.equal(read.readOnly,true);
    const r=await service.operation('gating',{action:'create',document_id:id,expected_revision:read.revision,entry_id,expected_source_hash:read.source_hash,rule:rule(cmp('gte',30))},undefined,{sessionId:session});assert.equal(r.error.code,'GATE_FOREIGN_SOURCE');
  }
  const entry_id=await add(),read=await op('gating',{action:'read',document_id:id,entry_id});
  let r=await service.operation('gating',{action:'create',document_id:id,expected_revision:read.revision,entry_id,expected_source_hash:'bad',rule:rule(cmp('gte',30))},undefined,{sessionId:session});assert.equal(r.error.code,'GATE_SOURCE_CONFLICT');
  await gate('create',entry_id,rule(cmp('gte',30)));
  r=await service.operation('gating',{action:'remove',document_id:id,expected_revision:read.revision,entry_id,expected_source_hash:read.source_hash},undefined,{sessionId:session});assert.equal(r.error.code,'REVISION_CONFLICT');
  const protectedRevision=(await service.load(id)).record.revision;
  r=await service.operation('book_patch',{document_id:id,expected_revision:protectedRevision,entry_id,changes:{content:'@@if true\nUnauthorized replacement'}},undefined,{sessionId:session});assert.equal(r.error.code,'GATE_MANAGED_BODY');assert.equal((await service.load(id)).record.revision,protectedRevision);
  await service.commit(id,protectedRevision,card=>{card.data.character_book.entries.find(e=>e.id===Number(entry_id.slice(3))).content='@@if true\nUnauthorized replacement';},'synthetic external damage');
  const check=await op('target',{action:'check',document_id:id});assert.equal(check.ready,false);assert.ok(check.diagnostics.some(d=>d.code==='GATE_SOURCE_CONFLICT'));assert.ok(check.diagnostics.some(d=>d.code==='GATE_UNMANAGED'));
  r=await service.operation('export_target',{document_id:id,expected_revision:(await service.load(id)).record.revision},undefined,{sessionId:session});assert.equal(r.error.code,'TARGET_NOT_READY');
  const backup=await mutate('export_backup',{name:'preserve.json'});assert.equal(backup.ready,false);assert.ok(backup.diagnostics.some(d=>d.code==='GATE_UNMANAGED'));
});

test('single existing writer saves completed snapshots; gates change only after the next snapshot update',async t=>{
  const {service,id,config}=await setup(t),authoring=(await service.state(id)).authoring,compiled=compileTarget(config,authoring);
  const r=rule(cmp('gte',30)),expression=compileGate(r,authoring.target).slice(5),events=new Map();let messages=[{role:'assistant',message:'Opening',data:{}}];
  const ctx={console,SillyTavern:{getCurrentChatId:()=>session,saveChat:async()=>{},get chat(){return messages.map(m=>({mes:m.message,swipe_id:0}));}},getLastMessageId:()=>messages.length-1,getVariables:({message_id})=>messages[message_id].data,getChatMessages:id=>messages[id]?[messages[id]]:[],setChatMessages:async writes=>{for(const w of writes)messages[w.message_id].data=structuredClone(w.data);},eventOn:(name,fn)=>{events.set(name,fn);return {stop(){}};},eventEmit:async()=>{},tavern_events:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_UPDATED','MESSAGE_SWIPED','CHAT_CHANGED'].map(x=>[x,x])),window:{addEventListener(){}},getvar:()=>messages.at(-1).data.story_state};
  vm.runInNewContext(compiled.script.content,ctx);await new Promise(r=>setTimeout(r,5));const run=()=>vm.runInNewContext(expression,ctx);assert.equal(run(),false);
  messages.push({role:'assistant',message:'Reply<state-update>{"values":{"progress":70}}</state-update>',data:{}});assert.equal(run(),false,'not completed by writer yet');await events.get('MESSAGE_RECEIVED')(1);assert.equal(run(),true);
  messages.push({role:'user',message:'Next question',data:{}});assert.equal(run(),false);await events.get('MESSAGE_SENT')(2);assert.equal(run(),true,'inherits completed prior state');
  messages.push({role:'assistant',message:'Return<state-update>{"values":{"progress":29}}</state-update>',data:{}});assert.equal(run(),false);await events.get('MESSAGE_RECEIVED')(3);assert.equal(run(),false,'relocks after decline');
  messages[3].message='Edited<state-update>{"values":{"progress":70}}</state-update>';assert.equal(run(),false,'stale source stamp');await events.get('MESSAGE_UPDATED')(3);assert.equal(run(),true);
  messages[3].message='Broken<state-update>{not json}</state-update>';await events.get('MESSAGE_UPDATED')(3);assert.equal(run(),false,'parse error is not eligible even with a previous high value');
});

test('partition gaps block certification until repaired; custom entry edits and stale definitions are diagnosed',async t=>{
  const {service,id,op,mutate,add,gate}=await setup(t),first=await add('Early stage');
  await gate('create',first,range(0,30));
  assert.ok((await op('target',{document_id:id,action:'check'})).diagnostics.some(d=>d.code==='GATE_PARTITION_GAP'));
  const middle=await add('Middle stage'),last=await add('Late stage');await gate('create',middle,range(30,70));await gate('create',last,range(70,100,true));
  assert.equal((await op('target',{document_id:id,action:'check'})).ready,true);
  await mutate('book_patch',{entry_id:middle,changes:{extensions:{unknown:{added:true}},keys:['new keyword']}});
  assert.equal((await op('target',{document_id:id,action:'check'})).ready,true,'unrelated metadata stays editable');
  await gate('patch',first,range(0,31));assert.ok((await op('target',{document_id:id,action:'check'})).diagnostics.some(d=>d.code==='GATE_PARTITION_OVERLAP'));
  const state=await service.state(id),{checkGates}=await import('../cardstudio-bundle/lib/worldbook-gating.js');state.authoring.target.definitionDigest='another-definition';
  assert.ok(checkGates(state.decoded.card,state.authoring).some(d=>d.code==='GATE_STALE'));
  const invalid=await op('gating',{document_id:id,action:'evaluate',snapshot:{profile:TARGET_PROFILE,definition:'another-definition',state:{values:initial},error:null}});
  assert.ok(invalid.entries.filter(e=>[first,middle,last].includes(e.entry_id)).every(e=>e.status==='unknown'&&!e.eligible));
});

test('compound and membership limits reject oversized rules and hostile strings remain inert data',()=>{
  const many={op:'and',args:Array.from({length:8},()=>({op:'and',args:Array.from({length:4},()=>cmp('gte',0))}))};
  assert.throws(()=>validateGateRule(rule(many),fields),{code:'GATE_LIMIT'});
  assert.throws(()=>validateGateRule(rule({op:'in',path:'values.quest_stage',values:Array.from({length:17},(_,i)=>String(i))}),fields),{code:'GATE_TYPE'});
  const text='\");globalThis.pwned=true;//{{setvar::x::y}}<%';
  const r=rule(cmp('eq',text,'values.quest_stage')),custom={...target,config:{...target.config,fields:{...fields,quest_stage:{type:'string',maxLength:256}}}};
  const source=compileGate(r,custom);assert.doesNotMatch(source,/\{\{|<%/);
  const message={mes:'synthetic'},snapshot={...snap({quest_stage:text}),input:{schemaVersion:1,messageId:0,swipeId:0,stamp:targetInputStamp(message.mes)}};
  const ctx={getvar:()=>snapshot,SillyTavern:{chat:[message]}};assert.equal(vm.runInNewContext(source.slice(5),ctx),true);assert.equal(ctx.pwned,undefined);
});
