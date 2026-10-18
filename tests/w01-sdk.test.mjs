// Actual official SDK registry/tool/plugin path. Scripted arguments, no inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeHost} from '../sources/card-studio/tests/helpers/portable-host.js';
import * as studioPlugin from '../packages/studio/index.js';
import * as sceanPlugin from '../packages/scean/plugin/index.js';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
test('W01 official rc2 SDK discovers dynamic tool, executes two themes, saves revision and human Handoff to actual SCEAN plugin',async()=>{
 const home=await fs.mkdtemp(join(tmpdir(),'w01-sdk-')),prior=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const host=await nativeHost(home,studioPlugin);let calls=0;
 host.ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'offline'})});
 host.ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){calls++;throw Error('MODEL_FORBIDDEN');}});
 const runtime=join(home,'synthetic-scean');await host.ctx.plugin(sceanPlugin,{dataRoot:runtime,enableExistingEmbedding:false});
 const workspace=host.registry.list()[0].path,agent=host.agent('w01-sdk-session',workspace),bridge=host.ctx.get('cardstudioSceanBridge');
 const request=r=>bridge.request(agent,r,new AbortController().signal);const claim=(await request({action:'acquire',page_id:'w01-sdk-human-page'})).value;
 const tool=host.ctx.tools.get('cardstudio_scean_frontend',agent);assert(tool,'registered official tool');
 const execute=async args=>{const r=await tool.execute(args,{agent,signal:new AbortController().signal});assert(r.ok,JSON.stringify(r));return r.value;};
 const results=[];
 try{
  for(const theme of ['indicator','fantasy']){
   const f=w01Fixture(theme),card=structuredClone(f.card);delete card.data.extensions.scean.frontend;
   await fs.writeFile(join(workspace,'imports',theme+'.json'),JSON.stringify(card));const imported=await request({action:'import',claim,args:{path:'imports/'+theme+'.json',type:'card'}});assert(imported.ok,JSON.stringify(imported));const id=imported.value.id;
   const draft=await execute({action:'dynamic_read',document_id:id});assert.equal(draft.runtimeProfile,'scean-html-bindings-v1');
   const saved=await execute({action:'dynamic_save',document_id:id,expected_revision:0,frontend:f.frontend,blueprint:f.bp,initial_state:f.initial});assert.equal(saved.revision,1);
   const preview=await execute({action:'dynamic_preview',document_id:id});assert(preview.html.includes(theme==='indicator'?'lamp scean-true':'術式可用'));
   const started=await bridge.sceanControl(agent,{claim,mode:'start',document_id:id,expected_revision:1},new AbortController().signal);assert(started.ok,JSON.stringify(started));
   const view=await host.ctx.scean.inspectFromStudio({...started.value,authoringSessionId:agent.id,generation:claim.generation??claim.agent_generation});
   assert.equal(view.frontendDiagnostics.status,'ready');assert.equal(view.snapshot.revision,1);assert(!JSON.stringify(view).includes('RESTRICTED_VALUE_CANARY'));
   results.push({theme,revision:1,runId:started.value.runId,hash:view.frontendDiagnostics.hash});
  }
  assert.equal(calls,0);assert.notEqual(results[0].hash,results[1].hash);
  await fs.mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../evidence/w01-sdk-receipt.json',import.meta.url),JSON.stringify({status:'PASS',surface:'official SDK registered tool + human lease bridge + actual packaged SCEAN plugin; no GUI',results,paidModelCalls:0,embeddingCalls:0,browser:'NOT_TESTED'},null,2)+'\n');
 }finally{await host.close();if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;}
});
