import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetStage, estimateContextTokens, defaultOutputReserve, DEFAULT_CONTEXT_WINDOW } from '../core/context-budget.mjs';

const packet = () => ({ system: 'Keep events and player agency.', input: { assembly: {
  playerInput: '我望向煙燈。', characterIdentities: [{ id: 'lin', name: '林' }],
  worldState: { world: { resources: { fuel: 40 } }, characters: {} },
  sources: { snapshot: { revision: 'r1' }, card: { data: { name: '研究船' } }, preset: { style: 'concise' }, worldbook: { entries: [
    { id: 'lamp', priority: 100, content: '燈具結構'.repeat(180) },
    { id: 'hull', priority: 0, content: '船殼構造'.repeat(180) },
  ] } },
  memory: { records: [{ id: 'm1', text: 'Public confirmed event '.repeat(80) }] },
  chapterSummary: 'The research ship reached the bay.',
  recentDialogue: [{ body: 'Older body '.repeat(50) }, { body: 'Newer body '.repeat(50) }],
}, conversation: [] } });
const generous = { contextWindow: 32768, outputReserve: 100, overheadReserve: 0 };

test('multilingual estimator accounts for script, punctuation, emoji and labels estimates', () => {
  assert.equal(estimateContextTokens('abc123'), 2);
  assert.equal(estimateContextTokens('世界'), 4);
  assert.equal(estimateContextTokens('😀'), 3);
  assert.equal(estimateContextTokens('{}'), 2);
  const { diagnostics } = budgetStage('director', packet(), generous);
  assert.equal(diagnostics.estimateOnly, true);
  assert.match(diagnostics.estimateMethod, /not tokenizer/);
  assert.equal(diagnostics.actualUsage, null);
});

test('unchanged in-capacity packet includes stable source inventory without payload text', () => {
  const input = packet();
  const before = structuredClone(input);
  const { prompt, diagnostics } = budgetStage('director', input, generous);
  assert.deepEqual(input, before);
  assert.deepEqual(prompt, input);
  assert.ok(diagnostics.sources.every(s => s.sourceID && s.path && Number.isFinite(s.priority) && s.visibility && Number.isInteger(s.estimate)));
  assert.ok(diagnostics.sources.every(s => s.included));
  assert.equal(JSON.stringify(diagnostics).includes('船殼構造'), false);
});

test('no token quota removes lower-priority authorized worldbook, memory or history', () => {
  const full = budgetStage('director', packet(), generous);
  const lowBook = full.diagnostics.sources.find(s => s.path.endsWith('/entries/1'));
  const capacity = full.diagnostics.includedEstimate - Math.floor(lowBook.estimate / 2);
  const { prompt, diagnostics } = budgetStage('director', packet(), { contextWindow: capacity + 100, outputReserve: 100, overheadReserve: 0 });
  assert.deepEqual(prompt.input.assembly.sources.worldbook.entries.map(e => e.id), ['lamp','hull']);
  assert.equal(prompt.input.assembly.memory.records.length, 1);
  assert.equal(prompt.input.assembly.recentDialogue.length, 2);
  assert.equal(diagnostics.sources.find(s => s.path.endsWith('/entries/1')).reason, 'within_capacity');
  assert.equal(diagnostics.policy,'complete_authorized_packet_no_token_quota');
});

test('oldest and newest history both remain despite a small estimated window', () => {
  const input = packet(); delete input.input.assembly.sources.worldbook; delete input.input.assembly.memory;
  const full = budgetStage('director', input, generous);
  const old = full.diagnostics.sources.find(s => s.path.endsWith('/recentDialogue/0'));
  const result = budgetStage('director', input, { contextWindow: full.diagnostics.includedEstimate - Math.floor(old.estimate / 2) + 100, outputReserve: 100, overheadReserve: 0 });
  assert.deepEqual(result.prompt.input.assembly.recentDialogue, input.input.assembly.recentDialogue);
});

test('estimated overflow is diagnostic and does not invent provider hard-limit rejection', () => {
  let modelCalls = 0;
  const execute = () => {
    budgetStage('director', packet(), { contextWindow: 80, outputReserve: 20, overheadReserve: 0 });
    modelCalls++;
  };
  execute();
  assert.equal(modelCalls, 1);
  assert.equal(budgetStage('director',packet(),{contextWindow:80}).diagnostics.estimatedOverflow,true);
});

test('core input, required identity, system and authoritative state cannot be made optional by metadata', () => {
  const result = budgetStage('director', packet(), { ...generous, sourceMetadata: { '/input/assembly/worldState': { priority: -100, sourceID: 'authoritative:state' } } });
  for (const path of ['/system', '/input/assembly/playerInput', '/input/assembly/characterIdentities', '/input/assembly/worldState']) {
    assert.equal(result.diagnostics.sources.find(s => s.path === path).mandatory, true);
  }
  assert.equal(result.diagnostics.sources.find(s => s.sourceID === 'authoritative:state').priority, 1000);
});

