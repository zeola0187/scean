import test from 'node:test';
import assert from 'node:assert/strict';
import {DeepSeekModel} from '../adapters/model.mjs';
import {budgetStage} from '../core/context-budget.mjs';

test('B generic HTTP adapter exposes configured output reserve without any network or usage reservation', async()=>{
  let network=0,reservations=0;
  const model=new DeepSeekModel({apiKey:'synthetic-offline',usageLedger:{async reserve(){reservations++;},async settle(){}},maxTokens:100000,fetchImpl:async()=>{network++;throw Error('No network authorized');}});
  const description=await model.describe({stage:'prose'});
  assert.equal(description.capabilities.outputLimit,100000);
  assert.equal(description.capabilities.contextWindow,null);
  const packet=budgetStage('prose',{system:'synthetic',input:{draft:'short',playerInput:'wait',preset:{},characterIdentities:[]}},{outputReserve:description.capabilities.outputLimit});assert.equal(packet.prompt.input.draft,'short');assert.equal(packet.diagnostics.capacitySource,'unknown');
  assert.equal(network,0);assert.equal(reservations,0);
});
