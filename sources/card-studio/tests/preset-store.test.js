// Synthetic offline disk fixtures only. No installed Studio, model or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createPresetStore,normalizePreset,PRESET_MAX_BYTES} from '../cardstudio-bundle/lib/preset-store.js';
import {sha} from '../cardstudio-bundle/lib/codec.js';

const defaultPreset={id:'default',revision:27,prompts:[],extension:{future:true}};
const check=async()=>{},args={documentId:'card-fixed-a',check};
async function fixture(t){
 const base=resolve(import.meta.dirname,'../../../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(join(base,'preset-store-'));
 t.after(async()=>{assert(root.startsWith(base+sep));await fs.rm(root,{recursive:true,force:true});});
 const make=extra=>createPresetStore({root,defaultPreset,...extra});
 const file=id=>join(root,'.cardstudio-scean','presets',sha(Buffer.from(id??args.documentId)),'current.json');
 return {root,make,file,store:make()};
}
const save=(store,preset,expectedRevision,operationId,extra={})=>store.save({...args,preset,expectedRevision,operationId,...extra});

test('missing reads and status create no files; defaults are isolated copies',async t=>{
 const f=await fixture(t),row=await f.store.read(args);assert.equal(row.revision,0);assert.equal(row.saved,false);assert.equal(row.scope,'working-card');assert.deepEqual(row.preset,defaultPreset);
 row.preset.extension.future=false;assert.deepEqual((await f.store.read(args)).preset,defaultPreset);
 assert.equal((await f.store.status({...args,operationId:'never'})).status,'not_committed');assert.deepEqual(await fs.readdir(f.root),[]);
 await assert.rejects(f.store.read({documentId:args.documentId}),{code:'PRESET_AUTHORITY_REQUIRED'});
});

test('complete unknown JSON persists across reload; storage CAS ignores payload revision and isolates fixed cards',async t=>{
 const f=await fixture(t),preset=JSON.parse('{"id":"same-name","revision":900,"temperature":0.2,"future":{"array":[null,true,"繁體 😀",{"x/y":"z"}]},"__proto__":{"safe":"inert"}}');
 const row=await save(f.store,preset,0,'save-a');assert.equal(row.revision,1);assert.equal(row.preset.revision,900);assert.equal(row.receipt.operationId,'save-a');assert.equal(row.receipt.presetHash,row.presetHash);assert(Date.parse(row.savedAt));
 assert.deepEqual((await f.make().read(args)).preset,preset);assert.equal({}.safe,undefined);
 await save(f.make(),{id:'same-name',revision:900},0,'save-b',{documentId:'card-fixed-b'});
 assert.deepEqual((await f.make().read(args)).preset,preset);assert.notEqual((await f.store.read({...args,documentId:'card-fixed-b'})).presetHash,row.presetHash);
 const disk=JSON.parse(await fs.readFile(f.file(),'utf8'));assert.equal(disk.revision,1);assert.equal(disk.receipts.length,1);assert.deepEqual(disk.preset,preset);
});

test('operation replay returns original receipt and latest current without reverting later edits',async t=>{
 const f=await fixture(t),first=await save(f.store,{v:1},0,'op-one');
 const replay=await save(f.make(),{v:1},0,'op-one');assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);
 await save(f.store,{v:2},1,'op-two');const late=await save(f.make(),{v:1},0,'op-one');assert.equal(late.revision,2);assert.deepEqual(late.preset,{v:2});assert.deepEqual(late.receipt,first.receipt);
 await assert.rejects(save(f.store,{v:3},0,'op-one'),{code:'PRESET_OPERATION_CONFLICT'});
 await assert.rejects(save(f.store,{v:1},2,'op-one'),{code:'PRESET_OPERATION_CONFLICT'});
 await assert.rejects(save(f.store,{v:3},0,'new-stale'),{code:'PRESET_REVISION_CONFLICT'});
 const unknown=await f.store.status({...args,operationId:'new-stale'});assert.equal(unknown.status,'not_committed');assert.equal(unknown.currentRevision,2);assert.equal(unknown.currentPresetHash,late.presetHash);
 const known=await f.store.status({...args,operationId:'op-one'});assert.equal(known.status,'committed');assert.deepEqual(known.receipt,first.receipt);assert.equal(known.currentRevision,2);
});

