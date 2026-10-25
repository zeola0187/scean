import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { nativeHost } from './helpers/portable-host.js';

const [packageRoot,phase]=process.argv.slice(2),home=process.env.DSH_HOME;
assert(packageRoot&&path.isAbsolute(home));assert(!process.env.OPENAI_API_KEY&&!process.env.DEEPSEEK_API_KEY);
// Running under Node's permission model proves no E: drive or live profile read
// can be used to satisfy the clean package. Only unpacked assets + public SDK
// fixtures + these test files are readable; only the synthetic home is writable.
assert(process.permission);assert.equal(process.permission.has('fs.read','E:\\Synthetic\\Card Studio'),false);
assert.equal(process.permission.has('fs.write',packageRoot),false);
const pkg=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
const entry=pathToFileURL(path.join(packageRoot,pkg.exports['.']));
const plugin=await import(entry.href),lib=new URL('./lib/codec.js',entry);
const {pngChunk,decodeCard}=await import(lib.href);
const proofPath=path.join(home,'synthetic-portable-proof.json');
const host=await nativeHost(home,plugin);
try {
  const row=host.registry.list()[0];assert.equal(host.registry.list().length,1);
  const agent=host.agent('synthetic-portable-session',row.path);
  const claim=(await host.request(agent,{action:'acquire',page_id:'packed-page-001'})).value;
  const call=async(action,args={})=>{const result=await host.request(agent,{action,args,claim});assert(result.ok,JSON.stringify(result));return result.value;};
  const skills=await host.ctx.skills.list({cwd:row.path,scope:agent});assert.equal(skills.length,8);assert.equal(host.ctx.tools.schemas(agent).length,25);
  assert(host.ctx.tools.schemas(agent).some(s=>s.name==='cardstudio_worldbook_gate'));
  let references=0;for(const item of skills){const skill=await host.ctx.skills.get(item.name,{cwd:row.path,scope:agent});assert(skill.resourceBase.path.startsWith(packageRoot));for(const ref of await fs.readdir(path.join(skill.resourceBase.path,'references'))){assert((await fs.readFile(path.join(skill.resourceBase.path,'references',ref))).length>0);references++;}}
  assert.equal(references,30);
  const advanced=await host.ctx.skills.get('advanced-tavern-card-authoring',{cwd:row.path,scope:agent});
  const conditionGuide=await fs.readFile(path.join(advanced.resourceBase.path,'references/worldbook-conditions.md'),'utf8');
  assert(conditionGuide.includes('cardstudio_worldbook_gate')&&conditionGuide.includes('values.quest_stage'));
  if(phase==='first'){
    assert.deepEqual(await call('imports'),[]);assert.equal((await call('documents')).total,0);
    const card={spec:'chara_card_v3',spec_version:'3.0',opaqueRoot:{keep:1},data:{name:'SYNTHETIC Portable Card',description:'{{user}} <script src="https://example.invalid/inert.js"></script>',personality:'Given',scenario:'Given',first_mes:'Hello {{user}}',mes_example:'',creator_notes:'Synthetic',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'synthetic',character_version:'1',extensions:{opaque:{keep:true}},character_book:{extensions:{keep:1},entries:[{id:7,keys:['synthetic'],content:'Fact',enabled:true,insertion_order:1,extensions:{keep:1}}]}}};
    const json=Buffer.from(JSON.stringify(card));const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('tEXt',Buffer.from('ccv3\0'+json.toString('base64'))),pngChunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),pngChunk('vpAg',Buffer.from('synthetic opaque chunk')),pngChunk('IEND',Buffer.alloc(0))]);
    await fs.mkdir(path.join(row.path,'library/nested'),{recursive:true});
    await fs.writeFile(path.join(row.path,'library/nested/synthetic.png'),png);
    await fs.writeFile(path.join(row.path,'library/synthetic.json'),json);
    const libraryTool=host.ctx.tools.get('cardstudio_library',agent);
    const listed=await libraryTool.execute({action:'list',limit:8},{agent,signal:new AbortController().signal});assert(listed.ok,JSON.stringify(listed));assert.equal(listed.value.items.length,1);assert.equal(listed.value.source_count,2);
    const source=listed.value.items[0],sid={item_id:source.item_id,source_sha256:source.source_sha256};
    const evidence=await libraryTool.execute({action:'read',...sid,fields:['description','scenario','first_mes'],budget:1000},{agent,signal:new AbortController().signal});assert(evidence.ok);assert(evidence.value.evidence.some(x=>x.locator==='/data/scenario'));
    const candidates=await libraryTool.execute({action:'search',query:'Hello',limit:8},{agent,signal:new AbortController().signal});assert(candidates.ok);assert.equal(candidates.value.items.length,1);assert.equal((await call('documents')).total,0);
    const copied=await host.ctx.tools.get('cardstudio_library_copy',agent).execute(sid,{agent,signal:new AbortController().signal});assert(copied.ok);assert.equal((await call('read',{document_id:copied.value.id})).sha256,source.source_sha256);
    assert.deepEqual(await fs.readFile(path.join(row.path,'library/nested/synthetic.png')),png);assert.deepEqual(await fs.readFile(path.join(row.path,'library/synthetic.json')),json);
    const documents=[];
    const missingRevision=await host.ctx.tools.get('cardstudio_visual_contract',agent).execute({action:'create',document_id:copied.value.id,contract:{characters:{guide:{}}}},{agent,signal:new AbortController().signal});
    assert.equal(missingRevision.ok,false);assert.equal(missingRevision.error.code,'REVISION_CONFLICT');assert.match(missingRevision.error.message,/expected_revision/);assert.deepEqual(JSON.parse(JSON.stringify(missingRevision)),missingRevision);assert.equal((await call('read',{document_id:copied.value.id})).revision,0);
    for(const [format,original] of [['json',json],['png',png]]){
      await fs.writeFile(path.join(row.path,'imports','synthetic.'+format),original);
      const doc=await call('import',{path:'imports/synthetic.'+format,type:'card'});
      const receipt=await call('patch_text',{document_id:doc.id,expected_revision:0,field:'first_mes',old_text:'Hello',new_text:'Edited'});assert(Buffer.byteLength(JSON.stringify(receipt))<8192);assert.equal(receipt.revision,1);assert(!('card'in receipt));
      await call('book_patch',{document_id:doc.id,expected_revision:1,entry_id:'id:7',changes:{enabled:false}});
      const diff=await call('diff',{document_id:doc.id,from:0,to:2});assert(diff);
      const exported=await call('export',{document_id:doc.id,expected_revision:2,name:'synthetic.'+format});const output=await fs.readFile(path.join(row.path,exported.path)),decoded=decodeCard(output);
      const backup=await call('export_backup',{document_id:doc.id,expected_revision:2,name:'backup.'+format});assert.equal(backup.ready,false);assert.equal(backup.primaryDelivery,false);assert.equal(backup.deliveryKind,'authoring-backup');assert.deepEqual(await fs.readFile(path.join(row.path,backup.path)),output);
      const toolBackup=await host.ctx.tools.get('cardstudio_document',agent).execute({action:'export_backup',document_id:doc.id,expected_revision:2,name:'tool-backup.'+format},{agent,signal:new AbortController().signal});assert.equal(toolBackup.ok,true,JSON.stringify(toolBackup));assert.equal(toolBackup.value.ready,false);assert.deepEqual(await fs.readFile(path.join(row.path,toolBackup.value.path)),output);
      assert.equal(decoded.card.data.first_mes,'Edited {{user}}');assert.deepEqual(decoded.card.opaqueRoot,card.opaqueRoot);assert.deepEqual(decoded.card.data.extensions,card.data.extensions);assert.equal(decoded.card.data.description,card.data.description);
      if(format==='png')assert.deepEqual(decoded.chunks.filter(x=>!x.text).map(x=>x.raw),decodeCard(original).chunks.filter(x=>!x.text).map(x=>x.raw));
      await call('rollback',{document_id:doc.id,expected_revision:2,to:0});assert.equal((await call('read',{document_id:doc.id})).card.data.first_mes,'Hello {{user}}');assert.deepEqual(await fs.readFile(path.join(row.path,'imports','synthetic.'+format)),original);
      documents.push({id:doc.id,revision:3,export:exported.path,exportSha256:createHash('sha256').update(output).digest('hex')});
    }
    const gated=await call('create',{name:'Synthetic packed variable gates'}),gid=gated.id;
    await call('visual_contract',{action:'create',document_id:gid,expected_revision:0,contract:{characters:{clerk:{}}}});
    const config={profile:'tauritavern-helper-ejs-v1',namespace:'packed_story',fields:{quest_stage:{type:'number',min:0,max:10},has_key:{type:'boolean'},area:{type:'string',enum:['hall','garden']},inventory:{type:'array',maxItems:8}},initialState:{values:{quest_stage:0,has_key:false,area:'hall',inventory:[]},characters:{clerk:{expression:'neutral'}}},source:'<p>Synthetic package fixture</p>'};
    await call('target',{action:'configure',document_id:gid,expected_revision:1,config});
    const added=await call('book_upsert',{document_id:gid,expected_revision:2,entry:{keys:['door'],content:'Packed gated lore',enabled:true,insertion_order:1,extensions:{unknown:{keep:true}}}});
    const beforeGate=await call('gating',{action:'read',document_id:gid,entry_id:added.entry_id});
    const rule={schemaVersion:1,predicate:{op:'and',args:[{path:'values.quest_stage',op:'gte',value:3},{path:'values.has_key',op:'eq',value:true},{path:'values.area',op:'eq',value:'garden'},{path:'values.inventory',op:'contains',value:'key'}]}};
    await call('gating',{action:'create',document_id:gid,expected_revision:3,entry_id:added.entry_id,expected_source_hash:beforeGate.source_hash,rule});
    const eligible={quest_stage:3,has_key:true,area:'garden',inventory:['key']};
    const trial=await host.ctx.tools.get('cardstudio_worldbook_gate',agent).execute({action:'evaluate',document_id:gid,values:eligible},{agent,signal:new AbortController().signal});assert(trial.ok);assert.equal(trial.value.entries.find(e=>e.entry_id===added.entry_id).status,'pass');
    const delivered=await call('export_target',{document_id:gid,expected_revision:4,name:'packed-gates'}),backup=await call('export_bundle',{document_id:gid,expected_revision:4,name:'packed-authoring'});
    const sidecar=JSON.parse(await fs.readFile(path.join(row.path,backup.path,'authoring.json'),'utf8'));assert.deepEqual(sidecar.gating.entries[0].rule,rule);
    const before=await call('gating',{action:'read',document_id:gid,entry_id:added.entry_id});
    await call('gating',{action:'remove',document_id:gid,expected_revision:4,entry_id:added.entry_id,expected_source_hash:before.source_hash});
    await call('rollback',{document_id:gid,expected_revision:5,to:4});
    assert.deepEqual((await call('gating',{action:'read',document_id:gid,entry_id:added.entry_id})).gate.rule,rule);
    const targetBytes=await fs.readFile(path.join(row.path,delivered.path,delivered.card));await fs.writeFile(path.join(row.path,'imports/packed-gates.json'),targetBytes);
    const reimport=await call('import',{path:'imports/packed-gates.json',type:'card'}),reread=await call('read',{document_id:reimport.id});assert.deepEqual(reread.card,decodeCard(targetBytes).card);
    const unmanaged=await call('gating',{action:'inspect',document_id:reimport.id});assert.ok(unmanaged.diagnostics.some(d=>d.code==='GATE_UNMANAGED'),'card-only import preserves runtime source but does not invent an authoring sidecar');
    await fs.writeFile(proofPath,JSON.stringify({workspaceId:row.id,documents,gating:{id:gid,revision:6,entry_id:added.entry_id,rule,eligible,sidecar:backup.path,target:delivered.path,targetCard:delivered.card,targetSha256:createHash('sha256').update(targetBytes).digest('hex')}}));
  } else {
    const proof=JSON.parse(await fs.readFile(proofPath,'utf8'));assert.equal(row.id,proof.workspaceId);
    for(const doc of proof.documents){const actual=await call('read',{document_id:doc.id});assert.equal(actual.revision,doc.revision);assert.equal(actual.card.data.first_mes,'Hello {{user}}');assert.equal(createHash('sha256').update(await fs.readFile(path.join(row.path,doc.export))).digest('hex'),doc.exportSha256);}
    const g=proof.gating,readGate=await call('gating',{action:'read',document_id:g.id,entry_id:g.entry_id});assert.equal(readGate.revision,g.revision);assert.deepEqual(readGate.gate.rule,g.rule);
    const trial=await call('gating',{action:'evaluate',document_id:g.id,values:g.eligible});assert.equal(trial.entries.find(e=>e.entry_id===g.entry_id).status,'pass');
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(row.path,g.target,g.targetCard))).digest('hex'),g.targetSha256);
  }
  const proof=JSON.parse(await fs.readFile(proofPath,'utf8')),checkArgs={action:'check',document_id:proof.gating.id,expected_revision:proof.gating.revision};
  const checked=await host.ctx.tools.get('cardstudio_document',agent).execute(checkArgs,{agent,signal:new AbortController().signal});assert.equal(checked.ok,true,JSON.stringify(checked));assert.equal(checked.value.exportAllowed,true);assert.equal(checked.value.runtimeVerified,false);assert.ok(checked.value.items.some(i=>i.code==='HOST_UNTESTED'));assert.match(advanced.content,/action="check"/);
  await call('release');
  console.log(JSON.stringify({phase,skills:skills.length,references,tools:25,preflightToolExecuted:true,preflightSkillRead:true,gatingToolDiscovered:true,conditionSkillRead:true,gateSidecarRollback:true,gateExportImportPreserved:true,permissionFence:true,noEDriveAccess:true,packageReadOnly:true,libraryToolsExecuted:phase==='first',librarySourceBytesPreserved:phase==='first',modelCalls:0}));
}finally{await host.close();}
