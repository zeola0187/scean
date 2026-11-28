import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {resolveSyntheticCreate,createScriptedModel} from '../fixtures/synthetic-catalog.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
import {hash} from '../core/contracts.mjs';
const {chromium}=await import(process.env.SCEAN_PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const {stageDocuments}=await import('./stage-browser-helpers.mjs');const html=(await stageDocuments()).next;
const evidence=path.resolve(process.env.SCEAN_TEST_OUTPUT??path.join(import.meta.dirname,'../.test-data/stage-browser'));await fs.mkdir(evidence,{recursive:true});
const results=[];
try{for(const width of [1100,390]){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scean-recycle-ui-')),store=new DurableStore({root:path.join(root,'store')});
 let holdRun=null,releaseRead=null,readEntered=null;
 let modelCalls=0;const scripted=createScriptedModel({delayMs:1}),model={generate:q=>{modelCalls++;return scripted.generate(q);}};
 const engine=new SceanEngine({store,model,memory:{retrieve:async()=>({records:[]})}});
 let host=await new SceanHost({engine,root:path.join(root,'host'),worldRoutineAutomatic:false}).init();
 const snapshot=structuredClone(resolveSyntheticCreate({cardId:'synthetic-observatory',revisionId:'r1',openingId:'deck'}).snapshot);delete snapshot.hash;
 snapshot.source={provider:'@local/dsh-card-studio-scean-test',card:{id:snapshot.cardId,revision:snapshot.revision},authoring:{sessionId:'synthetic-session',generation:1}};
 const scope={provider:snapshot.source.provider,cardId:snapshot.cardId,authoringSessionId:'synthetic-session',generation:1};
 const script=await host.scripts.publish({snapshot,authoringSessionId:'synthetic-session',generation:1,requestId:'synthetic-script'});
 snapshot.source.script={scriptId:script.scriptId,scriptHash:script.scriptHash,sourceSessionId:'synthetic-session'};
 const a=await host.createRun({snapshot,playerName:'Synthetic A'}),b=await host.createRun({snapshot,playerName:'Synthetic B'});
 const beforeA=await store.read(a.runId),beforeB=await store.read(b.runId),scriptFile=path.join(root,'host/scripts',script.scriptId,'record.json'),scriptBytes=await fs.readFile(scriptFile);
 const sidecars=['plot-compass.json','player-notes.json','feed-cursor.json'];for(const name of sidecars)await store.atomic(path.join(store.runDir(a.runId),name),{synthetic:name});
 const auth={principal:'synthetic-browser',allowGlobalSettings:true,requireCardScope:true,resolveCardScope:()=>scope};
 const bridge=createNativeBridge({getSessionId:()=>scope.authoringSessionId,getViewerId:()=>null,call:async q=>{const r=await host.request(q,undefined,auth);if(!r.ok)throw Object.assign(Error(r.error.message),r.error);if(q.action==='runView'&&q.runId===holdRun){holdRun=null;readEntered?.();await new Promise(resolve=>{releaseRead=resolve;});}return r.value;}});
 function parent(runId){const frame=document.querySelector('iframe');frame.onload=()=>{const channel=new MessageChannel();window.__select=id=>channel.port1.postMessage({kind:'context',runId:id});frame.contentWindow.postMessage({kind:'scean-native-connect'},'*',[channel.port2]);channel.port1.onmessage=async({data:{action,payload,id}})=>{if(!id)return;const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({action,payload})});channel.port1.postMessage({kind:'response',id,...await r.json()});};setTimeout(()=>window.__select(runId),150);};frame.src='/stage';}
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/stage'){res.setHeader('content-type','text/html;charset=utf-8');res.end(html);return;}
  if(req.url==='/rpc'){let raw='';for await(const c of req)raw+=c;try{const {action,payload}=JSON.parse(raw),value=await bridge.request(action,payload??{});res.end(JSON.stringify({ok:true,value}));}catch(e){res.end(JSON.stringify({ok:false,error:{code:e.code,message:e.message}}));}return;}
  const id=new URL(req.url,'http://localhost').searchParams.get('run');res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>('+parent.toString()+')('+JSON.stringify(id)+')</script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const pages=[];
 try{
  const open=async id=>{const p=await browser.newPage({viewport:{width,height:820},reducedMotion:'reduce'});pages.push(p);p.on('pageerror',e=>console.log('PAGE_ERROR',e.message));await p.goto('http://127.0.0.1:'+server.address().port+'/?run='+id);const d=p.frameLocator('iframe');await d.locator('#composer-input').waitFor();return {p,d};};
  const one=await open(a.runId),observer=await open(a.runId),other=await open(b.runId),stale=await open(a.runId);
  const staleFrame=await (await stale.p.locator('iframe').elementHandle()).contentFrame();await staleFrame.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));
  await one.d.getByRole('button',{name:'更多',exact:true}).click();await one.d.getByRole('button',{name:/移入回收區/}).click();
  const dialog=one.d.locator('dialog.recycle-dialog');await dialog.waitFor();assert.match(await dialog.textContent(),/Synthetic A/);assert(await dialog.getByRole('button',{name:'取消',exact:true}).evaluate(n=>document.activeElement===n));
  host.worldRoutine.active.set(a.runId,Promise.resolve());await dialog.getByRole('button',{name:'移入回收區',exact:true}).click();await dialog.getByRole('status').filter({hasText:/./}).waitFor();assert.equal((await store.read(a.runId)).runId,a.runId);host.worldRoutine.active.clear();
  await one.p.screenshot({path:path.join(evidence,`recycle-busy-${width}.png`)});
  await dialog.getByRole('button',{name:'移入回收區',exact:true}).click();await one.d.locator('.shelf').waitFor();await observer.d.locator('.shelf').waitFor({timeout:8000});
  assert.equal((await store.read(a.runId,{includeTrashed:true})).recycle.status,'trashed');assert.deepEqual(await store.read(b.runId),beforeB);assert.equal(await other.d.locator('.bar-sub').textContent(),'Synthetic B 的故事');
  assert.deepEqual(await fs.readFile(scriptFile),scriptBytes);for(const name of sidecars)assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.runDir(a.runId),name))),{synthetic:name});
  await host.close();host=await new SceanHost({engine,root:path.join(root,'host'),worldRoutineAutomatic:false}).init();assert.deepEqual(host.listRuns().map(r=>r.runId),[b.runId]);
  await one.d.getByRole('button',{name:'演出回收區',exact:true}).click();await dialog.getByRole('button',{name:'恢復演出',exact:true}).click();await dialog.getByRole('button',{name:'恢復演出',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const restored=await store.read(a.runId);delete restored.recycle;assert.deepEqual(restored,beforeA);assert.deepEqual(await store.read(b.runId),beforeB);assert.deepEqual(await fs.readFile(scriptFile),scriptBytes);assert.equal(modelCalls,0);
  await observer.d.getByRole('button',{name:new RegExp('管理這場演出 '+a.runId.slice(-12))}).waitFor({timeout:8000});
  assert.equal(await one.d.locator('#composer-input').count(),0);await one.p.screenshot({path:path.join(evidence,`recycle-restored-${width}.png`)});
  // Exact stale lifecycle must fail even though the story version/head are unchanged.
  await assert.rejects(bridge.request('compassBlind',{runId:a.runId,expectedLifecycleRevision:0,expectedVersion:beforeA.version,expectedHead:beforeA.head,expectedRevision:0,blind:false}),e=>e.code==='RUN_LIFECYCLE_CHANGED');
  // A page that missed both lifecycle transitions may not silently upgrade its old input.
  await stale.d.locator('#composer-input').fill('Stale synthetic input must never generate.');await stale.d.locator('button.send').click();await stale.d.locator('.shelf').waitFor();assert.equal(modelCalls,0);
  // Hold an A response, choose B, and then release A: the late response cannot replace B.
  for(const x of [one,observer,stale]){const f=await (await x.p.locator('iframe').elementHandle()).contentFrame();await f.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));}
  holdRun=a.runId;const entered=new Promise(resolve=>{readEntered=resolve;});await other.p.evaluate(id=>window.__select(id),a.runId);await entered;await other.p.evaluate(id=>window.__select(id),b.runId);await other.d.locator('.bar-sub').filter({hasText:'Synthetic B'}).waitFor();releaseRead();await other.p.waitForTimeout(150);assert.equal(await other.d.locator('.bar-sub').textContent(),'Synthetic B 的故事');assert.equal(await other.d.locator('.latest-body').isDisabled(),true);
  results.push({width,twoRunsIsolated:true,crossPage:true,restartRestore:true,busyRejected:true,scriptUnchanged:true,sidecarsRetained:true,stalePageRejected:true,lateResponseIgnored:true,modelCalls});
 }finally{for(const p of pages)await p.close();await bridge.dispose();await new Promise(r=>server.close(r));await host.close();}
}}
finally{await browser.close();}
await fs.writeFile(path.join(evidence,'recycle-browser.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
