import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {publicInspection} from '../core/inspection.mjs';

// Offline model-port capture tests; no provider client, SDK or billing path.
const serialized = value => JSON.stringify(value);
const roster=()=>[{id:'keeper',name:'守塔人',description:'KEEPER_FULL_OWNER_BACKGROUND',relationships:{apprentice:'KEEPER_OWNER_RELATION'},private:{secret:'KEEPER_CARD_SECRET'}},{id:'apprentice',name:'學徒',description:'APPRENTICE_FULL_BACKGROUND',private:{secret:'APPRENTICE_CARD_SECRET'}}];
const snapshot=()=>({schemaVersion:1,cardId:'b-synthetic-magic-tower',revision:'r1',card:{name:'合成魔法塔',description:'The public tower entrance.'},worldbook:{entries:[{id:'door',keys:['塔門'],content:'DOOR_PUBLIC_RULE'}]},preset:{style:'Concise public scene'},characters:roster()});
const state=()=>({world:{locations:{current:'tower'},resources:{mana:80},time:{minute:17}},characters:{keeper:{private:{facts:{secret:'KEEPER_STATE_SECRET'}},public:{facts:{role:'keeper'}}},apprentice:{private:{facts:{secret:'APPRENTICE_STATE_SECRET'}}}}});
const emptyProposal=()=>({contractVersion:2,stateChanges:[],memories:[]});
const advice=()=>({adviceVersion:1,characterId:'keeper',observable:{attitude:'calm',intent:'wait'},publicUtterances:['PUBLIC_ADVICE_ONLY'],withheld:['WITHHELD_PRIVATE_SENTINEL'],internal:{notes:['INTERNAL_PRIVATE_SENTINEL']},intendedDisclosures:[]});
async function setup({source=snapshot(),initial=state(),window=32768,consult=false,post=emptyProposal,fault}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-b-integration-')),store=new DurableStore({root,fault}),calls=[],descriptions=[],recalls=[];
  const model={async describe(...args){descriptions.push(args);return{capabilities:{contextWindow:window,outputLimit:4096}};},async generate(args){calls.push({stage:args.stage,system:args.system,input:structuredClone(args.input)});
    if(args.stage==='director')return consult&&!args.input.conversation.length?{text:'',toolCalls:[{id:'owner-consult',name:'consult_character',arguments:{characterId:'keeper',question:'What is your public advice about the door?'}}]}:{text:'PUBLIC_BRIEF_ONLY: wait outside the tower.'};
    if(args.stage==='character')return{text:JSON.stringify(advice())};
    if(args.stage==='draft'||args.stage==='prose')return{text:'The keeper waited beside the closed tower door.'};
    if(args.stage==='post_stat')return{text:JSON.stringify(post(args))};
    throw Error('Unexpected stage '+args.stage);
  }};
  const memory={async retrieve(args){recalls.push({audience:args.audience,characterId:args.characterId??null});return{records:structuredClone(args.records),status:'synthetic_offline'};}};
  const engine=new SceanEngine({store,model,memory});const run=await engine.createRun({snapshot:source,initialState:initial});
  return{root,store,model,engine,run,calls,descriptions,recalls};
}
const play=(f,requestId='b-turn')=>f.engine.turn({runId:f.run.runId,input:'我在塔門旁等待。',requestId});

