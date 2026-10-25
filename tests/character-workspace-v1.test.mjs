import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {bindCharacterSources,validateCharacterSources} from '../core/character-sources.mjs';
import {validateSnapshot,hash} from '../core/contracts.mjs';
import {buildSavedSnapshot} from '../studio/cardstudio-bundle/lib/scean-integration.js';

globalThis.fetch=async()=>assert.fail('No network in offline acceptance');
const card=()=>({data:{description:'ALPHA_FULL: quiet engineer; secretly fears deep water.',creator_notes:'DIRECTOR_BACKSTAGE: beta will leave next chapter.',extensions:{scean:{}},character_book:{entries:[{id:10,content:'ALPHA_BOOK_ONLY: repairs radios.'},{id:20,content:'BETA_BOOK_ONLY: collects maps.'},{id:30,content:'Shared scene: Alpha fixes a lamp. Beta hides a map.'}]}}});
const actor=(id,description)=>({id,name:id,description});
function fixtureCard(){
 const c=card(),ctx={card:c,worldbook:c.data.character_book};
 c.data.extensions.scean.characters=[bindCharacterSources(actor('alpha','ALPHA_BOOK_ONLY: repairs radios.'),[{kind:'worldbook_entry',entryId:10}],ctx),bindCharacterSources(actor('beta','BETA_BOOK_ONLY: collects maps.'),[{kind:'worldbook_entry',entryId:20}],ctx)];return c;
}
const saved=(c,revision=1)=>buildSavedSnapshot({id:'synthetic-v1',type:'card',revision,sha256:hash(c),card:c});
const empty=()=>({contractVersion:2,stateChanges:[],memories:[]});
const advice=id=>({adviceVersion:1,characterId:id,observable:{attitude:'ADVICE_ONLY_CANARY',intent:'possible suggestion'},publicUtterances:[],withheld:[],internal:{notes:[]},intendedDisclosures:[]});
test('single description selection, multi-entry source attribution and same-entry curated backgrounds',()=>{
 const c=card(),ctx={card:c,worldbook:c.data.character_book};
 const single=bindCharacterSources(actor('alpha',c.data.description),[{kind:'card_field',path:'/data/description'}],ctx);
 c.data.extensions.scean.characters=[single];assert.equal(saved(c).characters[0].description,c.data.description);
 const multi=fixtureCard();assert.deepEqual(saved(multi).characters.map(x=>x.sourceBindings.sources[0].entryId),[10,20]);
 for(const a of saved(multi).characters)assert(!a.description.includes(a.id==='alpha'?'BETA':'ALPHA'));
 const curated=bindCharacterSources(actor('alpha','Alpha fixes a lamp.'),[{kind:'worldbook_entry',entryId:30}],ctx);
 assert(!JSON.stringify(curated).includes('Beta hides'));validateCharacterSources(curated,ctx);
 const reordered=structuredClone(ctx);reordered.worldbook.entries.reverse();validateCharacterSources(curated,reordered);
});
test('stale source, stale compiled background, forged owner, missing/ambiguous entry rejected before Run',()=>{
 for(const mutation of [c=>c.data.character_book.entries[0].content+=' changed',c=>c.data.extensions.scean.characters[0].description+=' changed',c=>c.data.extensions.scean.characters[0].sourceBindings.characterId='beta',c=>c.data.character_book.entries.shift(),c=>c.data.character_book.entries.push({...c.data.character_book.entries[0]})]){
  const c=fixtureCard();mutation(c);assert.throws(()=>saved(c),e=>e.code.startsWith('CHARACTER_SOURCE_'));
 }
 const snap=saved(fixtureCard());snap.characters[0].sourceBindings.sources[0].sha256='0'.repeat(64);delete snap.hash;
 assert.throws(()=>validateSnapshot(snap),{code:'CHARACTER_SOURCE_DRIFT'});
});
test('no CR still writes memory; fresh port packets include canonical context and exclude previous consultation history',async()=>{
 await mkdir(new URL('../.test-data/',import.meta.url),{recursive:true});const root=await mkdtemp(new URL('../.test-data/workspace-v1-',import.meta.url));
 const calls=[];let step=0;const model={async generate(a){calls.push(structuredClone({...a,signal:undefined}));
  if(a.stage==='director')return step>0&&!a.input.conversation.length?{text:'',toolCalls:[{id:'cr-'+step,name:'consult_character',arguments:{characterId:'alpha',question:step===1?'PRIOR_QUESTION_CANARY':'lamp current question'}}]}:{text:'Editorial brief'};
  if(a.stage==='character')return {text:JSON.stringify(advice('alpha'))};
  if(a.stage==='post_stat')return {text:JSON.stringify(step===0?{...empty(),memories:[{schemaVersion:2,text:'Alpha repaired the lamp.',access:{kind:'known_event'},knowers:['alpha'],characterIds:['alpha'],visibility:'characters',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:['alpha'],decisionMakers:[]}}]}:empty())};
  return {text:step===0?'Alpha repaired the lamp.':'The crew rests quietly.'};}};
 const store=new DurableStore({root}),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()}),c=fixtureCard();
 const run=await engine.createRun({snapshot:saved(c),initialState:{world:{place:'PUBLIC_HARBOR'},characters:{alpha:{private:{fact:'OWN_STATE'}},beta:{private:{fact:'OTHER_STATE'}}}}});
 await engine.turn({runId:run.runId,requestId:'one',input:'repair lamp'});
 assert.deepEqual(calls.map(c=>c.stage),['director','draft','prose','post_stat']);
 let current=await store.read(run.runId);assert.equal(current.memories.length,1);assert.equal(current.memories[0].source.commitId,current.turns[0].commitId);assert.deepEqual(current.memories[0].knowers,['alpha']);
 step=1;await engine.turn({runId:run.runId,requestId:'two',input:'consult lamp'});
 const first=calls.find(c=>c.stage==='character');assert.equal(first.input.lastCommittedTurn.body,'Alpha repaired the lamp.');assert.equal(first.input.lastCommittedTurn.commitId,current.turns[0].commitId);
 assert(first.input.character.description.includes('ALPHA_BOOK_ONLY'));assert(!JSON.stringify(first.input.character).includes('BETA_BOOK_ONLY'));assert.equal(first.input.ownState.private.fact,'OWN_STATE');assert(!JSON.stringify(first.input.ownState).includes('OTHER_STATE'));assert.equal(first.input.publicWorld.place,'PUBLIC_HARBOR');assert.equal(first.input.currentEvent.turn,2);assert.equal(first.input.characterIdentities.length,2);assert.equal(first.input.playerInput,'consult lamp');
 assert(JSON.stringify(calls.find(c=>c.stage==='director').input).includes('DIRECTOR_BACKSTAGE'));
 step=2;await engine.turn({runId:run.runId,requestId:'three',input:'consult lamp again'});
 const last=calls.filter(c=>c.stage==='character').at(-1);assert(!JSON.stringify(last).includes('PRIOR_QUESTION_CANARY'));assert(!JSON.stringify(last).includes('ADVICE_ONLY_CANARY'));assert(last.input.memory.records.some(m=>m.text.includes('repaired the lamp')));assert.equal(last.input.lastCommittedTurn.turn,2);
 for(const call of calls.filter(c=>c.stage==='post_stat')){assert(!JSON.stringify(call).includes('PRIOR_QUESTION_CANARY'));assert(!JSON.stringify(call).includes('ADVICE_ONLY_CANARY'));}
 current=await store.read(run.runId);assert.equal(current.memories.length,1);assert(!JSON.stringify(current.memories).includes('ADVICE_ONLY_CANARY'));
 const bytes=await readFile(join(store.runDir(run.runId),'current.json'));
 c.data.character_book.entries[0].content='NEW_BACKGROUND';c.data.extensions.scean.characters[0]=bindCharacterSources(actor('alpha','NEW_BACKGROUND'),[{kind:'worldbook_entry',entryId:10}],{card:c,worldbook:c.data.character_book});
 const next=await engine.createRun({snapshot:saved(c,2)});assert.equal(next.snapshot.characters[0].description,'NEW_BACKGROUND');assert.deepEqual(await readFile(join(store.runDir(run.runId),'current.json')),bytes);
 await engine.rollback({runId:run.runId,operationId:'rollback',expectedVersion:current.version,expectedHead:current.head});
 assert.equal((await store.read(run.runId)).turns.length,2);
});
test('portable source-binding implementation is identical across Core and Studio adapter',async()=>{
 const source=await readFile(new URL('../core/character-sources.mjs',import.meta.url),'utf8');
 for(const path of ['../studio/cardstudio-bundle/lib/character-sources.js'])assert.equal(await readFile(new URL(path,import.meta.url),'utf8'),source);
});
