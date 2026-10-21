import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {WorkspaceLoader} from '../sources/card-studio/cardstudio-bundle/lib/loader.js';
import {buildSavedSnapshot,createSceanControl,resolveSceanCardContext} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {createSceanDiagnosis} from '../sources/card-studio/cardstudio-bundle/lib/scean-diagnosis.js';
import {toolSpecs} from '../sources/card-studio/cardstudio-bundle/lib/tool-definitions.js';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
import {clearEditIntent} from '../sources/card-studio/cardstudio-bundle/lib/diagnosis-consent.js';

export const syntheticCard=()=>({spec:'chara_card_v3',spec_version:'3.0',data:{name:'同名合成卡',description:'Independent; she may disagree.',personality:'Independent and kind.',scenario:'Synthetic station.',first_mes:'A lamp is on the desk.',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:['A new synthetic scene.'],group_only_greetings:[],tags:[],creator:'offline QA',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Independent station keeper.'}]}},character_book:{entries:[{id:1,keys:['lamp'],content:'A silver lamp.',enabled:true,insertion_order:0,extensions:{}},{id:2,keys:['unmatched'],content:'Unmatched background.',enabled:true,insertion_order:1,extensions:{}}]}}});
export async function fixture(t){
  const base=new URL('../.test-data/',import.meta.url);await mkdir(base,{recursive:true});const root=await mkdtemp(new URL('w02-',base));
  const clock={value:100000},calls=[];
  const model={async generate(args){calls.push(args.stage);if(args.stage==='director')return {text:'Observe independently.'};if(['draft','prose'].includes(args.stage))return {text:'She disagreed and inspected the lamp.'};if(args.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};throw Error('Unexpected offline stage '+args.stage);}};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),model,memory:new Memory()});
  const host=await new SceanHost({engine,root:join(root,'host'),now:()=>clock.value}).init();
  const workspace=join(root,'studio');await mkdir(workspace);
  const agent={id:'w02-session',status:'idle',session:{header:{cwd:workspace},snapshotEvents:()=>[]},whenIdle:async()=>{},cancel(){}};
  const loader=new WorkspaceLoader({root:workspace,agentLookup:id=>id===agent.id?agent:null,activateAddon:async()=>({dispose(){}}),now:()=>clock.value});
  await loader.init();await loader.setArchiveState([]);const claim=await loader.acquire(agent,'w02-human-page'),r=loader.records.get(agent.id);
  t?.after(async()=>{await loader.close();await host.close();});
  const runtime={startFromStudio:q=>host.startFromStudio(q),inspectFromStudio:q=>host.inspectFromStudio(q),listDiagnosticRuns:q=>host.agentDiagnostics.list(q),grantAgentDiagnosis:q=>host.agentDiagnostics.issue(q),readAgentDiagnosis:q=>host.agentDiagnostics.read(q),revokeAgentDiagnosis:q=>host.agentDiagnostics.revoke(q)};
  const diagnosis=createSceanDiagnosis(loader,()=>runtime),control=createSceanControl(loader,()=>runtime);
  const invoke=(action,args={},human=true)=>loader.call(agent,r,human?claim:null,action,args);
  const importCard=async(name='synthetic')=>{await writeFile(join(workspace,'imports',name+'.json'),JSON.stringify(syntheticCard()));const imported=await invoke('import',{path:'imports/'+name+'.json',type:'card'});assert(imported.ok,JSON.stringify(imported));return imported.value.id;};
  const id=await importCard();
  const saved=async()=>{const value=await invoke('read',{document_id:id});assert(value.ok,JSON.stringify(value));return value.value;};
  const scope=()=>resolveSceanCardContext(loader,agent.id);
  const start=async(requestId='w02-handoff-00000001')=>{
    const current=await saved(),offer=await control(agent,{claim,mode:'start',document_id:id,expected_revision:current.revision,request_id:requestId});
    if(offer.runId)return offer;
    const s=await scope(),o=host.openings.get(s),choice={offerId:o.offerId,cardId:o.cardId,revision:o.revision,snapshotHash:o.snapshotHash,openingIndex:0,playerName:'Synthetic tester'};
    return host.openings.start(choice,s,scope);
  };
  const grant=(runId,args={})=>diagnosis.human(agent,{claim,mode:'diagnosis_grant',runId,...args});
  const tool=args=>diagnosis.call(agent,r,args);
  const human=args=>diagnosis.human(agent,{claim,...args});
  return {root,workspace,clock,calls,engine,host,loader,agent,r,claim,id,invoke,importCard,saved,scope,start,grant,tool,human,control,runtime,diagnosis};
}
