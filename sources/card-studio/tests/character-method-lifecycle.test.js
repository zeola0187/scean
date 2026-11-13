import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as plugin from '../cardstudio-bundle/index.js';
import {nativeHost} from './helpers/current-host.js';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';
import {hasDialogue} from '../cardstudio-bundle/lib/character-method.js';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {sha} from '../cardstudio-bundle/lib/codec.js';

const original='palette-personality-reconstruction',modern='character-authoring';
const initialEvents=['permission/preset','sandbox/mode','approval/policy'];
async function setup(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-lifecycle-')),old=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const host=await nativeHost(home,plugin,{}, {nativeLifecycle:true});const root=host.registry.list()[0].path;
 t.after(async()=>{try{for(const view of (host.testClients??[]).reverse())await view.close();}finally{await host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert(path.dirname(home)===os.tmpdir()&&path.basename(home).startsWith('cardstudio-lifecycle-'));await fs.rm(home,{recursive:true,force:true});}});
 return {host,root};
}
const acquire=(host,agent,page='native-lifecycle-page')=>host.request(agent,{action:'acquire',page_id:page});
const choose=(host,agent,claim,name=modern)=>host.ctx.get('cardstudioSceanBridge').setCharacterMethod(agent,{name,expected_epoch:claim.character_method.epoch,claim});
const deferred=()=>Promise.withResolvers();
function client(host,root,{send,show=()=>{}}={}){
 const view=new WorkspaceClient({root,pageId:'native-lifecycle-client-page',show,hide(){},notify:error=>{throw error;},setTimer:()=>1,clearTimer(){},send:send??((id,r)=>host.request(host.ctx.agents.get(id),r)),sendMethod:(id,r)=>host.ctx.get('cardstudioSceanBridge').setCharacterMethod(host.ctx.agents.get(id),r)});(host.testClients??=[]).push(view);return view;
}

test('real Host AgentLoop/Permission initialization remains selectable before first input',async t=>{
 const {host,root}=await setup(t),{agent}=await host.createAgent('native-lifecycle-fresh',root);
 assert.deepEqual(agent.session.snapshotEvents().map(x=>x.type),initialEvents);
 const r=await host.request(agent,{action:'acquire',page_id:'native-lifecycle-page-fresh'});assert(r.ok,JSON.stringify(r));assert.equal(r.value.character_method.locked,false);
 const selected=await host.ctx.get('cardstudioSceanBridge').setCharacterMethod(agent,{name:modern,expected_epoch:0,claim:r.value});assert(selected.ok,JSON.stringify(selected));
 assert.equal(selected.value.character_method.name,modern);assert.equal(selected.value.character_method.locked,false);
 const names=(await host.ctx.skills.list({cwd:root,scope:agent})).map(x=>x.name);assert(names.includes(modern));assert(!names.includes(original));
});

test('real Host old-to-new and consecutive new Sessions bind the selected identity before choosing',async t=>{
 const {host,root}=await setup(t),old=(await host.createAgent('native-lifecycle-old',root)).agent;
 // This is actual Agent inbox admission before user/message; no driver wakeup.
 old.inject(createUserMessage({content:[{type:'text',text:'Synthetic input only'}],source:{kind:'synthetic'}}));assert(hasDialogue(old));
 const view=client(host,root);await view.transition({id:old.id,cwd:root});assert(view.characterMethod.locked);
 for(const id of ['native-lifecycle-new-one','native-lifecycle-new-two']){
  const a=(await host.createAgent(id,root)).agent;await view.transition({id,cwd:root});assert.equal(view.current.id,id);assert.equal(view.characterMethod.name,modern);assert.equal(view.characterMethod.locked,false);
  await view.setCharacterMethod(modern);assert.equal(view.characterMethod.name,modern);assert.equal(hasDialogue(a),false);
  assert((await host.ctx.skills.list({cwd:root,scope:a})).some(s=>s.name===modern));
 }
 await view.transition({id:old.id,cwd:root});assert.equal(view.characterMethod.name,modern);assert(view.characterMethod.locked);await view.setCharacterMethod(modern);assert(view.characterMethod.locked);
});

