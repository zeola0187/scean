import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createNativeModelPort} from '../plugin/native-model.mjs';

test('shipped Stage profiles send 16000 tokens for each chapter stage, not the Writer',async()=>{
  for(const file of ['cordis.patch.yml','plugin/cordis.patch.yml','packages/scean/plugin/cordis.patch.yml']){
    const yaml=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    const host=yaml.match(/    - id: local-scean-host\r?\n[^\n]+\r?\n      config:\r?\n        stageMaxTokens:\r?\n          chapter_analysis: (\d+)\r?\n          chapter_summary: (\d+)/);
    assert.ok(host,file);
    const stageMaxTokens={chapter_analysis:Number(host[1]),chapter_summary:Number(host[2])};
    const sent=[],model=createNativeModelPort({
      selection:{provider:'scripted',model:'offline'},
      usageLedger:{async reserve(){return 'offline';},async settle(){}},
      llm:{
        async resolveModelInfo(){return {context:{contextWindow:65536},defaultMaxTokens:97};},
        async *stream(options){
          sent.push(options.maxTokens);
          yield {type:'text-delta',index:0,text:'synthetic output'};
          yield {type:'finish',reason:{kind:'stop'}};
        },
      },
      stageMaxTokens,
    });
    for(const stage of ['chapter_analysis','chapter_summary','writer'])await model.generate({stage,system:'Synthetic test',input:{}});
    assert.deepEqual(sent,[16000,16000,97],file);
  }
});