test('B2 actual stages retain owner CR context while public handoffs never receive private raw packets',async()=>{
  const f=await setup({consult:true});await play(f);
  const cr=f.calls.find(c=>c.stage==='character'),raw=serialized(cr.input);
  for(const marker of ['KEEPER_FULL_OWNER_BACKGROUND','KEEPER_OWNER_RELATION','KEEPER_CARD_SECRET','KEEPER_STATE_SECRET'])assert(raw.includes(marker),marker);
  for(const marker of ['APPRENTICE_FULL_BACKGROUND','APPRENTICE_CARD_SECRET','APPRENTICE_STATE_SECRET'])assert(!raw.includes(marker),marker);
  assert(!Object.hasOwn(cr.input.currentEvent,'recentDialogue'));
  for(const call of f.calls.filter(c=>c.stage!=='character'))for(const marker of ['KEEPER_FULL_OWNER_BACKGROUND','KEEPER_STATE_SECRET','KEEPER_CARD_SECRET','WITHHELD_PRIVATE_SENTINEL','INTERNAL_PRIVATE_SENTINEL'])assert(!serialized(call.input).includes(marker),call.stage+' leaked '+marker);
  const post=f.calls.find(c=>c.stage==='post_stat');assert(!serialized(post.input).includes('PUBLIC_ADVICE_ONLY'));assert(!serialized(post.input).includes('PUBLIC_BRIEF_ONLY'));
  const saved=await f.store.read(f.run.runId);assert.deepEqual(saved.state,state());assert.equal(saved.memories.length,0);
});

test('B2 complete core remains intact when the model metadata estimate is small',async()=>{
 const source=snapshot();source.card.description='REQUIRED_CARD '.repeat(12000);const f=await setup({source,window:18000}),before=await f.store.read(f.run.runId);await play(f);assert(f.calls.some(c=>c.stage==='director'&&serialized(c.input).includes('REQUIRED_CARD')));assert.deepEqual((await f.store.read(f.run.runId)).state,before.state);
});

test('B2 complete authorized packet preserves selected books and source-selected snapshot history without token pruning',async()=>{
  const source=snapshot();source.worldbook.entries=Array.from({length:12},(_,i)=>({id:'book-'+i,constant:true,priority:i,content:`OPTIONAL_BOOK_${i} `+'word '.repeat(1000)}));
  source.recentDialogue=Array.from({length:8},(_,i)=>({turn:i+1,input:'Earlier question '+i,body:`OLD_BODY_${i} `+'history '.repeat(1800)}));
  const a=await setup({source,window:18000}),b=await setup({source:structuredClone(source),window:18000});
  await play(a);await play(b);
  const packet=a.calls.find(c=>c.stage==='director');assert(serialized(packet.input).includes('OPTIONAL_BOOK_0'));assert(!serialized(packet.input).includes('OLD_BODY_0'));
  assert(serialized(packet.input).includes('我在塔門旁等待。'));assert(serialized(packet.input).includes('"mana":80'));assert(serialized(packet.input).includes('守塔人'));
  assert.deepEqual(a.calls,b.calls,'run IDs and timestamps must not affect assembled prompt');
  const trace=serialized((await a.engine.inspect(a.run.runId)).attempts.at(-1));assert(trace.includes('complete_authorized_packet_no_token_quota')); assert(trace.includes('estimateOnly'));
});

test('B2 public diagnostics never expose owner-context contents from capacity candidates',async()=>{
  const f=await setup({consult:true});await play(f);
  const shared=serialized(publicInspection(await f.engine.inspect(f.run.runId)));
  for(const marker of ['KEEPER_CARD_SECRET','KEEPER_STATE_SECRET','APPRENTICE_STATE_SECRET','KEEPER_FULL_OWNER_BACKGROUND','WITHHELD_PRIVATE_SENTINEL','INTERNAL_PRIVATE_SENTINEL'])assert(!shared.includes(marker),marker);
});

test('B2 large CR owner packet remains owner-authorized without a fabricated platform token limit',async()=>{
 const source=snapshot();source.characters[0].description='OWN_PRIVATE_BACKGROUND '.repeat(3500);const f=await setup({source,window:12000,consult:true}),before=await f.store.read(f.run.runId);await play(f);
 assert.equal(f.recalls.filter(x=>x.audience==='public').length,1);assert.equal(f.recalls.filter(x=>x.characterId==='keeper'||x.audience==='owner').length,1);assert(f.calls.some(c=>c.stage==='character'&&serialized(c.input).includes('OWN_PRIVATE_BACKGROUND')));assert(!serialized(f.calls.find(c=>c.stage==='director').input).includes('OWN_PRIVATE_BACKGROUND'));assert.deepEqual((await f.store.read(f.run.runId)).state,before.state);
});
