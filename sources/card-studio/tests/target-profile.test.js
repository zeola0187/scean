import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { AuthoringCardService } from '../cardstudio-bundle/lib/authoring-service.js';
import { TARGET_PROFILE,compileTarget } from '../cardstudio-bundle/lib/target-profile.js';
import { sha } from '../cardstudio-bundle/lib/codec.js';
import { sixSyntheticRasters } from './helpers/synthetic-assets.js';

const repo=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const session='synthetic-target-session';
const config={profile:TARGET_PROFILE,namespace:'clerk_state',fields:{affection:{type:'number',min:0,max:100,bands:[{min:0,label:'初識'},{min:70,label:'親近'}]},time:{type:'string',maxLength:5},outfit:{type:'string',enum:['uniform','casual']}},initialState:{values:{affection:6,time:'18:30',outfit:'uniform'},characters:{clerk:{expression:'neutral'}}},source:'<section><style>section{padding:24px}img{width:96px}</style><h2>運動用品店</h2><img data-character-id="clerk" alt="表情"><p>好感：{{sample_label::affection}}</p><p>{{sample::time}} / {{sample::outfit}}</p></section>'};
async function setup(t){const root=path.join(repo,'test-target-'+randomUUID());await fs.mkdir(root);const service=new AuthoringCardService(root);await service.init();await service.synchronizeArchiveState([]);t.after(async()=>{await service.close();assert.equal(path.dirname(path.resolve(root)),repo);await fs.rm(root,{recursive:true,force:true});});const op=async(action,args)=>{const r=await service.operation(action,args,undefined,{sessionId:session});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};const c=await op('create',{name:'合成成年店員',description:'26歲運動用品店店員，外向但面對真誠稱讚會害羞。',first_mes:'歡迎光臨。',alternate_greetings:['晚安，來看看跑鞋嗎？','今天想練哪個項目？']});const id=c.id;const mutate=async(action,args)=>op(action,{document_id:id,expected_revision:(await service.load(id)).record.revision,...args});await mutate('visual_contract',{action:'create',contract:{characters:{clerk:{dimensions:{outfit:['uniform','casual']}}}}});for(const raster of sixSyntheticRasters()){const upload=await mutate('asset_upload_begin',{name:raster.expression+'.png',size:raster.bytes.length});await op('asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:raster.bytes.toString('base64')});const a=await op('asset_upload_finish',{upload_id:upload.upload_id});await mutate('asset',{action:'link',asset_id:a.asset_id,character_id:'clerk',expression:raster.expression});}return {root,service,op,mutate,id};}

test('target creates native content, preserves metadata, local edit, safe preview and immutable delivery',async t=>{
  const {root,service,op,mutate,id}=await setup(t);
  await mutate('patch',{patches:[{op:'add',path:'/data/extensions/opaque',value:{keep:'yes'}},{op:'add',path:'/data/extensions/tavern_helper',value:{variables:{untouched:42},future:{keep:true},scripts:[]}}]});
  await mutate('target',{action:'configure',config});let state=await service.state(id);assert.deepEqual(state.decoded.card.data.extensions.opaque,{keep:'yes'});assert.equal(state.decoded.card.data.extensions.tavern_helper.variables.untouched,42);assert.equal(state.decoded.card.data.alternate_greetings.length,2);
  assert.equal((await op('target',{document_id:id,action:'check'})).ready,true);
  assert.equal(state.decoded.card.data.extensions.tavern_helper.scripts.length,1);assert.equal(state.decoded.card.data.extensions.regex_scripts.length,2);assert.match(state.decoded.card.data.character_book.entries[0].content,/scope:"message"/);
  await mutate('target',{action:'patch',expected_source_hash:sha(config.source),old_text:'width:96px',new_text:'width:180px'});
  const fixture={schemaVersion:1,fixtureId:'default',bindings:config.fields,values:{affection:92,time:'21:10',outfit:'casual'}};await mutate('fixture',{action:'patch',fixture});
  const preview=await op('preview',{document_id:id,component_id:'target',viewport:390});assert.match(preview.html,/width:180px/);assert.match(preview.html,/親近/);assert.doesNotMatch(preview.html,/<script\b/);assert.equal(preview.capabilities.cardJavaScript,false);
  state=await service.state(id);const bundle=await mutate('export_target',{name:'synthetic-target'});assert.equal(bundle.ready,true);assert.equal(bundle.runtimeVerified,false);assert.deepEqual(await fs.readFile(path.join(root,bundle.path,bundle.card)),Buffer.from(state.record.bytes,'base64'));assert.equal((await service.state(id)).record.revision,state.record.revision);
  for(const f of bundle.files)assert.equal(sha(await fs.readFile(path.join(root,bundle.path,f.name))),f.sha256);
  const manifest=JSON.parse(await fs.readFile(path.join(root,bundle.path,'assets-manifest.json'),'utf8'));assert.equal(manifest.assets.length,6);assert.ok(manifest.assets.every(a=>/^[a-f0-9]{64}\.png$/.test(a.filename)));
  const writer=state.decoded.card.data.extensions.tavern_helper.scripts[0];await mutate('target_source',{action:'patch',kind:'script',content_id:writer.id,expected_source_hash:sha(writer.content),old_text:'// Character-owned',new_text:'// Custom character-owned'});
  assert.equal((await op('target',{document_id:id,action:'check'})).ready,false);const blocked=await service.operation('export_target',{document_id:id,expected_revision:(await service.load(id)).record.revision},undefined,{sessionId:session});assert.equal(blocked.error.code,'TARGET_NOT_READY');await mutate('export_backup',{name:'raw.json'});
});

test('target rejects unresolved binders, unsafe template, missing assets and stale maps without mutating source',async t=>{
  const {service,op,mutate,id}=await setup(t);const before=await service.state(id);
  for(const source of ['<section onclick="x()">x</section>','<script>x()</script>','<img src="https://x.invalid/">','<p>{{sample::unknown}}</p>','<style>a{background:url(https://x.invalid)}</style>']){
    const r=await service.operation('target',{action:'configure',document_id:id,expected_revision:before.record.revision,config:{...config,source}},undefined,{sessionId:session});assert.equal(r.ok,false);assert.equal((await service.state(id)).record.revision,before.record.revision);
  }
  await mutate('target',{action:'configure',config});await mutate('patch_text',{field:'first_mes',old_text:'歡迎光臨。',new_text:'歡迎 {{sample::affection}}。'});const check=await op('target',{action:'check',document_id:id});assert.equal(check.ready,false);assert.ok(check.diagnostics.some(x=>x.code==='TARGET_UNRESOLVED_SAMPLE'));
});

test('target encoding preserves literal dollars and macro-like labels without invoking regex groups or ST macros',async t=>{
  const {service,id}=await setup(t),a=(await service.state(id)).authoring;
  const dollar={...config,source:config.source.replace('運動用品店','價格 $100'),fields:{...config.fields,affection:{...config.fields.affection,bands:[{min:0,label:'$1 {{setvar::x::y}}'}]}}};
  const compiled=compileTarget(dollar,a),replacement=compiled.regexes[1].replaceString;
  const pattern=compiled.regexes[1].findRegex, parsed=/^\/(.*)\/([a-z]*)$/.exec(pattern);assert.ok(parsed,'Native regex needs both delimiters');assert.equal('Greeting'.replace(new RegExp(parsed[1],parsed[2]),'<panel>'),'Greeting<panel>');
  assert.doesNotMatch(replacement,/\$\d|\$<|\{\{/);assert.match(replacement,/&#36;100/);assert.match(replacement,/\\u00241/);assert.match(replacement,/\\u007b\\u007bsetvar/);
});

test('generated native helper writer persists low/high state, edits, swipes, reload and chat isolation without inference',async t=>{
  const {service,mutate,id}=await setup(t);await mutate('target',{action:'configure',config});const a=(await service.state(id)).authoring,compiled=compileTarget(config,a);
  let identity='chat-a',messages=[{role:'assistant',message:'Welcome',data:{unrelated:17}}],saved=0;const events=new Map(),errors=[],cleanup=[];
  const context={console:{error:(...s)=>errors.push(s.join(' '))},SillyTavern:{getCurrentChatId:()=>identity,saveChat:async()=>{}},getLastMessageId:()=>messages.length-1,getVariables:({type,message_id})=>{assert.equal(type,'message');return messages[message_id]?.data??{};},getChatMessages:i=>messages[i]?[messages[i]]:[],setChatMessages:async(writes,options)=>{assert.equal(options.refresh,'none');saved++;for(const w of writes)messages[w.message_id].data=structuredClone(w.data);},eventOn:(name,fn)=>{const set=events.get(name)??new Set();events.set(name,set);set.add(fn);return {stop:()=>set.delete(fn)};},eventEmit:async name=>{for(const fn of events.get(name)??[])await fn();},tavern_events:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED','CHAT_CHANGED'].map(n=>[n,n])),window:{addEventListener:(_n,fn)=>cleanup.push(fn)}};
  const drain=()=>new Promise(resolve=>setTimeout(resolve,5));vm.runInNewContext(compiled.script.content,context);await drain();assert.equal(messages[0].data.clerk_state.state.values.affection,6);assert.equal(messages[0].data.unrelated,17);
  messages.push({role:'assistant',message:'Good evening<state-update>{"values":{"affection":92,"time":"21:10","outfit":"casual"},"characters":{"clerk":{"expression":"happy"}}}</state-update>',data:{}});await context.eventEmit('MESSAGE_RECEIVED');await drain();assert.equal(messages[1].data.clerk_state.state.values.affection,92);
  const writes=saved;cleanup.splice(0).forEach(fn=>fn());vm.runInNewContext(compiled.script.content,context);await drain();assert.equal(saved,writes,'reload does not advance state');
  messages[1].message='<state-update>{"values":{"affection":-1}}</state-update>';for(const f of events.get('MESSAGE_UPDATED'))await f(1);await drain();assert.equal(messages[1].data.clerk_state.state.values.affection,6);assert.ok(messages[1].data.clerk_state.error);
  messages[1].message='<state-update>{"values":{"affection":34}}</state-update>';for(const f of events.get('MESSAGE_SWIPED'))await f(1);await drain();assert.equal(messages[1].data.clerk_state.state.values.affection,34);
  const pending=[...events.get('MESSAGE_UPDATED')].map(f=>f(1));identity='chat-b';messages=[{role:'assistant',message:'Alternate greeting',data:{}}];await Promise.all(pending);await context.eventEmit('CHAT_CHANGED');await drain();assert.equal(messages[0].data.clerk_state.state.values.affection,6);assert.equal(errors.length,0,errors.join('\n'));
});


test('target accepts styled semantic header without losing CSS and identifies rejected elements',async t=>{
  const {service,id,mutate,op}=await setup(t),source='<section class="panel"><style>.panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));max-width:60rem;width:100%}</style><header><h4>State</h4><i>{{sample_label::affection}}</i></header><figure><img data-character-id="clerk" alt="Clerk"><figcaption>{{sample::time}}</figcaption></figure></section>';
  await mutate('target',{action:'configure',config:{...config,source}});
  const state=await service.state(id),compiled=compileTarget({...config,source},state.authoring);
  assert.ok(compiled.html.includes(source.match(/<style>[\s\S]*?<\/style>/)[0]));assert.match(compiled.html,/<header><h4>State<\/h4>/);assert.doesNotMatch(compiled.html,/\{\{sample/);
  const preview=await op('preview',{document_id:id,component_id:'target',viewport:1024});assert.match(preview.html,/<header>/);assert.match(preview.html,/repeat\(auto-fit,minmax\(15rem,1fr\)\)/);assert.doesNotMatch(preview.html,/<script\b/);
  const bad=await service.operation('target',{action:'patch',document_id:id,expected_revision:state.record.revision,expected_source_hash:sha(source),old_text:source,new_text:'<section><iframe></iframe></section>'},undefined,{sessionId:session});
  assert.equal(bad.error.code,'TARGET_SOURCE');assert.match(bad.error.message,/<iframe> at offset 9/);assert.equal((await service.state(id)).record.revision,state.record.revision);
});

test('raw export warns about authoring-only bindings and assets while preserving exact card bytes',async t=>{
  const {root,service,id,mutate}=await setup(t);
  await mutate('patch',{patches:[{op:'replace',path:'/data/first_mes',value:'<p>{{sample_label::affection}}</p><img data-character-id="clerk">'}]});
  const before=await service.state(id),receipt=await mutate('export_backup',{name:'authoring-backup.json'});
  assert.equal(receipt.deliveryKind,'authoring-backup');assert.equal(receipt.ready,false);assert.equal(receipt.runtimeVerified,false);assert.equal(receipt.requiresTargetPreparation,true);
  assert.deepEqual(receipt.diagnostics.map(x=>x.code),['RAW_EXPORT_SAMPLE_BINDINGS','RAW_EXPORT_UNBOUND_IMAGES','RAW_EXPORT_EXTERNAL_ASSETS']);
  assert.deepEqual(await fs.readFile(path.join(root,receipt.path)),Buffer.from(before.record.bytes,'base64'));assert.equal((await service.state(id)).record.revision,before.record.revision);
  await mutate('patch',{patches:[{op:'replace',path:'/data/first_mes',value:'Plain greeting'}]});
  const plain=await mutate('export',{name:'plain.json'});assert.equal(plain.requiresTargetPreparation,false);assert.deepEqual(plain.diagnostics.map(x=>x.code),['RAW_EXPORT_EXTERNAL_ASSETS']);
});


test('selected target has one primary delivery; raw backups are explicit and incomplete exports write nothing',async t=>{
  const {root,service,id,mutate,op}=await setup(t);
  await mutate('target',{action:'configure',config});
  const info=await op('read',{document_id:id});assert.equal(info.delivery.primaryAction,'export_target');assert.equal(info.delivery.backupAction,'export_backup');
  const before=await service.state(id),blocked=await service.operation('export',{document_id:id,expected_revision:before.record.revision,name:'ambiguous.json'},undefined,{sessionId:session});
  assert.equal(blocked.error.code,'EXPORT_PURPOSE_REQUIRED');assert.deepEqual(await fs.readdir(path.join(root,'exports')),[]);
  const backup=await mutate('export_backup',{name:'preservation.json'});assert.equal(backup.ready,false);assert.equal(backup.primaryDelivery,false);assert.equal(backup.deliveryKind,'authoring-backup');
  assert.deepEqual(await fs.readFile(path.join(root,backup.path)),Buffer.from(before.record.bytes,'base64'));
  const delivered=await mutate('export_target',{name:'playable'});assert.equal(delivered.primaryDelivery,true);assert.equal(delivered.deliveryKind,'target-package');assert.equal(delivered.runtimeVerified,false);
  await mutate('patch',{patches:[{op:'replace',path:'/data/first_mes',value:'<p>{{sample::time}}</p><img data-character-id="clerk">'}]});
  const directory=path.dirname(path.join(root,delivered.path)),files=await fs.readdir(directory);
  const incomplete=await service.operation('export_target',{document_id:id,expected_revision:(await service.load(id)).record.revision,name:'incomplete'},undefined,{sessionId:session});
  assert.equal(incomplete.error.code,'TARGET_NOT_READY');assert.match(incomplete.error.message,/TARGET_UNRESOLVED_SAMPLE/);assert.match(incomplete.error.message,/TARGET_IMAGE_SRC/);assert.deepEqual(await fs.readdir(directory),files);
});


test('shared presentation defaults and inline bindings preserve label/value layout without enabling scripts',async t=>{
  const {buildPreview}=await import('../cardstudio-bundle/lib/preview-projection.js');
  const {bindFixture}=await import('../cardstudio-bundle/lib/authoring-fixture.js');
  const {targetLabel}=await import('../cardstudio-bundle/lib/target-state.js');
  const {PRESENTATION_BASE_CSS}=await import('../cardstudio-bundle/lib/presentation-base.js');
  const {service,id}=await setup(t),a=(await service.state(id)).authoring;
  const fields={inventory:{type:'array',maxItems:4}},values={inventory:['One','<script>Two</script>']},source='<p>{{sample_label::inventory}} / {{sample::inventory}}</p>';
  const fixture=bindFixture({schemaVersion:1,fixtureId:'default',bindings:fields,values});
  const preview=buildPreview(source,{fixture}),compiled=compileTarget({...config,fields,initialState:{values,characters:{clerk:{expression:'neutral'}}},source},a);
  assert.ok(preview.html.includes(PRESENTATION_BASE_CSS));assert.ok(compiled.html.includes(PRESENTATION_BASE_CSS));
  assert.equal(targetLabel(fields.inventory,values.inventory,'label'),'One、<script>Two</script>');assert.equal(targetLabel(fields.inventory,values.inventory,'value'),'One · <script>Two</script>');
  for(const mode of ['label','value'])assert.ok(preview.html.includes('data-state-field="inventory" data-state-display="'+mode+'"')&&compiled.html.includes('data-state-field="inventory" data-state-display="'+mode+'"'));
  assert.match(preview.html,/One、&lt;script&gt;Two&lt;\/script&gt;/);assert.doesNotMatch(preview.html,/<script\b/);assert.equal(preview.javascript,false);assert.equal(preview.network,false);
});


test('legacy generated presentation cannot be certified by a newer compiler without explicit rebuild',async t=>{
  const {checkTarget}=await import('../cardstudio-bundle/lib/target-profile.js'),{canonical}=await import('../cardstudio-bundle/lib/codec.js');
  const {service,id,mutate}=await setup(t);await mutate('target',{action:'configure',config});
  const state=await service.state(id),card=structuredClone(state.decoded.card),a=structuredClone(state.authoring),target=a.target;
  card.data.extensions.regex_scripts.find(r=>r.id===target.regexIds[1]).replaceString=card.data.extensions.regex_scripts.find(r=>r.id===target.regexIds[1]).replaceString.replace('font-family:system-ui,sans-serif;font-size:16px','font-family:serif');
  // Simulate a self-consistent card generated by an older compiler, not an external edit.
  target.ownedHash=sha(canonical({scripts:card.data.extensions.tavern_helper.scripts.filter(s=>target.scriptIds.includes(s.id)),regexes:card.data.extensions.regex_scripts.filter(r=>target.regexIds.includes(r.id)),entry:card.data.character_book.entries.find(e=>e.id===target.bookId)}));
  const before=JSON.stringify(card),checked=checkTarget(card,a);assert.equal(checked.ready,false);assert.ok(checked.diagnostics.some(d=>d.code==='TARGET_STALE'));assert.equal(JSON.stringify(card),before);
  assert.equal(checkTarget(state.decoded.card,state.authoring).ready,true);
});
