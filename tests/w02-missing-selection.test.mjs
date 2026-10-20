import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CardService} from '../sources/card-studio/cardstudio-bundle/lib/card-service.js';
import {WorkspaceLoader} from '../sources/card-studio/cardstudio-bundle/lib/loader.js';
const fixture=JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic missing-source fixture',description:'Original',personality:'',scenario:'',first_mes:'Hello',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{}}});
test('missing selected source remains unselected and renewable without erasing its identity or selecting a namesake',async()=>{
 const root=await fs.mkdtemp(path.join(path.resolve('evidence'),'w02-missing-source-'));
 let service,loader;
 try{
  service=new CardService(root);await service.init();await fs.writeFile(path.join(root,'imports/fixture.json'),fixture);
  const imported=await service.operation('import',{path:'imports/fixture.json',type:'card'},undefined,{sessionId:'session-A'});assert(imported.ok);const id=imported.value.id;
  const other=await service.operation('import',{path:'imports/fixture.json',type:'card'},undefined,{sessionId:'session-B'});assert(other.ok);assert.notEqual(other.value.id,id);
  const association=path.join(root,'.cardstudio-scean/working-copy-sessions.json'),before=await fs.readFile(association);
  const agent={id:'session-A',status:'idle',session:{header:{cwd:root}},whenIdle:async()=>{}};
  loader=new WorkspaceLoader({root,agentLookup:key=>key===agent.id?agent:undefined,activateAddon:async()=>({dispose:async()=>{}})});await loader.init();
  const claim=await loader.acquire(agent,'synthetic-page-A'),source=path.join(root,'.cardstudio-scean/documents',id),held=path.join(root,'held-source');
  await fs.rename(source,held);
  try{
   assert.equal(await service.selectedDocument('session-A'),null);assert.equal((await service.selectedDocument('session-B')).document_id,other.value.id);
   const renewed=await loader.renew(agent,claim);assert.equal(renewed.selection_status.document_id,null);assert.equal(renewed.selection_status.revision,null);
   assert.deepEqual(await fs.readFile(association),before,'persisted source identities must not be erased or reassigned');
  }finally{await fs.rename(held,source);}
  assert.equal((await service.selectedDocument('session-A')).document_id,id);assert.deepEqual(await fs.readFile(association),before);
 }finally{
  await loader?.close();await service?.close();assert.equal(path.dirname(root),path.resolve('evidence'));assert(path.basename(root).startsWith('w02-missing-source-'));await fs.rm(root,{recursive:true,force:true});
 }
});
test('invalid selected-source data is a query failure, never silently reported as a missing source',async()=>{
 const root=await fs.mkdtemp(path.join(path.resolve('evidence'),'w02-invalid-source-'));const service=new CardService(root);
 try{
  await service.init();await fs.writeFile(path.join(root,'imports/fixture.json'),fixture);const result=await service.operation('import',{path:'imports/fixture.json',type:'card'},undefined,{sessionId:'session-A'});assert(result.ok);
  const current=path.join(root,'.cardstudio-scean/documents',result.value.id,'current.json'),before=await fs.readFile(current);
  await fs.writeFile(current,'{invalid JSON');try{await assert.rejects(service.selectedDocument('session-A'));}finally{await fs.writeFile(current,before);}
 }finally{await service.close();assert.equal(path.dirname(root),path.resolve('evidence'));assert(path.basename(root).startsWith('w02-invalid-source-'));await fs.rm(root,{recursive:true,force:true});}
});
