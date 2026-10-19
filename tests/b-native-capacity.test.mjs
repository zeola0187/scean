import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeModelPort } from '../plugin/native-model.mjs';

function fixture({ maxTokens, stageMaxTokens, resolve, prepare, streamError, technicalRetries = 0 } = {}) {
  const effects = { resolve: [], prepared: 0, streams: [], ledgerReserve: [], ledgerSettle: [], gateReserve: [], gateSettle: [], traces: [] };
  const llm = {
    async resolveModelInfo(provider, model) {
      effects.resolve.push({ provider, model });
      return resolve ? resolve(provider, model, effects.resolve.length) : { context: { contextWindow: 32768 }, defaultMaxTokens: 17 };
    },
    async *stream(options) {
      effects.streams.push(options);
      if(streamError)throw Object.assign(Error(streamError),{code:streamError});
      yield { type: 'text-delta', index: 0, text: 'Synthetic complete response' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
    ...(prepare ? { async prepareCall(config) { effects.prepared++; return { config: prepare(config), stream: options => llm.stream(options) }; } } : {}),
  };
  const usageLedger = { async reserve(row) { effects.ledgerReserve.push(row); return 'usage-1'; }, async settle(id, row) { effects.ledgerSettle.push({ id, ...row }); } };
  const generationGate = { async reserve(row) { effects.gateReserve.push(row); return 'gate-1'; }, async settle(id, row) { effects.gateSettle.push({ id, ...row }); } };
  const port = createNativeModelPort({ llm, usageLedger, generationGate, selection: { provider: 'synthetic', model: 'original' },
    maxTokens, stageMaxTokens, technicalRetries, onTrace: row => effects.traces.push(row) });
  return { port, effects };
}

const capacity = { contextWindow: 32768, outputReserve: 4096, includedEstimate: 1000, overheadReserve: 512, toolReserve: 100 };
const request = (extra = {}) => ({ stage: 'director', system: 'Synthetic system', input: { synthetic: true }, context: { capacityBudget: capacity }, ...extra });
function assertNoDispatch(effects) {
  assert.equal(effects.streams.length, 0);
  assert.deepEqual(effects.ledgerReserve, []);
  assert.deepEqual(effects.ledgerSettle, []);
  assert.deepEqual(effects.gateReserve, []);
  assert.deepEqual(effects.gateSettle, []);
}

test('RP describe inherits DSH defaults while explicit background limits remain configured', async () => {
  const f = fixture({ maxTokens: 3000, stageMaxTokens: { prose: 6000, director: 1200 } });
  assert.equal((await f.port.describe({ stage: 'director' })).capabilities.outputLimit, 17);
  assert.equal((await f.port.describe({ stage: 'prose' })).capabilities.outputLimit, 17);
  const draft = await f.port.describe({ stage: 'draft' });
  assert.equal(draft.capabilities.outputLimit, 17);
  assert.equal(draft.capabilities.outputLimitSource,'dsh_model_default');
  assert.equal((await f.port.describe({stage:'summary'})).capabilities.outputLimit,3000);
  assert.equal(draft.capabilities.defaultMaxTokens, 17);
  assert.equal(draft.capabilities.contextWindow, 32768);
  assertNoDispatch(f.effects);
});

test('RP disclosed SDK output default matches stream config without a stage fallback', async () => {
  const f = fixture();
  const description = await f.port.describe({ stage: 'prose' });
  assert.equal(description.capabilities.outputLimit, 17);
  const result = await f.port.generate(request({ stage: 'prose', context: { capacityBudget: { ...capacity, outputReserve: description.capabilities.outputLimit } } }));
  assert.equal(f.effects.streams[0].maxTokens, description.capabilities.outputLimit);
  assert.equal(result.route.effective.maxTokens, 17);
  assert.equal(result.route.outputBudget.providerFinalMaxTokens,null);
  assert.equal(result.usage, null);
  assert.equal(f.effects.ledgerSettle[0].actualCostUsd, null);
});

test('reported capacity shrinking does not turn heuristic estimates into a dispatch veto',async()=>{
 const f=fixture({technicalRetries:1,resolve:(_p,_m,count)=>({context:{contextWindow:count===1?32768:5000}})});await f.port.describe();await f.port.generate(request());assert.equal(f.effects.streams.length,1);assert.equal(f.effects.ledgerReserve.length,1);
});
test('prepared model redirection preserves the complete request and SDK effective route',async()=>{
 const f=fixture({prepare:c=>({...c,provider:'synthetic-fallback',model:'small'}),resolve:()=>({context:{contextWindow:1}})});const result=await f.port.generate(request());assert.equal(result.route.effective.provider,'synthetic-fallback');assert.equal(f.effects.streams.length,1);assert.equal(f.effects.streams[0].messages[0].content[0].text,JSON.stringify(request().input));
});
test('prepared output length is not mechanically reserved against an estimated input quota',async()=>{
 const f=fixture({prepare:c=>({...c,maxTokens:8192})});await f.port.generate(request());assert.equal(f.effects.streams[0].maxTokens,8192);assert.equal(f.effects.prepared,1);
});

test('prepared redirect with sufficient capacity and no larger output proceeds exactly once', async () => {
  const f = fixture({ prepare: config => ({ ...config, provider: 'synthetic-fallback', model: 'large', maxTokens: 2048 }),
    resolve: () => ({ context: { contextWindow: 65536 } }) });
  const result = await f.port.generate(request());
  assert.equal(result.text, 'Synthetic complete response');
  assert.equal(result.route.effective.provider, 'synthetic-fallback');
  assert.equal(f.effects.streams.length, 1);
  assert.equal(f.effects.streams[0].maxTokens, 2048);
  assert.equal(f.effects.ledgerReserve.length, 1);
  assert.equal(f.effects.gateReserve.length, 1);
});

test('absent capability stays unknown and does not fabricate a32k token quota', async () => {
  const f = fixture({ resolve: () => ({}) });
  assert.equal((await f.port.describe()).capabilities.contextWindow, null);
  await f.port.generate(request());
  assert.equal(f.effects.streams.length, 1);
});

test('D explicit summary stage limit resolves through native capability and dispatch without new credentials',async()=>{
  const f=fixture({stageMaxTokens:{summary:2048}}),description=await f.port.describe({stage:'summary'});
  assert.equal(description.capabilities.outputLimit,2048);assertNoDispatch(f.effects);
  const result=await f.port.generate(request({stage:'summary',context:{capacityBudget:{...capacity,outputReserve:2048}}}));
  assert.equal(f.effects.streams[0].maxTokens,2048);assert.equal(result.route.effective.maxTokens,2048);
});

test('native actual hard-context rejection is recorded once and never technically retried',async()=>{
 const f=fixture({streamError:'CONTEXT_WINDOW_EXCEEDED',technicalRetries:1});await assert.rejects(f.port.generate(request()),{code:'CONTEXT_WINDOW_EXCEEDED'});assert.equal(f.effects.streams.length,1);assert.equal(f.effects.ledgerReserve.length,1);assert.equal(f.effects.ledgerSettle[0].status,'failed');
});
test('background generic model configuration keeps its limit without a DeepSeek-specific ceiling',async()=>{
 const f=fixture({maxTokens:400000});assert.equal((await f.port.describe({stage:'summary'})).capabilities.outputLimit,400000);await f.port.generate(request({stage:'summary'}));assert.equal(f.effects.streams[0].maxTokens,400000);
});
