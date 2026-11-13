// Real registry / controlled tool execution from the new Skill's original example.
// Synthetic data only; no inference, external network, or production Profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {nativeHost} from '../sources/card-studio/tests/helpers/portable-host.js';
import * as studioPlugin from '../packages/studio/index.js';
import {loadSkills,readSkill,bundledSkillsRoot,retiredSkillNames,nativeAuthoringSkillNames} from '../packages/studio/lib/workspace-setup.js';
import {toolSpecs} from '../packages/studio/lib/tool-definitions.js';
import {buildSavedSnapshot} from '../packages/studio/lib/scean-integration.js';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=path.resolve(import.meta.dirname,'..');

test('runtime catalog/read path excludes retired trees; original protected Skill bytes remain exact',async()=>{
 const skills=await loadSkills(bundledSkillsRoot,{includeAuthoring:true});assert.equal(skills.length,9);
 for(const name of nativeAuthoringSkillNames)assert(skills.some(s=>s.name===name&&s.resourceBase.path===path.join(bundledSkillsRoot,name)));
 for(const name of retiredSkillNames){assert(!skills.some(s=>s.name===name));await assert.rejects(fs.access(path.join(bundledSkillsRoot,name)),{code:'ENOENT'});await assert.rejects(readSkill(bundledSkillsRoot,{name,description:'retired'}),{code:'SKILL_RETIRED'});}
 const evidence=JSON.parse(await fs.readFile(path.join(root,'docs/native-skills-evidence/retirement-and-preservation.json'),'utf8'));
 for(const row of evidence.preservedFiles.filter(row=>!row.path.includes('/palette-personality-reconstruction/')))assert.equal(sha(await fs.readFile(path.join(root,row.path))),row.sha256,row.path);
 const sources=JSON.parse(await fs.readFile(path.join(bundledSkillsRoot,'sources.json'),'utf8'));
 for(const row of sources.filter(r=>retiredSkillNames.includes(r.skill))){assert.equal(row.status,'retired-from-runtime');assert.equal(row.history.commit,evidence.baselineCommit);assert.equal(evidence.retiredRuntimeFiles.find(f=>f.path===row.history.path)?.sha256,row.originalSha256,'Historical locator must identify the original hash, not an adapted wrapper.');}
});

test('retained legacy workspace cannot reactivate retired Skills; native replacements load without modifying local files',async()=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'native-skills-legacy-'));
 const catalog=JSON.parse(await fs.readFile(path.join(bundledSkillsRoot,'catalog.json'),'utf8'));
 await fs.cp(bundledSkillsRoot,directory,{recursive:true});
 const legacy=catalog.filter(r=>!nativeAuthoringSkillNames.includes(r.name));
 for(const name of retiredSkillNames){legacy.push({name,description:'Synthetic old catalog row'});await fs.mkdir(path.join(directory,name));await fs.writeFile(path.join(directory,name,'SKILL.md'),'Synthetic retired body must stay unread and unchanged.');}
 await fs.writeFile(path.join(directory,'catalog.json'),JSON.stringify(legacy));
 const before=await fs.readFile(path.join(directory,'catalog.json'));
 const loaded=await loadSkills(directory,{includeAuthoring:true,tolerantMethods:true});
 assert.equal(loaded.length,9);assert(!loaded.some(s=>retiredSkillNames.includes(s.name)));
 for(const name of nativeAuthoringSkillNames)assert.equal(loaded.find(s=>s.name===name).path,path.join(bundledSkillsRoot,name,'SKILL.md'));
 assert.deepEqual(await fs.readFile(path.join(directory,'catalog.json')),before);
 for(const name of retiredSkillNames)assert.equal(await fs.readFile(path.join(directory,name,'SKILL.md'),'utf8'),'Synthetic retired body must stay unread and unchanged.');
});

