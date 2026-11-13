import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nativeHost} from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';
import {syntheticCard} from './helpers/png-fixtures.js';

test('official native SDK registers 25 tools; generic command cannot review; dedicated human bridge persists receipts and real prompt context pins materials without inference',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'material-native-host-')),old=process.env.DSH_HOME;process.env.DSH_HOME=home;let host;
 try{
  host=await nativeHost(home,plugin);const workspace=host.registry.list()[0],agent=host.agent('synthetic-material-native',workspace.path);const claim=(await host.request(agent,{action:'acquire',page_id:'material-native-page-001'})).value;
  const bridge=host.ctx.get('cardstudioSceanBridge'),call=async(action,args={})=>{const r=await host.request(agent,{action,args,claim});assert(r.ok,JSON.stringify(r));return r.value;};
  assert.equal(host.ctx.tools.schemas(agent).length,29);assert.equal(host.ctx.tools.schemas(agent).filter(row=>row.name==='cardstudio_scean_work_review').length,1);const tool=host.ctx.tools.get('cardstudio_scean_materials',agent);assert(tool);
  assert.equal((await host.request(agent,{action:'reviewMaterials',claim,args:{accepted_ids:[]}})).error.code,'ACTION');
  const c=syntheticCard(3);c.data.description='A lighthouse keeper searching for her sister; reserved but loyal.';c.data.personality='Uses short maritime metaphors.';await fs.writeFile(path.join(workspace.path,'library/synthetic.json'),JSON.stringify(c));
  const scope=await bridge.setAuthoringScope(agent,{claim,mode:'content',expected_epoch:0},undefined);assert(scope.ok);
  const list=await call('library',{action:'list'}),source=list.items[0];
  const execute=async args=>{const r=await tool.execute(args,{agent,signal:new AbortController().signal});assert(r.ok,JSON.stringify(r));return r.value;};
  let b=await execute({action:'begin',sources:[{type:'library',item_id:source.item_id,source_sha256:source.source_sha256}],intent:'Explicit synthetic whole-character extraction'});
  await execute({action:'source_read',extraction_id:b.extraction_id,source_index:0,fields:['description','personality']});b=await execute({action:'candidate',extraction_id:b.extraction_id});
  b=await execute({action:'propose',extraction_id:b.extraction_id,expected_revision:b.revision,candidate_sha256:b.candidate_sha256,candidates:[{kind:'character',title:'Lighthouse Cheng',summary:'A complete keeper with relationship and voice.',body:'Cheng searches for her missing sister; loyal but afraid of separation, she uses short maritime metaphors.',use_notes:'Adapt occupation while retaining sister relationship. Recreate Opening.',source_refs:[{source_index:0,locators:['/data/description','/data/personality'],transform_note:'Integrated character, no Opening/runtime.'}]}]});
  assert.equal((await execute({action:'catalog'})).total,0);
  const reviewed=await bridge.reviewMaterials(agent,{claim,expected_epoch:1,mode:'confirm',extraction_id:b.extraction_id,expected_revision:b.revision,candidate_sha256:b.candidate_sha256,accepted_ids:b.candidates.map(c=>c.candidate_id)},undefined);assert(reviewed.ok,JSON.stringify(reviewed));assert.equal(reviewed.value.receipt.human_review,true);
  const material=(await execute({action:'catalog'})).items[0],pin={material_id:material.material_id,record_sha256:material.record_sha256};await execute({action:'select',materials:[pin]});
  const contexts=(await host.ctx.systemPrompt.assemble({scope:agent})).contexts;const text=contexts.find(r=>r.name==='cardstudio-material-guidance').text;assert.equal(typeof text,'string');assert(text.includes(material.material_id));assert(!text.includes('searches for her missing sister'));
  const created=await call('create',{name:'Synthetic sky keeper',description:'Cheng searches skyways for her sister.',material_selection:[pin],adaptation_note:'Harbor to sky city; recreate Opening last.'});
  const read=await call('read',{document_id:created.id});assert.deepEqual(read.material_composition.materials,[pin]);assert.deepEqual(read.card.data.extensions,{});
  assert.equal((await host.request(agent,{action:'book_upsert',claim,args:{document_id:created.id,expected_revision:0,entry:{keys:['sky'],content:'Synthetic',enabled:true,insertion_order:1,extensions:{}}}})).error.code,'AUTHORING_SCOPE');
  await call('release');assert.equal(host.ctx.tools.schemas(agent).length,0);
 }finally{await host?.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});}
});
