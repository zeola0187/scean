import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import LocalCredentials from '@deepseek-ai/dsh-credentials-local';
import {ChapterProviderSettings,chapterSettingsDefaults} from '../plugin/chapter-settings.mjs';
import {sealChapterKeys} from '../isolated/web/chapter-settings-ui.mjs';
import {configuredChapterPorts} from '../adapters/chapter-providers.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

const EMB='SYNTHETIC_EMBEDDING_CANARY_NOT_A_REAL_KEY',RANK='SYNTHETIC_RERANK_CANARY_NOT_A_REAL_KEY',ENV='SYNTHETIC_ENV_CANARY_NOT_A_REAL_KEY';
function memoryCredentials(){const records=new Map();let chain=Promise.resolve();return {records,async readRecord(key){return structuredClone(records.get(key));},modifyRecord(key,mutate){const task=chain.then(async()=>{const old=structuredClone(records.get(key)),next=await mutate(old);if(next!==undefined)records.set(key,structuredClone(next));return structuredClone(next??old);});chain=task.catch(()=>{});return task;}};}
function setup({credentials=memoryCredentials(),scope='synthetic-host',config={},env={},writable=true}={}){
 const manager=new ChapterProviderSettings({credentials,scope,config,environment:name=>env[name],nativeSelection:()=>({provider:'scripted-native',model:'offline'}),writable});return {manager,credentials};
}
async function save(manager,{settings,keys={},operationId='synthetic-save',expectedRevision}={}){
 const status=await manager.status(),request={action:'chapterProviderSave',operationId,expectedRevision:expectedRevision??status.revision,settings:settings??status.settings};request.sealedKeys=await sealChapterKeys(status.keyTransport,request,keys);return {request,result:await manager.save(request)};
}
const enabled=()=>{const settings=chapterSettingsDefaults();for(const k in settings.flags)settings.flags[k]=true;return settings;};
const code=expected=>error=>error.code===expected;
function noSecrets(value){const text=JSON.stringify(value);for(const key of [EMB,RANK,ENV])assert(!text.includes(key));}

