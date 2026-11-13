import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { clientRegistryFacts,observeClientRegistry } from '../cardstudio-bundle/lib/host-diagnostics.js';

const own=new URL('../cardstudio-bundle/client.js',import.meta.url);
const id='@local/dsh-card-studio-scean-test';
const dependencies=['@deepseek-ai/dsh-client-ui-conversation','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-ui-commands'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const entries=[{id,immediately:true,inject:dependencies},...dependencies.map(id=>({id})),{id:'synthetic-unrelated-private-plugin',config:{secret:'NEVER_LOG_ME'}}];

test('Host diagnostic reads only own bundle and emits no paths, other plugin names or graph configuration',async()=>{
  const registry={graph:()=>({entries}),clientPath:()=>own};
  const facts=await clientRegistryFacts(registry,own);
  assert.equal(facts.advertised,true);assert.equal(facts.ownBundlePathMatches,true);
  assert.equal(facts.declaredDependenciesPresent,true);
  assert.equal(facts.ownBundleSha256,createHash('sha256').update(await fs.readFile(own)).digest('hex'));
  const result=JSON.stringify(facts);
  for(const forbidden of ['NEVER_LOG_ME','synthetic-unrelated-private-plugin',own.href])assert(!result.includes(forbidden));
});

test('Host diagnostic distinguishes unadvertised and wrong-owned-path states without following other bundle contents',async()=>{
  const missing=await clientRegistryFacts({graph:()=>({entries:[]}),clientPath:()=>undefined},own);
  assert.equal(missing.advertised,false);assert.equal(missing.ownBundlePathMatches,false);
  const wrong=await clientRegistryFacts({graph:()=>({entries}),clientPath:()=>new URL('../cardstudio-bundle/package.json',import.meta.url)},own);
  assert.equal(wrong.advertised,true);assert.equal(wrong.ownBundlePathMatches,false);
  assert.equal(wrong.ownBundleSha256,missing.ownBundleSha256);
});

test('Host observer waits for native optional service, follows graph changes, and unsubscribes on disposal',async()=>{
  const ctx=new Context(),listeners=new Set(),observed=[];
  let graph={entries:[]};
  await ctx.plugin({name:'synthetic-diagnostic-owner',apply(scope){observeClientRegistry(scope,own,facts=>{observed.push(facts);});}});
  assert.equal(observed.length,0);
  await ctx.plugin({name:'synthetic-registry-provider',apply(scope){scope.provide('clientModules',{
    graph:()=>graph,clientPath:()=>graph.entries.length?own:undefined,
    onGraphChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  });}});
  for(let n=0;n<25&&observed.length<1;n++)await tick();
  assert.equal(observed[0]?.advertised,false);
  graph={entries};for(const notify of listeners)notify();
  for(let n=0;n<25&&observed.length<2;n++)await tick();
  assert.equal(observed[1]?.advertised,true);
  await ctx.fiber.dispose();assert.equal(listeners.size,0);
});
