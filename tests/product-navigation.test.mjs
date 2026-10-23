import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

test('product navigation selects only the three supported panels and never changes Session, scope or Run',async()=>{
 const panels=[];const bridge=createNativeBridge({selectPanel:key=>panels.push(key),call:()=>assert.fail('navigation must not call Host'),openSession:()=>assert.fail('product navigation must not select another Session')});
 for(const screen of ['home','studio','stage'])assert.deepEqual(await bridge.request('native.navigate',{screen}),{opened:true,screen});
 assert.deepEqual(panels,['local-scean-home','local-scean-studio','local-scean']);
 for(const payload of [{},{screen:'toString'},{screen:'__proto__'},{screen:'https://example.invalid'},{screen:'home',sessionId:'other'},{screen:'stage',runId:'other'},{screen:'studio',panel:'other-plugin'},[]])await assert.rejects(bridge.request('native.navigate',payload),e=>['NATIVE_NAVIGATION_INVALID','NATIVE_REQUEST_INVALID'].includes(e.code));
 assert.equal(panels.length,3);await bridge.dispose();await assert.rejects(bridge.request('native.navigate',{screen:'home'}),{code:'NATIVE_PANEL_CLOSED'});
});

test('new reading defaults use prototype font size while saved larger type stays intact',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let value=null;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>value,setItem:(_k,v)=>value=v}});
 try{
  const bridge=createNativeBridge({call:()=>assert.fail('appearance must not call Host')});
  assert.equal((await bridge.request('native.presentationGet')).readingSize,'normal');
  value=JSON.stringify({schemaVersion:1,theme:'dark',readingSize:'large',darkPalette:'wine',readingWidth:'comfortable',leftCollapsed:true});
  const saved=await bridge.request('native.presentationGet');assert.equal(saved.readingSize,'large');assert.equal(saved.darkPalette,'wine');assert.equal(saved.readingWidth,'comfortable');assert.equal(saved.leftCollapsed,true);
 }finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});

test('unavailable source status is read-only display metadata and cannot become a playback scope',async()=>{
 const bridge=createNativeBridge({getSessionId:()=> 'synthetic-archived',call:async request=>{assert.equal(request.action,'context');return {cardScope:null,playbackStatus:{status:'session_archived',authoringBindingRequired:true,privateTitle:'not for UI'}};}});
 assert.deepEqual(await bridge.request('native.context'),{cardScope:null,playbackStatus:{status:'session_archived',authoringBindingRequired:true}});
 await assert.rejects(bridge.request('native.returnToAuthoring',{runId:'old-run'}),{code:'NATIVE_RETURN_TARGET_INVALID'});
});