async function setup(t){
 const home=await fs.mkdtemp(path.join(tmpdir(),'native-skills-sdk-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const host=await nativeHost(home,studioPlugin),workspace=host.registry.list()[0].path,agent=host.agent('native-skills-author',workspace);agent.session.snapshotEvents=()=>[];
 const bridge=host.ctx.get('cardstudioSceanBridge');assert(bridge);
 const request=r=>bridge.request(agent,r,new AbortController().signal),acquired=await request({action:'acquire',page_id:'native-skills-human-001'});assert(acquired.ok,JSON.stringify(acquired));
 const claim=acquired.value;
 t.after(async()=>{await host.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;});
 const execute=async(name,args)=>{const tool=host.ctx.tools.get(name,agent);assert(tool,name);return tool.execute(args,{agent,signal:new AbortController().signal});};
 const ok=async(name,args)=>{const r=await execute(name,args);assert(r.ok,JSON.stringify(r));return r.value;};
 return {home,host,workspace,agent,bridge,claim,request,execute,ok};
}

test('official SDK discovery, human method exclusivity, read lock, Session isolation and protected opening remain intact',async t=>{
 const s=await setup(t),names=async()=> (await s.host.ctx.skills.list({cwd:s.workspace,scope:s.agent})).map(r=>r.name),modern='character-authoring',palette='palette-personality-reconstruction';
 assert.equal(s.claim.character_method.name,modern);assert((await names()).includes(modern));assert(!(await names()).includes(palette));assert.equal((await names()).length,9);
 const choose=async name=>{const current=await s.request({action:'capabilities',claim:s.claim});return s.bridge.setCharacterMethod(s.agent,{claim:s.claim,name,expected_epoch:current.value.character_method.epoch},new AbortController().signal);};
 assert.equal((await choose(palette)).error.code,'CHARACTER_METHOD_CHANGED');assert(!(await names()).includes(palette));assert((await names()).includes(modern));
 for(const name of retiredSkillNames)assert.equal(await s.host.ctx.skills.get(name,{cwd:s.workspace,scope:s.agent}),undefined);
 assert((await choose(modern)).ok);const definition=await s.host.ctx.skills.get(modern,{cwd:s.workspace,scope:s.agent});assert(definition.content.length>100);
 assert.equal((await choose(palette)).error.code,'CHARACTER_METHOD_CHANGED');
 const other=s.host.agent('native-skills-other',s.workspace);other.session.snapshotEvents=()=>[];const acquired=await s.bridge.request(other,{action:'acquire',page_id:'native-skills-human-002'},new AbortController().signal);assert.equal(acquired.value.character_method.name,modern);assert.equal(acquired.value.character_method.locked,false);
 for(const name of nativeAuthoringSkillNames)assert(await s.host.ctx.skills.get(name,{cwd:s.workspace,scope:s.agent}));
 assert.equal(await s.host.ctx.skills.get('opening-narrative-crafter',{cwd:s.workspace,scope:s.agent}),undefined);
 assert(!toolSpecs.some(([name])=>/method|scope.*set/i.test(name)));
 const denied=await s.request({action:'set_character_method',claim:s.claim,args:{name:palette}});assert.equal(denied.ok,false);
 const status=JSON.parse(await fs.readFile(path.join(s.workspace,'.cardstudio-scean/runtime-status.json'),'utf8'));assert.equal(status.skillCount,9);assert.equal(status.storedSkillCount,9);
});

test('new Skill example executes registered frontend read/validate/preview/save/readback/patch with refusal and fixed Snapshot',async t=>{
 const s=await setup(t),text=await fs.readFile(path.join(bundledSkillsRoot,'scean-frontend-authoring/references/synthetic-acceptance.md'),'utf8');
 const blocks=[...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1]));assert.equal(blocks.length,4);
 const [blueprint,initial_state,derived_facts,frontend]=blocks,candidate={blueprint,initial_state,derived_facts,frontend};
 const card=structuredClone(w01Fixture().card);for(const name of ['stateBlueprint','initialState','frontend','derivedFacts'])delete card.data.extensions.scean[name];card.data.extensions.syntheticPreserved={label:'independent-unknown-metadata'};
 await fs.writeFile(path.join(s.workspace,'imports/notebook.json'),JSON.stringify(card));const imported=await s.request({action:'import',claim:s.claim,args:{path:'imports/notebook.json',type:'card'}});assert(imported.ok,JSON.stringify(imported));const id=imported.value.id;
 const call=async(action,extra={})=>s.execute('cardstudio_scean_frontend',{action,document_id:id,...extra});
 const ok=async(action,extra={})=>{const r=await call(action,extra);assert(r.ok,JSON.stringify(r));return r.value;};
 const read=()=>s.ok('card_read',{document_id:id});assert.equal((await ok('dynamic_read')).frontend,null);
 assert.equal((await ok('dynamic_validate',candidate)).valid,true);
 const preview=await ok('dynamic_preview',candidate);assert.equal(preview.source,'authoring-initial-state-not-runtime');assert.equal(preview.projection.values.charge.value,62);assert.equal(preview.projection.values.sky.value,'clear');assert.equal(preview.projection.values.measurementReady.value,true);assert(preview.html.includes('scean-true'));assert(!JSON.stringify(preview).includes('PRIVATE_'));
 const cases=[
  ['missing binding','FRONTEND_BINDING_MISSING',c=>c.frontend.bindings[0].target.key='absent'],
  ['restricted binding','FRONTEND_BINDING_UNAUTHORIZED',c=>c.frontend.bindings.push({alias:'private',target:{scope:'world',category:'facts',key:'privateNote'},type:'string'})],
  ['wrong binding type','FRONTEND_BINDING_TYPE',c=>c.frontend.bindings[0].type='string'],
  ['wrong initial type','BLUEPRINT_VALUE_RANGE',c=>c.initial_state.values[0].value='62'],
  ['wrong AST type','FRONTEND_EXPRESSION_TYPE',c=>c.frontend.conditions.lowCharge={op:'not',args:[{ref:'charge'}]}],
  ['missing fact','FRONTEND_DERIVED_MISSING',c=>c.frontend.derivedBindings[0].factId='absent'],
  ['restricted fact','DERIVED_BINDING_UNAUTHORIZED',c=>c.derived_facts.bindings.push({alias:'private',target:{scope:'world',category:'facts',key:'privateNote'},type:'string'})],
  ['card script','FRONTEND_HTML_UNSUPPORTED',c=>c.frontend.html+='<script>1</script>'],
  ['event attribute','FRONTEND_ATTRIBUTE_UNSUPPORTED',c=>c.frontend.html='<p onclick="1">test</p>'],
  ['unsupported CSS','FRONTEND_CSS_UNSUPPORTED',c=>c.frontend.css='.notebook{position:fixed}'],
  ['world action','FRONTEND_CAPABILITY_UNSUPPORTED',c=>c.frontend.capabilities.worldActions=['set']]
 ];
 for(const [label,code,mutate] of cases){const value=structuredClone(candidate);mutate(value);const result=await call('dynamic_validate',value);assert.equal(result.ok,false,label);assert.equal(result.error.code,code,label);}
 assert.equal((await read()).revision,0);
 const missing=structuredClone(candidate);missing.initial_state.values.shift();assert.equal((await ok('dynamic_preview',missing)).projection.values.measurementReady.status,'unknown');
 const zero=structuredClone(candidate);zero.initial_state.values[0].value=0;const low=await ok('dynamic_preview',zero);assert.equal(low.projection.values.charge.value,0);assert.equal(low.projection.values.measurementReady.value,false);
 const cloudy=structuredClone(candidate);cloudy.initial_state.values[1].value='cloudy';assert.equal((await ok('dynamic_preview',cloudy)).projection.values.measurementReady.value,false);
 const scope=await s.bridge.setAuthoringScope(s.agent,{claim:s.claim,mode:'content',expected_epoch:0},new AbortController().signal);assert(scope.ok);assert.equal((await call('dynamic_save',{...candidate,expected_revision:0})).error.code,'AUTHORING_SCOPE');
 assert((await s.bridge.setAuthoringScope(s.agent,{claim:s.claim,mode:'full',expected_epoch:scope.value.authoring_scope.epoch},new AbortController().signal)).ok);
 assert.equal((await ok('dynamic_save',{...candidate,expected_revision:0})).revision,1);const saved=await read(),current=await ok('dynamic_read');assert.equal(saved.revision,1);assert.deepEqual(saved.card.data.extensions.syntheticPreserved,card.data.extensions.syntheticPreserved);assert.equal(saved.card.data.first_mes,card.data.first_mes);assert.deepEqual(saved.card.data.extensions.scean.characters,card.data.extensions.scean.characters);assert.equal((await ok('dynamic_preview')).html,preview.html);
 const changed=structuredClone(current.derivedFacts);changed.facts[0].description+=' changed';assert.equal((await call('dynamic_validate',{derived_facts:changed})).error.code,'DERIVED_HASH_MISMATCH');delete changed.hash;assert.equal((await ok('dynamic_validate',{derived_facts:changed})).valid,true);
 const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:new DurableStore({root:path.join(s.home,'synthetic-runs')}),model:{async generate(){assert.fail('NO_MODEL');}},memory:{async retrieve(){return {records:[]};}}}),run=await engine.createRun({snapshot:buildSavedSnapshot(saved)});
 const patch={expected_revision:1,expected_source_hash:current.frontend.hash,field:'html',old_text:'觀測手帳',new_text:'觀測手帳・修訂'};assert.equal((await ok('dynamic_patch',patch)).revision,2);
 assert.equal((await call('dynamic_patch',patch)).error.code,'REVISION_CONFLICT');assert.equal((await call('dynamic_patch',{...patch,expected_revision:2})).error.code,'FRONTEND_SOURCE_CONFLICT');
 const latest=await ok('dynamic_read');assert.notEqual(latest.frontend.hash,current.frontend.hash);assert.equal((await read()).revision,2);assert.equal((await engine.store.read(run.runId)).snapshot.frontend.hash,current.frontend.hash);
 assert.equal((await call('dynamic_patch',{...patch,expected_revision:2,expected_source_hash:latest.frontend.hash,old_text:'ABSENT'})).error.code,'FRONTEND_PATCH');assert.equal((await read()).revision,2);
});
