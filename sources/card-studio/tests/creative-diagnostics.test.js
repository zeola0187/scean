import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nativeHost} from './helpers/current-host.js';
import {syntheticCard,syntheticPng,metadataChunk} from './helpers/png-fixtures.js';
import {sixSyntheticRasters} from './helpers/synthetic-assets.js';
import {sha,decodeCard} from '../cardstudio-bundle/lib/codec.js';
import {TARGET_PROFILE} from '../cardstudio-bundle/lib/target-profile.js';
import {loadSkills} from '../cardstudio-bundle/lib/workspace-setup.js';
import * as plugin from '../cardstudio-bundle/index.js';

const reportURL=new URL('../test-evidence/creative-diagnostics-host.json',import.meta.url);
async function tree(directory){
 const result={};
 async function walk(root){for(const entry of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())await walk(file);else result[path.relative(directory,file)]=sha(await fs.readFile(file));}}
 await walk(directory);return result;
}
// Independently compare exact PNG carrier bytes excluding only the selected ccv3 chunk.
function carrier(bytes){const parts=[];let offset=8,selected=false;while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4),active=!selected&&type==='tEXt'&&data.subarray(0,5).equals(Buffer.from('ccv3\0'));if(active)selected=true;else parts.push(bytes.subarray(offset,end).toString('base64'));offset=end;if(type==='IEND')break;}parts.push(bytes.subarray(offset).toString('base64'));return parts;}

