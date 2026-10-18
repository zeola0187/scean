import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';

// Synthetic data and a capturing model port. No network or generation provider.
const text = value => JSON.stringify(value);
const book = () => ({id:'research-book',version:'r1',entries:[
  {id:'constant',constant:true,content:'SHIP_CONSTANT_PUBLIC'},
  {id:'lamp',keys:['煙燈'],content:'LAMP_SELECTED: 煙燈是一件未確認是否點燃的設備。',priority:90},
  {id:'civilization',keys:['遠古文明'],content:'UNRELATED_CIVILIZATION_EXCLUDED'},
  {id:'disabled',keys:['煙燈'],enabled:false,content:'DISABLED_EXCLUDED'},
  {id:'secondary',keys:['煙燈'],selective:true,secondary_keys:['維修'],content:'SECONDARY_EXCLUDED'},
  {id:'regex',keys:['/煙.*/'],content:'REGEX_EXCLUDED'},
  {id:'placement',keys:['煙燈'],position:4,depth:8,content:'PLACEMENT_PUBLIC'},
]});
const snapshot = (worldbook=book()) => ({schemaVersion:1,cardId:'b-worldbook-synthetic',revision:'r1',
  card:{data:{name:'Synthetic research ship',description:'Public deck.',character_book:structuredClone(worldbook)}},
  worldbook,worldbookSelection:{scanWindow:{unit:'messages',count:0}},
  preset:{style:'STYLE_REQUIRED_MARKER'},characters:[{id:'engineer',name:'Engineer',description:'OWNER_BACKGROUND_ONLY'}]});
const emptyProposal = {contractVersion:2,stateChanges:[],memories:[]};
async function fixture(source=snapshot(),{consultStat=false}={}) {
  const store=new DurableStore({root:await mkdtemp(join(tmpdir(),'scean-b-worldbook-'))});
  const calls=[];
  const model={async generate(args){calls.push({stage:args.stage,input:structuredClone(args.input)});
    if(args.stage==='director')return consultStat&&!args.input.conversation.length
      ?{text:'',toolCalls:[{id:'stat-1',name:'adjudicate_action',arguments:{action:'Look at the lamp without lighting it.',mode:'query'}}]}
      :{text:'Observe the lamp; do not establish a lighting event.'};
    if(args.stage==='adjudicate')return{text:'No roll needed; looking does not light the lamp.'};
    if(args.stage==='draft'||args.stage==='prose')return{text:'The crew looked at the lamp without changing it.'};
    if(args.stage==='post_stat')return{text:JSON.stringify(emptyProposal)};
    throw Error('Unexpected stage '+args.stage);
  }};
  const memory={async retrieve(){return{records:[],status:'synthetic_offline'};}};
  const engine=new SceanEngine({store,model,memory});
  const run=await engine.createRun({snapshot:source,initialState:{world:{facts:{lampLit:false}},characters:{}}});
  return{engine,store,calls,run};
}
const play=(f,input='我看看煙燈。',requestId='b-worldbook-turn')=>f.engine.turn({runId:f.run.runId,input,requestId});

test('B1 actual model packets contain selected KEY context and no disabled/unrelated/selective/regex container leakage',async()=>{
  const f=await fixture(snapshot(),{consultStat:true});await play(f);
  for(const marker of ['UNRELATED_CIVILIZATION_EXCLUDED','DISABLED_EXCLUDED','SECONDARY_EXCLUDED','REGEX_EXCLUDED'])assert(!text(f.calls).includes(marker),marker);
  for(const stage of ['director','draft','adjudicate'])assert(text(f.calls.find(c=>c.stage===stage).input).includes('LAMP_SELECTED'),stage);
  for(const stage of ['prose','post_stat'])assert(!text(f.calls.find(c=>c.stage===stage).input).includes('LAMP_SELECTED'),stage+' must not receive full worldbooks');
  const after=await f.store.read(f.run.runId);assert.equal(after.state.world.facts.lampLit,false);assert.equal(after.memories.length,0);
  const inspection=await f.engine.inspect(f.run.runId);const raw=text(inspection.attempts.at(-1));
  assert(raw.includes('primary_miss'));assert(raw.includes('secondary_condition_failed'));assert(raw.includes('unsupported_regex'));assert(raw.includes('UNSUPPORTED_PLACEMENT'));
});

test('B1 independently named book versions stay distinct while an exact embedded duplicate is injected once',async()=>{
  const b=book();b.entries=[{id:'lamp',keys:['煙燈'],content:'VERSIONED_SELECTED'}];
  const source=snapshot(b);source.worldbook=[{book:structuredClone(b),source:{id:'research-book',revision:'r1'}},{book:structuredClone(b),source:{id:'research-book',revision:'r2'}}];
  const f=await fixture(source);await play(f);
  const entries=f.calls.find(c=>c.stage==='director').input.assembly.sources.worldbook.entries;
  assert.equal(entries.length,2);assert.deepEqual(entries.map(e=>e.bookVersion).sort(),['r1','r2']);
  assert(entries.every(e=>e.entryId==='lamp'&&e.sourceId&&e.contentHash&&e.bookId));
  const diagnostic=text((await f.engine.inspect(f.run.runId)).attempts.at(-1));assert(diagnostic.includes('exact_book_and_version'));
});

test('B1 scan message and player-turn units are distinguishable at the actual Director port',async()=>{
  for(const [unit,expected] of [['messages',false],['player_turns',true]]){
    const source=snapshot();source.recentDialogue=[{turn:1,input:'曾提及煙燈。',body:'船員站在甲板。'}];source.worldbookSelection={scanWindow:{unit,count:1}};
    const f=await fixture(source);await play(f,'我等待。');
    const entries=f.calls.find(c=>c.stage==='director').input.assembly.sources.worldbook.entries;
    assert.equal(entries.some(e=>e.entryId==='lamp'),expected,unit);
  }
});

test('B1 source mutation and a newer Run cannot change the existing immutable book snapshot',async()=>{
  const source=snapshot();const f=await fixture(source);const old=await f.store.read(f.run.runId);
  source.worldbook.entries[1].content='NEW_REVISION_ONLY';source.card.data.character_book=structuredClone(source.worldbook);source.revision='r2';
  const newer=await f.engine.createRun({snapshot:source});await play(f);
  assert(text(f.calls).includes('LAMP_SELECTED'));assert(!text(f.calls).includes('NEW_REVISION_ONLY'));
  assert.deepEqual((await f.store.read(f.run.runId)).snapshot,old.snapshot);assert.notEqual(newer.snapshot.hash,old.snapshot.hash);
});

test('B1 stripping nested raw books preserves ordinary Preset entries and required style',async()=>{
  const source=snapshot();source.preset={entries:[{id:'style',content:'PRESET_ENTRY_REQUIRED_MARKER',enabled:true}],style:'STYLE_REQUIRED_MARKER'};
  source.card.data.extensions={unknownWrapper:{character_book:{entries:[{id:'hidden',enabled:false,content:'NESTED_RAW_BOOK_EXCLUDED'}]}}};
  const f=await fixture(source);await play(f);
  assert(!text(f.calls).includes('NESTED_RAW_BOOK_EXCLUDED'));
  for(const stage of ['director','draft','prose'])assert(text(f.calls.find(c=>c.stage===stage).input).includes('PRESET_ENTRY_REQUIRED_MARKER'),stage+' lost valid preset content');
});
