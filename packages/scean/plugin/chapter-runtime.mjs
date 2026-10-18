import {createHash} from 'node:crypto';
import {ChapterRecall} from '../core/chapter-recall.mjs';
import {ChapterProviderSettings} from './chapter-settings.mjs';
import {configuredChapterPorts} from '../adapters/chapter-providers.mjs';
import {createNativeModelPort} from './native-model.mjs';

export function createChapterConfiguration({ctx,config,dataRoot,usageLedger,legacyNativeModel,fetchImpl=fetch}){
  const settings=new ChapterProviderSettings({credentialSource:()=>ctx.get('credentials'),scope:{profile:ctx.get('profileContext')?.name??'host',dataRoot},config,nativeSelection:()=>ctx.agentDefaultModel.currentSelection()});
  const nativeModel=createNativeModelPort({llm:ctx.llm,agentDefaultModel:ctx.agentDefaultModel,usageLedger,stageMaxTokens:config.stageMaxTokens,timeoutMs:config.timeoutMs,technicalRetries:config.technicalRetries});
  const ports=configuredChapterPorts({settings,nativeModel,legacyNativeModel,usageLedger,fetchImpl});
  const runtimeFactory=status=>{
    if(!status.settings.flags.chapterRetrievalEnabled)return undefined;
    const embeddingEnabled=status.settings.flags.chapterEmbeddingEnabled&&status.embeddingKey.configured,rerankEnabled=status.rerankKey.configured;
    const identity=createHash('sha256').update(JSON.stringify({revision:status.revision,embedding:status.settings.embedding})).digest('hex');
    return new ChapterRecall({embed:embeddingEnabled?ports.embed:undefined,rerankModel:rerankEnabled?ports.rerankModel:undefined,embeddingModel:'configured-chapter-'+identity});
  };
  return {settings,runtimeFactory};
}