test('two service instances and separate Session checks cannot lose a same-card update',async t=>{
 const f=await fixture(t),checks=[0,0],services=[f.make(),f.make()];
 const results=await Promise.allSettled(services.map((service,i)=>save(service,{session:i},0,'parallel-'+i,{check:async()=>{checks[i]++;}})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PRESET_REVISION_CONFLICT');assert(checks.every(n=>n>0));
 assert.equal((await f.store.read(args)).revision,1);assert.equal(JSON.parse(await fs.readFile(f.file(),'utf8')).receipts.length,1);
});

test('independent process is fenced by immutable disk tickets',async t=>{
 const f=await fixture(t),moduleUrl=new URL('../cardstudio-bundle/lib/preset-store.js',import.meta.url).href;
 const source=`import {createPresetStore} from ${JSON.stringify(moduleUrl)}; const store=createPresetStore({root:process.argv[1],defaultPreset:{},fault:async p=>{if(p==='beforeRename'){process.stdout.write('READY\\n');await new Promise(r=>process.stdin.once('data',r));}}});try{await store.save({documentId:'card-fixed-a',preset:{child:true},expectedRevision:0,operationId:'child',check:async()=>{}});process.stdout.write('SAVED\\n');}catch(e){console.error(e);process.exitCode=1;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,f.root],{stdio:['pipe','pipe','pipe']});let output='',stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.on('data',chunk=>output+=chunk);
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});t.after(()=>{if(child.exitCode===null)child.kill();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('child did not acquire lock: '+stderr)),15000);const ready=()=>{if(output.includes('READY')){clearTimeout(timer);child.stdout.off('data',ready);resolve();}};child.stdout.on('data',ready);ready();});
 await assert.rejects(save(f.store,{parent:true},0,'parent'),{code:'PRESET_BUSY'});assert.equal((await f.store.status({...args,operationId:'parent'})).status,'not_committed');
 child.stdin.end('release\n');assert.equal(await ended,0,stderr);assert(output.includes('SAVED'));assert.deepEqual((await f.store.read(args)).preset,{child:true});
});

test('pre-publication failure preserves current JSON; lost acknowledgement recovers durable receipt',async t=>{
 const f=await fixture(t);await save(f.store,{v:1},0,'old');const before=await fs.readFile(f.file(),'utf8');
 await assert.rejects(save(f.make({fault:async phase=>{if(phase==='beforeRename')throw Object.assign(new Error('synthetic before failure'),{code:'TEST_BEFORE'});}}),{v:2},1,'failed'),{code:'TEST_BEFORE'});
 assert.equal(await fs.readFile(f.file(),'utf8'),before);assert.equal((await f.store.status({...args,operationId:'failed'})).status,'not_committed');
 const recovered=await save(f.make({fault:async phase=>{if(phase==='afterRename')throw new Error('synthetic response loss');}}),{v:2},1,'lost');assert.equal(recovered.recovered,true);assert.equal(recovered.receipt.operationId,'lost');assert.equal((await f.make().status({...args,operationId:'lost'})).status,'committed');
});

test('a crashed writer leaves no committed preset and its dead tickets can be recovered',async t=>{
 const f=await fixture(t),moduleUrl=new URL('../cardstudio-bundle/lib/preset-store.js',import.meta.url).href;
 const source=`import {createPresetStore} from ${JSON.stringify(moduleUrl)}; const store=createPresetStore({root:process.argv[1],defaultPreset:{},fault:async phase=>{if(phase==='beforeRename')process.exit(72);}});await store.save({documentId:'card-fixed-a',preset:{crashed:true},expectedRevision:0,operationId:'crashed',check:async()=>{}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,f.root],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,72,stderr);
 const state=await f.store.status({...args,operationId:'crashed'});assert.equal(state.status,'not_committed');assert.equal(state.currentRevision,0);
 const resumed=await save(f.make(),{recovered:true},0,'recovered-after-crash');assert.equal(resumed.revision,1);assert.deepEqual((await f.make().read(args)).preset,{recovered:true});
});

test('post-commit unreadable outcome returns UNKNOWN then reload status reconciles',async t=>{
 const f=await fixture(t);let published=false;
 const store=f.make({fault:async phase=>{if(phase==='afterRename'){published=true;throw new Error('lost acknowledgement');}if(phase==='read'&&published)throw new Error('temporarily unavailable');}});
 await assert.rejects(save(store,{v:1},0,'uncertain'),{code:'PRESET_SAVE_UNKNOWN'});
 const status=await f.make().status({...args,operationId:'uncertain'});assert.equal(status.status,'committed');assert.equal(status.currentRevision,1);assert.equal((await save(f.make(),{v:1},0,'uncertain')).replayed,true);
});

test('authorization rechecked per call and at rename; lost access after commit never reports not committed',async t=>{
 const f=await fixture(t);let allowed=false,calls=0;const scoped=async()=>{calls++;if(!allowed)throw Object.assign(new Error('revoked'),{code:'SCOPE_REVOKED'});};
 await assert.rejects(save(f.store,{v:1},0,'denied',{check:scoped}),{code:'SCOPE_REVOKED'});assert.deepEqual(await fs.readdir(f.root),[]);
 allowed=true;const deniedAtRename=async()=>{if(++calls>=5)throw Object.assign(new Error('revoked'),{code:'SCOPE_REVOKED'});};calls=0;
 await assert.rejects(save(f.store,{v:1},0,'pre-revoked',{check:deniedAtRename}),{code:'SCOPE_REVOKED'});assert.equal((await f.store.status({...args,operationId:'pre-revoked'})).status,'not_committed');
 const store=f.make({fault:async phase=>{if(phase==='afterRename')allowed=false;}});allowed=true;
 await assert.rejects(save(store,{v:1},0,'post-revoked',{check:scoped}),{code:'PRESET_SAVE_UNKNOWN'});
 await assert.rejects(store.status({...args,operationId:'post-revoked',check:scoped}),{code:'SCOPE_REVOKED'});allowed=true;assert.equal((await store.status({...args,operationId:'post-revoked',check:scoped})).status,'committed');
});

test('cancellation before publication is empty, cancellation after publication is queryable UNKNOWN',async t=>{
 const f=await fixture(t),pre=new AbortController();pre.abort();await assert.rejects(save(f.store,{v:1},0,'cancel-pre',{signal:pre.signal}),{name:'AbortError'});assert.deepEqual(await fs.readdir(f.root),[]);
 const post=new AbortController(),store=f.make({fault:async phase=>{if(phase==='afterRename')post.abort();}});
 await assert.rejects(save(store,{v:2},0,'cancel-post',{signal:post.signal}),{code:'PRESET_SAVE_UNKNOWN'});assert.equal((await f.make().status({...args,operationId:'cancel-post'})).status,'committed');
});

test('document paths, missing operation/CAS and non-JSON values are rejected',async t=>{
 const f=await fixture(t);for(const documentId of ['../escape','C:/fixture/private','a/b',''])await assert.rejects(f.store.read({...args,documentId}),{code:'PRESET_DOCUMENT'});
 await assert.rejects(save(f.store,{},0,undefined),{code:'PRESET_OPERATION'});await assert.rejects(save(f.store,{},undefined,'missing'),{code:'PRESET_REVISION_REQUIRED'});
 const cyclic={};cyclic.self=cyclic;let invoked=false;const getter={get value(){invoked=true;return 'unsafe';}},oddArray=[1];oddArray.length=2;oddArray['01']=2;
 for(const value of [[],null,{x:undefined},{x:NaN},{x:-0},{x:new Date()},cyclic,getter,{x:[,1]},{x:oddArray},{x:1n},{x:'\ud800'}])assert.throws(()=>normalizePreset(value),{code:'PRESET_INVALID'});
 assert.equal(invoked,false);assert.throws(()=>normalizePreset({x:'x'.repeat(PRESET_MAX_BYTES)}),{code:'PRESET_LIMIT'});assert.deepEqual(await fs.readdir(f.root),[]);
});

test('record corruption fails closed and no arbitrary existing file gets replaced',async t=>{
 const f=await fixture(t);await save(f.store,{v:1},0,'one');const row=JSON.parse(await fs.readFile(f.file(),'utf8'));row.preset.v=99;await fs.writeFile(f.file(),JSON.stringify(row));
 await assert.rejects(f.store.read(args),{code:'PRESET_CORRUPT'});await assert.rejects(save(f.store,{v:2},1,'two'),{code:'PRESET_CORRUPT'});assert.equal(JSON.parse(await fs.readFile(f.file(),'utf8')).preset.v,99);
});

test('directory junctions are refused even when their target remains inside the workspace',async t=>{
 const f=await fixture(t),target=join(f.root,'target');await fs.mkdir(target);
 try{await fs.symlink(target,join(f.root,'.cardstudio-scean'),'junction');}catch(error){if(error.code==='EPERM'){t.skip('This Windows sandbox denies creating junction fixtures (EPERM).');return;}throw error;}
 await assert.rejects(f.store.read(args),{code:'PRESET_PATH'});await assert.rejects(save(f.store,{v:1},0,'link'),{code:'PRESET_PATH'});assert.deepEqual(await fs.readdir(target),[]);
});

test('a regular file cannot be adopted as a storage directory',async t=>{
 const f=await fixture(t),file=join(f.root,'.cardstudio-scean');await fs.writeFile(file,'existing unrelated content');
 await assert.rejects(f.store.read(args),{code:'PRESET_PATH'});await assert.rejects(save(f.store,{v:1},0,'not-directory'),{code:'PRESET_PATH'});assert.equal(await fs.readFile(file,'utf8'),'existing unrelated content');
});
