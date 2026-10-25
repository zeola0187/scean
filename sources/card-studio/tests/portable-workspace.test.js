import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as plugin from '../cardstudio-bundle/index.js';
import { prepareWorkspace,loadSkills,bundledSkillsRoot } from '../cardstudio-bundle/lib/workspace-setup.js';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';
import { nativeHost } from './helpers/current-host.js';

async function isolated(run){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-portable-')),home=path.join(base,'Clean user 空白','Harness Home');
  const previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
  try { await run({base,home}); }
  finally { if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(base),os.tmpdir());assert(path.basename(base).startsWith('cardstudio-portable-'));await fs.rm(base,{recursive:true,force:true}); }
}
async function hashes(root){
  const rows={};for(const entry of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory()){for(const [name,hash] of Object.entries(await hashes(file)))rows[entry.name+'/'+name]=hash;}else rows[entry.name]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}return rows;
}
test('portable Host uses DSH_HOME, native registry and bundled nine skills/32 readable references without a model or old workspace',()=>isolated(async({home})=>{
  const host=await nativeHost(home,plugin);
  try{
    const [workspace]=host.registry.list();assert.equal(host.registry.list().length,1);assert.equal(workspace.title,'Card Studio SCEAN Test');assert.equal(workspace.path.toLowerCase(),path.join(home,'card-studio-scean-test','workspace').toLowerCase());assert.deepEqual(workspace.sessionIds,[]);
    const a=host.agent('portable-synthetic-A',workspace.path),b=host.agent('portable-synthetic-other',home);
    assert.deepEqual((await host.request(a,{action:'workspace'})).value,{workspace:workspace.path});
    assert.equal((await host.request({...a},{action:'workspace'})).ok,false,'No forged agent identity');
    assert.equal((await host.request(b,{action:'acquire',page_id:'other-page-001'})).ok,false);
    const acquired=await host.request(a,{action:'acquire',page_id:'portable-page-001'});assert(acquired.ok,JSON.stringify(acquired));
    const skills=await host.ctx.skills.list({cwd:workspace.path,scope:a});assert.equal(skills.length,9);assert.equal(host.ctx.tools.schemas(a).length,29);assert.equal(host.ctx.tools.schemas(b).length,0);
    let referenceCount=0;
    for(const row of skills){const skill=await host.ctx.skills.get(row.name,{cwd:workspace.path,scope:a});assert(skill.content.length>100);assert.equal(skill.resourceBase.path,path.join(bundledSkillsRoot,row.name));for(const name of await fs.readdir(path.join(skill.resourceBase.path,'references'))){assert((await fs.readFile(path.join(skill.resourceBase.path,'references',name),'utf8')).length>0);referenceCount++;}}
    assert.equal(referenceCount,32);assert.deepEqual((await host.request(a,{action:'imports',claim:acquired.value})).value,[]);assert.equal((await host.request(a,{action:'documents',claim:acquired.value,args:{}})).value.total,0);
    const released=await host.request(a,{action:'release',claim:acquired.value});assert(released.ok,JSON.stringify(released));assert.equal((await host.ctx.skills.list({cwd:workspace.path,scope:a})).length,0);
  }finally{await host.close();}
}));
test('restart/reinstall preserves workspace identity, name, imports, exports, custom skills and state byte-for-byte',()=>isolated(async({home})=>{
  let host=await nativeHost(home,plugin);const workspace=host.registry.list()[0],root=workspace.path,id=workspace.id;
  await workspace.setTitle('User-chosen title');await host.close();
  for(const [name,body] of Object.entries({'imports/user.json':'SYNTHETIC USER IMPORT','exports/user.txt':'SYNTHETIC USER EXPORT','.cardstudio-scean/user-settings.json':'{"synthetic":true}','.cardstudio-scean/skills/custom/SKILL.md':'SYNTHETIC CUSTOM SKILL'})){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),body);}
  const before=await hashes(root);delete before['.cardstudio-scean/runtime-status.json'];
  for(let i=0;i<3;i++){host=await nativeHost(home,plugin);try{assert.equal(host.registry.list().length,1);assert.equal(host.registry.list()[0].id,id);assert.equal(host.registry.list()[0].title,'User-chosen title');}finally{await host.close();}}
  const after=await hashes(root);delete after['.cardstudio-scean/runtime-status.json'];assert.deepEqual(after,before);
}));
test('explicit legacy projectRoot retains its local skill files and never initializes the portable home',()=>isolated(async({base,home})=>{
  const root=path.join(base,'Existing Card Studio');await fs.mkdir(path.join(root,'.cardstudio-scean'),{recursive:true});
  await fs.writeFile(path.join(root,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Existing'}));await fs.cp(bundledSkillsRoot,path.join(root,'.cardstudio-scean/skills'),{recursive:true});
  const original=await hashes(path.join(root,'.cardstudio-scean'));const prepared=await prepareWorkspace({projectRoot:root});
  assert.equal(prepared.portable,false);assert.equal(prepared.skillsRoot,path.join(root,'.cardstudio-scean/skills'));assert.deepEqual(await hashes(path.join(root,'.cardstudio-scean')),original);await assert.rejects(fs.stat(home),{code:'ENOENT'});
  assert.equal((await loadSkills(prepared.skillsRoot)).length,9);
}));
test('portable setup rejects junctions, invalid manifests and conflicting files without overwriting or escaping',()=>isolated(async({base,home})=>{
  await fs.mkdir(home,{recursive:true});const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');
  const link=path.join(home,'card-studio-scean-test');await fs.symlink(outside,link,'junction');
  await assert.rejects(prepareWorkspace({}, {create(){assert.fail('must not register');}}),e=>e.code==='CONFIG');assert.deepEqual(await fs.readdir(outside),['keep.txt']);await fs.unlink(link);
  const prepared=await prepareWorkspace({}, {create:async()=>{}});const file=path.join(prepared.root,'.cardstudio-scean/workspace.json');await fs.writeFile(file,'{"schemaVersion":99,"capability":"card-studio"}');
  await assert.rejects(prepareWorkspace({}, {create(){assert.fail('invalid manifest registered');}}),e=>e.code==='CONFIG');assert.equal(await fs.readFile(file,'utf8'),'{"schemaVersion":99,"capability":"card-studio"}');
}));
test('relative projectRoot and missing registry fail before creating user data',()=>isolated(async({home})=>{
  await assert.rejects(prepareWorkspace({projectRoot:'../escape'}),e=>e.code==='CONFIG');await assert.rejects(prepareWorkspace(),e=>e.code==='CONFIG');await assert.rejects(fs.stat(home),{code:'ENOENT'});
}));
test('initialization refuses conflicting files and linked internal data directories before writing through them',()=>isolated(async({base,home})=>{
  const registry={create:async()=>{}},outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'sentinel'),'UNCHANGED');
  await fs.mkdir(home,{recursive:true});await fs.writeFile(path.join(home,'card-studio-scean-test'),'CONFLICT');
  await assert.rejects(prepareWorkspace({},registry),e=>e.code==='CONFIG');assert.equal(await fs.readFile(path.join(home,'card-studio-scean-test'),'utf8'),'CONFLICT');await fs.unlink(path.join(home,'card-studio-scean-test'));
  const {root}=await prepareWorkspace({},registry);
  for(const name of ['imports','exports','.cardstudio-scean/documents']){
    const target=path.join(root,name);await fs.rmdir(target);await fs.symlink(outside,target,'junction');
    await assert.rejects(prepareWorkspace({},registry),e=>e.code==='CONFIG');assert.deepEqual(await fs.readdir(outside),['sentinel']);await fs.unlink(target);await fs.mkdir(target);
  }
}));
test('skill loading refuses catalog traversal and duplicate names',()=>isolated(async({base})=>{
  const root=path.join(base,'skills');await fs.mkdir(root);await fs.writeFile(path.join(root,'catalog.json'),JSON.stringify([{name:'../outside',description:'synthetic'}]));await assert.rejects(loadSkills(root),e=>e.code==='SKILL');
  await fs.cp(bundledSkillsRoot,root,{recursive:true});const rows=JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));rows.push(rows[0]);await fs.writeFile(path.join(root,'catalog.json'),JSON.stringify(rows));await assert.rejects(loadSkills(root),e=>e.code==='SKILL');
}));
test('Client learns its root from Host and discards a late discovery after leaving or closing',async()=>{
  for(const close of [false,true]){
    let resolve;const delayed=new Promise(done=>{resolve=done;}),calls=[];
    const client=new WorkspaceClient({send:async(id,r)=>{calls.push(r.action);return delayed;},pageId:'portable-page-002',hide(){},notify(){assert.fail('stale discovery notified');}});
    const request=client.transition({id:'synthetic-A',cwd:'C:/Synthetic/Card Studio'});if(close)await client.close();else await client.transition(null);resolve({ok:true,value:{workspace:'C:/Synthetic/Card Studio'}});await request;assert.deepEqual(calls,['workspace']);assert.equal(client.root,null);if(!close)await client.close();
  }
});
test('Client accepts a Host-resolved UNC workspace without a compiled machine path',async()=>{
  const root='\\\\synthetic-server\\share\\Card Studio',calls=[];let shown=false;
  const client=new WorkspaceClient({send:async(_id,r)=>{calls.push(r.action);return {ok:true,value:r.action==='workspace'?{workspace:root}:r.action==='capabilities'?{skills:[],tools:[]}:{lease_id:'synthetic'}};},pageId:'portable-page-003',hide(){},show(){shown=true;},notify(error){throw error;},setTimer:()=>0,clearTimer(){}});
  try{await client.transition({id:'synthetic-UNC',cwd:root});assert.deepEqual(calls,['workspace','acquire','capabilities']);assert(shown);}finally{await client.close();}
});
