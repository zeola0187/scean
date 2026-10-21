import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlayerReaders} from '../isolated/web/player-readers-ui.mjs';
import {playerWorldbook,playerRecap} from '../core/player-readers.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';

const tick=()=>new Promise(setImmediate),wait=async()=>{await tick();await tick();};
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.style={};this.dataset={};this.events={};this.attrs={};this.hidden=false;this.disabled=false;this.value='';this.open=false;this._text='';}
 set id(v){this._id=v;this.doc.ids.set(v,this);}get id(){return this._id;}
 set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerHTML(v){throw Error('HTML rendering is forbidden');}
 setAttribute(k,v){this.attrs[k]=v;}append(...nodes){for(const n of nodes){if(n.parent)n.remove();n.parent=this;this.children.push(n);}}
 insertBefore(node,before){if(node.parent)node.remove();node.parent=this;const i=this.children.indexOf(before);if(i<0)this.children.push(node);else this.children.splice(i,0,node);}
 get firstChild(){return this.children[0]??null;}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 addEventListener(k,fn){(this.events[k]??=[]).push(fn);}fire(k,event={}){return Promise.all((this.events[k]??[]).map(fn=>fn({preventDefault(){},...event})));}
 focus(){this.doc.activeElement=this;}click(){if(!this.disabled)return this.fire('click');}showModal(){this.open=true;}close(value){this.returnValue=value;this.open=false;void this.fire('close');}
 find(fn){for(const n of this.children){if(fn(n))return n;const d=n.find(fn);if(d)return d;}return null;}
 querySelector(selector){if(selector==='[data-reader-more]')return this.find(n=>n.dataset.readerMore!==undefined);if(selector==='[data-reader-content-more]')return this.find(n=>n.dataset.readerContentMore!==undefined);return null;}
}
function setup({run,request}={}){
 const ids=new Map(),doc={ids,activeElement:null,createElement(tag){return new Element(tag,this);},getElementById(id){return ids.get(id);}};doc.body=doc.createElement('body');const main=doc.createElement('main'),composer=doc.createElement('section'),draft=doc.createElement('textarea');draft.id='input';draft.value='EXISTING_DRAFT';composer.append(draft);main.append(composer);doc.body.append(main);doc.querySelector=selector=>selector==='.composer'?composer:selector==='main'?main:selector==='dialog[open]'?doc.body.find(n=>n.tagName==='DIALOG'&&n.open):null;
 let current=run,preserved=0,restored=0,navigated=[];const calls=[];
 const ui=mountPlayerReaders({document:doc,getContext:()=>({sessionId:'synthetic-session',cardId:'synthetic-card',epoch:1}),preserveReading(){preserved++;return()=>restored++;},onNavigate:target=>navigated.push(target),request:async(action,args)=>{calls.push({action,args});return request?request(action,args):action==='playerWorldbook'?playerWorldbook(current,args):playerRecap(current,args);}});
 return{doc,ui,calls,draft,navigated,update(value){current=value;ui.update(value);},get(id){return ids.get(id);},button(text){return doc.body.find(n=>n.tagName==='BUTTON'&&n.textContent===text);},get preserved(){return preserved;},get restored(){return restored;}};
}
const world=(runId='one',content='A safe public setting.')=>({runId,version:1,head:'commit-one',turns:[],snapshot:{hash:'snapshot-'+runId,worldbook:{visibility:'public',entries:[{name:'設定標題',content}]}}});
test('readers are on-demand, read-only and preserve draft, reading anchor and accessible close focus',async()=>{
 const run=world(),f=setup({run});assert.equal(f.calls.length,0);assert(f.get('player-worldbook-open').disabled);f.update(run);await f.get('player-worldbook-open').click();await wait();assert.equal(f.calls.length,1);assert.equal(f.get('player-reader-title').textContent,'世界書');assert(f.get('player-reader-list').textContent.includes('設定標題'));assert.equal(f.draft.value,'EXISTING_DRAFT');
 await f.button('設定標題').click();await wait();assert(f.get('player-reader-detail').textContent.includes('A safe public setting.'));assert(f.get('player-reader-list').hidden);await f.button('返回目錄').click();assert(!f.get('player-reader-list').hidden);
 await f.button('返回故事').click();assert.equal(f.preserved,1);assert.equal(f.restored,1);assert.equal(f.doc.activeElement,f.get('player-worldbook-open'));assert.equal(f.draft.value,'EXISTING_DRAFT');assert(f.calls.every(c=>c.action==='playerWorldbook'));f.ui.dispose();
});

