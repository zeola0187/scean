import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {validateFrontend,frontendPackage,frontendPreview,frontendProjection} from '../core/frontend.mjs';
import {evaluateDisplay,renderFrontendDocument,displayValues} from '../isolated/web/frontend-runtime.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {publicRunView} from '../core/inspection.mjs';
import {validateSnapshot,hash} from '../core/contracts.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
const copy=v=>structuredClone(v);
const edit=(f,fn)=>{const p=copy(f.frontend);delete p.hash;fn(p);return p;};
const check=(f,p,code)=>assert.throws(()=>validateFrontend(p,f.bp),e=>e.code===code);
test('W01 synthetic four conditions: all true, each false, missing, unavailable, stale never claims current safety',()=>{
 const f=w01Fixture(),p=frontendPreview(f.frontend,f.bp,f.initial).projection;
 assert.deepEqual(displayValues(f.frontend,p).safe,{status:'known',value:true});
 for(let i=1;i<=4;i++){const x=copy(p);x.values['check_'+i].value=false;assert.equal(displayValues(f.frontend,x).safe.value,false);}
 for(const status of ['unknown','unavailable']){const x=copy(p);x.values.check_3={status};assert.equal(displayValues(f.frontend,x).safe.status,status);}
 const stale={...p,freshness:'stale'},v=displayValues(f.frontend,stale);assert.equal(v.safe.status,'stale');
 assert(!renderFrontendDocument(frontendPreview(f.frontend,f.bp,f.initial).frontend,stale).includes('class="lamp scean-true"'));
});
test('W01 bounded logic supports AND/OR/NOT numeric and enum with strict boolean types',()=>{
 const f=w01Fixture('fantasy'),p=frontendPreview(f.frontend,f.bp,f.initial).projection;
 assert.equal(displayValues(f.frontend,p).canCast.value,true);p.values.mana.value=0;assert.equal(displayValues(f.frontend,p).canCast.value,false);
 p.values.stance.value='rest';assert.equal(displayValues(f.frontend,p).resting.value,true);
 assert.equal(evaluateDisplay({op:'or',args:[{ref:'a'},{ref:'b'}]},{a:{status:'unknown'},b:{status:'known',value:true}}).value,true);
 check(f,edit(f,p=>p.conditions.canCast={op:'not',args:[{ref:'mana'}]}),'FRONTEND_EXPRESSION_TYPE');
});
test('W01 binding admission rejects missing, restricted, wrong-type, wildcard and capability escalation',()=>{
 const f=w01Fixture();
 check(f,edit(f,p=>p.bindings[0].target.key='absent'),'FRONTEND_BINDING_MISSING');
 check(f,edit(f,p=>{p.bindings[0].target.key='secret';p.bindings[0].type='string';}),'FRONTEND_BINDING_UNAUTHORIZED');
 check(f,edit(f,p=>p.bindings[0].type='number'),'FRONTEND_BINDING_TYPE');
 check(f,edit(f,p=>p.bindings[0].target.key='*'),'FRONTEND_BINDING_MISSING');
 check(f,edit(f,p=>p.capabilities.worldActions=['write']),'FRONTEND_CAPABILITY_UNSUPPORTED');
 check(f,edit(f,p=>p.runtime.profile='isolated-js-v2'),'FRONTEND_RUNTIME_UNSUPPORTED');
 check(f,edit(f,p=>p.capabilities.derivedDisplays=['secret-derived']),'FRONTEND_CAPABILITY_UNSUPPORTED');
});
test('W01 renderer admission rejects scripts, events, network, svg, forms, iframe, CSS escape/import and broken references',()=>{
 const f=w01Fixture();
 for(const html of ['<script>alert(1)</script>','<img src="https://invalid.example/">','<svg><script></script></svg>','<iframe></iframe>','<form></form>','<div onclick="alert(1)">x</div>','<div style="color:red">x</div>','<div data-scean-text="absent"></div>'])assert.throws(()=>validateFrontend(edit(f,p=>p.html=html),f.bp),e=>e.code.startsWith('FRONTEND_'),html);
 for(const css of ['@import "https://invalid.example";','div{background:url(https://invalid.example)}','div{color:var(--private)}','div{position:fixed}','div{background:u\\72l(x)}'])check(f,edit(f,p=>p.css=css),'FRONTEND_CSS_UNSUPPORTED');
});
test('W01 manifest integrity and AST resource bounds are enforced',()=>{
 const f=w01Fixture(),p=copy(f.frontend);p.html+='<p>tamper</p>';check(f,p,'FRONTEND_HASH_MISMATCH');
 let ast={ref:'check_1'};for(let i=0;i<14;i++)ast={op:'not',args:[ast]};check(f,edit(f,p=>p.conditions.safe=ast),'FRONTEND_EXPRESSION_LIMIT');
 check(f,edit(f,p=>p.html='<div>'.repeat(40)+'x'+'</div>'.repeat(40)),'FRONTEND_DOM_LIMIT');
});
test('W01 State strings are text, false/0/empty remain known, projection never contains restricted canaries',()=>{
 const f=w01Fixture('fantasy');f.initial.values.find(v=>v.key==='hero').value='<script>parent.alert(1)</script>';
 f.initial.values.find(v=>v.key==='mana').value=0;
 const x=frontendPreview(f.frontend,f.bp,f.initial),html=renderFrontendDocument(x.frontend,x.projection);
 assert(html.includes('&lt;script&gt;parent.alert(1)&lt;/script&gt;'));assert(!JSON.stringify(x.projection).includes('RESTRICTED'));
 assert.equal(x.projection.values.mana.value,0);assert(html.includes('script-src \'none\''));
});
async function setup(){
 const f=w01Fixture(),root=await mkdtemp(join(tmpdir(),'w01-run-')),store=new DurableStore({root});let mode='off',calls=0;
 const model={async generate({stage,signal}){calls++;if(stage==='post_stat'){
   if(mode==='fail')throw Error('synthetic failure');if(mode==='hold')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
   return {text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'check_1',operation:'set',value:mode==='on'}],memories:[]})};
 }return {text:stage==='director'?'Observe the public test light.':'The synthetic archivist records the observation.'};}};
 const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:{async retrieve(){return {records:[],status:'offline'};}}}),run=await engine.createRun({snapshot:f.snapshot});
 return {...f,root,store,engine,run,model,setMode:m=>mode=m,calls:()=>calls};
}
test('W01 formal commits update projection; fail/cancel and uncommitted proposals preserve it; restart/rollback/regenerate align',async()=>{
 const f=await setup(),runId=f.run.runId,initial=frontendProjection(await f.store.read(runId));
 const turn=requestId=>f.engine.turn({runId,input:'Observe.',requestId});
 f.setMode('fail');await assert.rejects(turn('failed'));assert.deepEqual(frontendProjection(await f.store.read(runId)),initial);
 f.setMode('hold');const abort=new AbortController(),pending=f.engine.turn({runId,input:'Observe.',requestId:'cancelled',signal:abort.signal});
 await new Promise(r=>setTimeout(r,100));assert.deepEqual(frontendProjection(await f.store.read(runId)),initial);abort.abort();await assert.rejects(pending);assert.deepEqual(frontendProjection(await f.store.read(runId)),initial);
 f.setMode('off');await turn('committed');let saved=await f.store.read(runId);assert.equal(frontendProjection(saved).values.check_1.value,false);
 const engine2=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:f.root}),model:f.model,memory:{async retrieve(){return {records:[],status:'offline'};}}});assert.deepEqual(frontendProjection(await engine2.store.read(runId)),frontendProjection(saved));
 await engine2.rollback({runId,operationId:'rollback',expectedVersion:saved.version,expectedHead:saved.head});saved=await f.store.read(runId);assert.equal(frontendProjection(saved).values.check_1.value,true);assert(saved.version>initial.canonical.version);
 await turn('again');saved=await f.store.read(runId);f.setMode('on');await engine2.regenerate({runId,operationId:'regenerate',expectedVersion:saved.version,expectedHead:saved.head,requestId:'regen-result'});saved=await f.store.read(runId);assert.equal(frontendProjection(saved).values.check_1.value,true);
 const packet=JSON.stringify(publicRunView(saved));assert(!packet.includes('RESTRICTED_LABEL_CANARY'));assert(!packet.includes('RESTRICTED_VALUE_CANARY'));
});
test('W01 snapshot freeze and Run export/import retain exact package; new revision has no effect on old Run',async()=>{
 const f=await setup(),before=await f.store.read(f.run.runId),s=copy(f.snapshot);s.revision=2;s.frontend=frontendPackage(edit(f,p=>p.html=p.html.replace('合成觀測站','改版觀測站')),f.bp);s.card.data.extensions.scean.frontend=s.frontend;
 const newer=await f.engine.createRun({snapshot:s});assert.notEqual(newer.snapshot.frontend.hash,before.snapshot.frontend.hash);assert.deepEqual(await f.store.read(f.run.runId),before);
 const raw=encodeRunBundle(before),restored=validateRunBundle(raw);assert.equal(restored.snapshot.frontend.hash,before.snapshot.frontend.hash);assert.equal(hash(restored),hash(before));
});
