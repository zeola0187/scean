import {TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {hostname} from 'node:os';
import {resolveDshHome} from '@deepseek-ai/dsh-home-paths';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {UsageLedger} from '../adapters/budget.mjs';
import {createOpenRouterEmbedding} from '../adapters/model.mjs';
import {SceanHost} from './host.mjs';
import {createNativeModelPort} from './native-model.mjs';
import {sceanRemote} from './protocol.mjs';
import {VERSION} from './version.mjs';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
import {createChapterConfiguration} from './chapter-runtime.mjs';

export const inject=['typert','llm','agentDefaultModel'];
export async function apply(ctx,config={}){
  const dataRoot=resolve(config.dataRoot??join(resolveDshHome(),'scean-mvp-0.7.1-milestone-d-final'));
  await mkdir(dataRoot,{recursive:true});
  const statusFile=join(dataRoot,'runtime-status.json');
  let embed,memoryEmbeddingFailure=null,chapterConfiguration,host;
  const status=async phase=>writeFile(statusFile,JSON.stringify({schemaVersion:1,plugin:'@local/dsh-scean',version:VERSION,phase,host:hostname(),namespace:'scean',panel:'local-scean',client:'@local/dsh-scean',modelSelectionSource:config.modelSelection?'plugin':'dsh_current_selection',usageMode:'journal_only',localDollarLimit:null,localGenerationLimit:null,memory:{embeddingConfigured:typeof embed==='function',embeddingModel:typeof embed==='function'?'openrouter/nebius/qwen3-embedding-8b':null,retrieval:typeof embed==='function'?'embedding_bm25_rrf':'bm25',configurationFailure:memoryEmbeddingFailure,rerankConfigured:false,providerConnectivity:'not_probed'},backgroundModels:{rollingSummary:config.summaryEnabled===true,chapters:host?.chapterModelsEnabled??config.chapterModelsEnabled===true},chapterContext:{enabled:host?.chapterRetrievalEnabled??config.chapterRetrievalEnabled===true,embeddingConfigured:host?.engine.chapterRecall?.capabilities().embedding===true,configurationFailure:host?.chapterRetrievalEnabled&&!host?.engine.chapterRecall?.capabilities().embedding?'EMBEDDING_CONFIGURATION_MISSING':null,rerank:host?.chapterRetrievalEnabled?'shared_chapter_configuration':'disabled',tokenQuota:null,providerConnectivity:'not_probed',settingsRevision:host?.globalSettingsRevision??null},at:new Date().toISOString()},null,2));
  await status('initializing');
  // budgetPath is intentionally ignored: the historical budget ledger is evidence.
  const usageLedger=new UsageLedger(resolve(config.usagePath??join(dataRoot,'usage-a1.jsonl')));
  const model=createNativeModelPort({llm:ctx.llm,agentDefaultModel:ctx.agentDefaultModel,usageLedger,selection:config.modelSelection,stageSelections:config.stageModelSelections,maxTokens:config.maxTokens,stageMaxTokens:config.stageMaxTokens,timeoutMs:config.timeoutMs,technicalRetries:config.technicalRetries});
  if(config.enableExistingEmbedding===true){
    try{
      const rawEmbed=createOpenRouterEmbedding({usageLedger,caseId:'native-scean-embedding'});
      embed=({texts,signal,kind,context})=>rawEmbed(texts,{signal,kind,context});
    }catch(error){
      if(error.code!=='EMBEDDING_CONFIGURATION_MISSING')throw error;
      memoryEmbeddingFailure=error.code;
    }
  }
  const memory=new Memory({embed,embeddingModel:embed?'openrouter/nebius/qwen3-embedding-8b':'disabled'});
  const store=new DurableStore({root:join(dataRoot,'store')});
  chapterConfiguration=createChapterConfiguration({ctx,config,dataRoot,usageLedger,legacyNativeModel:model});
  const engine=new SceanEngine({store,model,memory,recentWindow:config.recentWindow??6});
  host=await new SceanHost({engine,root:join(dataRoot,'host'),summaryEnabled:config.summaryEnabled===true,chapterModelsEnabled:config.chapterModelsEnabled===true,chapterRetrievalEnabled:config.chapterRetrievalEnabled===true,
    chapterProviderSettings:chapterConfiguration.settings,chapterRuntimeFactory:chapterConfiguration.runtimeFactory,onChapterConfigurationChanged:()=>status('ready'),maxConcurrentOperations:config.maxConcurrentOperations??4}).init();
  // Credentials may become ready after this independently useful RP service.
  // Resolve them dynamically and apply an existing shared revision once ready.
  ctx.inject(['credentials'],async()=>{
    try{const saved=await chapterConfiguration.settings.status({transport:false});if(!host.closing&&(host.globalSettingsRevision===null||saved.revision>host.globalSettingsRevision))host.applyChapterProviderConfiguration(saved);await status('ready');}
    catch{ /* The settings UI reports its fixed storage error; saved RP stays readable. */ }
  });
  class SceanService extends TypertRemoteService {
    constructor(){super(ctx,'scean',{namespace:'scean'});}
    request(request,signal){
      // Compare the exact authenticated browser Peer; owner-shaped or API Peers are not UI authority.
      // Generic actions are not callable as Agent tools/commands or unscoped in-process requests.
      const peer=this.ctx.invocation?.peer;
      const connection=this.ctx.get('connection'),gateway=this.ctx.get('typertGateway');
      // rc.1 uses browserPeer; rc.2 used operator plus a Gateway-owned in-process fallback.
      const operator=connection?.browserPeer??connection?.operator??(typeof gateway?.operatorPeer==='function'?gateway.operatorPeer():undefined);
      if(!peer||peer!==operator)return {ok:false,error:{code:'TRUSTED_CLIENT_REQUIRED',message:'SCEAN control requires the authenticated operator connection.'}};
      // UI-only read projection. Never serialize provider settings or credentials.
      if(request.action==='models')return model.describe({signal}).then(info=>({ok:true,value:{mode:'native',source:'DSH authenticated host',selectionSource:info.selectionSource,requested:{provider:info.requested?.provider,model:info.requested?.model},capabilities:{contextWindow:info.capabilities?.contextWindow,outputLimit:info.capabilities?.outputLimit},modelSwitching:false}})).catch(()=>({ok:false,error:{code:'MODEL_DESCRIPTION_UNAVAILABLE',message:'目前無法讀取模型標籤；仍可閱讀已保存故事。'}}));
      return host.request(request,signal,{principal:peer,allowGlobalSettings:true,allowPrivateDiagnostics:true,allowPrivateSaves:true,requireCardScope:true,
        resolveCardScope:sessionId=>ctx.get('cardstudioSceanBridge')?.resolveSceanScope?.(sessionId),resolvePresentationSource:(sessionId,scope)=>ctx.get('cardstudioSceanBridge')?.resolveSceanFrontendSource?.(sessionId,scope)});
    }
    auditSavedSnapshot(input){return auditSavedSnapshot(input);}
    startFromStudio(request){return host.startFromStudio(request);}
    inspectFromStudio(request){return host.inspectFromStudio(request);}
    attachInspection(request){return host.attachInspection(request);}
    listDiagnosticRuns(request){return host.agentDiagnostics.list(request);}
    grantAgentDiagnosis(request){return host.agentDiagnostics.issue(request);}
    readAgentDiagnosis(request){return host.agentDiagnostics.read(request);}
    revokeAgentDiagnosis(request){return host.agentDiagnostics.revoke(request);}
  }
  new SceanService();
  ctx.typert.register({package:sceanRemote.package,face:'host',schemas:[],invocations:sceanRemote.descriptors});
  ctx.effect(()=>async()=>{await host.close();chapterConfiguration.settings.close();await status('inactive');},'scean host cleanup');
  await status('ready');
}
