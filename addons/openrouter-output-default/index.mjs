import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {installOutputDefaultGuard} from './guard.mjs';

export const name='scean-openrouter-output-default';
export const inject=['llm'];
const allowedUsage=['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens'];
export async function activate(ctx,config={}){
 const pin=JSON.parse(await fs.readFile(new URL('./sdk-pin.json',import.meta.url),'utf8'));
 const root=path.join(process.env.DSH_HOME??path.join(homedir(),'.dsh'),'scean-openrouter-output-default');
 await fs.mkdir(root,{recursive:true});
 const metadata=JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8'));
 const state={schemaVersion:1,version:metadata.version,active:false,provider:'openrouter',sdkVersion:pin.sdkVersion,expectedMethodHash:pin.adapterMethodSha256,omissionsObserved:0,modelCallsStarted:0,phase:'starting'};
 let queue=Promise.resolve(),closed=false,verification=null,controller=null;
 const handles=new Map();
 const save=()=>{const snapshot=JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2)+'\n';queue=queue.catch(()=>{}).then(async()=>{const target=path.join(root,'runtime-status.json'),temp=target+'.tmp';await fs.writeFile(temp,snapshot);await fs.rename(temp,target);});return queue;};
 const onOmission=record=>{state.omissionsObserved++;state.lastOmission={...record,at:new Date().toISOString()};void save().catch(()=>{});};
 const verificationKey=config.verifyOnce;
 if(verificationKey!==undefined&&(typeof verificationKey!=='string'||!/^[a-z0-9-]{1,90}$/.test(verificationKey)))throw Error('INVALID_VERIFICATION_KEY');
 async function verifyOnce(){
  const target=path.join(root,'verification-'+verificationKey+'.json');
  let existing;try{existing=JSON.parse(await fs.readFile(target,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(existing){state.verification={status:existing.status,reusedReceipt:true};await save();return existing;}
  let verificationText='Confirm the transport is working. Reply OK.';
  if(config.verifyCorpus===true){let seed=20261106;const chars=[];for(let i=0;i<120000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;chars.push(String.fromCharCode(0x4e00+seed%20000));}verificationText='This is a generated tokenizer stress-test corpus, not meaningful text. Ignore it and reply exactly OK.\n'+chars.join('');}
  if(Buffer.byteLength(verificationText,'utf8')>400000)throw Error('VERIFICATION_INPUT_BOUND');
  const receipt={schemaVersion:1,status:'admitted',provider:'openrouter',model:'z-ai/glm-5.3',requestKind:config.verifyCorpus===true?'synthetic_context_transport_check':'synthetic_transport_check',syntheticInputChars:verificationText.length,syntheticInputBytes:Buffer.byteLength(verificationText,'utf8'),storyRunUsed:false,automaticRetries:0,startedAt:new Date().toISOString()};
  try{await fs.writeFile(target,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code==='EEXIST')return;throw e;}
  const persist=()=>fs.writeFile(target,JSON.stringify(receipt,null,2)+'\n');
  controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000),blocks=new Map();const before=state.omissionsObserved;
  try{
   await ctx.llm.resolveModelInfo('openrouter','z-ai/glm-5.3',controller.signal);
   receipt.status='dispatched';state.modelCallsStarted++;await persist();await save();let finish;
   for await(const chunk of ctx.llm.stream({provider:'openrouter',model:'z-ai/glm-5.3',system:'This is a transport verification, not a story. Reply with exactly OK.',messages:[{role:'user',content:[{type:'text',text:verificationText}]}],signal:controller.signal,purpose:'scean-verification',sessionId:'scean-verify-'+verificationKey})){
    if(chunk.type==='text-delta'){blocks.set(chunk.index,(blocks.get(chunk.index)??'')+(chunk.text??''));}
    else if(chunk.type==='block-end'&&chunk.block?.type==='text')blocks.set(chunk.index,chunk.block.text);
    else if(chunk.type==='usage')receipt.usage=Object.fromEntries(allowedUsage.filter(k=>Number.isFinite(chunk.usage?.[k])).map(k=>[k,chunk.usage[k]]));
    else if(chunk.type==='finish')finish=chunk.reason;
    if([...blocks.values()].join('').length>256){receipt.failureCode='VERIFICATION_RESPONSE_BOUND';controller.abort();break;}
   }
   receipt.finishKind=finish?.kind??'missing';receipt.failureCode??=finish?.failure?.code??null;
   receipt.outputMatchesOK=[...blocks.values()].join('').trim()==='OK';receipt.outputLimitOmissionObserved=state.omissionsObserved>before;receipt.lastOmission=state.lastOmission??null;
   receipt.status=finish?.kind==='stop'&&receipt.outputMatchesOK&&receipt.outputLimitOmissionObserved?'passed':'failed';
  }catch(e){receipt.status='failed';receipt.failureCode=typeof e.code==='string'?e.code:controller.signal.aborted?'ABORTED':'VERIFICATION_FAILED';}
  finally{clearTimeout(timeout);controller=null;receipt.finishedAt=new Date().toISOString();await persist();state.verification={status:receipt.status,failureCode:receipt.failureCode??null};await save();}
  return receipt;
 }
 function attach(){
  if(closed)return;
  try{
   const adapter=ctx.llm.registration('openrouter').adapter;
   if(!handles.has(adapter))handles.set(adapter,installOutputDefaultGuard(adapter,{expectedMethodHash:pin.adapterMethodSha256,onOmission}));
   const handle=handles.get(adapter);state.active=handle.active;state.phase=handle.active?'active':handle.reason;
  }catch(e){state.active=false;state.phase='provider_not_registered';}
  void save().catch(()=>{});
  if(state.active&&verificationKey&&!verification)verification=Promise.resolve().then(verifyOnce).catch(e=>{state.verification={status:'failed',failureCode:e.code??'LOCAL_VERIFICATION_FAILED'};return save();});
 }
 ctx.on('llm/adapters-updated',attach);attach();await save();
 return {root,waitForVerification:()=>verification??Promise.resolve(null),async dispose(){closed=true;controller?.abort();for(const h of handles.values())h.dispose();state.active=false;state.phase='disposed';await verification;await save();}};
}
export async function apply(ctx,config){const handle=await activate(ctx,config);ctx.effect(()=>()=>handle.dispose(),'OpenRouter output default cleanup');}
