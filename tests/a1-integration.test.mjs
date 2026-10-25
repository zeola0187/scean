import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {hash} from '../core/contracts.mjs';

// Synthetic facts only. These are structural/dataflow tests, never semantic proof.
const evidence=resolve('evidence/milestone-a1/integration');
const roster=()=>[
  {id:'kalt',name:'卡爾特',description:'KALT_FULL_BACKGROUND：她是研究船工程師，害怕深水。',identity:{source:'user-explicit',gender:'女性',pronouns:'她'},relationships:{ael:'KALT_RELATION_AEL：長期合作'},private:{secret:'KALT_CARD_SECRET'},foreignContext:{contextScope:{kind:'character',characterId:'sio'},text:'SIO_NESTED_FOREIGN_SECRET'}},
  {id:'ael',name:'艾爾',description:'AEL_FULL_BACKGROUND：合成觀測員。',private:{secret:'AEL_CARD_SECRET'}},
  {id:'sio',name:'希歐',description:'SIO_FULL_BACKGROUND：合成領航員。',private:{secret:'SIO_CARD_SECRET'}}
];
const snapshot=()=>{const characters=roster();return {schemaVersion:1,cardId:'a1-original-synthetic',revision:'r1',card:{data:{name:'合成研究船',description:'星港日常。',extensions:{scean:{characters:structuredClone(characters)}}}},worldbook:{entries:[{content:'星港很安靜。',constant:true}]},preset:{style:'繁體中文'},characters};};
const state=()=>({
  world:{locations:{kalt:'workshop',ael:'workshop',sio:'bridge'},tasks:{inspection:{status:'active',assignedTo:['kalt','sio']},fullThermalCycle:{status:'pending'}},resources:{fuel:72},time:{elapsedSeconds:{temporalKind:'duration',seconds:0}}},
  characters:{
    kalt:{public:{role:'工程師'},private:{facts:{secret:'KALT_STATE_SECRET'}}},
    ael:{public:{role:'觀測員'},private:{facts:{secret:'AEL_STATE_SECRET'}}},
    sio:{public:{role:'領航員'},private:{facts:{secret:'SIO_STATE_SECRET'}}}
  }
});
const source=runId=>({runId,turn:0,commitId:'synthetic-seed',bodyHash:'synthetic-seed-body',snapshotHash:'synthetic-snapshot',cardId:'a1-original-synthetic',revision:'r1',rosterHash:'synthetic-roster'});
const mem=(runId,id,kind,knowers=[],epistemic='fact',credibility='confirmed')=>({schemaVersion:2,id,version:1,text:`harbor ${id}`,access:{kind},knowers,characterIds:[...knowers],visibility:kind==='world_public'?'public':'characters',epistemic:{kind:epistemic},credibility,participants:{speakers:[],actors:[],decisionMakers:[]},source:source(runId)});
const seeded=runId=>[mem(runId,'WORLD_PUBLIC','world_public'),mem(runId,'KALT_AEL_KNOWN','known_event',['kalt','ael']),mem(runId,'KALT_PRIVATE_RAW_MEMORY','private',['kalt'],'experience','subjective'),mem(runId,'SIO_PRIVATE_RAW_MEMORY','private',['sio']),mem(runId,'AEL_FALSE_BELIEF','known_event',['ael'],'belief','disputed'),mem('other-run','FOREIGN_RUN_MEMORY','world_public'),{id:'LEGACY_KALT_ONLY',version:1,text:'harbor LEGACY_KALT_ONLY',characterIds:['kalt'],visibility:'public',source:source(runId)}];
const advice=(characterId,reveal=false)=>({adviceVersion:1,characterId,observable:{attitude:'願意協助',intent:'先確認讀數'},publicUtterances:['建議先做低負載檢查。'],withheld:['WITHHELD_PRIVATE_CONTENT'],internal:{notes:['INTERNAL_PRIVATE_NOTES']},intendedDisclosures:reveal?[{topic:'自願透露的位置',publicText:'我願意說：保險箱在艙底。'}]:[]});
async function fixture({targets=[],reveal=false,postStat,body='卡爾特把工具留在桌上，她沒有替玩家做決定。',initial=state()}={}){
  await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(evidence,'fixture-'));const store=new DurableStore({root});const calls=[],rankInputs=[];
  const memory=new Memory({topK:20});const retrieve=memory.retrieve.bind(memory);memory.retrieve=async args=>{rankInputs.push({characterId:args.characterId??null,audience:args.audience,records:structuredClone(args.records)});return retrieve(args);};
  const model={async generate(args){const p={stage:args.stage,system:args.system,input:structuredClone(args.input),context:structuredClone(args.context)};calls.push(p);
    if(args.stage==='director')return targets.length&&!args.input.conversation.length?{text:'',toolCalls:targets.map(id=>({id:'consult-'+id,name:'consult_character',arguments:{characterId:id,question:'harbor 的檢查建議？'}}))}:{text:'保持當前場景與角色自主性。'};
    if(args.stage==='character')return{text:JSON.stringify(advice(args.input.character.id,reveal))};
    if(args.stage==='draft')return{text:typeof body==='function'?body(args):body};
    if(args.stage==='prose')return{text:args.input.draft};
    if(args.stage==='post_stat')return{text:JSON.stringify(postStat?postStat(args):{contractVersion:2,stateChanges:[],memories:[]})};
    throw Error('Unexpected stage '+args.stage);
  }};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory});const run=await engine.createRun({snapshot:snapshot(),initialState:initial});
  const records=seeded(run.runId);await store.withRunLock(run.runId,()=>store.commit(run.runId,0,{...run,version:1,memories:records}));
  return {engine,store,memory,runId:run.runId,calls,rankInputs,root,records};
}
const textOf=value=>JSON.stringify(value);

