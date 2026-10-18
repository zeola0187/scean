import test from 'node:test';
import assert from 'node:assert/strict';
import {settledTurnProgress} from '../isolated/web/view-model.mjs';
const operation={kind:'turn',runId:'r',requestId:'q',operationId:'o'};
const progress={runId:'r',requestId:'q',operationId:'o',pending:false,status:'committed'};
test('only a matching authoritative terminal turn can release an outstanding RPC owner',()=>{
  for(const status of ['committed','failed','cancelled','retired'])assert.equal(settledTurnProgress(operation,{...progress,status}),true);
  for(const change of [{pending:true},{pending:undefined},{runId:'other'},{requestId:'other'},{operationId:'old'},{operationId:null},{status:'unknown'},{status:'not_recorded'}])assert.equal(settledTurnProgress(operation,{...progress,...change}),false);
  assert.equal(settledTurnProgress({...operation,kind:'regenerate'},progress),false);
  assert.equal(settledTurnProgress(null,progress),false);
});
