import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {syntheticCard} from './png-fixtures.js';

export async function seedRecycleMaterials(root,invoke,human){
  const card=syntheticCard(3);card.data.name='Synthetic recycle source';card.data.description='A synthetic keeper remembers her sister and tends a lighthouse.';
  await fs.writeFile(path.join(root,'library/synthetic-recycle.json'),JSON.stringify(card));
  const ok=async promise=>{const result=await promise;assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  await ok(invoke('library',{action:'refresh'}));const source=(await ok(invoke('library',{action:'list'}))).items[0];
  let batch=await ok(invoke('material',{action:'begin',sources:[{type:'library',item_id:source.item_id,source_sha256:source.source_sha256}],intent:'Synthetic offline extraction for recycle regression'}));
  await ok(invoke('material',{action:'source_read',extraction_id:batch.extraction_id,source_index:0,fields:['description']}));
  batch=await ok(invoke('material',{action:'candidate',extraction_id:batch.extraction_id}));
  batch=await ok(invoke('material',{action:'propose',extraction_id:batch.extraction_id,expected_revision:batch.revision,candidate_sha256:batch.candidate_sha256,candidates:[0,1].map(i=>({kind:'character',title:'Synthetic keeper '+i,summary:'Reusable synthetic keeper '+i,body:'A synthetic keeper remembers her sister and tends a lighthouse.',use_notes:'Synthetic only. Preserve relationships and rewrite Opening.',source_refs:[{source_index:0,locators:['/data/description'],transform_note:'Whole synthetic character, no runtime content.'}]}))}));
  await human({mode:'confirm',extraction_id:batch.extraction_id,expected_revision:batch.revision,candidate_sha256:batch.candidate_sha256,accepted_ids:batch.candidates.map(row=>row.candidate_id)});
  return (await ok(invoke('material',{action:'catalog'}))).items;
}