test('A1 A/B: actual CR prompts receive own full background, own private state and permitted memories only',async()=>{
  const f=await fixture({targets:['kalt','ael','sio']});await f.engine.turn({runId:f.runId,input:'請分別諮詢卡爾特、艾爾、希歐的 harbor 建議。',requestId:'a1-context'});
  const cr=f.calls.filter(x=>x.stage==='character');assert.equal(cr.length,3);
  for(const call of cr){const id=call.input.character.id,raw=textOf(call.input);assert(raw.includes(id.toUpperCase()+'_FULL_BACKGROUND'));assert(raw.includes(id.toUpperCase()+'_STATE_SECRET'));assert(raw.includes(id.toUpperCase()+'_CARD_SECRET'));assert(raw.includes('WORLD_PUBLIC'));
    for(const other of ['kalt','ael','sio'].filter(x=>x!==id)){assert(!raw.includes(other.toUpperCase()+'_FULL_BACKGROUND'));assert(!raw.includes(other.toUpperCase()+'_STATE_SECRET'));assert(!raw.includes(other.toUpperCase()+'_CARD_SECRET'));}
    assert(!raw.includes('FOREIGN_RUN_MEMORY'));assert(!raw.includes('SIO_NESTED_FOREIGN_SECRET'));
    assert.equal(raw.includes('KALT_AEL_KNOWN'),id!=='sio');assert.equal(raw.includes('KALT_PRIVATE_RAW_MEMORY'),id==='kalt');assert.equal(raw.includes('SIO_PRIVATE_RAW_MEMORY'),id==='sio');assert.equal(raw.includes('LEGACY_KALT_ONLY'),id==='kalt');assert.equal(raw.includes('AEL_FALSE_BELIEF'),id==='ael');
  }
  const kalt=cr.find(x=>x.input.character.id==='kalt');assert.equal(kalt.input.character.identity.gender,'女性');assert(textOf(kalt.input).includes('KALT_RELATION_AEL'));assert(!Object.hasOwn(kalt.input.currentEvent,'recentDialogue'),'unscoped history is not automatic character knowledge');
  const belief=cr.find(x=>x.input.character.id==='ael').input.memory.records.find(x=>x.text.includes('AEL_FALSE_BELIEF'));assert.equal(belief.epistemic.kind,'belief');assert.equal(belief.credibility,'disputed');
  for(const call of f.calls.filter(x=>x.stage!=='character'))for(const forbidden of ['_FULL_BACKGROUND','_STATE_SECRET','_CARD_SECRET','KALT_PRIVATE_RAW_MEMORY','SIO_PRIVATE_RAW_MEMORY','KALT_AEL_KNOWN','AEL_FALSE_BELIEF','LEGACY_KALT_ONLY','WITHHELD_PRIVATE_CONTENT','INTERNAL_PRIVATE_NOTES'])assert(!textOf(call.input).includes(forbidden),call.stage+' leaked '+forbidden);
  await writeFile(join(evidence,'actual-stage-prompts.json'),JSON.stringify(f.calls,null,2));
});

