import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {MaterialCardService} from '../cardstudio-bundle/lib/material-service.js';
import {syntheticCard} from './helpers/png-fixtures.js';
const sessionId='synthetic-material-race';
test('duplicate source paths keep separate extraction states; stale Session generation and asynchronously changed candidate refuse publication',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'material-races-'));const s=new MaterialCardService(root);await s.init();const policy=g=>({mode:'content',epoch:1,sessionGeneration:g,assertCurrent(){}}),invoke=args=>s.withAuthoringScope(policy('one'),()=>s.operation('material',args,undefined,{sessionId}));
 try{
  const bytes=Buffer.from(JSON.stringify(syntheticCard(3)));await fs.writeFile(path.join(root,'library/a.json'),bytes);await fs.writeFile(path.join(root,'library/b.json'),bytes);await s.library.scan();const rows=[...s.library.rows.values()].sort((a,b)=>a.relative_path.localeCompare(b.relative_path));
  let r=await invoke({action:'begin',intent:'Explicit zero candidate review',sources:[{type:'library',item_id:rows[1].item_id,source_sha256:rows[1].source_sha256}]});assert(r.ok);const b=r.value,request={mode:'confirm',extraction_id:b.extraction_id,expected_revision:b.revision,candidate_sha256:b.candidate_sha256,accepted_ids:[]};
  await assert.rejects(s.withAuthoringScope(policy('two'),()=>s.humanMaterials(request,undefined,{sessionId})),{code:'MATERIAL_SESSION_EPOCH'});
  await s.withAuthoringScope(policy('one'),()=>s.humanMaterials(request,undefined,{sessionId}));r=await invoke({action:'source_status'});assert(r.ok);assert.equal(r.value.total,2);assert.equal(r.value.items[0].extraction_status,'unorganized');assert.equal(r.value.items[1].extraction_status,'organized');
  r=await invoke({action:'begin',intent:'Candidate revision race',sources:[{type:'library',item_id:rows[0].item_id,source_sha256:rows[0].source_sha256}]});const next=r.value;
  s.materials.beforePublish=async()=>{const file=path.join(root,'.cardstudio-scean/material-candidates',next.extraction_id+'.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));raw.intent='changed by synthetic external actor';await fs.writeFile(file,JSON.stringify(raw));};
  await assert.rejects(s.withAuthoringScope(policy('one'),()=>s.humanMaterials({...request,extraction_id:next.extraction_id,expected_revision:next.revision,candidate_sha256:next.candidate_sha256},undefined,{sessionId})),{code:'MATERIAL_VERIFY'});
  assert.equal((await fs.readdir(path.join(root,'materials/receipts'))).length,1);
 }finally{await s.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
