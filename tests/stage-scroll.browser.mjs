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
import {createNativeModelPort} from '../plugin/native-model.mjs';

const evidence=path.resolve(process.env.SCEAN_TEST_OUTPUT??path.join(import.meta.dirname,'../.test-data/stage-browser'));await fs.mkdir(evidence,{recursive:true});
const {chromium}=await import(process.env.SCEAN_PLAYWRIGHT_MODULE??'playwright');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'scean-compass-web-')),store=new DurableStore({root:path.join(root,'store')});
const discovery=resolveSyntheticCreate({cardId:'synthetic-observatory',revisionId:'r1',openingId:'deck'});
let release; let pause;
const base=createScriptedModel({delayMs:10});
const model={async generate(args){if(args.stage==='post_stat'&&pause)await pause;const out=await base.generate(args);if(args.stage==='writer'){const v=JSON.parse(out.text);v.finalBody+='\n\n'+Array.from({length:64},(_,i)=>`Paragraph ${i+1}. `+'The synthetic observer reads the quiet sky and the brass telescope. '.repeat(8)).join('\n\n');out.text=JSON.stringify(v);}return out;}};
const engine=new SceanEngine({store,model,memory:{retrieve:async()=>({records:[]})}}),host=await new SceanHost({engine,root:path.join(root,'host'),worldRoutineAutomatic:false}).init();
const auth={principal:'synthetic-browser',allowGlobalSettings:true};
const created=await host.request(discovery,undefined,auth);assert(created.ok,JSON.stringify(created));const runId=created.value.runId;
const bridge=createNativeBridge({getSessionId:()=>null,getViewerId:()=>null,call:async q=>{
 if(q.action==='context')return {cardScope:{provider:'@local/dsh-card-studio-scean-test',cardId:'synthetic-observatory',authoringSessionId:'synthetic-session',generation:1},playbackStatus:{status:'available'}};
 if(q.action==='scriptList')return [];
 if(q.action==='list')return [{runId,title:'Synthetic garden',cardId:'synthetic-observatory',version:(await store.read(runId)).version}];
 const r=await host.request(q,undefined,auth);if(!r.ok)throw Object.assign(Error(r.error.message),r.error);return r.value;
}});
const {stageDocuments}=await import('./stage-browser-helpers.mjs');const html=(await stageDocuments()).next;
function parent(runId){
 const frame=document.querySelector('iframe');frame.onload=()=>{
  const channel=new MessageChannel();frame.contentWindow.postMessage({kind:'scean-native-connect'},'*',[channel.port2]);
  channel.port1.onmessage=async({data:{action,payload,id}})=>{
   if(!id)return;
   try{const response=await fetch('/rpc',{method:'POST',body:JSON.stringify({action,payload})});const v=await response.json();channel.port1.postMessage({kind:'response',id,...v});}catch{channel.port1.postMessage({kind:'response',id,ok:false,error:{code:'TRANSPORT'}});}
  };
  setTimeout(()=>channel.port1.postMessage({kind:'context',runId}),150);
 };frame.src='/stage';
}
const server=http.createServer(async(req,res)=>{
 if(req.url==='/stage'){res.setHeader('content-type','text/html;charset=utf-8');res.end(html);return;}
 if(req.url==='/rpc'&&req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   try{const {action,payload}=JSON.parse(body);const value=await bridge.request(action,payload??{});res.end(JSON.stringify({ok:true,value}));}catch(e){res.end(JSON.stringify({ok:false,error:{code:e.code,message:e.message}}));}
   return;
 }
 res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>('+parent.toString()+')('+JSON.stringify(runId)+')</script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.SCEAN_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-crash-reporter','--disable-breakpad','--no-proxy-server']});
 for(const [width,height,down] of [[1100,820,0],[1100,820,1300],[390,780,0],[390,780,1300]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce'});
  await page.addInitScript(()=>{
   window.__scrollCalls=[];
   const orig=Window.prototype.scrollTo??window.scrollTo;
   window.scrollTo=function(...args){window.__scrollCalls.push(['scrollTo',...args]);return orig.apply(window,args);};
   const into=Element.prototype.scrollIntoView;
   Element.prototype.scrollIntoView=function(options){window.__scrollCalls.push(['scrollIntoView',this.className,options]);return into.call(this,options);};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const doc=page.frameLocator('iframe'),input=doc.locator('#composer-input');
  const frame=await (await page.locator('iframe').elementHandle()).contentFrame();
  await input.waitFor();await page.waitForTimeout(250);if((await store.read(runId)).turns.length)await doc.locator('button.latest-body').click();
  const get=(selector)=>frame.evaluate(sel=>({scrollY:Math.round(scrollY),distanceToBottom:Math.round(document.documentElement.scrollHeight-innerHeight-scrollY),targetTop:Math.round(document.querySelector(sel).getBoundingClientRect().top)}),selector);
  pause=new Promise(r=>{release=r;});
  await input.fill('Look at the observatory door.');
  await doc.locator('button.send').click();
  await doc.locator('[data-stat-preview]').waitFor({timeout:20000});
  await page.waitForTimeout(180);
  await doc.locator('button.latest-body').click();
  if(down)await frame.evaluate(n=>window.scrollBy(0,n),down);
  const readPoint=()=>{const prose=document.querySelector('[data-stat-preview] .prose'),top=document.querySelector('.reader-bar').getBoundingClientRect().bottom+16,box=prose.getBoundingClientRect(),caret=document.caretRangeFromPoint(box.left+10,top),region=caret?.startContainer.parentElement.closest('[data-body-start]');if(!region)return null;const r=document.createRange();r.selectNodeContents(region);r.setEnd(caret.startContainer,caret.startOffset);const point=document.createRange();point.setStart(caret.startContainer,caret.startOffset);point.setEnd(caret.startContainer,Math.min(caret.startOffset+1,caret.startContainer.length));return {offset:Number(region.dataset.bodyStart)+r.toString().length,y:point.getBoundingClientRect().top};};
  const textAnchor=down?await frame.evaluate(readPoint):null;
  const preview=await get('[data-stat-preview] .prose'); const previewCalls=await frame.evaluate(()=>window.__scrollCalls.splice(0));
  release();pause=null;
  await doc.locator('.turn.is-new .prose').waitFor({timeout:20000});
  await doc.locator('[data-stat-preview]').waitFor({state:'hidden'});
  await page.waitForTimeout(700);
  const committed=await get('.turn.is-new .prose');
  console.log(JSON.stringify({width,height,down,preview,committed,previewCalls,afterCalls:await frame.evaluate(()=>window.__scrollCalls)}));
  if(!down)assert(Math.abs(committed.targetTop-preview.targetTop)<8,JSON.stringify({preview,committed}));
  else {assert(textAnchor);const finalAnchor=await frame.evaluate(anchor=>{const prose=document.querySelector('.turn.is-new .prose');for(const region of prose.querySelectorAll('[data-body-start]')){if(anchor.offset<Number(region.dataset.bodyStart)||anchor.offset>=Number(region.dataset.bodyEnd))continue;let at=anchor.offset-Number(region.dataset.bodyStart);const w=document.createTreeWalker(region,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(at<n.length){const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+1);return {offset:anchor.offset,y:r.getBoundingClientRect().top};}at-=n.length;}}return null;},textAnchor);console.log(JSON.stringify({textAnchor,finalAnchor}));assert(finalAnchor&&Math.abs(finalAnchor.y-textAnchor.y)<4);}

  assert(committed.distanceToBottom>2000);
  assert(down?preview.targetTop<0:preview.targetTop>=0);
  assert.equal(await doc.locator('.composer-tools > button.tool').count(),4);
  const turnsBefore=(await store.read(runId)).turns.length;await doc.locator('button.latest-body').click();assert.equal((await store.read(runId)).turns.length,turnsBefore);
  assert(Math.abs((await get('.turn.is-new .prose')).targetTop-(await frame.locator('.reader-bar').evaluate(n=>n.getBoundingClientRect().bottom+12)))<3);
  await page.screenshot({path:path.join(evidence,`stage-${width}-${down}.png`)});
  await page.close();
 }
}finally{release?.();await browser?.close();await new Promise(r=>server.close(r));await host.close();}
