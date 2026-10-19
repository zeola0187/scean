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
import * as plugin from '../../sources/card-studio/cardstudio-bundle/index.js';
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
 ctx.provide('scean',{startFromStudio:r=>host.startFromStudio({...r,playerName:'Synthetic player'}),inspectFromStudio:r=>host.inspectFromStudio(r),attachInspection:r=>host.attachInspection(r),listDiagnosticRuns:r=>host.agentDiagnostics.list(r),grantAgentDiagnosis:r=>host.agentDiagnostics.issue(r),readAgentDiagnosis:r=>host.agentDiagnostics.read(r),revokeAgentDiagnosis:r=>host.agentDiagnostics.revoke(r)});
 const fiber=ctx.plugin(plugin,{projectRoot:dir});await fiber;
 t.after(async()=>{await fiber.dispose();await ctx.fiber.dispose();host.close();});
 const invoke=async request=>JSON.parse((await ctx.commands.execute(a,'/cardstudio-scean '+JSON.stringify(request),[],new AbortController().signal)).result.text);
 return {ctx,a,other,invoke,dir,host,store,bridge:ctx.get('cardstudioSceanBridge')};
}

test('W02 actual SDK registers scoped diagnostic tool, preserves natural-language repair context and requires human consent before existing patch tool',async t=>{
 const f=await fixture(t),acquired=await f.invoke({action:'acquire',page_id:'w02-sdk-page-0001'});assert(acquired.ok);const claim=acquired.value;
 const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'SDK synthetic',description:'Independent.',personality:'Kind.',scenario:'Test.',first_mes:'Hello.',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],group_only_greetings:[],tags:[],creator:'QA',character_version:'1',extensions:{scean:{characters:[{id:'actor',name:'Actor',description:'Independent.'}]}},character_book:{entries:[]}}};
 await writeFile(join(f.dir,'imports','sdk-card.json'),JSON.stringify(card));
 const imported=await f.invoke({action:'import',claim,args:{path:'imports/sdk-card.json',type:'card'}});assert(imported.ok,JSON.stringify(imported));const id=imported.value.id;
 const execute=async(name,args)=>{const tool=f.ctx.tools.get(name,f.a);assert(tool,name);return tool.execute(args,{agent:f.a,signal:new AbortController().signal});};
 assert(f.ctx.tools.schemas(f.a).some(t=>t.name==='cardstudio_scean_diagnose'));assert(!f.ctx.tools.schemas(f.other).some(t=>t.name==='cardstudio_scean_diagnose'));
 const diagnostic=f.ctx.tools.schemas(f.a).find(t=>t.name==='cardstudio_scean_diagnose');assert.deepEqual(diagnostic.parameters.properties.target.enum,['card','worldbook']);assert.deepEqual(diagnostic.parameters.properties.action.enum,['read','prepare_edit']);assert.deepEqual(diagnostic.parameters.properties.limit.enum,[1,2,3,4,5,6,7,8,9,10]);assert.match(diagnostic.parameters.properties.limit.description,/NOT characters or tokens/);await assert.rejects(execute('cardstudio_scean_diagnose',{section:'story',turn:1,limit:4000}),e=>e.code==='INVALID_ARGS');await assert.rejects(execute('cardstudio_scean_diagnose',{action:'prepare_edit',target:'description',direction:'Bad target'}),e=>e.code==='INVALID_ARGS');
 assert.equal((await execute('cardstudio_scean_diagnose',{})).error.code,'DIAG_DENIED');
 const start=await f.bridge.sceanControl(f.a,{claim,mode:'start',document_id:id,expected_revision:0});assert(start.ok,JSON.stringify(start));
 const grant=await f.bridge.sceanControl(f.a,{claim,mode:'diagnosis_grant',runId:start.value.runId});assert(grant.ok,JSON.stringify(grant));
 const context=await execute('cardstudio_scean_diagnose',{});assert(context.ok,JSON.stringify(context));assert.equal(context.value.editTarget.target.document_id,id);assert(!JSON.stringify(context).includes('grantToken'));
 let edit=await execute('card_patch_fields',{document_id:id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Unauthorized.'}]});assert.equal(edit.error.code,'DIAG_EDIT_CONSENT');
 assert((await execute('cardstudio_scean_diagnose',{action:'prepare_edit',direction:'Let her refuse while keeping her kind personality.'})).ok);
 const approved=await f.bridge.sceanControl(f.a,{claim,mode:'diagnosis_consent',expected_revision:0});assert(approved.ok,JSON.stringify(approved));
 edit=await execute('card_patch_fields',{document_id:id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Independent; she can refuse kindly.'}]});assert(edit.ok,JSON.stringify(edit));assert.equal(edit.value.revision,1);
 assert((await execute('cardstudio_scean_diagnose',{})).value.editTarget.revisionDiffers);
 await f.bridge.sceanControl(f.a,{claim,mode:'diagnosis_revoke'});assert.equal((await execute('cardstudio_scean_diagnose',{})).error.code,'DIAG_DENIED');
});