test('A1 B/D: permission filters apply before ranking and cross-Run/legacy inputs remain unchanged',async()=>{
  const f=await fixture({targets:['kalt','sio']});const before=await readFile(join(f.root,'runs',f.runId,'current.json'),'utf8');const original=structuredClone(f.records);
  await f.engine.recall(await f.store.read(f.runId),'harbor','kalt');await f.engine.recall(await f.store.read(f.runId),'harbor','sio');
  assert.equal(await readFile(join(f.root,'runs',f.runId,'current.json'),'utf8'),before,'read-time compatibility cannot migrate old Run');assert.deepEqual(f.records,original);
  const kalt=f.rankInputs.find(x=>x.characterId==='kalt'),sio=f.rankInputs.find(x=>x.characterId==='sio');assert(kalt.records.some(x=>x.id==='KALT_PRIVATE_RAW_MEMORY'));assert(!sio.records.some(x=>['KALT_PRIVATE_RAW_MEMORY','KALT_AEL_KNOWN','LEGACY_KALT_ONLY'].includes(x.id)));
  for(const args of f.rankInputs)assert(!args.records.some(x=>x.source.runId!==f.runId),'foreign records never reach ranking port');
  const sent=[];const ranked=[];const real=new Memory({topK:20,embed:async({texts})=>{sent.push(...texts);return texts.map(()=>[1,0]);},rerank:async({candidates})=>{ranked.push(...candidates);return candidates.map((_,index)=>({index,score:1}));}});
  await real.retrieve({query:'harbor',records:f.records,runId:f.runId,characterId:'sio',audience:'owner'});
  assert(!textOf({sent,ranked}).includes('KALT_PRIVATE_RAW_MEMORY'));assert(!textOf({sent,ranked}).includes('KALT_AEL_KNOWN'));assert(!textOf({sent,ranked}).includes('FOREIGN_RUN_MEMORY'));
});

test('A1 C: withheld/private notes stay private; explicit disclosure is advice only, not a Host event',async()=>{
  for(const reveal of [false,true]){const f=await fixture({targets:['kalt'],reveal});const before=await f.store.read(f.runId);await f.engine.turn({runId:f.runId,input:'請諮詢卡爾特的 harbor 建議。',requestId:'advice-'+reveal});
    const after=await f.store.read(f.runId),director=f.calls.filter(x=>x.stage==='director').at(-1);const raw=textOf(director.input);assert(raw.includes('建議先做低負載檢查。'));assert(raw.includes('advice_not_event'));assert(!raw.includes('WITHHELD_PRIVATE_CONTENT'));assert(!raw.includes('INTERNAL_PRIVATE_NOTES'));assert(!raw.includes('KALT_PRIVATE_RAW_MEMORY'));assert.equal(raw.includes('我願意說：保險箱在艙底。'),reveal);
    assert.deepEqual(after.memories,before.memories,'CR advice never writes official memory');assert.deepEqual(after.state,before.state,'CR advice never applies state');
    const inspection=await f.engine.inspect(f.runId),stage=inspection.attempts.at(-1).stages.find(x=>x.stage==='character');assert.equal(stage.access.kind,'character_private');assert.equal(stage.access.characterId,'kalt');
  }
  await writeFile(join(evidence,'semantic-boundary.json'),JSON.stringify({structuralProjection:'PASS',freeTextSemanticLeakage:'NOT_OBSERVED',reason:'Synthetic scripted outputs exercise declared withheld/disclosure projection only; no semantic reviewer or proof that a real model never leaks.'},null,2));
});

