import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {syntheticLongrun} from './synthetic-longrun-d.mjs';
import {updateChapterSettings,backfillChapterSummary} from '../core/chapter-summary.mjs';
import {validateRunBundle,encodeRunBundle} from '../core/save-bundle.mjs';
import {constructTemporalFixture} from './temporal-history.mjs';

let template;
export async function chapterRecallFixture(){
  template??=(async()=>{
    const root=await mkdtemp(join(tmpdir(),'scean-recall-template-')),store=new DurableStore({root}),run=syntheticLongrun({turns:42,chapters:14,bodyRepeats:0,runId:'synthetic-chapter-recall'});await store.create(run);
    const args=async(operationId,extra={})=>{const r=await store.read(run.runId);return {runId:r.runId,operationId,expectedVersion:r.version,expectedHead:r.head,...extra};};
    const engine={store,model:{async generate(a){const chapter=Number(a.input.range.endTurn/3);return {text:JSON.stringify({title:`Chapter ${chapter}`,summary:`CHAPTER_CANARY_${chapter}: copper compass promise and unfinished calibration in public watch ${chapter}.`,keywords:['compass'],characters:[],locations:[],plotThreads:['calibration'],emotionalTone:null}),model:'scripted-archive',usage:{costUSD:0}};}}};
    await updateChapterSettings(engine,await args('configure-archive',{settings:{autoEnabled:false,tokenThreshold:16000,bufferTurns:6,detail:'auto'}}));
    for(const c of run.narrative.chapters)await backfillChapterSummary(engine,await args('fill-'+c.order,{chapterId:c.id}),{enabled:true});
    const base=await store.read(run.runId),tail=syntheticLongrun({turns:45,bodyRepeats:0,runId:run.runId});
    for(const t of tail.turns.slice(42)){const version=++base.version;t.commitVersion=version;base.turns.push(t);base.receipts[t.requestId]=tail.receipts[t.requestId];base.receipts[t.requestId].result.version=version;base.head=t.commitId;}
    constructTemporalFixture(base);validateRunBundle(encodeRunBundle(base));return base;
  })();return structuredClone(await template);
}
export function chapterRecallPorts({overrideEmbed,overrideRerank,contextWindow=200000}={}){
  const calls=[];
  const embed=async a=>{calls.push({kind:a.kind,texts:structuredClone(a.texts),signal:a.signal});const custom=await overrideEmbed?.(a);if(custom!==undefined)return custom;return a.texts.map(text=>a.kind==='query'?[1,0]:[Number(/CANARY_(\d+)/.exec(text)?.[1]??1),1]);};
  const rerankModel={async describe(){return {capabilities:{contextWindow,outputLimit:4096}};},async generate(a){calls.push({stage:a.stage,input:structuredClone(a.input),context:structuredClone(a.context),signal:a.signal});const custom=await overrideRerank?.(a);if(custom!==undefined)return custom;return {text:JSON.stringify({rankings:a.input.candidates.map((c,index)=>({index,score:Number(/CANARY_(\d+)/.exec(c.text)[1])===1?1000:100-index}))}),model:'scripted-rerank',usage:{inputTokens:10,outputTokens:10,costUSD:0}};}};
  return {embed,rerankModel,calls};
}
