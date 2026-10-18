import fs from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Commands from '@deepseek-ai/dsh-commands';
import Typert from '@deepseek-ai/dsh-typert-registry';
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { createScope } from '@deepseek-ai/dsh-scope';
import Agents from '@deepseek-ai/dsh-agent';
import Sessions from '@deepseek-ai/dsh-session';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import Permissions from '@deepseek-ai/dsh-permission-presets';
import Approval from '@deepseek-ai/dsh-user-approval';

// Native DSH registry/domain/services with a synthetic JSON storage medium.
// No Desktop profile, session persistence, credential service or model provider.
export async function nativeHost(home, plugin, config = {}, {nativeLifecycle=false}={}) {
  await fs.mkdir(home,{recursive:true});
  const storageFile=path.join(home,'synthetic-registry.json');
  let durable={global:{initialized:true,workspaceIds:[],archivedSessionIds:[],pinnedSessionIds:[]},tables:{workspaces:{}}};
  try { durable=JSON.parse(await fs.readFile(storageFile,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const persist=()=>fs.writeFile(storageFile,JSON.stringify(durable));
  const ctx=new Context(),agents=new Map();let facility;
  await ctx.plugin({name:'synthetic-portable-storage',apply(scope){
    scope.provide('storage',{backend:{get:()=>({kv:{open:async()=>({
      loadAll:async()=>structuredClone(durable),
      setGlobal:async value=>{durable.global=structuredClone(value);await persist();},
      putRecord:async(table,key,value)=>{(durable.tables[table]??={})[key]=structuredClone(value);await persist();},
      deleteRecord:async(table,key)=>{delete durable.tables[table]?.[key];await persist();},close:async()=>{},
    })}})}});
    facility=new DomainFacility(scope,{backend:'synthetic'});scope.provide('storageDomain',facility);
    if(nativeLifecycle){
      scope.provide('sessionPersistence',{list:async()=>[],create:async header=>({header,append:async()=>{},close:async()=>{}})});
      scope.provide('shell',{sandboxMode:'workspace-write'});
      scope.provide('llm',{request(){throw new Error('Model inference is forbidden.');},stream(){throw new Error('Model inference is forbidden.');}});
    }else{
      scope.provide('sessionPersistence',{list:async()=>[]});scope.provide('sessions',{get:()=>undefined,list:()=>[]});
      scope.provide('agents',{get:id=>agents.get(id)});
    }
  }});
  await ctx.plugin(Typert);await ctx.plugin(SystemPrompt);await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(Skills);await ctx.plugin(Commands);await ctx.plugin(WorkspaceRegistry);
  if(nativeLifecycle){await ctx.plugin(Sessions);await ctx.plugin(Agents);await ctx.plugin(SessionProjections);await ctx.plugin(Approval);await ctx.plugin(Permissions);await ctx.plugin(AgentLoop);}
  const fiber=ctx.plugin(plugin,config);await fiber;
  if(fiber.state!==2){await ctx.fiber.dispose();throw new Error('Card Studio Host did not activate: fiber state '+fiber.state);}
  const agent=(id,cwd)=>{
    const value={id,status:'idle',async whenIdle(){},cancel(){throw new Error('Unexpected cancellation');},session:{header:{id,cwd},append(){throw new Error('Synthetic portable test must not append session events.');}},prompt(){throw new Error('Model inference is forbidden.');}};
    value.ctx=createScope(ctx,value).ctx;agents.set(id,value);return value;
  };
  return {ctx,fiber,agent,createAgent:(id,cwd,setup)=>ctx.agents.create({sessionId:id,meta:{cwd},agentOptions:{provider:'forbidden',model:'no-inference'},setup}),registry:ctx.get('workspaceRegistry'),request:(agent,request)=>ctx.get('cardstudioBridge').request(agent,request,new AbortController().signal),close:async()=>{await ctx.fiber.dispose();await facility.closeAll();}};
}
