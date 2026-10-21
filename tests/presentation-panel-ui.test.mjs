import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPresentationPanel} from '../isolated/web/presentation-panel-ui.mjs';
import {mountCardFrontend} from '../isolated/web/card-frontend.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {frontendPreview} from '../core/frontend.mjs';
const tick=()=>new Promise(setImmediate);
function dom(){
 const nodes=[];const create=tag=>{const n={tag,children:[],attrs:{},style:{},events:{},hidden:false,disabled:false,textContent:'',value:'',setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this[k];delete this.attrs[k];},addEventListener(k,fn){this.events[k]=fn;},append(...v){this.children.push(...v);for(const x of v)x.parentElement=this;},after(v){this.parentElement?.append(v);},remove(){this.removed=true;}};nodes.push(n);return n;};
 const body=create('body'),form=create('form');form.id='prose-style-form';body.append(form);const chat=create('div');chat.id='chat';body.append(chat);const input=create('textarea');input.id='input';input.value='既有玩家草稿';body.append(input);
 return {nodes,body,input,createElement:create,getElementById:id=>nodes.find(n=>n.id===id),by:id=>nodes.find(n=>n.id===id)};
}
const run=(id='one')=>({runId:id,snapshot:{hash:'snapshot-'+id,cardId:'w01-fantasy'},version:3,head:'commit-3',presentationRevision:0});
const view=r=>({runId:r.runId,snapshotHash:r.snapshot.hash,presentationRevision:0,status:'available',usingOriginal:true,canRestoreOriginal:false,canRestorePrevious:false,bindings:[{displayName:'魔力',known:true}],canonical:{version:r.version,head:r.head}});
function fixture(override){
 const doc=dom(),calls=[];let selected=run(),revision=0,preserves=0;
 const f=w01Fixture('fantasy'),preview=frontendPreview(f.frontend,f.bp,f.initial);
 const request=async(action,args)=>{calls.push({action,args});if(override){const result=override(action,args,{selected,revision,preview});if(result!==undefined)return result;}
  if(action==='presentation')return {...view(selected),presentationRevision:revision};
  if(action==='presentationSource')return {frontend:f.frontend,source:{documentId:'w01-fantasy',revision:8,label:'工作卡'}};
  if(action==='presentationPreview')return {...view(selected),previewToken:'preview-one',source:args.source,preview:{status:'ready',frontend:preview.frontend,projection:preview.projection}};
  revision++;return {...view(selected),presentationRevision:revision,lastOperationId:args.operationId,usingOriginal:action==='presentationRestore',canRestoreOriginal:true,canRestorePrevious:true};
 };
 const ui=mountPresentationPanel({document:doc,request,getContext:()=>selected,preserveReading:()=>{preserves++;return()=>{};},makeId:()=>String(calls.length)});ui.update(selected);
 return {doc,calls,ui,get preserves(){return preserves;},select(r){selected=r;ui.update(r);},async click(id){const n=doc.by(id);assert(!n.disabled,id+' should be enabled');await n.events.click();await tick();await tick();}};
}

test('presentation UI reads saved working-card panel, previews current State, and applies only after explicit player click',async()=>{
 const f=fixture();await tick();await f.click('presentation-source-load');assert.deepEqual(f.calls.map(c=>c.action),['presentation','presentationSource','presentationPreview']);
 assert.equal(f.doc.by('presentation-preview').hidden,false);assert.match(f.doc.by('presentation-preview-label').textContent,/第 8 版/);assert.equal(f.doc.by('presentation-preview-frame').attrs.sandbox,'');assert.match(f.doc.by('presentation-preview-frame').srcdoc,/script-src 'none'/);
 assert.equal(f.doc.input.value,'既有玩家草稿');await f.click('presentation-apply');assert.equal(f.calls.at(-1).action,'presentationApply');assert.equal(f.calls.at(-1).args.confirmed,true);assert.equal(f.calls.at(-1).args.previewToken,'preview-one');assert(!f.calls.some(c=>['turn','regenerate'].includes(c.action)));assert.equal(f.doc.input.value,'既有玩家草稿');assert(f.preserves>0);
});

test('presentation UI blocks missing Blueprint, safe text-rendering retains official State and never posts a package',async()=>{
 const f=fixture(action=>action==='presentation'?{...view(run()),status:'unavailable',code:'PRESENTATION_BLUEPRINT_REQUIRED'}:undefined);await tick();assert.equal(f.doc.by('presentation-source-load').disabled,true);assert.match(f.doc.by('run-presentation-status').textContent,/沒有原有狀態藍圖/);assert.equal(f.calls.length,1);assert.equal(f.doc.input.value,'既有玩家草稿');
});

