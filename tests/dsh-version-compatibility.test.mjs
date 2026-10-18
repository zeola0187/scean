import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {evaluatePluginCompatibility,loadProfileDirectory} from '@deepseek-ai/dsh-app-boot';
import {Context} from '@deepseek-ai/cordis';
import Typert from '@deepseek-ai/dsh-typert-registry';
import {TypertGatewayService} from '@deepseek-ai/dsh-api-gateway';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../plugin/index.js';
const root=path.resolve(import.meta.dirname,'..');
const spec=JSON.parse(await fs.readFile(path.join(root,'dsh-compatibility.json'),'utf8'));

test('all three package boundaries admit only the reviewed exact DSH versions',async()=>{
 for(const rel of ['package.json','packages/scean/package.json','packages/studio/package.json']){
  const m=JSON.parse(await fs.readFile(path.join(root,rel),'utf8'));
  assert.equal(m.engines.dsh,spec.supportedDshVersions.join(' || '));
  for(const version of spec.supportedDshVersions)assert.equal(evaluatePluginCompatibility(m,{},version),undefined,rel+' '+version);
  for(const version of ['0.2.0-rc.1','0.2.1-alpha.1','0.2.1-rc.3','0.2.1','0.2.2-rc.1','1.0.0']){
   const issue=evaluatePluginCompatibility(m,{},version);assert(issue,rel+' must reject '+version);assert.equal(issue.exempted,false);
  }
 }
});

test('official Profile loader discovers the suite without an exemption or importing plugin code',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'scean-version-loader-'));
 const target=path.join(temp,'node_modules/@local/dsh-scean-suite');
 await fs.mkdir(target,{recursive:true});
 for(const file of ['package.json','cordis.patch.yml'])await fs.copyFile(path.join(root,file),path.join(target,file));
 await fs.writeFile(path.join(temp,'package.json'),JSON.stringify({private:true,dsh:{profile:{bundles:['@local/dsh-scean-suite']}}}));
 await fs.writeFile(path.join(temp,'cordis.patch.yml'),'[]\n');
 const loaded=loadProfileDirectory('dsh',temp,path.join(root,'package.json'));
 assert.deepEqual(loaded.skippedBundles,[]);assert.equal(loaded.layers.length,1);assert.equal(loaded.layers[0].patches[0].insert.length,2);
 await assert.rejects(fs.access(path.join(temp,'compatibility.json')),{code:'ENOENT'});
});

for(const field of ['browserPeer','operator'])test(`trusted UI identity through ${field} rejects a different owner Peer and unscoped calls`,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scean-peer-compat-'));const ctx=new Context();
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'offline',model:'none'})});
 ctx.provide('llm',{resolveModelInfo:async()=>({}),async *stream(){assert.fail('No generation in trust test');}});
 await ctx.plugin(Typert);
 const makePeer=()=>Connection.Peer?new Connection.Peer(ctx,{principal:{kind:'owner'}}):new Connection.OperatorPeer(ctx);
 const browser=makePeer(),foreign=makePeer();ctx.provide('connection',{[field]:browser});
 const gateway=new TypertGatewayService(ctx,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 try{
  await ctx.plugin(plugin,{dataRoot:dir});
  assert.equal((await ctx.scean.request({action:'capabilities'})).error.code,'TRUSTED_CLIENT_REQUIRED');
  const call=peer=>gateway.invokeRpc('scean/request',{args:{request:{action:'capabilities'}}},new AbortController().signal,peer);
  assert.equal((await call(browser)).value.ok,true);
  assert.equal((await call(foreign)).value.error.code,'TRUSTED_CLIENT_REQUIRED');
  await browser.dispose();
  // The new SDK introduces a lifetime signal and refuses disposed transport Peers.
  // rc.2's OperatorPeer has no signal and its Gateway does not expose that contract.
  if(Connection.Peer)assert.equal((await call(browser)).ok,false,'disposed Peer cannot invoke');
 }finally{await ctx.fiber.dispose();}
});
