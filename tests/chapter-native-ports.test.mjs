import test from 'node:test';
import assert from 'node:assert/strict';
import {ChapterRecall} from '../core/chapter-recall.mjs';
import {chapterRecallFixture} from '../fixtures/synthetic-chapter-recall.mjs';
import {createOpenRouterEmbedding} from '../adapters/model.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';

test('3+8 uses the formal OpenRouter embedding and DSH native rerank boundaries with scripted transports and usage journals',async t=>{
  const run=await chapterRecallFixture(),events=[],requests=[],ledger={async reserve(row){events.push({event:'reserve',...row});return 'synthetic-'+events.length;},async settle(id,row){events.push({kind:'settle',id,...row});}};
  const raw=createOpenRouterEmbedding({apiKey:'SYNTHETIC_NOT_A_REAL_KEY',usageLedger:ledger,caseId:'native-scean-chapter-embedding',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({url,body});return {ok:true,async json(){return {data:body.input.map((text,index)=>({index,embedding:text.startsWith('Instruct:')?[1,0]:[Number(/CANARY_(\d+)/.exec(text)?.[1]??1),1]})),usage:{prompt_tokens:1,total_tokens:1,cost:0}};}};
  }});
  const llm={async resolveModelInfo(){return {context:{contextWindow:65536},defaultMaxTokens:17};},async *stream(options){
    const input=JSON.parse(options.messages[0].content[0].text);events.push({kind:'stream',candidateIds:input.candidates.map(c=>c.summaryId),maxTokens:options.maxTokens});
    yield {type:'text-delta',index:0,text:JSON.stringify({rankings:input.candidates.map((c,index)=>({index,score:100-index}))})};yield {type:'finish',reason:{kind:'stop'}};
  }};
  const model=createNativeModelPort({llm,usageLedger:ledger,selection:{provider:'scripted-native',model:'offline'},stageMaxTokens:{chapter_rerank:512},generationGate:{async reserve(){events.push({kind:'gate_reserve'});return 'gate';},async settle(){events.push({kind:'gate_settle'});}}});
  const recall=new ChapterRecall({embed:({texts,signal,kind,context})=>raw(texts,{signal,kind,context}),rerankModel:model,embeddingModel:'openrouter/nebius/qwen3-embedding-8b'}),result=await recall.retrieve({run,query:'compass promise',context:{runId:run.runId,requestId:'formal-ports'}});
  assert.equal(result.recent.length,3);assert.equal(result.retrieved.length,8);assert.equal(requests.length,2);assert(requests.every(r=>r.url==='https://openrouter.ai/api/v1/embeddings'&&r.body.model==='qwen/qwen3-embedding-8b'));
  const streamIndex=events.findIndex(e=>e.kind==='stream');assert(events.slice(0,streamIndex).some(e=>e.kind==='gate_reserve'));assert(events.slice(0,streamIndex).some(e=>e.event==='reserve'&&e.meta?.stage==='chapter_rerank'));
  assert.equal(events[streamIndex].maxTokens,512);assert.equal(events[streamIndex].candidateIds.length,11);assert(events.some(e=>e.event==='reserve'&&e.caseId==='native-scean-chapter-embedding'));
  t.diagnostic(JSON.stringify({evidence:'formal_chapter_ports_scripted_only',recent:result.recent.map(r=>r.chapterId),retrieved:result.retrieved.map(r=>r.chapterId),uncovered:result.recentDialogue.map(r=>r.turn),candidateCount:events[streamIndex].candidateIds.length,externalPaidModelCalls:0,externalEmbeddingCalls:0,modelTransports:'scripted',realCredentialsRead:false}));
});