test('CR owner biography, private state and authorized recall all remain complete', () => {
  const input = { system: 'Owner consultation', input: { character: { id: 'lin', name: '林', description: 'Full biography', relationships: { captain: 'family' }, privateDescription: 'owner secret' },
    ownState: { private: { anxiety: 3 } }, publicWorld: {}, question: 'Your view?', playerInput: 'Ask Lin', currentEvent: {}, characterIdentities: [], memory: { records: [{ text: 'Old authorized recall '.repeat(500) }] } } };
  const full = budgetStage('character', input, generous);
  const result = budgetStage('character', input, { contextWindow: full.diagnostics.requiredEstimate + 200, outputReserve: 100, overheadReserve: 0 });
  assert.deepEqual(result.prompt.input.character, input.input.character);
  assert.deepEqual(result.prompt.input.ownState, input.input.ownState);
  assert.deepEqual(result.prompt.input.memory.records, input.input.memory.records);
  assert.equal(result.diagnostics.sources.find(s => s.path === '/input/character').visibility, 'character:lin');
});

test('large CR owner definition remains complete without a fabricated token quota',()=>{
 const input={system:'CR',input:{character:{id:'lin',description:'owner secret '.repeat(500)},ownState:{private:'keep'},question:'q'}};
 const result=budgetStage('character',input,{contextWindow:100,outputReserve:20});assert.deepEqual(result.prompt,input);assert.equal(result.diagnostics.estimatedOverflow,true);
});

test('Prose boundary excludes full worldbook, memory and raw consultation container', () => {
  const result = budgetStage('prose', { system: 'Prose', input: { draft: 'Draft', playerInput: 'Play', preset: {}, characterIdentities: [], assembly: { secret: 'RAW_PRIVATE' }, worldbook: { entries: ['unselected'] }, memory: ['private'] } }, generous);
  assert.deepEqual(Object.keys(result.prompt.input), ['draft', 'playerInput', 'preset', 'characterIdentities']);
  assert.equal(JSON.stringify(result.prompt).includes('RAW_PRIVATE'), false);
  assert.equal(result.diagnostics.sources.filter(s => s.reason === 'stage_boundary').length, 3);
});

test('PostStat receives only final body, prior state, identities and blueprint', () => {
  const result = budgetStage('post_stat', { system: 'Stat', input: { finalBody: 'Done', previousState: { world: {} }, characters: [], stateBlueprint: { version: 1 }, directorBrief: 'Unadopted advice', rawCR: { private: 'X' } } }, generous);
  assert.deepEqual(Object.keys(result.prompt.input), ['finalBody', 'previousState', 'characters', 'stateBlueprint']);
  assert.equal(JSON.stringify(result.prompt).includes('Unadopted'), false);
});

test('embedded unselected books cannot leak through a full card container', () => {
  const input = packet();
  input.input.assembly.sources.card.data.character_book = { entries: [{ content: 'UNSELECTED' }] };
  input.input.assembly.sources.rawSnapshot = { worldbook: 'ANOTHER_RAW' };
  const result = budgetStage('director', input, generous);
  assert.equal(JSON.stringify(result.prompt).includes('UNSELECTED'), false);
  assert.equal(JSON.stringify(result.prompt).includes('ANOTHER_RAW'), false);
  assert.ok(result.diagnostics.sources.some(s => s.reason === 'embedded_book_requires_selection'));
});

test('tool estimates and requested output lengths are reported without inventing unknown capacity', () => {
  const tools = [{ name: 'consult_character', parameters: { type: 'object' } }];
  const result = budgetStage('director', packet(), { tools, toolReserve: 0 });
  assert.equal(result.diagnostics.contextWindow, 0);
  assert.equal(result.diagnostics.capacitySource, 'unknown');
  assert.equal(result.diagnostics.outputReserve, defaultOutputReserve('director'));
  assert.equal(result.diagnostics.toolReserve, estimateContextTokens(tools));
  assert.equal(defaultOutputReserve('prose'), 8192);
});

test('tool and output estimates are not subtracted from an artificial input quota',()=>{
 const input={system:'s',input:{draft:'d'}},result=budgetStage('prose',input,{contextWindow:100,outputReserve:100000,overheadReserve:40,toolReserve:40});assert.deepEqual(result.prompt,input);assert.equal(result.diagnostics.inputCapacity,100);
});

test('fixed input and capacity produce deterministic packet and diagnostics, no wall clock fields', () => {
  const first = budgetStage('director', packet(), { contextWindow: 2500, outputReserve: 100, overheadReserve: 0 });
  assert.deepEqual(first, budgetStage('director', packet(), { contextWindow: 2500, outputReserve: 100, overheadReserve: 0 }));
});

test('invalid packets and unknown stages fail closed', () => {
  assert.throws(() => budgetStage('reviewer', packet()), { code: 'INVALID_CONTEXT_PACKET' });
  assert.throws(() => budgetStage('prose', { system: 's', input: 'raw' }), { code: 'INVALID_CONTEXT_PACKET' });
});
test('transport data safety remains enforced independently of Token quotas',()=>{
 assert.throws(()=>budgetStage('prose',{system:'s',input:{draft:'x'.repeat(16*1024*1024)}},{contextWindow:100000000}),{code:'CONTEXT_PACKET_TOO_LARGE'});
});

test('B1 selected entry refs are retained as source IDs through capacity selection', () => {
  const input = packet();
  input.input.assembly.sources.worldbook.entries[0].ref = 'worldbook:0:entry:0';
  const result = budgetStage('director', input, generous);
  assert.ok(result.diagnostics.sources.some(s => s.sourceID === 'worldbook:0:entry:0' && s.included));
});
