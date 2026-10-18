import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Typert from '@deepseek-ai/dsh-typert-registry';
import * as plugin from '../plugin/index.js';

test('plugin default data follows isolated DSH_HOME; explicit dataRoot retains precedence without generation',async()=>{
 const base=await fs.mkdtemp(path.join(tmpdir(),'b00-home-isolation-')),prior=process.env.DSH_HOME;
 try{
  for(const explicit of [false,true]){
   const home=path.join(base,explicit?'override-home':'default-home');process.env.DSH_HOME=home;
   const dataRoot=explicit?path.join(base,'explicit-data'):path.join(home,'scean-mvp-0.7.1-milestone-d-final');
   const ctx=new Context();ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'offline'})});
   ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){assert.fail('Model forbidden');}});
   try{await ctx.plugin(Typert);await ctx.plugin(plugin,explicit?{dataRoot}:{});const status=JSON.parse(await fs.readFile(path.join(dataRoot,'runtime-status.json'),'utf8'));assert.equal(status.phase,'ready');assert.equal(status.memory.embeddingConfigured,false);}
   finally{await ctx.fiber.dispose();}
   if(explicit)await assert.rejects(fs.access(path.join(home,'scean-mvp-0.7.1-milestone-d-final')),{code:'ENOENT'});
  }
 }finally{if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;}
});
