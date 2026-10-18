import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetStage} from '../core/context-budget.mjs';
import {outputLimits} from '../adapters/model.mjs';
for(const stage of ['chapter_analysis','chapter_summary'])test(`DF ${stage} mandatory bounded public packet and stage output override`,()=>{
  const input={range:{startTurn:1,endTurn:2},turns:[{turn:1,input:'hello',body:'finished'}],instructions:'public sources only',privateState:{secret:'NEVER_EXPOSE'}};
  if(stage==='chapter_summary')Object.assign(input,{detail:'precise',previousChapters:[]});
  const result=budgetStage(stage,{system:'chapter contract',input},{contextWindow:32768,outputReserve:4096});
  assert.equal(JSON.stringify(result).includes('NEVER_EXPOSE'),false);
  assert.equal(outputLimits({stageMaxTokens:{[stage]:1234}})(stage),1234);
});
