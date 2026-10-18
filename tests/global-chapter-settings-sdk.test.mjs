import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Typert from '@deepseek-ai/dsh-typert-registry';
import {TypertGatewayService} from '@deepseek-ai/dsh-api-gateway';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import LocalCredentials from '@deepseek-ai/dsh-credentials-local';
import * as plugin from '../plugin/index.js';
import {sealChapterKeys} from '../isolated/web/chapter-settings-ui.mjs';
import {buildSavedSnapshot} from '../vendor/cardstudio-scean/lib/scean-integration.js';

test('global real SDK late credential service, strict operator RPC, two Runs, live adoption and plugin restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scean-global-sdk-')),ctx=new Context();let generations=0;
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'offline'})});
 ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){generations++;throw Error('NO_GENERATION_IN_SETTINGS_TEST');}});await ctx.plugin(Typert);
 const owner=Connection.Peer?new Connection.Peer(ctx,{principal:{kind:'owner'}}):new Connection.OperatorPeer(ctx),foreign=Connection.Peer?new Connection.Peer(ctx,{principal:{kind:'owner'}}):new Connection.OperatorPeer(ctx);
 ctx.provide('connection',Connection.Peer?{browserPeer:owner}:{operator:owner});const gateway=new TypertGatewayService(ctx,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 const invoke=(request,peer=owner)=>gateway.invokeRpc('scean/request',{args:{request}},new AbortController().signal,peer);
 let fiber=ctx.plugin(plugin,{dataRoot:join(root,'data'),technicalRetries:0});await fiber;
 try{
  const initial=await invoke({action:'chapterProviderSettings'});assert.equal(initial.value.value.storageAvailable,false);
  assert.equal((await invoke({action:'chapterProviderSettings'},foreign)).value.error.code,'TRUSTED_CLIENT_REQUIRED');
  await ctx.plugin(LocalCredentials,{path:join(root,'synthetic-credentials.yaml'),watch:false});
  const available=(await invoke({action:'chapterProviderSettings'})).value.value;assert.equal(available.storageAvailable,true);
  const settings=available.settings;for(const name of Object.keys(settings.flags))settings.flags[name]=true;
  const request={action:'chapterProviderSave',operationId:'actual-sdk-save',expectedRevision:available.revision,settings};request.sealedKeys=await sealChapterKeys(available.keyTransport,request,{embedding:'SYNTHETIC_SDK_KEY_NOT_REAL'});
  assert(!JSON.stringify(request).includes('SYNTHETIC_SDK_KEY_NOT_REAL'));const saved=await invoke(request);assert(saved.value.ok,JSON.stringify(saved));assert.equal(saved.value.value.runtimeApplied,true);assert.equal(saved.value.value.chapterRunsArmed,0);
  const runtime=JSON.parse(await readFile(join(root,'data/runtime-status.json'),'utf8'));assert.equal(runtime.chapterContext.enabled,true);assert.equal(runtime.chapterContext.embeddingConfigured,true);assert.equal(runtime.backgroundModels.chapters,true);
  const snapshot=buildSavedSnapshot({id:'global-synthetic-card',revision:1,type:'card',sha256:'synthetic',card:{data:{name:'Synthetic global test',first_mes:'Synthetic opening.',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Synthetic.'}]}}}}});
  for(const id of ['one','two']){
   const start=await ctx.scean.startFromStudio({snapshot,authoringSessionId:'synthetic-'+id,generation:'synthetic-generation-'+id});
   const inspected=await ctx.scean.inspectFromStudio({...start,authoringSessionId:'synthetic-'+id,generation:'synthetic-generation-'+id});assert(!JSON.stringify(inspected).includes('SYNTHETIC_SDK_KEY_NOT_REAL'));assert(!JSON.stringify(inspected).includes('sealedKeys'));
   assert.equal((await invoke({action:'chapterProviderSettings'})).value.value.embeddingKey.stored,true);
  }
  await fiber.dispose();fiber=ctx.plugin(plugin,{dataRoot:join(root,'data'),technicalRetries:0});await fiber;
  const restored=(await invoke({action:'chapterProviderSettings'})).value.value;assert.equal(restored.revision,1);assert.equal(restored.embeddingKey.source,'stored');assert.equal(restored.settings.flags.chapterEmbeddingEnabled,true);assert.equal(restored.appliedRevision,1);assert(!JSON.stringify(restored).includes('SYNTHETIC_SDK_KEY_NOT_REAL'));assert.equal(generations,0);
 }finally{await ctx.fiber.dispose();}
});
