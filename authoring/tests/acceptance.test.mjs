import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validatePlan} from '../scripts/validate-plan-v1.0.0.mjs';
import {hash} from '../../core/contracts.mjs';
import {buildSavedSnapshot} from '../../studio/cardstudio-bundle/lib/scean-integration.js';
import {normalizeStudioHandoffSnapshot} from '../../plugin/studio-handoff.mjs';
import {SceanEngine} from '../../core/engine.mjs';
import {DurableStore} from '../../adapters/store.mjs';
import {Memory} from '../../core/memory.mjs';
import {projectCharacterAdvice} from '../../core/character-advice.mjs';
import {publicInspection} from '../../core/inspection.mjs';
import {publicBlueprintState} from '../../core/state-blueprint.mjs';
import {blueprintStateRows} from '../../isolated/web/view-model.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const read=async n=>JSON.parse(await readFile(join(root,'fixtures',n),'utf8'));
const inputs=async kind=>({plan:await read(kind+'.plan.json'),card:await read(kind+'.native.json'),source:await read(kind+'.source.json')});
const snapshot=card=>normalizeStudioHandoffSnapshot(buildSavedSnapshot({id:'synthetic-card',revision:1,type:'card',sha256:hash(card),card}));
const error=code=>e=>e.code===code;
globalThis.fetch=async()=>assert.fail('No network authorized in offline acceptance');
for(const kind of ['ship','market'])test(kind+' authored fixture passes real handoff + typed initial contracts',async()=>{
 const {plan,card,source}=await inputs(kind);assert.equal(validatePlan(plan,card,source).status,'ready');
 assert.equal(snapshot(card).stateBlueprint.id,kind+'-blueprint');
});
test('script cannot become Host capability',async()=>{
 const {plan,card,source}=await inputs('ship');plan.mechanisms[0].implementation='script';
 assert.throws(()=>validatePlan(plan,card,source),error('AUTHORING_SCRIPT_NOT_HOST'));
 plan.mechanisms[0].implementation='native-data';plan.mechanisms[0].capability='arbitrary-scripts';
 assert.throws(()=>validatePlan(plan,card,source),error('AUTHORING_FALSE_CAPABILITY'));
});
test('missing author decision blocks readiness',async()=>{
 const {plan,card,source}=await inputs('ship');Object.assign(plan.mechanisms[0],{capability:'missing-author-choice',classification:'author_decision'});
 assert.throws(()=>validatePlan(plan,card,source),error('AUTHORING_DECISION_REQUIRED'));
 plan.status='blocked';assert.equal(validatePlan(plan,card,source).status,'blocked');
});
test('source drift and omitted domain cannot masquerade as full read',async()=>{
 const f=await inputs('market');f.source.prompt.system+='new';assert.throws(()=>validatePlan(f.plan,f.card,f.source),error('AUTHORING_SOURCE_DRIFT'));
 const g=await inputs('ship');g.plan.inventory.pop();assert.throws(()=>validatePlan(g.plan,g.card,g.source),error('AUTHORING_COVERAGE'));
});
test('classified private literal in public card is rejected by authoring check',async()=>{
 const f=await inputs('ship');f.card.data.description+=f.plan.classifiedPrivateLiterals[0];
 assert.throws(()=>validatePlan(f.plan,f.card,f.source),error('AUTHORING_PUBLIC_LEAK'));
});
for(const [label,mutate,code] of [
 ['numeric range',c=>c.data.extensions.scean.initialState.values[0].value=101,'BLUEPRINT_VALUE_RANGE'],
 ['numeric string',c=>c.data.extensions.scean.initialState.values[0].value='40','BLUEPRINT_VALUE_RANGE'],
 ['enum',c=>c.data.extensions.scean.initialState.values[1].value='teleport','BLUEPRINT_VALUE_ENUM'],
 ['illegal actor',c=>c.data.extensions.scean.stateBlueprint.variables.at(-1).characterId='unknown','BLUEPRINT_ACTOR'],
 ['reserved player roster',c=>c.data.extensions.scean.characters[0].id='player','RESERVED_ACTOR_ID'],
 ['initial version',c=>c.data.extensions.scean.initialState.blueprintVersion=2,'INITIAL_STATE_VERSION'],
 ['task missing fields',c=>c.data.extensions.scean.initialState.values[3].value={status:'done'},'BLUEPRINT_REQUIRED_VALUE']
])test('native negative: '+label,async()=>{const f=await inputs('ship');mutate(f.card);assert.throws(()=>snapshot(f.card),error(code));});