test('isolated official Host: A authorized local PNG edit, B safe Gate rebind and fresh export, C same-revision missing bound blob blocks; raw results retained',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-018-host-')),old=process.env.DSH_HOME;process.env.DSH_HOME=home;let host;
 const report={scope:'Official SDK/Host services with synthetic storage, Sessions, cards and tool driver; no real model or Desktop UI',realModel:false,TT_Runtime:false,mainReplyValidation:'NOT RUN; expected human dialogue is a manual/real-model acceptance checklist',rawTools:[],cases:{}};
 try{
  host=await nativeHost(home,plugin);const workspace=host.registry.list()[0].path;
  const agentA=host.agent('synthetic-018-A',workspace),agentB=host.agent('synthetic-018-B',workspace);
  async function connect(agent){const response=await host.request(agent,{action:'acquire',page_id:'synthetic-page-'+agent.id});assert(response.ok,JSON.stringify(response));return response.value;}
  const claimA=await connect(agentA),claimB=await connect(agentB);
  const ui=async(agent,claim,action,args={})=>{const result=await host.request(agent,{claim,action,args});assert(result.ok,JSON.stringify(result));return result.value;};
  const invoke=async(agent,name,args)=>{
   const tool=host.ctx.tools.get(name,agent);assert(tool,name);
   const result=await tool.execute(args,{agent,signal:new AbortController().signal});
   const rendered=tool.output.render(args,result);assert.deepEqual(rendered,[{type:'text',text:JSON.stringify(result)}]);
   report.rawTools.push({session:agent.id,name,args,result,rendered});return result;
  };
  const ok=async(agent,name,args)=>{const result=await invoke(agent,name,args);assert(result.ok,JSON.stringify(result));return result.value;};
  const docTool=(agent,id,action,args={})=>ok(agent,'cardstudio_scean_document',{document_id:id,action,...args});
  const readUI=(agent,claim,id)=>ui(agent,claim,'read',{document_id:id});

  const primary=syntheticCard(3);primary.data.name='Akiho synthetic';primary.data.personality='Reserved';
  const png=syntheticPng([metadataChunk('chara',syntheticCard(2)),metadataChunk('ccv3',primary),metadataChunk('ccv3',syntheticCard(3))]);
  await fs.writeFile(path.join(workspace,'imports/synthetic-A.png'),png);
  const imported=await ok(agentA,'cardstudio_scean_import',{path:'imports/synthetic-A.png',type:'card'}),idA=imported.id;
  const scope=await host.ctx.get('cardstudioSceanBridge').setAuthoringScope(agentA,{claim:claimA,mode:'content',expected_epoch:0},undefined);assert(scope.ok);
  const before=await readUI(agentA,claimA,idA),documentRoot=path.join(workspace,'.cardstudio-scean/documents',idA),beforeTree=await tree(documentRoot);
  const typo=await invoke(agentA,'card_read',{document_id:idA.slice(1),fields:['personality']});
  assert(!typo.ok);assert.equal(typo.error.code,'SESSION_CARD_MISMATCH');assert.equal(typo.error.details.document_id,idA);
  assert.equal(path.dirname(documentRoot),path.join(workspace,'.cardstudio-scean/documents'));await fs.rename(documentRoot,documentRoot+'.held');
  try{const missing=await invoke(agentA,'card_read',{document_id:idA,fields:['personality']});assert(!missing.ok);assert.equal(missing.error.code,'ENOENT');}finally{await fs.rename(documentRoot+'.held',documentRoot);}
  assert.deepEqual(await tree(documentRoot),beforeTree);assert.equal((await readUI(agentA,claimA,idA)).revision,before.revision);
  const badPointer=await invoke(agentA,'card_patch_fields',{document_id:idA,expected_revision:before.revision,patches:[{op:'replace',path:'/personality',value:'INVALID TEST MUST NOT WRITE'}]});
  assert(!badPointer.ok);assert.deepEqual(await tree(documentRoot),beforeTree);assert.equal((await readUI(agentA,claimA,idA)).revision,before.revision);
  // Scripted discussion phase makes only relevant readonly reads, without check or mutation.
  const discussionStart=report.rawTools.length;
  await ok(agentA,'card_read',{document_id:idA,fields:['personality','description','scenario']});
  assert.deepEqual(await tree(documentRoot),beforeTree);assert.equal((await readUI(agentA,claimA,idA)).revision,before.revision);
  assert.equal(report.rawTools.slice(discussionStart).length,1);
  const contextsA=(await host.ctx.systemPrompt.assemble({scope:agentA})).contexts,contextsB=(await host.ctx.systemPrompt.assemble({scope:agentB})).contexts;
  const guidance=contextsA.find(row=>row.name==='cardstudio-creative-response');assert(guidance&&guidance.text.includes('Must execute:')&&guidance.text.includes('Must tell:'));
  assert(contextsA.find(row=>row.name==='cardstudio-selection').text.includes(idA));assert(!contextsB.find(row=>row.name==='cardstudio-selection').text.includes(idA));
  const personality='She complains about the trouble, yet quietly leaves a meal for {{user}}; concern is difficult to admit.';
  const dialogue='{{char}}: You forgot lunch again. Here. I happened to buy an extra one.';
  const receipt=await ok(agentA,'card_patch_fields',{document_id:idA,expected_revision:before.revision,patches:[{op:'replace',path:'/data/personality',value:personality},{op:'replace',path:'/data/mes_example',value:dialogue}]});
  const after=await readUI(agentA,claimA,idA),expected=structuredClone(before.card);expected.data.personality=personality;expected.data.mes_example=dialogue;
  assert.deepEqual(after.card,expected);assert(!JSON.stringify(receipt).includes(personality));assert.equal(after.revision,before.revision+1);
  const precheckTree=await tree(documentRoot),checked=await docTool(agentA,idA,'check',{expected_revision:after.revision,export_action:'export',name:'synthetic-A.png'});
  assert.deepEqual(await tree(documentRoot),precheckTree);assert(checked.exportAllowed);assert(checked.items.some(row=>row.code==='PNG_ALTERNATE_METADATA'));
  const exported=await docTool(agentA,idA,'export',{expected_revision:after.revision,name:'synthetic-A.png'}),outBytes=await fs.readFile(path.join(workspace,exported.path));
  assert.deepEqual(decodeCard(outBytes).card,expected);assert.deepEqual(carrier(outBytes),carrier(png));
  const diff=await docTool(agentA,idA,'diff',{from:before.revision,to:after.revision});
  report.cases.A={pass:true,discussionReadonly:true,authorizedFieldsOnly:true,readonlyCheck:true,carrierPreserved:true,receipt,diff,exported};

  const created=await ok(agentB,'cardstudio_scean_create',{name:'Synthetic Akiho B',first_mes:'Preserve the plot {{user}}'}),idB=created.id;
  const mutate=async(name,args)=>{const doc=await readUI(agentB,claimB,idB);return ok(agentB,name,{document_id:idB,expected_revision:doc.revision,...args});};
  await mutate('cardstudio_scean_visual_contract',{action:'create',contract:{characters:{akiho:{}}}});
  const config={profile:TARGET_PROFILE,namespace:'synthetic_state',fields:{progress:{type:'number',min:0,max:100}},initialState:{values:{progress:0},characters:{akiho:{expression:'neutral'}}},source:'<p>State</p>'};
  await mutate('cardstudio_scean_target',{action:'configure',config});
  await mutate('lorebook_upsert_entry',{entry:{keys:['door'],content:'Only the existing plot opens here {{user}}',enabled:true,insertion_order:10,extensions:{unknown:'retain'}}});
  const entry=(await ok(agentB,'lorebook_list_entries',{document_id:idB})).entries.find(row=>row.keys.includes('door')).entry_id;
  const gate=await ok(agentB,'cardstudio_scean_worldbook_gate',{action:'read',document_id:idB,entry_id:entry});
  const rule={schemaVersion:1,predicate:{op:'gte',path:'values.progress',value:30}};
  await mutate('cardstudio_scean_worldbook_gate',{action:'create',entry_id:entry,expected_source_hash:gate.source_hash,rule});
  await mutate('cardstudio_scean_target',{action:'rebuild'});
  const priorContract=(await ok(agentB,'cardstudio_scean_visual_contract',{action:'read',document_id:idB})).contract;
  await mutate('cardstudio_scean_visual_contract',{action:'patch',changes:{characters:{akiho:{...priorContract.characters.akiho,displayName:'秋穗'}}}});
  await mutate('cardstudio_scean_target',{action:'rebuild'});
  const beforeRepair=await readUI(agentB,claimB,idB),priorGate=await ok(agentB,'cardstudio_scean_worldbook_gate',{action:'read',document_id:idB,entry_id:entry});
  const cases=[29,30,29].map(progress=>({name:'progress-'+progress,values:{progress},expect:{[entry]:progress>=30?'pass':'fail'}}));
  const stale=await docTool(agentB,idB,'check',{expected_revision:beforeRepair.revision,export_action:'export_target',cases});assert(stale.items.some(row=>row.repair?.kind==='gate_rebind'));
  const blocked=await invoke(agentB,'cardstudio_scean_document',{document_id:idB,action:'export_target',expected_revision:beforeRepair.revision,name:'B-blocked',cases});assert(!blocked.ok);assert.equal(blocked.error.details.check.overall,'FAIL');
  const repaired=await docTool(agentB,idB,'repair',{expected_revision:beforeRepair.revision,export_action:'export_target',cases});assert.equal(repaired.stop,'complete');assert.equal(repaired.rounds.length,1);assert.equal(repaired.rounds[0].fullCheck.counts.FAIL,0);
  const afterGate=await ok(agentB,'cardstudio_scean_worldbook_gate',{action:'read',document_id:idB,entry_id:entry});assert(priorGate.gate?.rule);assert.deepEqual(afterGate.gate.rule,priorGate.gate.rule);assert.equal(afterGate.entry.content.slice(afterGate.entry.content.indexOf('\n')+1),priorGate.entry.content.slice(priorGate.entry.content.indexOf('\n')+1));
  const finalB=await readUI(agentB,claimB,idB),outB=await docTool(agentB,idB,'export_target',{expected_revision:finalB.revision,name:'B-play',cases});assert(outB.preflight.exportAllowed);assert.equal(outB.preflight.cases_hash,stale.cases_hash);assert.equal(outB.runtimeVerified,false);
  await docTool(agentB,idB,'rollback',{expected_revision:finalB.revision,to:beforeRepair.revision});const rolled=await ok(agentB,'cardstudio_scean_worldbook_gate',{action:'read',document_id:idB,entry_id:entry});assert.deepEqual(rolled, {...priorGate,revision:rolled.revision});
  report.cases.B={pass:true,blockedBeforeRepair:true,sameRuleAndBody:true,repaired,outB,jointRollback:true};

  // C uses a separate synthetic card with an explicitly bound surprise expression.
  const agentC=host.agent('synthetic-018-C',workspace),claimC=await connect(agentC);
  const crossCreate=await invoke(agentB,'cardstudio_scean_create',{name:'Refused second card'});assert.equal(crossCreate.error.code,'SESSION_CARD_BOUND');
  const madeC=await ok(agentC,'cardstudio_scean_create',{name:'Synthetic Akiho C',scenario:'Akiho background'}),idC=madeC.id;
  const mutateC=async(name,args)=>ok(agentC,name,{document_id:idC,expected_revision:(await readUI(agentC,claimC,idC)).revision,...args});
  await mutateC('cardstudio_scean_visual_contract',{action:'create',contract:{characters:{akiho:{}}}});
  const raster=sixSyntheticRasters()[0].bytes,cDoc=await readUI(agentC,claimC,idC);
  const upload=await ui(agentC,claimC,'asset_upload_begin',{document_id:idC,expected_revision:cDoc.revision,name:'synthetic-surprise.png',size:raster.length});
  await ui(agentC,claimC,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:raster.toString('base64')});await ui(agentC,claimC,'asset_upload_finish',{upload_id:upload.upload_id});
  const asset=(await ok(agentC,'cardstudio_scean_asset',{action:'list',document_id:idC})).assets[0];
  await mutateC('cardstudio_scean_asset',{action:'link',asset_id:asset.asset_id,character_id:'akiho',expression:'surprised'});
  await mutateC('cardstudio_scean_target',{action:'configure',config});
  const goodC=await docTool(agentC,idC,'check',{expected_revision:(await readUI(agentC,claimC,idC)).revision,export_action:'export_target'});assert(goodC.exportAllowed);
  const assetFile=path.join(workspace,'.cardstudio-scean/documents',idC,'assets',asset.sha256);await fs.rename(assetFile,assetFile+'.held');
  const cRevision=(await readUI(agentC,claimC,idC)).revision;
  for(const action of ['export_target','export_bundle']){const fail=await invoke(agentC,'cardstudio_scean_document',{document_id:idC,expected_revision:cRevision,action,name:'C-blocked'});assert(!fail.ok);assert.equal(fail.error.details.check.revision,goodC.revision);assert.equal(fail.error.details.check.overall,'FAIL');assert(fail.error.details.check.items.some(row=>row.object.asset_id===asset.asset_id));}
  const beforeDiscussion=await tree(path.join(workspace,'.cardstudio-scean/documents',idC));
  await ok(agentC,'card_read',{document_id:idC,fields:['scenario']});assert.deepEqual(await tree(path.join(workspace,'.cardstudio-scean/documents',idC)),beforeDiscussion);
  const contractC=(await ok(agentC,'cardstudio_scean_visual_contract',{action:'read',document_id:idC})).contract;assert(contractC.characters.akiho.variants.some(row=>row.expression==='surprised'&&row.assetId===asset.asset_id));
  report.cases.C={pass:true,sameRevisionMissingBlobBlocked:true,noFallbackOrBindingMutation:true,backgroundDiscussionReadonly:true,goodC};
  await fs.rename(assetFile+'.held',assetFile);
  await ui(agentA,claimA,'release');assert.equal(host.ctx.tools.schemas(agentA).length,0);assert(!(await host.ctx.systemPrompt.assemble({scope:agentA})).contexts.some(row=>row.name==='cardstudio-creative-response'));assert(host.ctx.tools.schemas(agentB).length>0);
  report.sessionIsolation=true;
 }finally{
  await fs.mkdir(new URL('../test-evidence/',import.meta.url),{recursive:true});await fs.writeFile(reportURL,JSON.stringify(report,null,2)+'\n');
  await host?.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
 }
});

