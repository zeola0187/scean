import test from 'node:test';
import assert from 'node:assert/strict';
import {mountScriptLibrary} from '../isolated/web/script-library-ui.mjs';
const tick=()=>new Promise(setImmediate),settle=async()=>{await tick();await tick();};
class Element{
 constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.dataset={};this.events={};this.attrs={};this.hidden=false;this.disabled=false;this._text='';}
 set id(v){this._id=v;this.doc.ids.set(v,this);}get id(){return this._id;}
 set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerHTML(v){throw Error('Authored HTML is forbidden');}
 setAttribute(k,v){this.attrs[k]=v;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 before(...nodes){const index=this.parent.children.indexOf(this);for(const node of nodes)node.parent=this.parent;this.parent.children.splice(index,0,...nodes);}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
 click(){if(!this.disabled)for(const fn of this.events.click??[])fn();}
 all(predicate){return this.children.flatMap(n=>[...(predicate(n)?[n]:[]),...n.all(predicate)]);}
 querySelectorAll(selector){if(selector==='[data-script-start]')return this.all(n=>n.dataset.scriptStart!==undefined);return[];}
}
const script={scriptId:'script-one',scriptHash:'fixed-hash',revision:2,title:'合成劇本',sourceSessionId:'exact-session'};
function fixture({request,storage=new Map()}={}){
 const doc={ids:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.ids.get(id);},defaultView:{sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}};
 doc.body=doc.createElement('body');const root=doc.createElement('nav');root.id='runs';doc.body.append(root);
 let scope='scope-one',offers=0,created=0;const calls=[],returned=[],rendered=[];
 const ui=mountScriptLibrary({document:doc,request:async(action,args)=>{calls.push({action,args});return request?request(action,args):action==='scriptGet'?script:{openingRequired:true};},getScopeKey:()=>scope,onOffer:async()=>offers++,onCreated:async()=>created++,onReturn:async target=>returned.push(target),makeId:()=> 'stable-operation'});
 const render=(runs=[{runId:'run-one',scriptId:script.scriptId},{runId:'legacy-run'}],error)=>ui.render({scripts:[script],runs,error,renderRun:(container,row)=>{rendered.push(row.runId);const entry=doc.createElement('div');entry.dataset.runId=row.runId;entry.textContent=row.runId;container.append(entry);}});
 return{doc,root,ui,calls,returned,rendered,storage,render,get offers(){return offers;},get created(){return created;},changeScope(){scope='scope-two';ui.reset();},start(){root.querySelectorAll('[data-script-start]')[0].click();},button(text){return doc.body.all(n=>n.tagName==='button'&&n.textContent===text)[0];}};
}
test('script list groups every performance and retains legacy rows without writes until explicit start',async()=>{
 const f=fixture();f.render();assert.equal(f.calls.length,0);assert.deepEqual(f.rendered,['run-one','legacy-run']);assert.equal(f.root.children[0].dataset.scriptId,script.scriptId);f.button('返回劇本創作對話').click();await settle();assert.deepEqual(f.returned,[{scriptId:script.scriptId}]);f.start();await settle();assert.deepEqual(f.calls.map(c=>c.action),['scriptGet','scriptStart']);assert.deepEqual(f.calls[1].args,{scriptId:script.scriptId,scriptHash:script.scriptHash,expectedRevision:2,operationId:'stable-operation'});assert.equal(f.offers,1);assert.equal(f.created,0);
});
test('lost preparation response persists the same operation and only status lookup resumes it after reload',async()=>{
 const storage=new Map(),f=fixture({storage,request:async action=>{if(action==='scriptGet')return script;throw Error('lost response');}});f.render();f.start();await settle();assert(storage.size);assert(f.root.querySelectorAll('[data-script-start]')[0].disabled);f.start();await settle();assert.equal(f.calls.filter(c=>c.action==='scriptStart').length,1);
 const second=fixture({storage,request:async(action,args)=>{assert.equal(action,'scriptStatus');assert.deepEqual(args,{operationId:'stable-operation'});return{status:'prepared',openingOfferId:'offer-one'};}});second.render();assert(!second.doc.getElementById('script-library-recheck').hidden);second.doc.getElementById('script-library-recheck').click();await settle();assert.equal(second.offers,1);assert.equal(storage.size,0);assert(second.calls.every(c=>c.action==='scriptStatus'));
});
test('late old-scope preparation never opens an offer in a new scope',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),f=fixture({request:action=>action==='scriptGet'?script:gate});f.render();f.start();await settle();assert.equal(f.calls.length,2);f.changeScope();resolve({openingRequired:true});await settle();assert.equal(f.offers,0);assert.equal(f.created,0);assert(f.doc.getElementById('script-library-recheck').hidden);
});
test('definite not_committed lookup unlocks an explicit retry; no automatic mutation occurs',async()=>{
 const f=fixture({request:async action=>action==='scriptGet'?script:action==='scriptStart'?Promise.reject(Error('unknown')):{status:'not_committed'}});f.render();f.start();await settle();f.doc.getElementById('script-library-recheck').click();await settle();assert(!f.root.querySelectorAll('[data-script-start]')[0].disabled);assert.equal(f.calls.filter(c=>c.action==='scriptStart').length,1);assert.equal(f.storage.size,0);
});