function advice(id,secret='') {return {adviceVersion:1,characterId:id,observable:{attitude:'calm',intent:'wait'},publicUtterances:['請等候。'],withheld:[secret],internal:{notes:[secret]},intendedDisclosures:[]};}
test('semantic disclosure remains a documented limitation',()=>{
 const a=advice('pilot','STRUCTURED_SECRET_CANARY');assert(!JSON.stringify(projectCharacterAdvice(a,{characterId:'pilot'})).includes('STRUCTURED_SECRET_CANARY'));
 a.publicUtterances=['UNLABELLED_SECRET_PARAPHRASE'];assert(JSON.stringify(projectCharacterAdvice(a,{characterId:'pilot'})).includes('UNLABELLED_SECRET_PARAPHRASE'));
 // A passing test here asserts the limitation, never a secrecy guarantee.
});

async function engineFixture(kind,{badPost}={}){
 await mkdir(join(root,'evidence','runs'),{recursive:true});const dir=await mkdtemp(join(root,'evidence','runs',kind+'-'));
 const {card}=await inputs(kind),fixed=snapshot(card),ids=fixed.characters.map(c=>c.id),calls=[],embedded=[];
 const memory=new Memory({embed:async({texts,kind})=>{embedded.push({kind,texts});return texts.map(()=>[1,0]);},embeddingModel:'synthetic-only',dimensions:2});
 const body='合成事件：工作人員完成檢查。玩家獨自記下 PLAYER_ONLY_CANARY。';
 const post=()=>({contractVersion:2,stateChanges:[{scope:'world',category:'tasks',key:'commission',operation:'set',value:{status:'completed',assignees:[ids[1]],progress:100}}],memories:[{schemaVersion:2,text:'OWNER_MEMORY_CANARY 完成檢查',access:{kind:'known_event'},knowers:[ids[0]],characterIds:[ids[0]],visibility:'characters',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:[ids[1]],decisionMakers:[]}}],playerHistory:[{text:'PLAYER_HISTORY_PRIVATE_CANARY',epistemic:{kind:'experience'},credibility:'subjective',participants:{speakers:[],actors:['player'],decisionMakers:[]}}]});
 const model={async generate(a){calls.push(structuredClone({stage:a.stage,input:a.input}));
  if(a.stage==='director')return a.input.conversation.length?{text:'眾人等候玩家。'}:{text:'',toolCalls:ids.slice(0,2).map((id,i)=>({id:'consult-'+i,name:'consult_character',arguments:{characterId:id,question:'完成檢查' }}))};
  if(a.stage==='character')return {text:JSON.stringify(advice(a.input.character.id,'PRIVATE_INTERNAL_CANARY'))};
  if(['draft','prose'].includes(a.stage))return {text:body};
  if(a.stage==='post_stat')return {text:JSON.stringify(badPost?badPost(post()):post())};
  assert.fail('Unexpected stage '+a.stage);
 }};
 const store=new DurableStore({root:join(dir,'store')}),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory}),run=await engine.createRun({snapshot:fixed});
 return {engine,store,run,ids,calls,embedded,dir,card};
}
for(const kind of ['ship','market'])test(kind+' durable turn: owner ACL, UI, provenance, idempotency and rollback',async()=>{
 const f=await engineFixture(kind),secret=f.card.data.extensions.scean.initialState.values.at(-1).value;
 const initial=f.run.state;assert.equal(initial.world.facts.lantern,false);assert(!Object.hasOwn(initial.world.facts,'weather'));
 if(kind==='market')assert.equal(initial.world.resources.coins,0);
 const view=publicBlueprintState(f.run.snapshot.stateBlueprint,initial),rows=blueprintStateRows(view);
 assert.equal(rows.declared.find(r=>r.label==='weather').text,'未知');assert(!JSON.stringify(view).includes(secret));assert(!JSON.stringify(view).includes('PRIVATE_LABEL'));
 const turn=await f.engine.turn({runId:f.run.runId,requestId:'one',input:'請兩位角色依自己的知情提出意見。'});
 assert.equal(turn.status,'committed');const committed=await new DurableStore({root:join(f.dir,'store')}).read(f.run.runId);
 assert.equal(committed.turns.length,1);assert.equal(committed.memories[0].source.bodyHash,hash(committed.turns[0].body));assert.equal(committed.memories[0].source.commitId,committed.turns[0].commitId);assert.equal(committed.playerHistory[0].source.commitId,committed.turns[0].commitId);
 assert.equal(committed.state.world.tasks.commission.progress,100);assert.equal(committed.snapshot.hash,f.run.snapshot.hash);
 const count=f.calls.length;await f.engine.turn({runId:f.run.runId,requestId:'one',input:'請兩位角色依自己的知情提出意見。'});assert.equal(f.calls.length,count);
 f.calls.length=0;await f.engine.turn({runId:f.run.runId,requestId:'two',input:'再詢問兩位角色各自記得什麼。'});
 const owner=f.calls.find(c=>c.stage==='character'&&c.input.character.id===f.ids[0]),other=f.calls.find(c=>c.stage==='character'&&c.input.character.id===f.ids[1]);
 assert(JSON.stringify(owner).includes(secret));assert(JSON.stringify(owner).includes('OWNER_MEMORY_CANARY'));
 assert(!JSON.stringify(other).includes(secret));assert(!JSON.stringify(other.input.memory).includes('OWNER_MEMORY_CANARY'));
 for(const call of f.calls.filter(c=>c.stage!=='character')){assert(!JSON.stringify(call).includes(secret));assert(!JSON.stringify(call).includes('OWNER_MEMORY_CANARY'));assert(!JSON.stringify(call).includes('PLAYER_HISTORY_PRIVATE_CANARY'));assert(!JSON.stringify(call).includes('PRIVATE_INTERNAL_CANARY'));}
 const inspected=await f.engine.inspect(f.run.runId);assert(!JSON.stringify(publicInspection(inspected)).includes(secret));
 const after=await f.store.read(f.run.runId);await f.engine.rollback({runId:f.run.runId,operationId:'rollback-two',expectedVersion:after.version,expectedHead:after.head});
 const rolled=await f.store.read(f.run.runId);assert.equal(rolled.turns.length,1);assert.equal(rolled.memories.length,1);assert.equal(rolled.playerHistory.length,1);assert.equal(rolled.snapshot.hash,f.run.snapshot.hash);
 await writeFile(join(f.dir,'summary.json'),JSON.stringify({layer:'L2 scripted-model, actual Core/store',kind,modelNetworkCalls:0,paidUsd:0,turnsCommitted:2,rollback:true,ownerAndPublicPacketsChecked:true},null,2));
});
for(const [label,mutate,code] of [
 ['player scope',p=>({...p,stateChanges:[{scope:'character',characterId:'player',visibility:'public',category:'facts',key:'test',operation:'set',value:true}]}),'INVALID_STATE_SCOPE'],
 ['unknown knower',p=>{p.memories[0].knowers=['outsider'];p.memories[0].characterIds=['outsider'];return p;},'INVALID_STAT_ACTORS'],
 ['private delta',p=>({...p,stateChanges:[{scope:'character',characterId:'pilot',visibility:'private',category:'facts',key:'promise',operation:'set',value:'new'}]}),'PRIVATE_STATE_WRITE_FORBIDDEN'],
 ['partial task',p=>({...p,stateChanges:[{scope:'world',category:'tasks',key:'commission',operation:'set',value:{status:'done'}}]}),'BLUEPRINT_REQUIRED_VALUE']
])test('failed post-stat leaves durable aggregate untouched: '+label,async()=>{
 const f=await engineFixture('ship',{badPost:mutate}),before=await readFile(join(f.store.runDir(f.run.runId),'current.json'));
 await assert.rejects(f.engine.turn({runId:f.run.runId,requestId:'bad',input:'檢查。'}),error(code));
 assert.deepEqual(await readFile(join(f.store.runDir(f.run.runId),'current.json')),before);assert.equal((await f.store.readAttempts(f.run.runId)).at(-1).status,'failed');
});
test('ACL excludes private and known-event before document embeddings and ranking',async()=>{
 const captures=[],m=new Memory({embed:async({texts})=>{captures.push(...texts);return texts.map(()=>[1,0]);},dimensions:2}),source={runId:'r',turn:1,commitId:'c',bodyHash:'hash'};
 const rec=(id,kind,knowers,text)=>({id,text,version:1,schemaVersion:2,source,access:{kind},epistemic:{kind:'fact'},credibility:'confirmed',knowers,characterIds:knowers,visibility:kind==='world_public'?'public':'characters'});
 const records=[rec('public','world_public',[],'public lamp'),rec('private','private',['pilot'],'PRIVATE_EMBED_CANARY lamp')];
 await m.retrieve({query:'lamp',records,runId:'r',audience:'public'});assert(!captures.join().includes('PRIVATE_EMBED_CANARY'));
 captures.length=0;await m.retrieve({query:'lamp',records,runId:'r',audience:'owner',characterId:'medic'});assert(!captures.join().includes('PRIVATE_EMBED_CANARY'));
 captures.length=0;await m.retrieve({query:'lamp',records,runId:'r',audience:'owner',characterId:'pilot'});assert(captures.join().includes('PRIVATE_EMBED_CANARY'));
});
test('capability source hashes and evidence paths remain valid',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'skills/scean-native-authoring/capability-manifest.json'),'utf8'));
 for(const c of manifest.capabilities){const data=await readFile(join(root,'..',c.source.path));assert.equal(createHash('sha256').update(data).digest('hex'),c.source.sha256,c.id);assert(data.toString().includes(c.source.symbol),c.id);for(const t of c.tests)assert((await readFile(join(root,'..',t.path))).length>0,t.path);}
});
