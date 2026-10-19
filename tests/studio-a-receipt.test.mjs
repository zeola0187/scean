import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

const scope={provider:'@local/dsh-card-studio-scean-test',cardId:'card-a',authoringSessionId:'session-a',generation:'generation-a',savedRevision:3};
const choice={offerId:'offer-a',cardId:'card-a',revision:3,snapshotHash:'offered-hash',openingIndex:1,playerName:'旅人'};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};

test('opening receipt uses authenticated current request context and the real Host result',async()=>{
 const receipts=[],result={runId:'opening-offer-a',binding:'host-issued-binding'},bridge=createNativeBridge({getSessionId:()=>scope.authoringSessionId,selectPanel(){},call:async request=>request.action==='context'?{cardScope:scope}:result,onOpeningStarted:receipt=>receipts.push(receipt)});
 await bridge.request('native.context');
 assert.deepEqual(await bridge.request('openingStart',choice),result);
 assert.equal(receipts.length,1);assert.deepEqual(receipts[0],{request:{...choice,action:'openingStart',sessionId:'session-a',cardScope:scope},value:result});
 await bridge.dispose();
});

test('late successful opening replies never notify another Session or a closed player',async()=>{
 for(const close of [false,true]){
  const waiting=deferred(),receipts=[],bridge=createNativeBridge({getSessionId:()=>scope.authoringSessionId,selectPanel(){},call:async request=>request.action==='context'?{cardScope:scope}:waiting.promise,onOpeningStarted:value=>receipts.push(value)});
  await bridge.request('native.context');const request=bridge.request('openingStart',choice);
  if(close)await bridge.dispose();else bridge.clearContext();waiting.resolve({runId:'opening-offer-a',binding:'saved-binding'});
  await assert.rejects(request,{code:close?'NATIVE_PANEL_CLOSED':'NATIVE_CONTEXT_STALE'});assert.deepEqual(receipts,[]);
 }
});

test('failed or incomplete opening replies do not create a success receipt',async()=>{
 for(const result of [{openingRequired:true},{runId:'missing-binding'}]){
  const receipts=[],bridge=createNativeBridge({getSessionId:()=>scope.authoringSessionId,selectPanel(){},call:async request=>request.action==='context'?{cardScope:scope}:result,onOpeningStarted:value=>receipts.push(value)});
  await bridge.request('native.context');await bridge.request('openingStart',choice);assert.deepEqual(receipts,[]);await bridge.dispose();
 }
 const receipts=[],bridge=createNativeBridge({call:async()=>{throw Object.assign(Error('failure'),{code:'OPENING_STALE'});},selectPanel(){},onOpeningStarted:value=>receipts.push(value)});
 await assert.rejects(bridge.request('openingStart',choice),{code:'OPENING_STALE'});assert.deepEqual(receipts,[]);await bridge.dispose();
});
