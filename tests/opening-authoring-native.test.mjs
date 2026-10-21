// Real DSH Skill/Tool registry and Studio/Host/Core/Store, synthetic input only.
// This proves program behavior, not LLM compliance with narrative instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {nativeHost} from '../sources/card-studio/tests/helpers/portable-host.js';
import * as studio from '../packages/studio/index.js';
import {loadSkills,bundledSkillsRoot,readSkill} from '../packages/studio/lib/workspace-setup.js';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
const skill='scean-opening-authoring';
async function setup(t,{rich=false}={}){
 const home=await fs.mkdtemp(path.join(tmpdir(),'opening-authoring-native-')),prior=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const store=new DurableStore({root:path.join(home,'runs')});let modelCalls=0;
 const runtime=await new SceanHost({root:path.join(home,'host'),engine:new SceanEngine({unconfiguredWritingMode:'current',store,memory:new Memory(),model:{generate(){modelCalls++;throw Error('MODEL_FORBIDDEN');}}})}).init();
 const h=await nativeHost(home,{name:'opening-authoring-native-fixture',async apply(ctx){ctx.provide('scean',runtime);await ctx.plugin(studio);}});
 const workspace=h.registry.list()[0].path,agent=h.agent('opening-author-session',workspace);agent.session.snapshotEvents=()=>[];
 const bridge=h.ctx.get('cardstudioSceanBridge');
 const request=r=>bridge.request(agent,r,new AbortController().signal);
 const acquired=await request({action:'acquire',page_id:'opening-authoring-native-page'});assert(acquired.ok,JSON.stringify(acquired));const claim=acquired.value;
 const execute=async(name,args)=>{const definition=h.ctx.tools.get(name,agent);assert(definition,name);return definition.execute(args,{agent,signal:new AbortController().signal});};
 const ok=async(name,args)=>{const value=await execute(name,args);assert(value.ok,JSON.stringify(value));return value.value;};
 const card=structuredClone(w01Fixture('fantasy').card);card.data.first_mes=rich?'SYNTHETIC ORIGINAL {{user}} <em>DAYLIGHT</em>.':'SYNTHETIC ORIGINAL {{user}} DAYLIGHT.';card.data.alternate_greetings=['SYNTHETIC ALT ONE {{char}}.',rich?'SYNTHETIC ALT TWO <b>UNCHANGED</b>.':'SYNTHETIC ALT TWO UNCHANGED.'];card.data.extensions.unknownMetadata={revisionNote:'synthetic preserved',nested:[false,0,'{{user}}']};card.data.creator_notes='SYNTHETIC AUTHOR NOTE';card.data.system_prompt='SYNTHETIC KEEP SYSTEM';card.data.post_history_instructions='SYNTHETIC KEEP PHI';
 await fs.writeFile(path.join(workspace,'imports/opening-synthetic.json'),JSON.stringify(card));
 const imported=await ok('cardstudio_scean_import',{path:'imports/opening-synthetic.json',type:'card'});const id=imported.id;
 assert((await request({action:'open',claim,args:{document_id:id}})).ok);
 const read=()=>ok('card_read',{document_id:id});
 const setScope=async mode=>{const caps=await request({action:'capabilities',claim});assert(caps.ok);const result=await bridge.setAuthoringScope(agent,{claim,mode,expected_epoch:caps.value.authoring_scope.epoch},new AbortController().signal);assert(result.ok,JSON.stringify(result));};
 const scoped=async(action,payload={})=>runtime.request({...payload,action,sessionId:agent.id,cardScope:await bridge.resolveSceanScope(agent.id)},undefined,{requireCardScope:true,resolveCardScope:id=>bridge.resolveSceanScope(id),principal:'synthetic-opening-operator',allowPrivateDiagnostics:false,allowPrivateSaves:false});
 t.after(async()=>{await h.close();await runtime.close();if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;assert.equal(modelCalls,0);});
 return {h,home,workspace,agent,bridge,claim,id,card,store,runtime,request,execute,ok,read,setScope,scoped};
}

test('new user opening Skill is catalogued, readable and scoped by the actual native SDK',async t=>{
 const f=await setup(t);const listed=await f.h.ctx.skills.list({cwd:f.workspace,scope:f.agent});assert.equal(listed.filter(x=>x.name===skill).length,1);assert.equal(listed.length,9);
 const definition=await f.h.ctx.skills.get(skill,{cwd:f.workspace,scope:f.agent});assert(definition);assert.equal(definition.resourceBase.path,path.join(bundledSkillsRoot,skill));
 for(const rel of ['references/creative-guide.md','references/authoring-workflow.md','references/studio-contract.md'])assert((await fs.readFile(path.join(definition.resourceBase.path,rel),'utf8')).length>100);
 const other=f.h.agent('outside-opening-session',f.home);assert.equal(await f.h.ctx.skills.get(skill,{cwd:f.home,scope:other}),undefined);
 const names=f.h.ctx.tools.schemas(f.agent).map(x=>x.name);for(const name of ['card_read','card_patch_text','card_patch_fields','lorebook_upsert_entry','cardstudio_scean_document'])assert(names.includes(name));
 assert(!names.some(name=>/opening.*(?:approve|title)|author_confirmed/.test(name)));
 await f.request({action:'release',claim:f.claim});assert.equal(await f.h.ctx.skills.get(skill,{cwd:f.workspace,scope:f.agent}),undefined);
});

