import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nativeHost} from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';
import {bundledSkillsRoot} from '../cardstudio-bundle/lib/workspace-setup.js';
import {cardstudioRemote} from '../cardstudio-bundle/lib/bridge-protocol.js';
import {toolSpecs} from '../cardstudio-bundle/lib/tool-definitions.js';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';
import {sha} from '../cardstudio-bundle/lib/codec.js';

const original='palette-personality-reconstruction',modern='character-authoring',deepener='character-design-deepener';
async function setup(t,{history=[],local=false,beforeStart}={}){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-method-')),old=process.env.DSH_HOME;process.env.DSH_HOME=home;
  let root,config={};
  if(local){root=path.join(home,'workspace');await fs.mkdir(path.join(root,'.cardstudio-scean'),{recursive:true});await fs.writeFile(path.join(root,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Synthetic'}));await fs.cp(bundledSkillsRoot,path.join(root,'.cardstudio-scean/skills'),{recursive:true});config={projectRoot:root};}
  if(beforeStart)await beforeStart(root);
  const state={home,config,host:await nativeHost(home,plugin,config)};root??=state.host.registry.list()[0].path;state.root=root;
  state.agent=state.host.agent('synthetic-method-A',root);state.agent.session.snapshotEvents=()=>history;
  const acquired=await state.host.request(state.agent,{action:'acquire',page_id:'method-page-a-0001'});assert(acquired.ok,JSON.stringify(acquired));state.claim=acquired.value;
  state.info=async()=>{const r=await state.host.request(state.agent,{action:'capabilities',claim:state.claim});assert(r.ok);return r.value;};
  state.set=(name,epoch=undefined,claim=state.claim)=>state.host.ctx.get('cardstudioSceanBridge').setCharacterMethod(state.agent,{name,expected_epoch:epoch??state.claim.character_method.epoch,claim});
  state.pick=async name=>{const result=await state.set(name,(await state.info()).character_method.epoch);assert(result.ok,JSON.stringify(result));return result.value;};
  state.get=name=>state.host.ctx.skills.get(name,{cwd:root,scope:state.agent});
  state.names=async()=>(await state.host.ctx.skills.list({cwd:root,scope:state.agent})).map(x=>x.name);
  state.settingsFile=path.join(root,'.cardstudio-scean/authoring-scopes',sha(Buffer.from(state.agent.id))+'.json');
  t.after(async()=>{await state.host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert(path.basename(home).startsWith('cardstudio-method-'));await fs.rm(home,{recursive:true,force:true});});
  return state;
}


test('only the user original method is selectable and discoverable; removed Palette is refused',async t=>{
 const s=await setup(t);const info=await s.info();assert.equal(info.character_method.name,modern);assert.deepEqual(info.character_method.options.map(x=>x.name),[modern]);
 assert((await s.names()).includes(modern));assert(!(await s.names()).includes(original));assert.equal(await s.get(original),undefined);
 assert.equal((await s.set(original,info.character_method.epoch)).error.code,'CHARACTER_METHOD_CHANGED');
 const body=await s.get(modern);assert(body.content.includes('沒有原始證據不是停止創作的理由'));assert(body.content.includes('七個**思考階段**'));
 for(const ref of ['person-design','social-and-situational','review-and-delivery'])assert((await fs.readFile(path.join(body.resourceBase.path,'references',ref+'.md'),'utf8')).length>100);
 assert((await s.info()).character_method.locked);assert.equal((await s.pick(modern)).character_method.name,modern);
});

test('persisted removed method fails closed without rewriting session settings or private documents',async t=>{
 const saved={schemaVersion:1,mode:'content',epoch:4,characterMethod:{name:original,epoch:7,locked:true,reason:'history'}};
 const s=await setup(t,{local:true,beforeStart:async root=>{const dir=path.join(root,'.cardstudio-scean/authoring-scopes');await fs.mkdir(dir);await fs.writeFile(path.join(dir,sha(Buffer.from('synthetic-method-A'))+'.json'),JSON.stringify(saved));}});
 const before=await fs.readFile(s.settingsFile);const info=await s.info();assert.equal(info.character_method.name,null);assert(info.character_method.locked);assert.equal(info.authoring_scope.mode,'content');
 assert.equal(await s.get(original),undefined);assert.equal(await s.get(modern),undefined);assert((await s.names()).includes('tavern-card-format-preservation'));
 assert.equal((await s.set(modern,0)).error.code,'CHARACTER_METHOD_LOCKED');assert.deepEqual(await fs.readFile(s.settingsFile),before);
});

test('read lock and selected original method survive restart and unrelated scope changes',async t=>{
 const s=await setup(t);await s.get(modern);const scope=await s.host.ctx.get('cardstudioSceanBridge').setAuthoringScope(s.agent,{mode:'content',expected_epoch:0,claim:s.claim});assert(scope.ok);
 const before=await fs.readFile(s.settingsFile);await s.host.close();s.host=await nativeHost(s.home,plugin,s.config);s.agent=s.host.agent('synthetic-method-A',s.root);s.agent.session.snapshotEvents=()=>[];
 s.claim=(await s.host.request(s.agent,{action:'acquire',page_id:'method-restart-0001'})).value;assert.equal(s.claim.character_method.name,modern);assert(s.claim.character_method.locked);assert.equal(s.claim.authoring_scope.mode,'content');assert.deepEqual(await fs.readFile(s.settingsFile),before);
});

test('missing protected method remains unavailable and never falls back to removed content',async t=>{
 const s=await setup(t,{local:true,beforeStart:async root=>fs.unlink(path.join(root,'.cardstudio-scean/skills/character-authoring/SKILL.md'))});
 const info=await s.info();assert.equal(info.character_method.name,modern);assert.equal(info.character_method.available,false);assert(!(await s.names()).includes(modern));assert.equal(await s.get(original),undefined);assert.equal(info.character_method.options.length,1);
});

test('stale human epochs, unknown method schema and generic Agent actions cannot select Palette',async t=>{
 const s=await setup(t);assert.equal((await s.set(modern,99)).error.code,'CHARACTER_METHOD_CHANGED');
 assert.equal((await s.host.request(s.agent,{action:'setCharacterMethod',claim:s.claim,args:{name:original}})).error.code,'ACTION');assert.equal(toolSpecs.some(([name])=>/method|scope/i.test(name)),false);
 const parser=cardstudioRemote.descriptors.find(d=>d.method==='setCharacterMethod').parameters[1].codec.create();assert.throws(()=>parser.parse({name:original,expected_epoch:0,claim:s.claim}));
});

test('late human response cannot apply a method receipt to a replacement Session',async()=>{
 let finish;const changes=[];const client=new WorkspaceClient({root:'C:/Synthetic',pageId:'method-client-page',show(){},hide(){},notify(){},setTimer:()=>1,clearTimer(){},send:async(id,r)=>({ok:true,value:{lease_id:id,character_method:{name:modern,epoch:0,locked:false}}}),sendMethod:()=>new Promise(resolve=>finish=resolve)});client.methodChanged=x=>changes.push(x);
 await client.transition({id:'A',cwd:'C:/Synthetic'});const pending=client.setCharacterMethod(modern);await client.transition({id:'B',cwd:'C:/Synthetic'});finish({ok:true,value:{character_method:{name:modern,epoch:1},skills:[]}});await assert.rejects(pending,/previous Session/);assert.equal(changes.length,0);await client.close();
});
