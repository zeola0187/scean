import test from 'node:test';
import assert from 'node:assert/strict';import {setTimeout as sleep} from 'node:timers/promises';
import {autoChapter,defaultChapterSettings} from '../core/chapter-summary.mjs';
async function exercise({analysis=0,summary=0,abort=false,configured=true,failExpected,expectedTimers}){
 const turns=Array.from({length:8},(_,i)=>({commitId:'commit-'+(i+1),turn:i+1,input:'Synthetic player action.',body:'The lamps illuminate the fictional hallway. '.repeat(90)}));
 const head=turns.at(-1).commitId;let state={runId:'test-run',version:8,head,turns,narrative:{schemaVersion:2,chapters:[],chapterSummaries:[],summaries:[],operations:{},chapterSettings:{...defaultChapterSettings(),autoEnabled:true,tokenThreshold:4000,bufferTurns:0}}};
 const store={async withRunLock(id,fn){return fn();},async read(){return structuredClone(state);},async commit(id,v,n){assert.equal(v,state.version);state=structuredClone(n);}};
 const arrays={keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet'}, calls=[], deadlines=[], controller=new AbortController();
 const model={describe:async()=>({contextWindow:1000000}),async generate({stage,signal,input}){
 calls.push(stage);
 if(stage==='chapter_analysis'){await sleep(analysis,undefined,{signal});return {text:JSON.stringify({...arrays,shouldCreateChapter:true,optimalEndTurn:input.range.endTurn,suggestedTitle:'Synthetic scene',significantEvents:[]})};}
 if(abort)globalThis.setTimeout(()=>controller.abort(),10);
 await sleep(summary,undefined,{signal});return {text:JSON.stringify({...arrays,title:'Synthetic scene',summary:'The fictional player walked through the hallway.'})};
 }};
 const real=setTimeout;globalThis.setTimeout=(fn,ms,...a)=>{if([60000,180000].includes(ms)){deadlines.push(ms);ms=ms===60000?70:210;}return real(fn,ms,...a);};
 let result;try{result=await autoChapter({store,model},{runId:'test-run',operationId:'test-op',expectedVersion:8,expectedHead:head,signal:controller.signal},{enabled:true,...(configured?{summaryTimeoutMs:180000}:{})});}catch(e){if(!failExpected)throw e;result=e;}finally{globalThis.setTimeout=real;}
 assert.equal(result.code,failExpected,JSON.stringify({result,calls,deadlines}));
 assert.deepEqual(deadlines,expectedTimers);
 assert.deepEqual(state.turns,turns);
 assert.equal(state.narrative.chapters.length,failExpected?0:1);
 if(!failExpected)assert.equal(result.created,true);
}

test('chapter writing has its own deadline without changing analysis or old callers',async()=>{
 await exercise({summary:105,expectedTimers:[60000,60000,60000,180000]});
 await exercise({summary:105,configured:false,failExpected:'MODEL_TIMEOUT',expectedTimers:[60000,60000,60000,60000]});
 await exercise({analysis:105,failExpected:'MODEL_TIMEOUT',expectedTimers:[60000,60000]});
 await exercise({summary:300,failExpected:'MODEL_TIMEOUT',expectedTimers:[60000,60000,60000,180000]});
 await exercise({summary:80,abort:true,failExpected:'CANCELLED',expectedTimers:[60000,60000,60000,180000]});
});
