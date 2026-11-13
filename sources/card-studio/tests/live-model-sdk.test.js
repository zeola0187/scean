import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DeepSeekAdapter,resolveAdapterOptions} from '@deepseek-ai/dsh-llm-deepseek';
import {createSystemMessage,createUserMessage,createMessage} from '@deepseek-ai/dsh-llm';
import {nativeHost} from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';

test('official SDK exposes complete serialized system, tools and history before network; offline interception only',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-018-wire-'));
 const previousHome=process.env.DSH_HOME,previousFetch=globalThis.fetch;process.env.DSH_HOME=home;
 let host,intercepts=0,captured;
 try{
  host=await nativeHost(home,plugin);
  const agent=host.agent('synthetic-wire-A',host.registry.list()[0].path);
  const acquired=await host.request(agent,{action:'acquire',page_id:'synthetic-wire-page'});assert(acquired.ok);
  const contexts=(await host.ctx.systemPrompt.assemble({scope:agent})).contexts;
  const system=contexts.map(row=>row.text).join('\n\n'),tools=host.ctx.tools.schemas(agent);
  assert(system.includes('Must execute:'));assert.equal(tools.length,29);
  const messages=[createSystemMessage(system),
   createUserMessage({content:[{type:'text',text:'SYNTHETIC prior user turn'}],source:{kind:'user'}}),
   createMessage({role:'assistant',content:[{type:'text',text:'OFFLINE prior assistant fixture'}],source:{kind:'model',provider:'deepseek-account',model:'deepseek-flash'}}),
   createUserMessage({content:[{type:'text',text:'SYNTHETIC current user turn'}],source:{kind:'user'}})];
  globalThis.fetch=async(url,options)=>{
   intercepts++;assert.equal(url,'https://api.deepseek.com/anthropic/v1/messages');
   assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
   captured=JSON.parse(options.body);assert.equal(captured.max_tokens,8192);assert.equal(captured.output_config.effort,'max');
   assert.equal(captured.thinking.type,'enabled');assert.equal(captured.tools.length,29);
   assert(JSON.stringify(captured.system).includes('Must execute:'));
   assert(JSON.stringify(captured.messages).includes('SYNTHETIC prior user turn'));
   assert(JSON.stringify(captured.messages).includes('OFFLINE prior assistant fixture'));
   assert(JSON.stringify(captured.messages).includes('SYNTHETIC current user turn'));
   const events=[{type:'message_start',message:{usage:{input_tokens:100,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:'OFFLINE SDK transport fixture'}},
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:50}},
    {type:'message_stop'}];
   return new Response(events.map(value=>'data: '+JSON.stringify(value)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});
  };
  const connection=resolveAdapterOptions({maxTokens:8192,reasoningEffort:'max'},{get:()=>undefined,getFrom:()=>undefined});
  const adapter=new DeepSeekAdapter({options:()=>connection,resolveUserId:()=> 'synthetic-user',
   prepareExtensions:async()=>({fields:{},accept:async()=>{}}),
   resolveAuth:async()=>({headers:{'x-dsh-auth-token':'dsh_mock_OFFLINE_ONLY'}})});
  const chunks=[];
  for await(const chunk of adapter.stream({provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max',maxTokens:8192,messages,tools,signal:new AbortController().signal}))chunks.push(chunk);
  assert.equal(intercepts,1);assert(chunks.some(chunk=>chunk.type==='usage'));
  const body=JSON.stringify(captured);
  await fs.writeFile(new URL('../test-evidence/live-model-sdk-wire.json',import.meta.url),JSON.stringify({
   evidenceType:'OFFLINE SDK + synthetic Host + intercepted fetch; fake authentication, response and usage',
   realModel:false,realNetworkRequests:0,offlineIntercepts:intercepts,completeSystemToolsHistoryCaptured:true,
   tools:captured.tools.length,serializedRequestUtf8Bytes:Buffer.byteLength(body,'utf8'),
   requestSha256:createHash('sha256').update(body).digest('hex'),request:captured,
   exactInputTokenCount:null,note:'Visibility is proven. Wire JSON bytes are not declared equivalent to the provider-rendered V4.1 token count.'},null,2)+'\n');
 }finally{
  globalThis.fetch=previousFetch;await host?.close();if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
 }
});