test('draft stays in memory; confirmed literal update preserves macros, alternatives, unknown data and initial state',async t=>{
 const f=await setup(t,{rich:true});await f.setScope('content');const before=await f.read();
 const draft={text:'SYNTHETIC confirmed noon prose.',authorReviewed:false};assert.equal((await f.read()).revision,before.revision);
 // This is explicit synthetic author confirmation in the test driver; there
 // is no invented confirmation parameter or semantic Host approval gate.
 draft.authorReviewed=true;assert(draft.authorReviewed);
 const protectedRich=await f.execute('card_patch_text',{document_id:f.id,expected_revision:before.revision,field:'first_mes',old_text:'DAYLIGHT',new_text:'NOON'});assert.equal(protectedRich.ok,false);assert.equal(protectedRich.error.code,'AUTHORING_SCOPE');assert.equal((await f.read()).revision,before.revision);
 await f.setScope('full');
 const saved=await f.ok('card_patch_text',{document_id:f.id,expected_revision:before.revision,field:'first_mes',old_text:'DAYLIGHT',new_text:'NOON'});
 const after=await f.read();assert.equal(after.revision,saved.revision);assert.equal(after.card.data.first_mes,'SYNTHETIC ORIGINAL {{user}} <em>NOON</em>.');
 const expected=structuredClone(before.card);expected.data.first_mes=after.card.data.first_mes;assert.deepEqual(after.card,expected);
 const stale=await f.execute('card_patch_text',{document_id:f.id,expected_revision:before.revision,field:'first_mes',old_text:'NOON',new_text:'STALE'});assert.equal(stale.ok,false);assert.equal((await f.read()).revision,after.revision);
 const ambiguous=await f.execute('card_patch_text',{document_id:f.id,expected_revision:after.revision,field:'first_mes',old_text:'',new_text:'NOT SAVED'});assert.equal(ambiguous.ok,false);assert.equal((await f.read()).revision,after.revision);
 const diff=await f.ok('cardstudio_scean_document',{action:'diff',document_id:f.id,from:before.revision,to:after.revision});assert(JSON.stringify(diff).includes('first_mes'));
});

test('empty opening and one alternate use local patches without changing another alternate or introducing metadata',async t=>{
 const f=await setup(t);await f.setScope('content');let current=await f.read();
 await f.ok('card_patch_fields',{document_id:f.id,expected_revision:current.revision,patches:[{op:'replace',path:'/data/first_mes',value:''}]});current=await f.read();
 await f.ok('card_patch_fields',{document_id:f.id,expected_revision:current.revision,patches:[{op:'test',path:'/data/first_mes',value:''},{op:'replace',path:'/data/first_mes',value:'SYNTHETIC NEW MAIN {{user}}.'}]});current=await f.read();const beforeAlt=structuredClone(current.card);
 await f.ok('card_patch_fields',{document_id:f.id,expected_revision:current.revision,patches:[{op:'test',path:'/data/alternate_greetings/0',value:current.card.data.alternate_greetings[0]},{op:'replace',path:'/data/alternate_greetings/0',value:'SYNTHETIC REVISED ALT {{char}}.'}]});current=await f.read();
 const expected=structuredClone(beforeAlt);expected.data.alternate_greetings[0]=current.card.data.alternate_greetings[0];assert.deepEqual(current.card,expected);
 const existing=[...current.card.data.alternate_greetings];await f.ok('card_patch_fields',{document_id:f.id,expected_revision:current.revision,patches:[{op:'replace',path:'/data/alternate_greetings',value:[...existing,'SYNTHETIC EXPLICITLY REQUESTED THIRD ALT.']}]});const after=await f.read();assert.deepEqual(after.card.data.alternate_greetings.slice(0,2),existing);
 assert.deepEqual(after.card.data.extensions,beforeAlt.data.extensions);assert.deepEqual(Object.keys(after.card.data).sort(),Object.keys(beforeAlt.data).sort());
});

