import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCardFrontend} from '../isolated/web/card-frontend.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {frontendPreview} from '../core/frontend.mjs';
function setup(){
 let now=0,tick;const nodes=[];
 const placement=[];
 const document={createElement(tag){const n={tag,style:{},attrs:{},events:{},children:[],hidden:false,setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this[k];delete this.attrs[k];},addEventListener(k,fn){this.events[k]=fn;},append(...c){this.children.push(...c);},remove(){}};nodes.push(n);return n;},getElementById(id){assert.equal(id,'chat');return {after(node){placement.push(node);}};}};
 const controller=mountCardFrontend({document,now:()=>now,setTimer:fn=>(tick=fn,1),clearTimer(){}});
 const f=w01Fixture(),x=frontendPreview(f.frontend,f.bp,f.initial),run={runId:'authoring-preview',version:0,head:null,snapshot:{cardId:'authoring-preview',hash:'preview'},cardFrontend:{status:'ready',frontend:x.frontend,projection:x.projection}};
 return {controller,nodes,run,placement,box:nodes.find(n=>n.tag==='section'),frame:nodes.find(n=>n.tag==='iframe'),status:nodes.find(n=>n.tag==='p'),tick(n){now=n;tick();}};
}
test('W01 iframe has empty sandbox/no bridge; stale, unknown and unavailable revoke safe presentation',()=>{
 const f=setup();f.controller.update(f.run);assert.equal(f.frame.attrs.sandbox,'');assert(f.frame.srcdoc.includes('lamp scean-true'));assert.equal(f.frame.events.message,undefined);
 f.tick(16000);assert(f.frame.srcdoc.includes('lamp scean-stale'));f.controller.heartbeat();assert(f.frame.srcdoc.includes('lamp scean-true'));
 f.controller.heartbeat(false);assert(f.frame.srcdoc.includes('lamp scean-stale'));
 for(const status of ['unknown','unavailable']){const r=structuredClone(f.run);r.version=1;r.cardFrontend.projection.canonical.version=1;r.cardFrontend.projection.values.check_1={status};f.controller.clear();f.controller.update(r);assert(f.frame.srcdoc.includes('lamp scean-'+status));}
 f.controller.dispose();
});

const history=run=>({runId:run.runId,snapshotHash:run.snapshot.hash,head:run.head??null});
test('W01 mounts one frame after chat, visible only beside its current committed tail',()=>{
 const f=setup();assert.deepEqual(f.placement,[f.box]);assert.equal(f.nodes.filter(n=>n.tag==='iframe').length,1);
 f.controller.update(f.run);assert.equal(f.box.hidden,true);f.controller.history(history(f.run));assert.equal(f.box.hidden,false);
 for(const change of [{runId:'other'},{snapshotHash:'other'},{head:'older'}]){f.controller.history({...history(f.run),...change});assert.equal(f.box.hidden,true);}
 f.controller.history(history(f.run));assert.equal(f.box.hidden,false);assert.equal(f.frame.attrs.sandbox,'');assert.equal(f.frame.attrs.referrerpolicy,'no-referrer');f.controller.dispose();
});
test('history visibility and repeated current reads preserve iframe identity and document',()=>{
 const f=setup(),frame=f.frame;f.controller.update(f.run);let document=f.frame.srcdoc,writes=0;
 Object.defineProperty(frame,'srcdoc',{get:()=>document,set:value=>{document=value;writes++;},configurable:true});
 for(let i=0;i<5;i++){f.controller.history({...history(f.run),head:'older'});f.controller.history(history(f.run));f.controller.update(f.run);}
 assert.equal(writes,0);assert.equal(f.frame,frame);assert.equal(f.placement.length,1);
 const next=structuredClone(f.run);next.version=1;next.head='commit-one';next.cardFrontend.projection.canonical={version:1,head:'commit-one'};
 f.controller.update(next);assert.equal(f.box.hidden,true);assert.equal(writes,1);f.controller.history(history(next));assert.equal(f.box.hidden,false);assert.equal(writes,1);
 f.nodes.find(n=>n.tag==='button').events.click();assert.equal(f.frame.hidden,true);f.controller.history({...history(next),head:'older'});f.controller.history(history(next));assert.equal(f.frame.hidden,true);f.controller.dispose();
});
test('rollback and regeneration use increasing canonical versions without duplicating the frame',()=>{
 const f=setup();for(const [version,head] of [[1,'first'],[2,null],[3,'regenerated']]){
  const run=structuredClone(f.run);run.version=version;run.head=head;run.cardFrontend.projection.canonical={version,head};
  f.controller.update(run);assert.equal(f.box.hidden,true);f.controller.history(history(run));assert.equal(f.box.hidden,false);assert.equal(f.box.attrs['data-version'],String(version));assert.equal(f.box.attrs['data-head'],head??'');
 }
 assert.equal(f.placement.length,1);f.controller.clear();assert.equal(f.box.hidden,true);assert.equal(f.frame.srcdoc,undefined);assert.equal(f.box.attrs['data-run-id'],undefined);f.controller.dispose();
});
test('a rejected projection cannot be revived by a later heartbeat',()=>{
 const f=setup();f.controller.update(f.run);const invalid=structuredClone(f.run);invalid.cardFrontend.projection.frontendHash='wrong';f.controller.update(invalid);assert.equal(f.frame.hidden,true);f.controller.heartbeat();f.tick(20000);assert.equal(f.frame.hidden,true);assert(f.status.textContent.includes('MISMATCH'));f.controller.dispose();
});
test('W01 late lower versions and cross Run/card/hash packets never replace current display; fallback leaves RP outside iframe',()=>{
 const f=setup(),newer=structuredClone(f.run);newer.version=3;newer.head='new-head';newer.cardFrontend.projection.canonical={version:3,head:'new-head'};
 f.controller.update(newer);f.controller.update(f.run);assert.equal(f.frame.hidden,true);assert(f.status.textContent.includes('MISMATCH'));
 for(const key of ['runId','cardId','snapshotHash','frontendHash']){const r=structuredClone(newer);r.cardFrontend.projection[key]='wrong';f.controller.update(r);assert.equal(f.frame.hidden,true);}
 f.controller.update(newer);assert.equal(f.frame.hidden,false);f.nodes.find(n=>n.tag==='button').events.click();assert.equal(f.frame.hidden,true);assert(f.status.textContent.includes('官方'));f.controller.clear();assert.equal(f.frame.srcdoc,undefined);f.controller.dispose();
});