test('worldbook search and detail use text safely, with no HTML or draft mutation',async()=>{
 const run=world('one','<script>hostCommand()</script> <img src="private">文字'),f=setup({run});f.update(run);await f.get('player-worldbook-open').click();await wait();f.get('player-worldbook-query').value='文字';await f.get('player-worldbook-query').parent.fire('submit');await wait();assert.equal(f.calls.at(-1).args.query,'文字');await f.button('設定標題').click();await wait();assert(f.get('player-reader-detail').textContent.includes('<script>hostCommand()</script>'));assert.equal(f.doc.body.find(n=>n.tagName==='SCRIPT'),null);assert.equal(f.draft.value,'EXISTING_DRAFT');f.ui.dispose();
});

test('late Run response cannot overwrite the new Run dialog; reset invalidates requests and actions',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),old=world('old','OLD_TEXT'),next=world('new','NEW_TEXT');const f=setup({run:old,request:async(action,args)=>args.runId==='old'?gate:playerWorldbook(next,args)});f.update(old);await f.get('player-worldbook-open').click();f.update(next);await wait();release(playerWorldbook(old));await wait();assert(!f.get('player-reader-list').textContent.includes('OLD_TEXT'));await f.button('設定標題').click();await wait();assert(f.get('player-reader-detail').textContent.includes('NEW_TEXT'));f.ui.reset();assert(f.get('player-worldbook-open').disabled);assert(!f.get('player-reader-dialog').open);assert.equal(f.draft.value,'EXISTING_DRAFT');f.ui.dispose();
});

test('mismatched history identity yields retry without stale detail or automatic generation',async()=>{
 const run=world(),f=setup({run,request:async()=>({...playerWorldbook(run),head:'old-head'})});f.update(run);await f.get('player-worldbook-open').click();await wait();assert.match(f.get('player-reader-status').textContent,/故事已更新/);assert.equal(f.get('player-reader-list').textContent,'');assert(!f.button('重新讀取').hidden);assert.equal(f.calls.length,1);assert.equal(f.draft.value,'EXISTING_DRAFT');f.ui.dispose();
});

test('empty worlds and recap missing payload show clear states; source jump is explicit only',async()=>{
 const run=syntheticLongrun({turns:3,chapters:1});run.snapshot.worldbook={entries:[{content:'UNMARKED_NOT_VISIBLE'}]};const f=setup({run});f.update(run);await f.get('player-worldbook-open').click();await wait();assert.match(f.get('player-reader-status').textContent,/沒有標示/);await f.button('返回故事').click();await f.get('player-recap-open').click();await wait();const row=f.get('player-reader-list').find(n=>n.tagName==='BUTTON');await row.click();await wait();assert.match(f.get('player-reader-detail').textContent,/這一章尚無摘要/);assert.equal(f.navigated.length,0);await f.button('回到這一章').click();assert.deepEqual(f.navigated,[{runId:run.runId,commitId:run.turns[0].commitId}]);assert(!f.get('player-reader-dialog').open);assert(f.calls.every(c=>['playerWorldbook','playerRecap'].includes(c.action)));f.ui.dispose();
});

test('reader detail loads full long content in bounded explicit chunks and closes with Escape',async()=>{
 const content='合成 '.repeat(12000),run=world('one',content),f=setup({run});f.update(run);await f.get('player-worldbook-open').click();await wait();await f.button('設定標題').click();await wait();assert(f.button('繼續閱讀'));while(f.button('繼續閱讀')){await f.button('繼續閱讀').click();await wait();}const all=f.get('player-reader-detail').children.filter(n=>n.className==='player-reader-text').map(n=>n.textContent).join('');assert.equal(all,content);await f.get('player-reader-dialog').fire('cancel');assert(!f.get('player-reader-dialog').open);assert.equal(f.restored,1);f.ui.dispose();
});
