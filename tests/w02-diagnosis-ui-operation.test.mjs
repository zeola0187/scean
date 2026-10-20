import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../sources/card-studio/cardstudio-bundle/client-template.js',import.meta.url),'utf8');
const implementation=source.split('/* EDITOR_OPERATION_START */')[1].split('/* EDITOR_OPERATION_END */')[0];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){
 let active=true;const lock={current:false},diagnosisLock={current:false},editor=[],diagnosis=[],statuses=[],errors=[];
 const api=vm.runInNewContext(implementation+';({run,runDiagnosis})',{lock,diagnosisLock,valid:()=>active,setBusy:x=>editor.push(x),setDiagnosisBusy:x=>diagnosis.push(x),setStatus:x=>statuses.push(x),t:x=>x,notify:e=>errors.push(e.message),setV:()=>{},notice:''});
 return {...api,lock,diagnosisLock,editor,diagnosis,statuses,errors,expire:()=>{active=false;}};
}
test('a delayed working-card read cannot prevent explicit diagnosis RPC dispatch',async()=>{
 const f=fixture(),held=deferred();let grants=0;
 const read=f.run(()=>held.promise);assert.equal(f.lock.current,true);
 await f.runDiagnosis(async()=>{grants++;});assert.equal(grants,1);assert.equal(f.lock.current,true);assert.deepEqual(f.editor,[true]);assert.deepEqual(f.diagnosis,[true,false]);
 held.resolve();await read;assert.deepEqual(f.editor,[true,false]);
});
test('repeated consent presses while its response is pending dispatch exactly once',async()=>{
 const f=fixture(),held=deferred();let requests=0;
 const grant=f.runDiagnosis(()=>{requests++;return held.promise;});await f.runDiagnosis(async()=>{requests++;});assert.equal(requests,1);assert.deepEqual(f.diagnosis,[true]);
 held.resolve();await grant;assert.equal(f.diagnosisLock.current,false);assert.deepEqual(f.diagnosis,[true,false]);
});
test('denied diagnosis reports failure and releases only its own gate for a human retry',async()=>{
 const f=fixture(),held=deferred(),read=f.run(()=>held.promise);
 assert.equal(await f.runDiagnosis(async()=>{throw Error('DIAG_DENIED');}),false);assert.deepEqual(f.errors,['DIAG_DENIED']);assert.equal(f.lock.current,true);assert.equal(f.diagnosisLock.current,false);
 assert.equal(await f.runDiagnosis(async()=>{}),true);held.resolve();await read;
});
test('an expired Panel never starts diagnosis or publishes a late error/status',async()=>{
 const f=fixture(),held=deferred();const pending=f.runDiagnosis(async()=>{await held.promise;throw Error('late response');});f.expire();const count=f.statuses.length;
 let dispatched=false;await f.runDiagnosis(async()=>{dispatched=true;});held.resolve();await pending;assert.equal(dispatched,false);assert.equal(f.statuses.length,count);assert.deepEqual(f.errors,[]);assert.equal(f.diagnosisLock.current,false);
});
test('a granted diagnosis does not release a pending editor write or permit a duplicate write',async()=>{
 const f=fixture(),held=deferred();let writes=0;const pending=f.run(()=>{writes++;return held.promise;});await f.runDiagnosis(async()=>{});await f.run(async()=>{writes++;});assert.equal(writes,1);held.resolve();await pending;
});