test('explicit custom workspace Skill is preserved and bundled fallback does not replace it',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-018-skills-'));
 try{
  await fs.cp(new URL('../cardstudio-bundle/skills/',import.meta.url),root,{recursive:true});
  const file=path.join(root,'scean-worldbook-authoring/SKILL.md');await fs.appendFile(file,'\nCUSTOM SYNTHETIC GUIDANCE; preserve this file.\n');
  const before=await tree(root),skills=await loadSkills(root,{includeAuthoring:true});assert(skills.find(row=>row.name==='scean-worldbook-authoring').content.includes('CUSTOM SYNTHETIC GUIDANCE'));assert.deepEqual(await tree(root),before);
  const catalogFile=path.join(root,'catalog.json'),catalog=JSON.parse(await fs.readFile(catalogFile,'utf8'));await fs.writeFile(catalogFile,JSON.stringify(catalog.filter(row=>row.name!=='advanced-tavern-card-authoring')));
  const legacyBefore=await tree(root),legacy=await loadSkills(root,{includeAuthoring:true});assert.equal(legacy.length,9);assert(legacy.find(row=>row.name==='advanced-tavern-card-authoring').path.includes('cardstudio-bundle'));assert(legacy.find(row=>row.name==='scean-worldbook-authoring').content.includes('CUSTOM SYNTHETIC GUIDANCE'));assert.deepEqual(await tree(root),legacyBefore);
 }finally{assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
