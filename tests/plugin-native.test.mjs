// Actual formal 0.2.0-rc.2 Cordis/registry/gateway extracted by scripts/prepare-sdk.py.
// Model is deliberately fake. This is NOT formal Desktop UI acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Typert from '@deepseek-ai/dsh-typert-registry';
import {TypertGatewayService} from '@deepseek-ai/dsh-api-gateway';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../plugin/index.js';
import {validateSnapshot} from '../core/contracts.mjs';
import {VERSION} from '../plugin/version.mjs';

test('FORMAL SOURCE / FAKE MODEL: native plugin registration, direct RPC no Agent, saved r1/r2, cleanup',async()=>{
  const base=fileURLToPath(new URL('../evidence/plugin-test-temp/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'native-'));
  const ctx=new Context();let modelCalls=0;
  ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'offline'})});
  ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){modelCalls++;throw new Error('No paid model call in native registration test');}});
  await ctx.plugin(Typert);
  const peer=Connection.Peer?new Connection.Peer(ctx,{principal:{kind:'owner'}}):new Connection.OperatorPeer(ctx);
  const foreignPeer=Connection.Peer?new Connection.Peer(ctx,{principal:{kind:'owner'}}):new Connection.OperatorPeer(ctx);
  ctx.provide('connection',Connection.Peer?{browserPeer:peer}:{operator:peer});
  const gateway=new TypertGatewayService(ctx,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
  const fiber=ctx.plugin(plugin,{dataRoot:root,budgetPath:join(root,'offline-ledger.jsonl')});await fiber;
  const cardScope={provider:'@local/dsh-card-studio-scean-test',cardId:'native-synthetic',authoringSessionId:'synthetic-author',generation:'uuid-native-generation'};
  ctx.provide('cardstudioSceanBridge',{resolveSceanScope:async id=>id===cardScope.authoringSessionId?cardScope:null});
  const invoke=request=>gateway.invokeRpc('scean/request',{args:{request:{sessionId:cardScope.authoringSessionId,cardScope,...request}}},new AbortController().signal,peer);
  try{
    const caps=await invoke({action:'capabilities'});assert(caps.ok,JSON.stringify(caps));assert(caps.value.ok,JSON.stringify(caps));assert.equal(caps.value.value.inspectionReadOnly,true);
    const snapshot=validateSnapshot({source:{provider:cardScope.provider,card:{id:cardScope.cardId,revision:1}},schemaVersion:1,cardId:'native-synthetic',revision:1,card:{name:'Synthetic'},worldbook:{entries:[]},preset:{},characters:[{id:'captain',name:'Captain',description:'Synthetic test captain.'}]});
    assert.equal((await ctx.scean.request({action:'list'})).error.code,'TRUSTED_CLIENT_REQUIRED');
    assert.equal((await gateway.invokeRpc('scean/request',{args:{request:{action:'list'}}},new AbortController().signal,foreignPeer)).value.error.code,'TRUSTED_CLIENT_REQUIRED');
    assert.equal((await ctx.scean.request({action:'models'})).error.code,'TRUSTED_CLIENT_REQUIRED');
    const labels=await invoke({action:'models'});assert(labels.value.ok);assert.deepEqual(labels.value.value.requested,{provider:'synthetic',model:'offline'});assert.equal(labels.value.value.modelSwitching,false);assert.deepEqual(Object.keys(labels.value.value.capabilities).sort(),['contextWindow','outputLimit']);
    const start=await ctx.scean.startFromStudio({snapshot,authoringSessionId:'synthetic-author',generation:'uuid-native-generation'});
    const read=await ctx.scean.inspectFromStudio({...start,authoringSessionId:'synthetic-author',generation:'uuid-native-generation'});assert.equal(read.snapshot.revision,1);
    assert.equal((await invoke({action:'create',snapshot})).value.error.code,'CARD_SCOPED_STUDIO_REQUIRED');
    const {hash:oldHash,...saved}=snapshot;
    const r2=await ctx.scean.startFromStudio({snapshot:validateSnapshot({...saved,revision:2,source:{...snapshot.source,card:{...snapshot.source.card,revision:2}}}),authoringSessionId:cardScope.authoringSessionId,generation:cardScope.generation});assert.notEqual(r2.runId,start.runId);
    assert.equal((await invoke({action:'list'})).value.value.length,2);assert.equal((await invoke({action:'inspect',runId:start.runId})).value.value.snapshot.revision,1);
    assert.equal(modelCalls,0);const status=JSON.parse(await readFile(join(root,'runtime-status.json'),'utf8'));assert.equal(status.phase,'ready');assert.equal(status.version,VERSION);assert.equal(caps.value.value.version,VERSION);assert.equal(status.usageMode,'journal_only');assert.equal(status.localGenerationLimit,null);assert.equal(status.localDollarLimit,null);assert.equal(status.memory.retrieval,'bm25');assert.equal(status.memory.rerankConfigured,false);assert.deepEqual(status.backgroundModels,{rollingSummary:false,chapters:true});
    await fiber.dispose();assert.equal(JSON.parse(await readFile(join(root,'runtime-status.json'),'utf8')).phase,'inactive');
    assert.equal((await invoke({action:'list'})).error.code,'gateway/definition-unavailable');
  }finally{await ctx.fiber.dispose();}
});
