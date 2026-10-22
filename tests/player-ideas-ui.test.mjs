import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlayerIdeas} from '../isolated/web/player-ideas-ui.mjs';
import {IDEA_CATEGORIES} from '../core/player-ideas.mjs';
const tick=()=>new Promise(setImmediate);
const result=run=>({runId:run.runId,version:run.version,head:run.head,snapshotHash:run.snapshot.hash,ideas:IDEA_CATEGORIES.map((category,index)=>({category,text:index===0?'<b>Explore the station</b>':'Synthetic suggestion '+index}))});
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.events={};this.style={};this.value='';this.disabled=false;this.textContent='';this.selectionStart=this.selectionEnd=0;this.maxLength=20000;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  before(node){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),0,node);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(k,v){this[k]=v;}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  removeEventListener(name,fn){this.events[name]=(this.events[name]??[]).filter(f=>f!==fn);}
  fire(name,event={}){for(const fn of this.events[name]??[])fn(event);}
  dispatchEvent(event){this.fire(event.type,event);}
  focus(options){this.focused=options;}
  setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length;}
}
function fixture(custom){
  const composer=new Element('section'),form=new Element('form'),input=new Element('textarea');form.id='turn-form';input.id='input';form.append(input);composer.append(form);
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  const doc={body:composer,createElement:tag=>new Element(tag),getElementById:id=>find(composer,id),defaultView:{Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}}}};
  const calls=[];let context={runId:'run-one',version:1,head:'commit-one',snapshot:{hash:'snapshot-one'}},preserved=0,submitted=0;
  form.addEventListener('submit',()=>submitted++);
  const request=custom??(async(_action,args)=>result(context));
  const ui=mountPlayerIdeas({document:doc,request:async(...args)=>{calls.push(args);return request(...args);},getContext:()=>context,preserveReading:()=>{preserved++;return()=>{};}});ui.update(context);
  return {ui,doc,input,calls,composer,get context(){return context;},set context(v){context=v;},get preserved(){return preserved;},get submitted(){return submitted;},click:id=>doc.getElementById(id).fire('click'),options:()=>doc.getElementById('player-ideas-list').children};
}

