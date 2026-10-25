import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';

test('human Scope uses a dedicated invocation, current lease/epoch and rejects a late response after Session switch',async()=>{
 const calls=[],scopeCalls=[],changes=[];let delayed,holdRenew=false;
 const client=new WorkspaceClient({root:'C:/Synthetic',pageId:'synthetic-page',hide(){},show(){},notify(){},setTimer:()=>1,clearTimer(){},send:async(id,r)=>{
  calls.push(r.action);if(r.action==='renew'&&holdRenew)return new Promise(resolve=>delayed=resolve);
  return {ok:true,value:r.action==='acquire'?{lease_id:id,authoring_scope:{mode:'full',epoch:0}}:{authoring_scope:{mode:'full',epoch:0}}};
 },sendScope:async(id,r)=>{scopeCalls.push({id,...r});return {ok:true,value:{authoring_scope:{mode:r.mode,epoch:r.expected_epoch+1}}};}});
 client.scopeChanged=s=>changes.push(s);await client.transition({id:'A',cwd:'C:/Synthetic'});await client.setAuthoringScope('content');
 assert.equal(scopeCalls[0].claim.lease_id,'A');assert.equal(scopeCalls[0].expected_epoch,0);assert.equal(client.authoringScope.mode,'content');assert.equal(calls.includes('scope_set'),false);
 holdRenew=true;const pending=client.heartbeat(client.sequence);await client.transition({id:'B',cwd:'C:/Synthetic'});const count=changes.length;
 delayed({ok:true,value:{authoring_scope:{mode:'content',epoch:12}}});await pending;assert.equal(changes.length,count);assert.deepEqual(client.authoringScope,{mode:'full',epoch:0});await client.close();
});

test('a late human Scope response cannot promote the replacement Session or revive a closed client',async()=>{
 let finish;const client=new WorkspaceClient({root:'C:/Synthetic',pageId:'synthetic-page',hide(){},show(){},notify(){},setTimer:()=>1,clearTimer(){},send:async(id,r)=>({ok:true,value:r.action==='acquire'?{lease_id:id,authoring_scope:{mode:'content',epoch:2}}:{}}),sendScope:()=>new Promise(resolve=>finish=resolve)});
 await client.transition({id:'A',cwd:'C:/Synthetic'});const pending=client.setAuthoringScope('full');await client.transition({id:'B',cwd:'C:/Synthetic'});finish({ok:true,value:{authoring_scope:{mode:'full',epoch:3}}});await assert.rejects(pending,/previous Session/);assert.equal(client.authoringScope.mode,'content');await client.close();
});
