import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { SessionController } from '@deepseek-ai/dsh-api-session-controller';
import { CardService } from '../cardstudio-bundle/lib/card-service.js';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';
import * as plugin from '../cardstudio-bundle/index.js';
import { nativeHost } from './helpers/current-host.js';

const card=()=>({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic Case Name',description:'',personality:'',scenario:'',first_mes:'synthetic',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{}}});
const binding=(session,id)=>createHash('sha256').update(JSON.stringify([session,id])).digest('hex')+'.json';
async function isolated(run){const base=await fs.mkdtemp(path.join(os.tmpdir(),'CardStudio-Export-Folder-')),root=path.join(base,'MixedCase Workspace');await fs.mkdir(root);const s=new CardService(root);await s.init();try{await run({base,root,s});}finally{await s.close();assert.equal(path.dirname(base),os.tmpdir());assert(path.basename(base).startsWith('CardStudio-Export-Folder-'));await fs.rm(base,{recursive:true,force:true});}}
async function operation(s,session,action,args={}){const result=await s.operation(action,args,undefined,{sessionId:session});assert(result.ok,JSON.stringify(result));return result.value;}
async function importCard(s,session){await fs.writeFile(path.join(s.root,'imports/synthetic.json'),JSON.stringify(card()));return operation(s,session,'import',{path:'imports/synthetic.json',type:'card'});}

test('official DSH verifier reproduces rc.2 lowercase path failure against the real Windows filesystem',()=>isolated(async({root})=>{
 const ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd:root});try{const desktop={ctx:{fs:ctx.fs},verifyDesktopPath:SessionController.prototype.verifyDesktopPath},signal=new AbortController().signal;
  const canonical=await fs.realpath(path.join(root,'exports')),client=new WorkspaceClient({root,hide(){}});
  await assert.rejects(SessionController.prototype.verifyDesktopPath.call(desktop,client.root+'/exports',signal),/Path has no verified Host path/);
  assert.equal(await desktop.verifyDesktopPath(canonical,signal),canonical);
 }finally{await ctx.fiber.dispose();}
}));
test('exports-folder action is read-only, returns canonical Host path and falls back without creating mappings',()=>isolated(async({root,s})=>{
 const before=await fs.readdir(path.join(root,'.cardstudio-scean'));
 const empty=await operation(s,'A','export_folder');assert.equal(empty.path,await fs.realpath(path.join(root,'exports')));assert.equal(empty.scope,'workspace');assert.equal(empty.document_id,null);
 assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean')),before);
 const d=await importCard(s,'A'),selected=await operation(s,'A','export_folder');assert.equal(selected.document_id,d.id);assert.equal(selected.scope,'workspace');assert.equal(selected.path,empty.path);await assert.rejects(fs.stat(path.join(root,'.cardstudio-scean/export-folders')),{code:'ENOENT'});
 assert.equal((await s.operation('export_folder',{},undefined,{})).ok,false);
}));
test('exports-folder follows only current trusted Session/copy binding across rename, shared copies, missing folder and restarts',()=>isolated(async({root,s})=>{
 const a=await importCard(s,'A'),exported=await operation(s,'A','export',{document_id:a.id,expected_revision:0,name:'a.json'}),directory=path.dirname(exported.path);
 await operation(s,'A','patch',{document_id:a.id,expected_revision:0,patches:[{op:'replace',path:'/data/name',value:'Renamed synthetic'}]});
 assert.equal((await s.operation('export_folder',{document_id:'ignored-untrusted-id',path:'../escape'},undefined,{sessionId:'A'})).error.code,'SESSION_CARD_MISMATCH');
 const folder=await operation(s,'A','export_folder');assert.equal(folder.path,await fs.realpath(path.join(root,directory)));assert.equal(folder.relative_path,directory);assert.equal(folder.scope,'document');
 await operation(s,'B','open',{document_id:a.id});assert.equal((await operation(s,'B','export_folder')).scope,'workspace');
 assert.equal((await s.operation('import',{path:'imports/synthetic.json',type:'card'},undefined,{sessionId:'A'})).error.code,'SESSION_CARD_BOUND');
 const other=await importCard(s,'C');assert.equal((await operation(s,'C','export_folder')).scope,'workspace');assert.equal((await s.operation('open',{document_id:other.id},undefined,{sessionId:'A'})).error.code,'SESSION_CARD_BOUND');await operation(s,'A','open',{document_id:a.id});assert.equal((await operation(s,'A','export_folder')).path,folder.path);
 const reopened=new CardService(root);await reopened.init();try{assert.equal((await operation(reopened,'A','export_folder')).path,folder.path);}finally{await reopened.close();}
 await fs.rename(path.join(root,directory),path.join(root,directory+' moved'));assert.equal((await operation(s,'A','export_folder')).scope,'workspace');assert.equal((await s.selectedDocument('A')).document_id,a.id);assert.notEqual(a.id,other.id);
}));
test('exports-folder refuses corrupt bindings and junctions instead of guessing or opening outside workspace',()=>isolated(async({base,root,s})=>{
 const d=await importCard(s,'A');await operation(s,'A','export',{document_id:d.id,expected_revision:0,name:'a.json'});
 const file=path.join(root,'.cardstudio-scean/export-folders',binding('A',d.id)),raw=await fs.readFile(file),row=JSON.parse(raw);
 await fs.writeFile(file,JSON.stringify({...row,directory:'../outside'}));assert.equal((await s.operation('export_folder',{},undefined,{sessionId:'A'})).error.code,'EXPORT_FOLDER');await fs.writeFile(file,raw);
 const target=path.join(root,'exports',row.directory),outside=path.join(base,'Outside');await fs.mkdir(outside);await fs.rename(target,target+' original');await fs.symlink(outside,target,'junction');
 assert.equal((await s.operation('export_folder',{},undefined,{sessionId:'A'})).ok,false);
 await fs.unlink(target);await fs.rename(target+' original',target);await fs.rename(path.join(root,'.cardstudio-scean/export-folders'),path.join(root,'.cardstudio-scean/export-folders original'));await fs.symlink(path.join(root,'.cardstudio-scean/export-folders original'),path.join(root,'.cardstudio-scean/export-folders'),'junction');assert.equal((await s.operation('export_folder',{},undefined,{sessionId:'A'})).ok,false);
 await fs.unlink(path.join(root,'.cardstudio-scean/export-folders'));
}));
test('native plugin bridge exposes trusted export folder but adds no model tool or conversation event',()=>isolated(async({base,root})=>{
 const old=process.env.DSH_HOME;process.env.DSH_HOME=path.join(base,'Host Home');const host=await nativeHost(process.env.DSH_HOME,plugin);try{const workspace=host.registry.list()[0],agent=host.agent('synthetic-folder-session',workspace.path),claim=(await host.request(agent,{action:'acquire',page_id:'synthetic-folder-page'})).value;
 const result=await host.request(agent,{action:'export_folder',claim,args:{path:root}});assert(result.ok,JSON.stringify(result));assert.equal(result.value.path,await fs.realpath(path.join(workspace.path,'exports')));assert.equal(host.ctx.tools.schemas(agent).length,29);
 }finally{await host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;}
}));