test('A1 D: synthetic T8 attribution and T9 endpoint retain female identity, Writer handoff and incremental state',async()=>{
  const bodies={t8:'卡爾特說：「等航向穩定再做完整熱循環。」她把清單放好，玩家點頭。',t9:'卡爾特與希歐回到共用艙室。她報告局部檢查完成，完整熱循環仍等待航向穩定。'};
  const f=await fixture({body:args=>bodies[args.context.requestId],postStat:args=>({contractVersion:2,stateChanges:args.context.requestId==='t8'?[{scope:'world',category:'tasks',key:'fullThermalCycle',operation:'set',value:{status:'deferred_until_course_stable'}}]:[{scope:'world',category:'tasks',key:'inspection',operation:'set',value:{status:'completed'}},{scope:'world',category:'locations',key:'kalt',operation:'set',value:'common_cabin'},{scope:'world',category:'locations',key:'sio',operation:'set',value:'common_cabin'}],memories:[{schemaVersion:2,text:args.context.requestId==='t8'?'卡爾特決定航向穩定後再做完整熱循環。':'卡爾特與希歐返回並報告局部檢查完成。',access:{kind:'known_event'},knowers:['kalt','ael'],characterIds:['kalt','ael'],visibility:'characters',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:['kalt'],actors:['kalt'],decisionMakers:['kalt']}}]})});
  const before=await f.store.read(f.runId);await f.engine.turn({runId:f.runId,input:'我點頭並等待。',requestId:'t8'});await f.engine.turn({runId:f.runId,input:'繼續等待直到兩人返回。',requestId:'t9'});
  const after=await f.store.read(f.runId);assert.equal(after.turns.length,2);assert.equal(after.turns[0].body,bodies.t8);assert.equal(after.turns[1].body,bodies.t9);assert.equal(f.calls.filter(x=>x.stage==='character').length,0,'daily scripted Director is not forced to consult');
  assert.equal(after.state.world.tasks.fullThermalCycle.status,'deferred_until_course_stable');assert.equal(after.state.world.tasks.inspection.status,'completed');assert.equal(after.state.world.resources.fuel,72);assert.deepEqual(after.state.characters,before.state.characters);
  for(const call of f.calls.filter(x=>['prose','post_stat'].includes(x.stage)))assert(textOf(call.input).includes('女性')&&textOf(call.input).includes('她'));
  const newRows=after.memories.slice(before.memories.length);assert.equal(newRows.length,2);for(const row of newRows){assert.deepEqual(row.participants.decisionMakers,['kalt']);assert(!row.participants.speakers.includes('player'));assert.equal(row.source.runId,f.runId);assert.equal(row.source.snapshotHash,after.snapshot.hash);assert.equal(row.source.rosterHash,hash(after.snapshot.characters));assert.equal(row.source.bodyHash,after.turns[row.source.turn-1].bodyHash);}
  const own=await f.engine.recall(after,'熱循環','kalt');assert(own.records.some(x=>x.id===newRows[0].id));const sio=await f.engine.recall(after,'熱循環','sio');assert(!sio.records.some(x=>newRows.some(y=>x.id===y.id)));
});

test('A1 D: cancellation rejects late result atomically and new revision does not rewrite existing snapshot',async()=>{
  const f=await fixture();const before=await f.store.read(f.runId),controller=new AbortController();let begin;const started=new Promise(r=>begin=r);let release;const delayed=new Promise(r=>release=r);
  f.engine.model={generate:async()=>{begin();await delayed;return{text:'late text'};}};const pending=f.engine.turn({runId:f.runId,input:'取消前先等待。',requestId:'a1-cancel',signal:controller.signal});await started;controller.abort();await assert.rejects(pending,e=>e.code==='CANCELLED');release();await new Promise(r=>setTimeout(r,30));
  const after=await f.store.read(f.runId);assert.deepEqual(after,before);
  const revised=snapshot();revised.revision='r2';revised.characters[0].description='KALT_R2_NEW_BACKGROUND';await f.engine.createRun({snapshot:revised,initialState:state()});assert.deepEqual((await f.store.read(f.runId)).snapshot,before.snapshot);
});