test('shared history writes respect human scope; partial multi-step save is observable and can be repaired lawfully',async t=>{
 const f=await setup(t);await f.setScope('content');const before=await f.read();
 const opening=await f.ok('card_patch_text',{document_id:f.id,expected_revision:before.revision,field:'first_mes',old_text:'DAYLIGHT',new_text:'MORNING'});
 const entry={keys:['synthetic shared history'],secondary_keys:[],content:'SYNTHETIC prior shared history, approved with the opening; not an alternate-only event.',enabled:true,insertion_order:10,case_sensitive:false,constant:false,selective:false,position:'before_char'};
 const denied=await f.execute('lorebook_upsert_entry',{document_id:f.id,expected_revision:opening.revision,entry});assert.equal(denied.ok,false);assert.equal(denied.error.code,'AUTHORING_SCOPE');const partial=await f.read();assert.equal(partial.revision,opening.revision);assert(partial.card.data.first_mes.includes('MORNING'));assert.deepEqual(partial.card.data.character_book,before.card.data.character_book);
 await f.setScope('full');const history=await f.ok('lorebook_upsert_entry',{document_id:f.id,expected_revision:partial.revision,entry});assert(history.entry_id);
 const readEntry=await f.ok('lorebook_read_entry',{document_id:f.id,entry_id:history.entry_id});assert(JSON.stringify(readEntry).includes(entry.content));
 const after=await f.read();assert.deepEqual(after.card.data.extensions.scean.stateBlueprint,before.card.data.extensions.scean.stateBlueprint);assert.deepEqual(after.card.data.extensions.scean.initialState,before.card.data.extensions.scean.initialState);assert.deepEqual(after.card.data.alternate_greetings,before.card.data.alternate_greetings);assert.equal(after.card.data.system_prompt,before.card.data.system_prompt);assert.equal(after.card.data.post_history_instructions,before.card.data.post_history_instructions);
 // Rollback is revision guarded and used here only because all intervening
 // synthetic revisions belong to this fixture. The real workflow must check it.
 await f.ok('cardstudio_scean_document',{action:'rollback',document_id:f.id,expected_revision:after.revision,to:before.revision});assert.deepEqual((await f.read()).card,before.card);
});

test('saved authoring hands off to current opening selection with shared InitialState and immutable prior Run',async t=>{
 const f=await setup(t);await f.setScope('content');let saved=await f.read();
 await f.ok('card_patch_text',{document_id:f.id,expected_revision:saved.revision,field:'first_mes',old_text:'DAYLIGHT',new_text:'APPROVED'});saved=await f.read();
 const handed=await f.bridge.sceanControl(f.agent,{mode:'start',claim:f.claim,document_id:f.id,expected_revision:saved.revision});assert(handed.ok,JSON.stringify(handed));assert.equal(handed.value.openingRequired,true);assert.equal((await f.store.listRuns()).length,0);
 let response=await f.scoped('openingOffer');assert(response.ok,JSON.stringify(response));let offer=response.value;assert.deepEqual(offer.options.map(x=>x.index),[0,1,2]);
 const payload={offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash};
 response=await f.scoped('openingStart',{...payload,openingIndex:1,playerName:'Synthetic player'});assert(response.ok,JSON.stringify(response));const first=await f.store.read(response.value.runId);assert.equal(first.snapshot.opening.text,saved.card.data.alternate_greetings[0]);assert.equal(first.snapshot.revision,saved.revision);const old=structuredClone(first);
 const again=await f.scoped('openingPrepare',{runId:first.runId});assert(again.ok,JSON.stringify(again));response=await f.scoped('openingOffer');offer=response.value;
 response=await f.scoped('openingStart',{offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash,openingIndex:0,playerName:'Synthetic player'});assert(response.ok,JSON.stringify(response));const main=await f.store.read(response.value.runId);assert.equal(main.snapshot.opening.text,saved.card.data.first_mes);assert.deepEqual(main.snapshot.initialState,first.snapshot.initialState);assert.deepEqual(main.snapshot.stateBlueprint,first.snapshot.stateBlueprint);assert.deepEqual(main.state,first.state);
 await f.ok('card_patch_fields',{document_id:f.id,expected_revision:saved.revision,patches:[{op:'replace',path:'/data/alternate_greetings/0',value:'SYNTHETIC LATER EDIT'}]});assert.deepEqual(await f.store.read(first.runId),old);
});

test('old catalogs receive the new native opening guidance without reviving old opening or Palette bodies',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'opening-authoring-legacy-'));
 await fs.writeFile(path.join(dir,'catalog.json'),JSON.stringify([{name:'opening-narrative-crafter',description:'Synthetic obsolete row'},{name:'palette-personality-reconstruction',description:'Synthetic removed row'}]));
 const before=await fs.readFile(path.join(dir,'catalog.json'));const loaded=await loadSkills(dir,{includeAuthoring:true,tolerantMethods:true});assert(loaded.some(x=>x.name===skill));assert(!loaded.some(x=>['opening-narrative-crafter','palette-personality-reconstruction'].includes(x.name)));assert.deepEqual(await fs.readFile(path.join(dir,'catalog.json')),before);
 await assert.rejects(readSkill(dir,{name:'opening-narrative-crafter'}),{code:'SKILL_WITHHELD'});
});