test('global environment compatibility exposes availability/source only and never migrates the ambient key',async()=>{
 const {manager,credentials}=setup({env:{'OpenRouter API Key':ENV}}),status=await manager.status();
 assert.equal(status.embeddingKey.source,'environment');assert.equal(status.embeddingKey.environmentAvailable,true);assert.equal(status.embeddingKey.stored,false);assert.equal(credentials.records.size,0);noSecrets(status);
 const s=status.settings;s.embedding.environmentFallback=false;const r=await save(manager,{settings:s});assert.equal(r.result.embeddingKey.source,'none');assert.equal(r.result.embeddingKey.environmentAvailable,true);noSecrets(r.result);assert(!JSON.stringify([...credentials.records]).includes(ENV));
});
test('global sealed save is atomic, redacted, immediately shared and empty fields preserve stored values',async()=>{
 const {manager}=setup({env:{'OpenRouter API Key':ENV}}),{request,result}=await save(manager,{settings:enabled(),keys:{embedding:EMB}});
 noSecrets(request);noSecrets(result);assert.equal(result.revision,1);assert.equal(result.embeddingKey.source,'stored');assert.equal((await manager.runtime('embedding')).apiKey,EMB);
 const next=await save(manager,{operationId:'keep-blank'});assert.equal(next.result.revision,2);assert.equal((await manager.runtime('embedding')).apiKey,EMB);assert.equal(next.result.saveStartsModelWork,false);
 const duplicate=await manager.save(next.request);assert.equal(duplicate.revision,2);noSecrets(duplicate);
 await assert.rejects(manager.save({...next.request,settings:{...next.request.settings,flags:{...next.request.settings.flags,chapterModelsEnabled:false}}}),code('CHAPTER_SETTINGS_DEPENDENCY'));
});
test('global mask strings, foreign destinations, malformed envelopes and missing dependencies fail before commit',async()=>{
 const {manager}=setup();await save(manager,{settings:enabled(),keys:{embedding:EMB}});
 const status=await manager.status(),request={action:'chapterProviderSave',operationId:'masked',expectedRevision:1,settings:status.settings};request.sealedKeys=await sealChapterKeys(status.keyTransport,request,{embedding:'••••••••'});await assert.rejects(manager.save(request),code('CHAPTER_SETTINGS_KEY_INVALID'));
 const changed=structuredClone(status.settings);changed.embedding.provider='compatible';changed.embedding.baseUrl='https://synthetic.invalid/v1';changed.embedding.nebiusOnly=false;await assert.rejects(save(manager,{settings:changed,operationId:'other-destination'}),code('CHAPTER_SETTINGS_KEY_DESTINATION_CHANGED'));
 await assert.rejects(manager.save({...request,operationId:'aad-changed'}),code('CHAPTER_SETTINGS_KEY_INVALID'));
 const invalid=enabled();invalid.flags.chapterEmbeddingEnabled=false;await assert.rejects(save(manager,{settings:invalid,operationId:'dependency'}),code('CHAPTER_SETTINGS_DEPENDENCY'));
 assert.equal((await manager.status()).revision,1);
});
test('global configured service without a key refuses activation without persisting false readiness',async()=>{
 const {manager}=setup();await assert.rejects(save(manager,{settings:enabled()}),code('CHAPTER_SETTINGS_KEY_REQUIRED'));assert.equal((await manager.status()).revision,0);
});
test('global current-DSH rerank without a selected model fails configuration before any embedding request',async()=>{
 const {credentials}=setup(),manager=new ChapterProviderSettings({credentials,scope:'missing-model',environment:()=>undefined,nativeSelection:()=>null});
 await assert.rejects(save(manager,{settings:enabled(),keys:{embedding:EMB}}),code('CHAPTER_SETTINGS_MODEL_REQUIRED'));assert.equal((await manager.status()).revision,0);
});
test('global confirmed clear removes owned keys and disables capabilities plus optional fallback',async()=>{
 const {manager}=setup({env:{'OpenRouter API Key':ENV}});await save(manager,{settings:enabled(),keys:{embedding:EMB}});
 const request={action:'chapterProviderClear',operationId:'clear-shared',expectedRevision:1};await assert.rejects(manager.save(request,undefined,{clear:true}),code('CHAPTER_SETTINGS_CLEAR_CONFIRMATION'));
 const result=await manager.save({...request,confirmation:'clear-shared-chapter-settings'},undefined,{clear:true});assert.equal(result.revision,2);assert(Object.values(result.settings.flags).every(v=>v===false));assert.equal(result.embeddingKey.source,'none');assert.equal(result.embeddingKey.environmentAvailable,true);assert.equal(result.embeddingKey.stored,false);noSecrets(result);
 await assert.rejects(manager.runtime('embedding'),code('CHAPTER_EMBEDDING_UNAVAILABLE'));
});
test('global native credential provider persists one protected record across restart and isolates Host/Profile identities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scean-global-credentials-')),filename=join(root,'synthetic-credentials.yaml');let ctx=new Context();await ctx.plugin(LocalCredentials,{path:filename,watch:false});
 let manager=setup({credentials:ctx.credentials,scope:{profile:'isolated',dataRoot:root}}).manager;await save(manager,{settings:enabled(),keys:{embedding:EMB}});manager.close();await ctx.fiber.dispose();
 ctx=new Context();await ctx.plugin(LocalCredentials,{path:filename,watch:false});try{
  manager=setup({credentials:ctx.credentials,scope:{profile:'isolated',dataRoot:root}}).manager;assert.equal((await manager.status()).revision,1);assert.equal((await manager.runtime('embedding')).apiKey,EMB);noSecrets(await manager.status());
  const other=setup({credentials:ctx.credentials,scope:{profile:'other',dataRoot:root}}).manager;assert.equal((await other.status()).revision,0);
  const document=await readFile(filename,'utf8');assert(document.includes(EMB));assert(!document.includes('runId'));assert(!document.includes('snapshot'));
 }finally{await ctx.fiber.dispose();}
});
test('global concurrent pages cannot overwrite a later revision; precommit cancellation makes no write',async()=>{
 const {manager}=setup(),settings=chapterSettingsDefaults(),one={action:'chapterProviderSave',operationId:'page-one',expectedRevision:0,settings},two={...one,operationId:'page-two'};
 const results=await Promise.allSettled([manager.save(one),manager.save(two)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CHAPTER_SETTINGS_VERSION_CONFLICT');
 const c=new AbortController();c.abort();await assert.rejects(manager.save({...one,operationId:'cancel',expectedRevision:1},c.signal));assert.equal((await manager.status()).revision,1);
});
test('global unknown durable write outcome is explicit and recoverable by read, never a secret resend',async()=>{
 const credentials=memoryCredentials(),original=credentials.modifyRecord;credentials.modifyRecord=async(...args)=>{await original.apply(credentials,args);throw Error('SYNTHETIC_AFTER_COMMIT');};
 const {manager}=setup({credentials});await assert.rejects(save(manager,{settings:enabled(),keys:{embedding:EMB}}),code('CHAPTER_SETTINGS_SAVE_UNKNOWN'));const status=await manager.status();assert.equal(status.revision,1);assert.equal(status.lastOperationId,'synthetic-save');noSecrets(status);
});
test('global unconfirmed native-store cache cannot falsely report live adoption or allow another secret submission',async()=>{
 const credentials=memoryCredentials();credentials.modifyRecord=async()=>{throw Error('SYNTHETIC_UNKNOWN_DURABILITY');};const {manager}=setup({credentials});
 const host=new SceanHost({engine:{},root:await mkdtemp(join(tmpdir(),'scean-global-unknown-')),chapterProviderSettings:manager,chapterModelsEnabled:true,chapterRetrievalEnabled:true});await host.init();
 try{host.chapterAutoArmed.add('synthetic');host.chapterContextArmed.add('synthetic');
  const authority={principal:{},allowGlobalSettings:true},request={action:'chapterProviderSave',operationId:'unknown-cache',expectedRevision:0,settings:chapterSettingsDefaults()};
  assert.equal((await host.request(request,undefined,authority)).error.code,'CHAPTER_SETTINGS_SAVE_UNKNOWN');assert.equal(host.chapterContextArmed.size,0);assert.equal(host.chapterModelsEnabled,false);
  const status=(await host.request({action:'chapterProviderSettings'},undefined,authority)).value;assert.equal(status.saveOutcomeUncertain,true);assert.equal(status.runtimeApplied,false);assert.equal(status.appliedRevision,null);
  assert.equal((await host.request({...request,operationId:'no-blind-resend'},undefined,authority)).error.code,'CHAPTER_SETTINGS_SAVE_UNKNOWN');
 }finally{await host.close();}
});
test('global unavailable/read-only native store never falls back to browser, Run or ad-hoc plaintext storage',async()=>{
 for(const options of [{credentials:undefined},{writable:false}]){const manager=new ChapterProviderSettings({scope:'unavailable',environment:()=>undefined,...options});assert.equal((await manager.status()).storageAvailable,false);await assert.rejects(manager.save({}),code('CHAPTER_SETTINGS_STORAGE_UNAVAILABLE'));}
});
test('global Host actions require operator authority without depending on any Run or card',async()=>{
 const {manager}=setup(),host=new SceanHost({engine:{},root:await mkdtemp(join(tmpdir(),'scean-global-host-')),chapterProviderSettings:manager});await host.init();try{
  for(const authority of [{},{principal:{}},{allowGlobalSettings:true}])assert.equal((await host.request({action:'chapterProviderSettings'},undefined,authority)).error.code,'CHAPTER_SETTINGS_DENIED');
  const authority={principal:{synthetic:true},allowGlobalSettings:true,requireCardScope:true,resolveCardScope:()=>null};assert.equal((await host.request({action:'chapterProviderSettings'},undefined,authority)).ok,true);
  host.chapterAutoArmed.add('synthetic-old-run');host.chapterContextArmed.add('synthetic-old-run');
  const result=await host.request({action:'chapterProviderSave',operationId:'host-save',expectedRevision:0,settings:chapterSettingsDefaults()},undefined,authority);assert.equal(result.ok,true);assert.equal(result.value.runtimeApplied,true);assert.equal(host.chapterAutoArmed.size,0);assert.equal(host.chapterContextArmed.size,0);
  host.running.set('synthetic-busy',new AbortController());assert.equal((await host.request({action:'chapterProviderSave',operationId:'busy',expectedRevision:1,settings:chapterSettingsDefaults()},undefined,authority)).error.code,'CHAPTER_SETTINGS_BUSY');host.running.clear();
 }finally{await host.close();}
});
test('global native bridge permits only fixed settings actions independently of changing card scope',async()=>{
 const calls=[],bridge=createNativeBridge({call:async request=>{calls.push(request);return {revision:1};},selectPanel:()=>{},getSessionId:()=>null});
 const pending=bridge.request('chapterProviderSettings');bridge.clearContext();assert.equal((await pending).revision,1);assert.equal(calls[0].action,'chapterProviderSettings');assert.equal(calls[0].cardScope,undefined);await assert.rejects(bridge.request('credentials/readRecord'),code('NATIVE_ACTION_DENIED'));await bridge.dispose();
});
test('global provider adapters dispatch configured destinations/model IDs and record usage without keys',async()=>{
 const {manager}=setup(),settings=enabled();settings.embedding.provider='compatible';settings.embedding.nebiusOnly=false;settings.embedding.model='synthetic-vector';settings.embedding.baseUrl='http://127.0.0.1:19888/v1';settings.rerank={mode:'compatible',provider:'',model:'synthetic-rank',baseUrl:'http://127.0.0.1:19889/v1',environmentFallback:false};await save(manager,{settings,keys:{embedding:EMB,rerank:RANK}});
 const events=[],requests=[],ledger={async reserve(row){events.push(row);return 'synthetic';},async settle(id,row){events.push(row);}},ports=configuredChapterPorts({settings:manager,usageLedger:ledger,nativeModel:{},fetchImpl:async(url,options)=>{requests.push({url,authorization:options.headers.Authorization,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/embeddings')?{data:[{index:0,embedding:[1,0]}],usage:{total_tokens:1,cost:0}}:{choices:[{message:{content:'{"rankings":[]}'},finish_reason:'stop'}],usage:{total_tokens:1,cost:0}}};}});
 assert.deepEqual(await ports.embed({texts:['synthetic'],kind:'query'}),[[1,0]]);await ports.rerankModel.generate({stage:'chapter_rerank',system:'Synthetic.',input:{candidates:[]}});
 assert.equal(requests[0].url,'http://127.0.0.1:19888/v1/embeddings');assert.equal(requests[0].authorization,'Bearer '+EMB);assert.equal(requests[1].url,'http://127.0.0.1:19889/v1/chat/completions');assert.equal(requests[1].authorization,'Bearer '+RANK);assert.equal(requests[1].body.model,'synthetic-rank');noSecrets(events);noSecrets(await manager.status());
});
test('global explicit/current DSH rerank choices override old per-Run routing without changing the story model',async()=>{
 const {manager}=setup({env:{'OpenRouter API Key':ENV}}),settings=enabled(),calls=[];
 const model={async describe(a){calls.push(a);return {capabilities:{}};},async generate(a){calls.push(a);return {text:'{"rankings":[]}'};}};
 const ports=configuredChapterPorts({settings:manager,nativeModel:model,usageLedger:{}}),context={runId:'synthetic',modelSelection:{provider:'old-run',model:'old-model'},stageModelSelections:{chapter_rerank:{provider:'old-stage',model:'old-stage-model'}}};
 await save(manager,{settings});await ports.rerankModel.generate({stage:'chapter_rerank',context});assert.deepEqual(calls.at(-1).context,{runId:'synthetic'});
 settings.rerank={mode:'dsh_model',provider:'shared-provider',model:'shared-model',baseUrl:'',environmentFallback:false};await save(manager,{settings,operationId:'specific-shared'});await ports.rerankModel.describe({stage:'chapter_rerank',context});assert.deepEqual(calls.at(-1).context,{runId:'synthetic',stageModelSelections:{chapter_rerank:{provider:'shared-provider',model:'shared-model'}}});assert.equal(context.modelSelection.provider,'old-run');
});
test('global OpenAI embedding uses the selected model without Qwen instructions or a Nebius route',async()=>{
 const {manager}=setup(),settings=chapterSettingsDefaults();settings.flags.chapterEmbeddingEnabled=true;settings.embedding={provider:'openai',model:'text-embedding-3-small',baseUrl:'https://api.openai.com/v1',nebiusOnly:false,environmentFallback:false};await save(manager,{settings,keys:{embedding:EMB}});
 let sent;const ports=configuredChapterPorts({settings:manager,nativeModel:{},usageLedger:{async reserve(){return 'synthetic';},async settle(){}},fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({data:[{index:0,embedding:[1,0]}]})};}});await ports.embed({texts:['synthetic query'],kind:'query'});assert.equal(sent.url,'https://api.openai.com/v1/embeddings');assert.deepEqual(sent.body.input,['synthetic query']);assert.equal(sent.body.provider,undefined);assert.equal(sent.body.model,'text-embedding-3-small');
});
test('global invalid endpoint/auth-bearing URL is rejected and storage failure leaves ordinary Host available',async()=>{
 const {manager}=setup();for(const url of ['http://remote.invalid/v1','https://user:password@synthetic.invalid/v1','https://synthetic.invalid/v1?key=not-real']){const settings=chapterSettingsDefaults();settings.embedding.provider='compatible';settings.embedding.nebiusOnly=false;settings.embedding.baseUrl=url;await assert.rejects(save(manager,{settings}),code('CHAPTER_SETTINGS_ENDPOINT'));}
 const broken=setup({credentials:{async readRecord(){throw Error('SYNTHETIC_STORAGE_ERROR');},async modifyRecord(){throw Error('SYNTHETIC_STORAGE_ERROR');}}}).manager;
 const host=new SceanHost({engine:{},root:await mkdtemp(join(tmpdir(),'scean-settings-storage-failure-')),chapterProviderSettings:broken,chapterModelsEnabled:true,chapterRetrievalEnabled:true});await host.init();try{assert.equal(host.chapterModelsEnabled,false);assert.equal((await host.request({action:'capabilities'})).ok,true);assert.equal((await host.request({action:'chapterProviderSettings'},undefined,{principal:{},allowGlobalSettings:true})).error.code,'CHAPTER_SETTINGS_STORAGE_UNAVAILABLE');}finally{await host.close();}
});
