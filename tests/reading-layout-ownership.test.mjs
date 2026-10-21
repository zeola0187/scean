import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReadingLayout,captureReadingAnchor} from '../isolated/web/reading-layout.mjs';

function fixture(){
 const events=new Map(),frames=new Map();let sequence=0,observe,disconnected=false,scale=1;
 const text={isConnected:true,contains:value=>value===text,getBoundingClientRect:()=>({top:-reading.scrollTop,bottom:reading.scrollHeight-reading.scrollTop,left:0})};
 const reading={isConnected:true,clientWidth:600,clientHeight:200,scrollHeight:3000,scrollTop:2800,
  getBoundingClientRect:()=>({top:0,bottom:reading.clientHeight,height:reading.clientHeight,left:0}),querySelectorAll:()=>[text],contains:value=>value===text,
  addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 reading.ownerDocument={caretPositionFromPoint:(x,y)=>({offsetNode:text,offset:(reading.scrollTop+y)/scale}),createRange(){return{setStart(node,offset){this.startContainer=node;this.offset=offset;},collapse(){},getBoundingClientRect(){return{top:this.offset*scale-reading.scrollTop};}};}};
 const layout=mountReadingLayout(reading,{requestFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){observe=fn;}observe(){observe();}disconnect(){disconnected=true;}}});
 return{reading,layout,emit:()=>observe(),event:(name,value={})=>events.get(name)?.(value),scale:value=>scale=value,flush(){for(let i=0;i<10&&frames.size;i++)for(const[id,fn]of [...frames]){frames.delete(id);fn();}},get frames(){return frames.size;},get listeners(){return events.size;},get disconnected(){return disconnected;}};
}

test('composer resize and appended content preserve a text Range rather than an old implicit end',()=>{
 const f=fixture();assert.deepEqual(captureReadingAnchor(f.reading),{end:true});
 f.reading.scrollHeight=5000;f.reading.clientHeight=240;f.emit();f.flush();assert.equal(f.reading.scrollTop,2800);f.layout.dispose();
});
test('explicit committed-player placement adopts its own anchor and cancels a queued old restore',()=>{
 const f=fixture();f.reading.clientHeight=240;f.emit();assert(f.frames);
 f.reading.scrollTop=1100;f.layout.adopt();f.flush();assert.equal(f.reading.scrollTop,1100);
 f.scale(1.2);f.reading.clientWidth=520;f.emit();f.flush();assert(Math.abs(f.reading.scrollTop-1332.8)<.001);f.layout.dispose();
});
test('manual movement wins over both pending animation-frame restore and a following resize',()=>{
 for(const type of ['wheel','touchmove','pointerdown','keydown']){
  const f=fixture();f.reading.clientHeight=240;f.emit();f.event(type,{key:'PageUp'});f.reading.scrollTop=200;f.event('scroll');f.reading.clientHeight=280;f.emit();f.flush();assert.equal(f.reading.scrollTop,200,type);f.layout.dispose();
 }
});
test('obsolete preserve callback cannot undo a newer navigation and dispose removes all scheduled work',()=>{
 const f=fixture(),restore=f.layout.preserve();f.reading.scrollTop=1400;f.layout.adopt();restore();f.flush();assert.equal(f.reading.scrollTop,1400);
 f.event('wheel');f.layout.dispose();assert.equal(f.frames,0);assert.equal(f.listeners,0);assert(f.disconnected);
});
