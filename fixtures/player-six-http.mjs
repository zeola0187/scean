// Actual isolated HTTP/Studio/Host chain, with invented assets and a zero-cost
// injected model. No installed Profile, production Run or provider is opened.
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../isolated/server.mjs';
import {UsageLedger} from '../adapters/budget.mjs';
import {w01Fixture} from './w01-frontends.mjs';
import {IDEA_CATEGORIES} from '../core/player-ideas.mjs';

export async function sixHttp(t){
 const base=fileURLToPath(new URL('../.test-data/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'player-six-http-')),dataRoot=path.join(root,'host-data'),gatePath=path.join(root,'synthetic-generation-gate.jsonl'),calls=[],ledger=new UsageLedger(path.join(root,'scripted-usage.jsonl'));
 let running=null,ideasHandler=null;
 const model={async describe(){return{source:'synthetic-only',capabilities:{contextWindow:32768,outputLimit:1536},effective:{provider:'synthetic',model:'scripted-six'}};},async generate(args){
  calls.push(structuredClone({stage:args.stage,input:args.input,tools:args.tools??[],context:args.context}));
  const id=await ledger.reserve({caseId:'six-'+args.stage,requestId:randomUUID(),meta:{stage:args.stage,provider:'synthetic',model:'scripted-six'}});let result;
  try{
   if(args.stage==='ideas')result=ideasHandler?await ideasHandler(args):{text:JSON.stringify({ideas:IDEA_CATEGORIES.map((category,index)=>({category,text:'合成方向 '+(index+1)}))})};
   else if(args.stage==='director')result={text:JSON.stringify({sceneIntent:'Observe the synthetic public gauge without new player decisions.'})};
   else if(args.stage==='writer')result={text:JSON.stringify({finalBody:'合成紀錄員查看儀表，讓玩家決定接下來要談的事情。',dialogue:[]})};
   else if(args.stage==='post_stat')result={text:JSON.stringify({time:{elapsedMinutes:20},stateChanges:[]})};
   else throw Object.assign(Error('Unexpected synthetic stage'),{code:'SCRIPTED_STAGE_UNSUPPORTED'});
   await ledger.settle(id,{status:'completed',actualCostUsd:0,usage:{inputTokens:17,outputTokens:26,totalTokens:43}});
   return{...result,model:'scripted-six',usage:{inputTokens:17,outputTokens:26,totalTokens:43,costUSD:0}};
  }catch(error){await ledger.settle(id,{status:'failed',actualCostUsd:0});throw error;}
 }};
 async function start(){
  // This explicit identity is confined to the authorized synthetic test worker.
  // Existing primary-machine guard tests and production configuration are intact.
  const prior=process.env.SCEAN_PRIMARY_MACHINE;process.env.SCEAN_PRIMARY_MACHINE=hostname();
  try{running=await startServer({scripted:true,port:0,dataRoot,gatePath,model,scriptedDelay:0});return running;}
  finally{if(prior===undefined)delete process.env.SCEAN_PRIMARY_MACHINE;else process.env.SCEAN_PRIMARY_MACHINE=prior;}
 }
 await start();t.after(async()=>{await running?.close();await rm(root,{recursive:true,force:true});});
 async function call(request,headers={}){const response=await fetch(running.origin+'/api',{method:'POST',headers:{'Content-Type':'application/json','X-Scean-Token':running.token,Origin:running.origin,...headers},body:JSON.stringify(request)});return{status:response.status,...await response.json()};}
 async function ok(request){const response=await call(request);if(!response.ok)throw Object.assign(Error('Synthetic HTTP action failed: '+request.action+' '+response.error?.code),response.error);return response.value;}
 async function importRun({withoutFrontend=false}={}){
  const fixture=w01Fixture('fantasy'),card=structuredClone(fixture.card);card.data.name='Six-item synthetic HTTP story';
  card.data.character_book.entries=[{id:1,name:'公開碼頭',content:'這是一座合成碼頭。',visibility:'public',constant:true},{id:2,name:'PRIVATE_BOOK_TITLE_CANARY',content:'PRIVATE_BOOK_CONTENT_CANARY',visibility:'private',constant:true},{id:3,name:'UNMARKED_BOOK_TITLE_CANARY',content:'UNMARKED_BOOK_CONTENT_CANARY',constant:true}].map((entry,index)=>({...entry,keys:['synthetic'],enabled:true,insertion_order:index,extensions:{}}));
  if(withoutFrontend)delete card.data.extensions.scean.frontend;
  const acquired=await ok({action:'studio.acquire',pageId:'synthetic-six-page'}),claim=acquired.claim;
  const imported=await ok({action:'studio.import',claim,fileName:'six-synthetic.json',type:'card',base64:Buffer.from(JSON.stringify(card)).toString('base64')});
  const created=await ok({action:'studio.handoff',claim,documentId:imported.id,expectedRevision:imported.revision??0,presetId:'scean-default',openingIndex:0,playerName:'合成玩家'});
  const runId=created.runId??created.value?.runId;
  if(!runId)throw Error('Synthetic handoff did not create a Run');
  return{fixture,card,claim,documentId:imported.id,revision:imported.revision??0,runId};
 }
 return{root,dataRoot,gatePath,calls,ledger,call,ok,importRun,get server(){return running;},set ideasHandler(value){ideasHandler=value;},async storyBytes(runId){return readFile(path.join(running.host.engine.store.runDir(runId),'current.json'));},async restart(){await running.close();return start();}};
}
