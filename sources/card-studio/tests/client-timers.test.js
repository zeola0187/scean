import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';

const source=(await fs.readFile(new URL('../cardstudio-bundle/lib/client-controller.js',import.meta.url),'utf8')).replace('export class WorkspaceClient','class WorkspaceClient');
const row={id:'synthetic-session',cwd:'C:/Synthetic/Card Studio'};
function fixture({failAcquire=false,failPresent=false,failRenew=false}={}){
  const timers=new Map(),delays=new Map(),calls=[],errors=[];let next=0,global;
  const receiver=value=>{if(value!==undefined&&value!==null&&value!==global)throw new TypeError('Illegal invocation');};
  const context=vm.createContext({
    AbortController,
    setInterval:function(callback,delay){receiver(this);assert.equal(delay,20000);timers.set(++next,callback);return next;},
    clearInterval:function(handle){receiver(this);timers.delete(handle);},
    setTimeout:function(callback,delay){receiver(this);delays.set(++next,{callback,delay});return next;},
    clearTimeout:function(handle){receiver(this);delays.delete(handle);},
  });
  global=vm.runInContext('globalThis',context);
  vm.runInContext(source+'\nglobalThis.makeClient=options=>new WorkspaceClient(options);',context);
  const client=global.makeClient({root:row.cwd,pageId:'synthetic-page',hide:()=>calls.push('hide'),
    present:()=>{calls.push('present');if(failPresent){failPresent=false;throw new TypeError('synthetic presentation failure');}},
    show:()=>calls.push('show'),notify:error=>errors.push(error),send:async(_id,request)=>{
      calls.push(request.action);
      if(request.action==='acquire'&&failAcquire){failAcquire=false;return {ok:false,error:{code:'SYNTHETIC',message:'acquire failed once'}};}
      if(request.action==='renew'&&failRenew){failRenew=false;return {ok:false,error:{message:'renew failed once'}};}
      return {ok:true,value:request.action==='acquire'?{lease_id:'synthetic-lease'}:{skills:[],tools:[]}};
    }});
  return {client,timers,delays,calls,errors};
}

test('browser timer receiver: no Session -> valid -> repeat -> Other -> valid -> repeated disposal',async()=>{
  const {client,timers,calls}=fixture();
  try{
    await client.transition(undefined);await client.transition(undefined);
    assert.equal(client.phase,'inactive');assert.equal(timers.size,0);assert(!calls.includes('acquire'));
    await client.transition(row);assert.equal(client.phase,'ready');assert.equal(timers.size,1);
    const before=calls.length;await client.transition(row);assert.equal(calls.length,before);
    await client.transition({...row,cwd:'E:/synthetic-other'});assert.equal(client.phase,'inactive');assert.equal(timers.size,0);
    await client.transition(row);assert.equal(client.phase,'ready');assert.equal(timers.size,1);
    await client.close();await client.close();assert.equal(timers.size,0);
    assert.equal(calls.filter(value=>value==='acquire').length,2);
    assert.equal(calls.filter(value=>value==='release').length,2);
  }finally{await client.close().catch(()=>{});}
});

test('browser timer receiver: failed acquire can retry and failed heartbeat can reacquire without timer leaks',async()=>{
  const {client,timers,errors}=fixture({failAcquire:true,failRenew:true});
  try{
    await client.transition(undefined);await client.transition(row);
    assert.equal(client.phase,'error');assert.equal(timers.size,1);assert.equal(errors.length,1);
    await client.retry();assert.equal(client.phase,'ready');assert.equal(timers.size,1);
    await client.heartbeat(client.sequence);assert.equal(client.phase,'ready');assert.equal(timers.size,1);
    assert.equal(errors.length,2);
  }finally{await client.close().catch(()=>{});}
  assert.equal(timers.size,0);
});

test('presentation failure enters retryable error instead of poisoning the selected Session identity',async()=>{
  const {client,timers,errors,calls}=fixture({failPresent:true});
  try{
    await client.transition(row);assert.equal(client.phase,'error');assert.equal(errors.length,1);
    assert.equal(calls.includes('acquire'),false);
    await client.retry();assert.equal(client.phase,'ready');assert.equal(timers.size,1);
  }finally{await client.close().catch(()=>{});}
  assert.equal(timers.size,0);
});

test('slow renewal is single flight and a late failure cannot resurrect a disposed Client',async()=>{
 let settle;const calls=[],timers=new Set(),errors=[];
 const client=new WorkspaceClient({root:row.cwd,pageId:'synthetic-page',hide(){},show(){},notify:e=>errors.push(e),setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn),send:async(_id,r)=>{
  calls.push(r.action);if(r.action==='renew')return new Promise(resolve=>{settle=resolve;});return {ok:true,value:r.action==='acquire'?{lease_id:'synthetic-lease'}:{skills:[],tools:[]}};
 }});
 await client.transition(row);const timer=[...timers][0],pending=timer();await timer();await timer();assert.equal(calls.filter(x=>x==='renew').length,1);
 const closing=client.close();assert.equal(timers.size,0);settle({ok:false,error:{message:'Synthetic late offline failure'}});await pending;await closing;
 assert.equal(calls.filter(x=>x==='acquire').length,1);assert.equal(calls.filter(x=>x==='release').length,1);assert.equal(errors.length,0);assert.equal(client.phase,'inactive');
});