test('presentation UI drops source response after Run switch and invalidates preview after a new committed head',async()=>{
 let release;const f=fixture(action=>action==='presentationSource'?new Promise(r=>release=r):undefined);await tick();const pending=f.doc.by('presentation-source-load').events.click();await tick();f.select(run('two'));await tick();release({frontend:{},source:{}});await pending;assert.equal(f.calls.filter(c=>c.action==='presentationPreview').length,0);assert.equal(f.doc.by('presentation-preview').hidden,true);
 const g=fixture();await tick();await g.click('presentation-source-load');g.select({...run(),version:4,head:'commit-4'});assert.equal(g.doc.by('presentation-preview').hidden,true);assert.equal(g.doc.by('presentation-apply').disabled,true);assert.equal(g.doc.input.value,'既有玩家草稿');
});

test('presentation pending response cannot cross Session selection stamp even for the same Run and head',async()=>{
 let release;const f=fixture(action=>action==='presentationSource'?new Promise(r=>release=r):undefined);await tick();f.select({...run(),selectionStamp:'session-one'});await tick();const pending=f.doc.by('presentation-source-load').events.click();await tick();f.select({...run(),selectionStamp:'session-two'});await tick();release({frontend:{},source:{}});await pending;assert.equal(f.calls.filter(c=>c.action==='presentationPreview').length,0);assert.equal(f.doc.by('presentation-preview').hidden,true);assert.equal(f.doc.input.value,'既有玩家草稿');
});

test('presentation unknown acknowledgment requires readback and never automatically repeats the mutation',async()=>{
 let operationId;const f=fixture((action,args)=>{if(action==='presentationApply'){operationId=args.operationId;throw Object.assign(Error(),{code:'PRESENTATION_SAVE_UNKNOWN'});}if(action==='presentation'&&operationId)return {...view(run()),presentationRevision:1,lastOperationId:operationId,usingOriginal:false,canRestoreOriginal:true,canRestorePrevious:true};});await tick();await f.click('presentation-source-load');await f.click('presentation-apply');assert.equal(f.doc.by('presentation-source-load').disabled,true);assert.equal(f.calls.filter(c=>c.action==='presentationApply').length,1);await f.click('presentation-refresh');assert.equal(f.calls.filter(c=>c.action==='presentationApply').length,1);assert.equal(f.doc.by('presentation-source-load').disabled,false);assert.match(f.doc.by('run-presentation-status').textContent,/已確認/);
});

test('presentation renderer accepts same-head higher display revision and ignores an old display after restore-to-none',()=>{
 const doc=dom(),f=w01Fixture('fantasy'),p=frontendPreview(f.frontend,f.bp,f.initial),ui=mountCardFrontend({document:doc,setTimer:()=>1,clearTimer(){}});
 const initial={runId:'authoring-preview',version:0,head:null,snapshot:{cardId:'authoring-preview',hash:'preview'},presentationRevision:1,cardFrontend:{status:'ready',frontend:p.frontend,projection:{...p.projection,presentationRevision:1}}};ui.update(initial);ui.history({runId:initial.runId,snapshotHash:'preview',head:null});const frame=doc.by('card-frontend-frame');assert(frame.srcdoc);
 const replacement=structuredClone(initial);replacement.presentationRevision=2;replacement.cardFrontend.projection.presentationRevision=2;replacement.cardFrontend.frontend.hash='b'.repeat(64);replacement.cardFrontend.projection.frontendHash=replacement.cardFrontend.frontend.hash;ui.update(replacement);assert.equal(doc.by('card-frontend').attrs['data-presentation-revision'],'2');
 ui.update({...replacement,presentationRevision:3,cardFrontend:null});assert.equal(frame.srcdoc,undefined);ui.update(initial);assert.equal(frame.srcdoc,undefined);assert.equal(doc.by('card-frontend').hidden,true);ui.dispose();
});

test('presentation renderer rejects a packet assembled from different presentation revisions',()=>{
 const doc=dom(),f=w01Fixture(),p=frontendPreview(f.frontend,f.bp,f.initial),ui=mountCardFrontend({document:doc,setTimer:()=>1,clearTimer(){}});
 ui.update({runId:'authoring-preview',version:0,head:null,snapshot:{cardId:'authoring-preview',hash:'preview'},presentationRevision:2,cardFrontend:{status:'ready',frontend:p.frontend,projection:{...p.projection,presentationRevision:1}}});assert.equal(doc.by('card-frontend-frame').hidden,true);assert.match(doc.by('card-frontend-status').textContent,/同步中/);ui.dispose();
});
