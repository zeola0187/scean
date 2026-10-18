// Real shipped SDK + actual Card Studio apply/loader/tools; synthetic Agent identity.
// No LLM service, provider, credential or production workspace is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Commands from '@deepseek-ai/dsh-commands';
import Typert from '@deepseek-ai/dsh-typert-registry';
import {createScope} from '@deepseek-ai/dsh-scope';
import * as plugin from '../.integration/cardstudio/index.js';
import {loadSkills} from '../.integration/cardstudio/lib/workspace-setup.js';
import {SceanHost} from '../../plugin/host.mjs';
import {SceanEngine} from '../../core/engine.mjs';
import {DurableStore} from '../../adapters/store.mjs';
import {Memory} from '../../core/memory.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),skill='scean-native-authoring';
globalThis.fetch=async()=>assert.fail('Network forbidden in zero-paid acceptance');
async function fixture(t){
 await mkdir(join(root,'evidence','studio-sessions'),{recursive:true});const dir=await mkdtemp(join(root,'evidence','studio-sessions','native-'));
 await mkdir(join(dir,'.cardstudio-scean'),{recursive:true});await writeFile(join(dir,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Synthetic native authoring'}));
 await cp(join(root,'.integration/cardstudio/skills'),join(dir,'.cardstudio-scean/skills'),{recursive:true});
 const ctx=new Context(),agents=new Map(),events=[];ctx.provide('workspaceRegistry',{archivedSessionIds:new Set()});await ctx.plugin(Typert);await ctx.plugin(SystemPrompt);await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(Skills);ctx.provide('agents',{get:id=>agents.get(id)});await ctx.plugin(Commands);
 const make=(id,cwd)=>({id,status:'idle',session:{header:{cwd},snapshotEvents:()=>[],append:(type,data)=>{events.push(type);return events.length;}},cancel(){},async whenIdle(){},prompt(){assert.fail('No actual model invocation authorized');}});
 const a=make('synthetic-native-agent',dir),other=make('synthetic-other',root);for(const x of [a,other]){x.ctx=createScope(ctx,x).ctx;agents.set(x.id,x);}
 const store=new DurableStore({root:join(dir,'scean-store')}),host=await new SceanHost({engine:new SceanEngine({store,model:{generate(){assert.fail('No RP model authorized for Studio handoff');}},memory:new Memory()}),root:join(dir,'scean-host')}).init();
 ctx.provide('scean',{startFromStudio:r=>host.startFromStudio(r),inspectFromStudio:r=>host.inspectFromStudio(r),attachInspection:r=>host.attachInspection(r)});
 const fiber=ctx.plugin(plugin,{projectRoot:dir});await fiber;
 t.after(async()=>{await fiber.dispose();await ctx.fiber.dispose();host.close();});
 const invoke=async request=>JSON.parse((await ctx.commands.execute(a,'/cardstudio-scean '+JSON.stringify(request),[],new AbortController().signal)).result.text);
 return {ctx,a,other,invoke,dir,host,store,bridge:ctx.get('cardstudioSceanBridge')};
}
test('actual SDK discovers and loads full skill only inside acquired Card Studio Session',async t=>{
 const f=await fixture(t);assert.equal((await f.ctx.skills.list({cwd:f.dir,scope:f.a})).length,0);
 const acquired=await f.invoke({action:'acquire',page_id:'native-authoring-page-001'});assert(acquired.ok,JSON.stringify(acquired));
 const catalog=await f.ctx.skills.list({cwd:f.dir,scope:f.a});assert(catalog.some(x=>x.name===skill));assert(!catalog.some(x=>x.name==='palette-personality-reconstruction'));assert(catalog.some(x=>x.name==='character-authoring'));
 const loaded=await f.ctx.skills.get(skill,{cwd:f.dir,scope:f.a});assert(loaded.content.includes('原意 → 原生責任'));assert.equal(loaded.resourceBase.path,join(f.dir,'.cardstudio-scean/skills',skill));
 const caps=await f.invoke({action:'capabilities',claim:acquired.value});assert(caps.ok);assert(caps.value.skills.some(x=>x.name===skill));
 assert(!(await f.ctx.skills.list({cwd:root,scope:f.other})).some(x=>x.name===skill));
 const schemas=f.ctx.tools.schemas(f.a);assert(schemas.some(x=>x.name==='card_patch_fields'));assert(!schemas.some(x=>/scean.*(?:start|handoff)/.test(x.name)));
 await f.invoke({action:'release',claim:acquired.value});assert(!(await f.ctx.skills.list({cwd:f.dir,scope:f.a})).some(x=>x.name===skill));
 await writeFile(join(f.dir,'discovery-summary.json'),JSON.stringify({layer:'L2 actual SDK synthetic Agent identity',listed:true,bodyLoaded:true,resourceBase:true,methodUnchanged:true,releaseRevoked:true,trueModelCalls:0},null,2));
});
test('catalog is required; an unlisted SKILL.md is not discovered',async()=>{
 await mkdir(join(root,'evidence/studio-sessions'),{recursive:true});const dir=await mkdtemp(join(root,'evidence/studio-sessions','unlisted-'));await cp(join(root,'skills',skill),join(dir,skill),{recursive:true});await writeFile(join(dir,'catalog.json'),'[]');assert.equal((await loadSkills(dir)).length,0);
});
for(const kind of ['ship','market'])test(kind+' Agent tool saves native extension, human bridge freezes revisions, old Run bytes unchanged',async t=>{
 const f=await fixture(t),acq=await f.invoke({action:'acquire',page_id:'native-authoring-page-002'});assert(acq.ok,JSON.stringify(acq));const claim=acq.value;
 const card=JSON.parse(await readFile(join(root,'fixtures',kind+'.native.json'),'utf8'));
 const execute=async(name,args)=>{const tool=f.ctx.tools.get(name,f.a);assert(tool,name);return tool.execute(args,{agent:f.a,signal:new AbortController().signal});};
 const {extensions,character_book,...narrative}=card.data;const created=await execute('cardstudio_scean_create',narrative);assert(created.ok,JSON.stringify(created));const id=created.value.id;
 const opened=await f.invoke({action:'open',claim,args:{document_id:id}});assert(opened.ok,JSON.stringify(opened));
 const book=await execute('lorebook_upsert_entry',{document_id:id,expected_revision:created.value.revision,entry:character_book.entries[0]});assert(book.ok,JSON.stringify(book));
 const saved=await execute('card_patch_fields',{document_id:id,expected_revision:book.value.revision,patches:[{op:'add',path:'/data/extensions/scean',value:card.data.extensions.scean}]});assert(saved.ok,JSON.stringify(saved));
 const read=await execute('card_read',{document_id:id});assert(read.ok);assert.equal(read.value.revision,saved.value.revision);assert.deepEqual(read.value.card.data.extensions.scean,card.data.extensions.scean);
 const start={mode:'start',claim,document_id:id,expected_revision:read.value.revision,preset:{id:'synthetic',revision:1,instructions:'合成驗收'}};
 const handed=await f.bridge.sceanControl(f.a,start);assert(handed.ok,JSON.stringify(handed));const rid=handed.value.runId;
 const stored=await f.store.read(rid);assert.equal(stored.snapshot.revision,read.value.revision);assert.equal(stored.snapshot.stateBlueprint.id,kind+'-blueprint');assert.equal(stored.state.world.facts.lantern,false);assert.equal(stored.snapshot.worldbook.entries[0].content,character_book.entries[0].content);assert.equal(stored.snapshot.card.data.system_prompt,card.data.system_prompt);
 const oldBytes=await readFile(join(f.store.runDir(rid),'current.json'));
 const next=structuredClone(card.data.extensions.scean);next.stateBlueprint.version=2;next.initialState.blueprintVersion=2;next.initialState.values[0].value=3;
 const second=await execute('card_patch_fields',{document_id:id,expected_revision:read.value.revision,patches:[{op:'replace',path:'/data/extensions/scean',value:next}]});assert(second.ok,JSON.stringify(second));
 const stale=await f.bridge.sceanControl(f.a,start);assert.equal(stale.error.code,'SCEAN_REVISION');
 const newRun=await f.bridge.sceanControl(f.a,{...start,expected_revision:second.value.revision});assert(newRun.ok,JSON.stringify(newRun));assert.notEqual(newRun.value.runId,rid);assert.deepEqual(await readFile(join(f.store.runDir(rid),'current.json')),oldBytes);
 const fresh=await new DurableStore({root:join(f.dir,'scean-store')}).read(newRun.value.runId);assert.equal(fresh.snapshot.stateBlueprint.version,2);assert.equal(fresh.state.world.resources[kind==='ship'?'fuel':'coins'],3);
 // Human UI scope transition is tested through its actual bridge, never by Agent tools.
 const scope=await f.bridge.setAuthoringScope(f.a,{claim,mode:'content',expected_epoch:claim.authoring_scope.epoch});assert(scope.ok,JSON.stringify(scope));
 const denied=await execute('card_patch_fields',{document_id:id,expected_revision:second.value.revision,patches:[{op:'replace',path:'/data/extensions/scean',value:next}]});assert.equal(denied.error.code,'AUTHORING_SCOPE');
 const forged=await f.bridge.sceanControl(f.a,{...start,claim:{...claim,lease_id:'forged'}});assert.equal(forged.error.code,'STALE_LEASE');
 await writeFile(join(f.dir,'native-save-summary.json'),JSON.stringify({layer:'L2 actual Agent tools + real Studio human bridge + durable store',kind,firstRevision:read.value.revision,newRevision:second.value.revision,oldRunUnchanged:true,snapshotLocked:true,scopeDenied:true,paidCalls:0},null,2));
});

test('v1 actual discovered binding tool saves reviewed sources, detects drift and preserves old Run through new revision',async t=>{
 const f=await fixture(t),acq=await f.invoke({action:'acquire',page_id:'workspace-v1-page-003'});assert(acq.ok,JSON.stringify(acq));const claim=acq.value;
 const execute=async(name,args)=>{const tool=f.ctx.tools.get(name,f.a);assert(tool,name);return tool.execute(args,{agent:f.a,signal:new AbortController().signal});};
 const created=await execute('cardstudio_scean_create',{name:'Synthetic solo',first_mes:'Synthetic saved lamp opening.',description:'SOLO_INITIAL: a quiet lamp keeper.'});assert(created.ok,JSON.stringify(created));const id=created.value.id;
 assert((await f.invoke({action:'open',claim,args:{document_id:id}})).ok);
 const bind=async(revision,description)=>execute('card_bind_scean_character',{document_id:id,expected_revision:revision,character:{id:'keeper',name:'Keeper',description},sources:[{kind:'card_field',path:'/data/description'}]});
 const bound=await bind(created.value.revision,'SOLO_INITIAL: a quiet lamp keeper.');assert(bound.ok,JSON.stringify(bound));
 const read=await execute('card_read',{document_id:id});assert.match(read.value.card.data.extensions.scean.characters[0].sourceBindings.sources[0].sha256,/^[a-f0-9]{64}$/);
 const request={mode:'start',claim,document_id:id,expected_revision:read.value.revision};const started=await f.bridge.sceanControl(f.a,request);assert(started.ok,JSON.stringify(started));
 const runId=started.value.runId;const old=await readFile(join(f.store.runDir(runId),'current.json'));
 const changed=await execute('card_patch_fields',{document_id:id,expected_revision:read.value.revision,patches:[{op:'replace',path:'/data/description',value:'SOLO_REVISED: a retired lamp keeper.'}]});assert(changed.ok,JSON.stringify(changed));
 const drift=await f.bridge.sceanControl(f.a,{...request,expected_revision:changed.value.revision});assert.equal(drift.error.code,'CHARACTER_SOURCE_DRIFT');
 const corrected=await bind(changed.value.revision,'SOLO_REVISED: a retired lamp keeper.');assert(corrected.ok,JSON.stringify(corrected));
 const next=await f.bridge.sceanControl(f.a,{...request,expected_revision:corrected.value.revision});assert(next.ok,JSON.stringify(next));assert.equal((await f.store.read(next.value.runId)).snapshot.characters[0].description,'SOLO_REVISED: a retired lamp keeper.');assert.deepEqual(await readFile(join(f.store.runDir(runId),'current.json')),old);
 const scope=await f.bridge.setAuthoringScope(f.a,{claim,mode:'content',expected_epoch:claim.authoring_scope.epoch});assert(scope.ok,JSON.stringify(scope));
 const denied=await bind(corrected.value.revision,'SOLO_REVISED: a retired lamp keeper.');assert.equal(denied.error.code,'AUTHORING_SCOPE');
});