test('real delayed Host initialization and a superseded acquisition cannot restore the previous Session',async t=>{
 const {host,root}=await setup(t),gate=deferred(),entered=deferred();
 const pending=host.createAgent('native-lifecycle-delayed',root,async()=>{entered.resolve();await gate.promise;});await entered.promise;
 assert.equal(host.ctx.agents.get('native-lifecycle-delayed'),undefined);
 const b=(await host.createAgent('native-lifecycle-replacement',root)).agent;
 const view=client(host,root,{send:async(id,r)=>{const a=id==='native-lifecycle-delayed'?(await pending).agent:host.ctx.agents.get(id);return host.request(a,r);}});
 const first=view.transition({id:'native-lifecycle-delayed',cwd:root});await view.transition({id:b.id,cwd:root});assert.equal(view.current.id,b.id);assert.equal(view.characterMethod.locked,false);await view.setCharacterMethod(modern);
 gate.resolve();await first;const a=(await pending).agent;assert.deepEqual(a.session.snapshotEvents().map(x=>x.type),initialEvents);assert.equal(view.current.id,b.id);assert.equal(view.characterMethod.name,modern);assert.equal(view.phase,'ready');
});

test('late capabilities from old Host Session cannot overwrite a consecutive new Session',async t=>{
 const {host,root}=await setup(t),a=(await host.createAgent('native-lifecycle-caps-old',root)).agent,b=(await host.createAgent('native-lifecycle-caps-new',root)).agent,gate=deferred(),entered=deferred();
 const view=client(host,root,{send:async(id,r)=>{const result=await host.request(host.ctx.agents.get(id),r);if(id===a.id&&r.action==='capabilities'){entered.resolve();await gate.promise;}return result;}});
 const first=view.transition({id:a.id,cwd:root});await entered.promise;await view.transition({id:b.id,cwd:root});await view.setCharacterMethod(modern);gate.resolve();await first;
 assert.equal(view.current.id,b.id);assert.equal(view.characterMethod.name,modern);assert.equal(view.characterMethod.locked,false);assert.equal(view.phase,'ready');
});

test('latest Host lock state is applied before synchronous UI show; discovery alone does not lock',async t=>{
 const {host,root}=await setup(t),a=(await host.createAgent('native-lifecycle-read-race',root)).agent;let view,shown;
 view=client(host,root,{send:async(id,r)=>{if(r.action==='capabilities'){const names=await host.ctx.skills.list({cwd:root,scope:a});assert(names.some(x=>x.name===modern));const prior=await host.request(a,r);assert.equal(prior.value.character_method.locked,false);await host.ctx.skills.get(modern,{cwd:root,scope:a});}return host.request(a,r);},show:value=>{shown=view.characterMethod;assert.deepEqual(shown,value.character_method);}});
 await view.transition({id:a.id,cwd:root});assert.equal(view.phase,'ready');assert(shown.locked);await assert.rejects(view.setCharacterMethod(original),/CHARACTER_METHOD_CHANGED/);
});

test('real inbox input, method reads and unknown/inherited history remain locked; old stored locks are retained',async t=>{
 const {host,root}=await setup(t),a=(await host.createAgent('native-lifecycle-config',root)).agent;
 a.session.append('model/selection',{provider:'forbidden',model:'no-inference'});assert.equal(hasDialogue(a),false);
 const r=await acquire(host,a);assert(r.ok);const chosen=await choose(host,a,r.value);assert(chosen.ok);
 a.inject(createUserMessage({content:[{type:'text',text:'Synthetic first input'}],source:{kind:'synthetic'}}));assert(hasDialogue(a));assert.equal((await choose(host,a,{...r.value,...chosen.value},original)).error.code,'CHARACTER_METHOD_CHANGED');
 const read=(await host.createAgent('native-lifecycle-read',root)).agent,readClaim=(await acquire(host,read)).value;
 await host.ctx.skills.get(modern,{cwd:root,scope:read});assert.equal((await choose(host,read,readClaim,original)).error.code,'CHARACTER_METHOD_CHANGED');
 const held=(await host.createAgent('native-lifecycle-old-saved-lock',root)).agent;
 await fs.writeFile(path.join(root,'.cardstudio-scean/authoring-scopes',sha(Buffer.from(held.id))+'.json'),JSON.stringify({schemaVersion:1,mode:'full',epoch:0,characterMethod:{name:original,epoch:0,locked:true,reason:'history'}}));
 const existing=(await acquire(host,held)).value;assert.equal(existing.character_method.name,null);assert(existing.character_method.locked);assert.equal((await choose(host,held,existing)).error.code,'CHARACTER_METHOD_LOCKED');
 assert(hasDialogue({session:{header:{},snapshotEvents:()=>[{type:'unknown/history'}]}}));assert(hasDialogue({session:{header:{isSeeded:true},snapshotEvents:()=>[{type:'session/end-seed',data:{inherited:true}}]}}));
 assert.equal(hasDialogue({session:{header:{isSeeded:false},snapshotEvents:()=>[{type:'session/end-seed',data:{}}]}}),false);
 assert(hasDialogue({session:{header:{}}}));
});
