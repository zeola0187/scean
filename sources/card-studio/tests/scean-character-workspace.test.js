import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {buildSavedSnapshot} from '../cardstudio-bundle/lib/scean-integration.js';
import {toolSpecs} from '../cardstudio-bundle/lib/tool-definitions.js';

globalThis.fetch=async()=>assert.fail('Offline synthetic test only');
test('actual Studio saves separate multi-character source bindings with revision and Content scope guards',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'studio-character-v1-'));
 const agent={id:'synthetic-workspace-v1',session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel(){}};
 const loader=new WorkspaceLoader({root,agentLookup:id=>id===agent.id?agent:null,activateAddon:async()=>({dispose:async()=>{}})});
 await loader.init();await loader.setArchiveState([]);let claim=await loader.acquire(agent,'synthetic-workspace-page-001');t.after(()=>loader.close());
 const call=(action,args={})=>loader.call(agent,loader.records.get(agent.id),claim,action,args);
 const created=await call('create',{name:'Synthetic duo',description:'Two people at a station.'});assert(created.ok,JSON.stringify(created));const id=created.value.id;let rev=created.value.revision;
 for(const [entryId,content] of [[10,'ALPHA_ONLY: station engineer.'],[20,'BETA_ONLY: map keeper.']]){
  const row=await call('book_upsert',{document_id:id,expected_revision:rev,entry:{id:entryId,keys:[],content,extensions:{},enabled:true,insertion_order:entryId}});assert(row.ok,JSON.stringify(row));rev=row.value.revision;
 }
 for(const [characterId,entryId,description] of [['alpha',10,'ALPHA_ONLY: station engineer.'],['beta',20,'BETA_ONLY: map keeper.']]){
  const row=await call('scean_character',{document_id:id,expected_revision:rev,character:{id:characterId,name:characterId,description,private:{note:characterId+' personal setting'}},sources:[{kind:'worldbook_entry',entryId}]});assert(row.ok,JSON.stringify(row));rev=row.value.revision;
 }
 assert(toolSpecs.some(s=>s[0]==='card_bind_scean_character'));
 const read=await call('read',{document_id:id});assert(read.ok);const snap=buildSavedSnapshot(read.value);
 assert.deepEqual(snap.characters.map(c=>c.sourceBindings.sources[0].entryId),[10,20]);assert(!JSON.stringify(snap.characters[0]).includes('BETA_ONLY'));assert(!JSON.stringify(snap.characters[1]).includes('ALPHA_ONLY'));
 const edit=await call('scean_character',{document_id:id,expected_revision:rev,character:{id:'alpha',name:'alpha',description:'Edited Alpha.'},sources:[{kind:'worldbook_entry',entryId:10}]});assert(edit.ok,JSON.stringify(edit));rev=edit.value.revision;
 assert.equal((await call('read',{document_id:id})).value.card.data.extensions.scean.characters[0].private.note,'alpha personal setting');
 const args={document_id:id,expected_revision:rev,character:{id:'alpha',name:'alpha',description:'Edited Alpha.'},sources:[{kind:'worldbook_entry',entryId:10}]};
 assert.equal((await call('scean_character',{...args,expected_revision:0})).error.code,'REVISION_CONFLICT');
 assert.equal((await call('scean_character',{...args,sources:[{kind:'worldbook_entry',entryId:99}]})).error.code,'CHARACTER_SOURCE_ENTRY');
 await loader.setAuthoringScope(agent,{claim,mode:'content',expected_epoch:claim.authoring_scope.epoch});
 assert.equal((await call('scean_character',args)).error.code,'AUTHORING_SCOPE');
 assert.equal((await call('read',{document_id:id})).value.revision,rev);
});
