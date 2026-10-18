import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCardFrontend} from '../isolated/web/card-frontend.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {frontendPreview} from '../core/frontend.mjs';
function setup(){
 let now=0,tick;const nodes=[];
 const document={createElement(tag){const n={tag,style:{},attrs:{},events:{},children:[],hidden:false,setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this[k];delete this.attrs[k];},addEventListener(k,fn){this.events[k]=fn;},append(...c){this.children.push(...c);},before(){},remove(){}};nodes.push(n);return n;},getElementById(){return {before(){}};}};
 const controller=mountCardFrontend({document,now:()=>now,setTimer:fn=>(tick=fn,1),clearTimer(){}});
 const f=w01Fixture(),x=frontendPreview(f.frontend,f.bp,f.initial),run={runId:'authoring-preview',version:0,head:null,snapshot:{cardId:'authoring-preview',hash:'preview'},cardFrontend:{status:'ready',frontend:x.frontend,projection:x.projection}};
 return {controller,nodes,run,frame:nodes.find(n=>n.tag==='iframe'),status:nodes.find(n=>n.tag==='p'),tick(n){now=n;tick();}};
}
test('W01 iframe has empty sandbox/no bridge; stale, unknown and unavailable revoke safe presentation',()=>{
 const f=setup();f.controller.update(f.run);assert.equal(f.frame.attrs.sandbox,'');assert(f.frame.srcdoc.includes('lamp scean-true'));assert.equal(f.frame.events.message,undefined);
 f.tick(16000);assert(f.frame.srcdoc.includes('lamp scean-stale'));f.controller.heartbeat();assert(f.frame.srcdoc.includes('lamp scean-true'));
 f.controller.heartbeat(false);assert(f.frame.srcdoc.includes('lamp scean-stale'));
 for(const status of ['unknown','unavailable']){const r=structuredClone(f.run);r.version=1;r.cardFrontend.projection.canonical.version=1;r.cardFrontend.projection.values.check_1={status};f.controller.clear();f.controller.update(r);assert(f.frame.srcdoc.includes('lamp scean-'+status));}
 f.controller.dispose();
});
test('W01 late lower versions and cross Run/card/hash packets never replace current display; fallback leaves RP outside iframe',()=>{
 const f=setup(),newer=structuredClone(f.run);newer.version=3;newer.head='new-head';newer.cardFrontend.projection.canonical={version:3,head:'new-head'};
 f.controller.update(newer);f.controller.update(f.run);assert.equal(f.frame.hidden,true);assert(f.status.textContent.includes('MISMATCH'));
 for(const key of ['runId','cardId','snapshotHash','frontendHash']){const r=structuredClone(newer);r.cardFrontend.projection[key]='wrong';f.controller.update(r);assert.equal(f.frame.hidden,true);}
 f.controller.update(newer);assert.equal(f.frame.hidden,false);f.nodes.find(n=>n.tag==='button').events.click();assert.equal(f.frame.hidden,true);assert(f.status.textContent.includes('官方'));f.controller.clear();assert.equal(f.frame.srcdoc,undefined);f.controller.dispose();
});