test('only clicking generates once and displays all five safe text suggestions; choice never submits',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);f.click('player-ideas-generate');await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'playerIdeas');assert.equal(f.options().length,5);assert.equal(f.options()[0].children[1].textContent,'\n<b>Explore the station</b>');assert.equal(f.options()[0].innerHTML,undefined);
  let edits=0;f.input.addEventListener('input',()=>edits++);f.options()[0].fire('click');assert.equal(f.input.value,'<b>Explore the station</b>');assert.equal(edits,1);assert.equal(f.submitted,0);assert.equal(f.input.focused.preventScroll,true);
  f.click('player-ideas-generate');await tick();assert.equal(f.calls.length,2);assert.equal(f.options().length,5);
});
test('cursor insertion retains every draft character including selected text and notifies normal draft autosave',async()=>{
  const f=fixture();f.input.value='Before selected after';f.input.selectionStart=7;f.input.selectionEnd=15;f.click('player-ideas-generate');await tick();f.options()[1].fire('click');assert.equal(f.input.value,'Before Synthetic suggestion 1\nselected after');assert.equal(f.submitted,0);assert(f.preserved>0);
});
test('IME composition is not overwritten or auto-applied after composition ends',async()=>{
  const f=fixture();f.input.value='正在輸入';f.click('player-ideas-generate');await tick();f.input.fire('compositionstart');f.options()[0].fire('click');assert.equal(f.input.value,'正在輸入');assert.match(f.doc.getElementById('player-ideas-status').textContent,/請先完成/);f.input.fire('compositionend');assert.equal(f.input.value,'正在輸入');f.options()[0].fire('click');assert(f.input.value.includes('正在輸入'));
});
test('run/head changes discard late results and old suggestion buttons cannot insert into a new story',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r)),original=structuredClone(f.context);f.click('player-ideas-generate');await tick();const signal=f.calls[0][2];f.context={...f.context,runId:'run-two'};f.ui.update(f.context);assert.equal(signal.aborted,true);release(result(original));await tick();assert.equal(f.options().length,0);assert.equal(f.input.value,'');
  const g=fixture();g.click('player-ideas-generate');await tick();const old=g.options()[0];g.context={...g.context,head:'new-head',version:2};g.ui.update(g.context);old.fire('click');assert.equal(g.input.value,'');assert.equal(g.options().length,0);g.click('player-ideas-generate');await tick();old.fire('click');assert.equal(g.input.value,'');
});
test('errors and invalid result preserve draft and never retry automatically',async()=>{
  for(const custom of [async()=>{throw Object.assign(Error('unknown'),{code:'CONNECTION_UNKNOWN'});},async()=>({ideas:[]})]){const f=fixture(custom);f.input.value='Keep this draft';f.click('player-ideas-generate');await tick();await tick();assert.equal(f.calls.length,1);assert.equal(f.input.value,'Keep this draft');assert.equal(f.options().length,0);assert.match(f.doc.getElementById('player-ideas-status').textContent,/不會自動重試/);assert.equal(f.doc.getElementById('player-ideas-generate').disabled,false);}
});
test('same run and head in a new session selection stamp cannot accept an old result',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r));f.context={...f.context,selectionStamp:'session-one'};f.ui.update(f.context);f.click('player-ideas-generate');await tick();const prior=structuredClone(f.context);f.context={...f.context,selectionStamp:'session-two'};f.ui.update(f.context);release(result(prior));await tick();assert.equal(f.options().length,0);assert.equal(f.input.value,'');
});
test('open/close and Escape retain results, draft and caret without requesting or focusing the input',async()=>{
  const f=fixture(),toggle=f.doc.getElementById('player-ideas-toggle'),panel=f.doc.getElementById('player-ideas-panel');
  f.input.value='My current draft';f.input.selectionStart=f.input.selectionEnd=3;
  assert.equal(panel.hidden,true);f.click('player-ideas-toggle');assert.equal(panel.hidden,false);assert.equal(f.calls.length,0);assert.equal(f.input.focused,undefined);
  f.click('player-ideas-generate');await tick();const options=[...f.options()];
  f.click('player-ideas-close');assert.equal(panel.hidden,true);assert.equal(toggle['aria-expanded'],'false');
  f.click('player-ideas-toggle');assert.equal(panel.hidden,false);assert.equal(toggle['aria-expanded'],'true');
  let prevented=false;panel.fire('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert(prevented);assert.equal(panel.hidden,true);assert.equal(toggle.focused.preventScroll,true);assert.equal(f.input.focused,undefined);
  assert.deepEqual(f.options(),options);assert.equal(f.calls.length,1);assert.equal(f.input.value,'My current draft');assert.equal(f.input.selectionStart,3);assert.equal(f.submitted,0);
  f.ui.reset();assert.equal(panel.hidden,true);assert.equal(f.input.value,'My current draft');
});
test('cancel aborts just the optional request and discards its late result without retry',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r));f.input.value='Keep draft';f.click('player-ideas-generate');await tick();f.click('player-ideas-generate');assert.equal(f.calls.length,1);const signal=f.calls[0][2];f.click('player-ideas-cancel');assert(signal.aborted);release(result(f.context));await tick();assert.equal(f.options().length,0);assert.equal(f.calls.length,1);assert.equal(f.input.value,'Keep draft');assert.equal(f.doc.getElementById('player-ideas-generate').disabled,false);
});
test('disabled composer, length limits, reset and dispose do not create hidden work',async()=>{
  const f=fixture();f.context={...f.context,disabled:true};f.ui.update(f.context);f.click('player-ideas-generate');await tick();assert.equal(f.calls.length,0);f.context={...f.context,disabled:false};f.ui.update(f.context);f.click('player-ideas-generate');await tick();f.input.value='retain';f.input.maxLength=6;f.options()[0].fire('click');assert.equal(f.input.value,'retain');f.ui.reset();assert.equal(f.options().length,0);assert.equal(f.input.value,'retain');f.ui.dispose();assert.equal(f.doc.getElementById('player-ideas'),undefined);assert.equal(f.calls.length,1);
});
