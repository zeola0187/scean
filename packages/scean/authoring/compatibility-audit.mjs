import {derivedFactsPackage} from '../core/derived-facts.mjs';
import {hash, validateRoster} from '../core/contracts.mjs';
import {selectWorldbooks} from '../core/worldbook.mjs';
import {validateCharacterSources} from '../core/character-sources.mjs';
import {validateBlueprint, materializeInitialState, validateBlueprintStateChanges, publicBlueprintState} from '../core/state-blueprint.mjs';
import {normalizeStudioHandoffSnapshot} from '../plugin/studio-handoff.mjs';
import {validateFrontend} from '../core/frontend.mjs';

export const AUDIT_VERSION = '0.1.0';
const own = (v,k) => Object.hasOwn(v??{},k);
const declarations = bp => Array.isArray(bp?.variables)?bp.variables:[];
const target = v => ({scope:v.scope,...v.characterId?{characterId:v.characterId}:{},category:v.category,key:v.key});
const key = v => JSON.stringify([v?.scope,v?.characterId??null,v?.category,v?.key]);
const capture = fn => {try{return {accepted:true,value:fn()};}catch(e){return {accepted:false,code:e.code??'AUDIT_VALIDATION_ERROR'};}};
const source = {id:'scean-compatibility-audit-synthetic',version:AUDIT_VERSION};
function sample(v) {
  if(v.type==='number')return Math.max(v.min??-Number.MAX_VALUE,Math.min(v.max??Number.MAX_VALUE,0));
  if(v.type==='boolean')return false;
  if(v.type==='string')return '';
  if(v.type==='enum')return v.enumValues[0];
  return {...Object.fromEntries((v.requiredFields??[]).map(k=>[k,'synthetic'])),...v.category==='tasks'?{status:'active',assignees:[],progress:0}:{}};
}
function probes(bp,v,actors) {
  const initial=value=>materializeInitialState(bp,{schemaVersion:1,blueprintId:bp.id,blueprintVersion:bp.version,values:[{...target(v),value,source}]},actors);
  const change={...target(v),operation:'set',value:sample(v),...v.scope==='character'?{visibility:v.visibility==='restricted'?'private':'public'}:{}};
  const cases=[['legal-initial',sample(v),true]];
  if(v.type==='number'){
    if(v.min!==undefined)cases.push(['min',v.min,true],['below-min',v.min-Math.max(1,Math.abs(v.min)*1e-6),false]);
    if(v.max!==undefined)cases.push(['max',v.max,true],['above-max',v.max+Math.max(1,Math.abs(v.max)*1e-6),false]);
    cases.push(['wrong-type','0',false]);
  }else if(v.type==='enum')cases.push(['outside-enum',{},false]);
  else if(v.type==='boolean')cases.push(['wrong-type','false',false]);
  else if(v.type==='string')cases.push(['wrong-type',0,false]);
  if(v.requiredFields?.length)cases.push(['missing-required',{},false]);
  if(v.category==='tasks')cases.push(['task-progress-invalid',{status:'active',assignees:[],progress:101},false],['task-actor-invalid',{status:'active',assignees:['audit-missing-actor'],progress:0},false]);
  const out=cases.map(([name,value,expectedAccepted])=>{const r=capture(()=>initial(value));return {name,expectedAccepted,accepted:r.accepted,...r.code?{code:r.code}:{}};});
  if(v.readOnly||v.visibility==='restricted'){
    const r=capture(()=>validateBlueprintStateChanges(bp,[change],actors,{source}));
    out.push({name:v.readOnly?'readonly-update':'restricted-public-update',expectedAccepted:false,accepted:r.accepted,...r.code?{code:r.code}:{}});
  }
  return out;
}

/** Pure engineering evidence. Receives only a Host-authorized saved payload.
 * No I/O, authored code execution, model calls, State/Memory writes or Run gate. */
export function auditSavedSnapshot(input) {
  const {snapshot, snapshotError=null, saved, entryIds=[], frontend={components:[],diagnostics:[]}, cases=[], baseline=null}=input;
  const items=[],actors=snapshot.characters??[],native=snapshot.card?.data?.extensions?.scean??{};
  const add=(itemID,status,objectID,program,observed,reason=null,reproduce='Repeat the same saved document ID/revision/hash through the Studio audit tool.',correction='No automatic edit; preserve author choices.')=>items.push({itemID,status,objectID,layer:'static',program,observed,reason,reproduce,correction});
  const run=(itemID,objectID,program,fn)=>{const r=capture(fn);add(itemID,r.accepted?'PASS':'FAIL',objectID,program,r.accepted?{accepted:true}:{accepted:false,code:r.code},r.code??null,undefined,r.accepted?undefined:'Repair the reported saved contract violation, only with separate author authorization; save a new revision and rerun.');return r;};
  add('D.saved-revision','PASS',saved.id,'Studio CardService.load/read + SHA256 verification',{revision:saved.revision,sha256:saved.sha256,format:saved.format,entryIds});
  const selection=capture(()=>selectWorldbooks(snapshot,{playerInput:''}));
  if(!selection.accepted)add('A.selector','FAIL',saved.id,'core/worldbook.selectWorldbooks',{code:selection.code},selection.code);
  else {
    const d=selection.value.diagnostics;
    const rawEntries=snapshot.worldbook?.entries??snapshot.card?.data?.character_book?.entries??[];
    const rows=Array.isArray(rawEntries)?rawEntries:Object.values(rawEntries);
    const stable=row=>`${saved.id}/book/${row.bookId??row.sourceId}/entry/${entryIds[Number(row.ref?.split(':').at(-1))]??row.entryId??row.ref}`;
    for(const row of d.entries){
      const unsupported=['unsupported_regex','unsupported_selective_logic'].includes(row.reason);
      const status=unsupported?'UNSUPPORTED':row.reason==='invalid_entry'?'FAIL':row.reason==='constant'&&row.status==='selected'?'PASS':row.reason==='secondary_keys_missing'?'WARN':['disabled','empty_content','private_scope'].includes(row.reason)?'WARN':'NOT_TESTED';
      const raw=rows[Number(row.ref?.split(':').at(-1))]??{};
      const controls=Object.fromEntries(['enabled','disable','constant','keys','key','secondary_keys','keysecondary','selective','selectiveLogic','selective_logic','use_regex','useRegex'].filter(k=>own(raw,k)).map(k=>[k,raw[k]]));
      add('A.entry.'+row.ref,status,stable(row),'core/worldbook.selectWorldbooks',{entryId:row.entryId,controls,selected:row.status==='selected',reason:row.reason,primaryHits:row.primaryHits?.length,secondaryHits:row.secondaryHits?.length},unsupported?row.reason:status==='NOT_TESTED'?'No proven scenario expectation supplied; an empty-input miss is legal.':null,undefined,unsupported?'Use supported literal keys or retain this unsupported mechanic as an explicit author decision.':undefined);
      items.at(-1).layer='runtime';
    }
    for(const [i,w]of d.warnings.entries())add('A.field.'+i,w.code.includes('UNSUPPORTED')||w.code==='EXECUTABLE_SYNTAX_LITERAL_ONLY'?'UNSUPPORTED':'WARN',w.ref?stable(d.entries.find(r=>r.ref===w.ref)??w):saved.id,'core/worldbook.selectWorldbooks diagnostics',w,w.code);
    for(const b of d.books)if(b.status==='excluded')add('A.book.'+b.sourceId,b.reason==='unsupported_book_format'?'UNSUPPORTED':'WARN',b.path,'core/worldbook.selectWorldbooks',b,b.reason);
    if(!d.entries.length)add('A.entries','NOT_APPLICABLE',saved.id,'core/worldbook.selectWorldbooks',{entries:0});
    for(const c of cases){
      const result=selectWorldbooks(snapshot,{playerInput:c.playerInput??'',recentDialogue:c.recentDialogue??[]});
      for(const [i,e]of (c.expect??[]).entries()){
        const matched=result.diagnostics.entries.filter(r=>(entryIds[Number(r.ref?.split(':').at(-1))]??r.entryId)===e.entry_id);
        const selected=matched.some(r=>r.status==='selected'),unsupported=matched.some(r=>r.reason?.startsWith('unsupported_'));
        const status=unsupported?'UNSUPPORTED':matched.length!==1?'FAIL':selected===e.selected?'PASS':'FAIL';
        add(`A.case.${c.id}.${i}`,status,`${saved.id}/entry/${e.entry_id}`,'core/worldbook.selectWorldbooks',{scenario:c.id,inputHash:hash({playerInput:c.playerInput??'',recentDialogue:c.recentDialogue??[]}),expectationSource:'explicit audit scenario; not inferred author intent',expectedSelected:e.selected,selected,reasons:matched.map(r=>r.reason)},unsupported?'Runtime selector does not support this mechanic.':status==='FAIL'?'Scenario expectation was not met.':null,`Replay case ${c.id} with the identical input and recentDialogue.`);
        items.at(-1).layer='runtime';
      }
    }
    add('A.intent','NOT_TESTED',saved.id,'no semantic reviewer',{scenarioCount:cases.length},'Selection does not prove narrative intent, model adherence or same-scene completeness.');
  }
  const roster=run('C.roster',saved.id,'core/contracts.validateRoster',()=>validateRoster(actors));
  if(roster.accepted)for(const a of actors){
    if(!a.sourceBindings)add('C.binding.'+a.id,'WARN',a.id,'core/character-sources.validateCharacterSources',{legacyExplicitBackground:true},'No source binding supplied; legacy authored background remains legal.');
    else {
      run('C.binding.'+a.id,a.id,'core/character-sources.validateCharacterSources',()=>validateCharacterSources(a,snapshot));
      items.at(-1).observed={...items.at(-1).observed,savedRevision:saved.revision,descriptionHash:a.sourceBindings?.descriptionHash??null,sources:a.sourceBindings?.sources??null};
    }
  }
  const bpResult=run('B.schema',native.stateBlueprint?.id??saved.id,'core/state-blueprint.validateBlueprint',()=>validateBlueprint(native.stateBlueprint,actors));
  let material,publicProjection=null;
  if(bpResult.accepted){
    const bp=bpResult.value;
    material=run('B.initial',bp?.id??saved.id,'core/state-blueprint.materializeInitialState',()=>materializeInitialState(bp,native.initialState,actors));
    if(!bp)add('B.declarations','NOT_APPLICABLE',saved.id,'core/state-blueprint.validateBlueprint',{blueprint:null},'No StateBlueprint declared; absence does not establish intended state coverage.');
    if(bp&&material.accepted){
      const projection=publicBlueprintState(bp,material.value.state);
      publicProjection=projection;
      for(const v of bp.variables){
        const p=projection.declared.find(d=>key(d)===key(v));
        const known=(native.initialState?.values??[]).some(x=>key(x)===key(v));
        const pbs=probes(bp,v,actors);
        add('B.variable.'+key(v),pbs.every(p=>p.accepted===p.expectedAccepted)?'PASS':'FAIL',`${bp.id}/${key(v)}`,'materializeInitialState + validateBlueprintStateChanges + publicBlueprintState',{target:target(v),type:v.type,visibility:v.visibility,known,publiclyVisible:!!p,publicKnown:p?.known??false,...p?.known?{publicValueKind:p.value===false?'false':p.value===0?'zero':typeof p.value}:{},probes:pbs},null,'Synthetic probes use copies only; no saved state changes.');
      }
      const unknown={scope:'world',category:'facts',key:'audit_extension_probe',operation:'set',value:false};
      // Avoid colliding with an authored declaration.
      while(bp.variables.some(v=>key(v)===key(unknown)))unknown.key+='x';
      const ext=capture(()=>validateBlueprintStateChanges(bp,[unknown],actors,{source}));
      add('B.extension-policy',ext.accepted===(bp.extensionPolicy==='allow')?'PASS':'FAIL',bp.id,'core/state-blueprint.validateBlueprintStateChanges',{extensionPolicy:bp.extensionPolicy,unknownFieldAccepted:ext.accepted,code:ext.code??null},null,'Synthetic unknown world.facts key only.');
      add('B.restricted-projection',bp.variables.filter(v=>v.visibility==='restricted').every(v=>!projection.declared.some(p=>key(v)===key(p)))?'PASS':'FAIL',bp.id,'core/state-blueprint.publicBlueprintState',{restrictedDeclarations:bp.variables.filter(v=>v.visibility==='restricted').length,restrictedExposed:projection.declared.some(p=>bp.variables.some(v=>v.visibility==='restricted'&&key(v)===key(p)))});
    }
  }
  if(baseline){
    const old=baseline.snapshot.card?.data?.extensions?.scean?.stateBlueprint;
    const current=native.stateBlueprint;
    const changes=[];
    for(const id of new Set([...declarations(old).map(key),...declarations(current).map(key)])){
      const before=declarations(old).find(v=>key(v)===id),after=declarations(current).find(v=>key(v)===id);
      if(JSON.stringify(before)!==JSON.stringify(after))changes.push({target:id,before:before??null,after:after??null});
    }
    add('B.constraint-diff',changes.length||old?.extensionPolicy!==current?.extensionPolicy?'WARN':'PASS',saved.id,'deterministic declaration comparison',{fromRevision:baseline.saved.revision,toRevision:saved.revision,extensionPolicy:{before:old?.extensionPolicy??null,after:current?.extensionPolicy??null},changes},'Mechanical differences only; counts, consolidation and policy choices are author decisions.');
  }
  const handoff=snapshotError?{accepted:false,code:snapshotError}:capture(()=>normalizeStudioHandoffSnapshot(snapshot));
  add('D.snapshot-handoff',handoff.accepted?'PASS':'FAIL',saved.id,'Studio buildSavedSnapshot + plugin/studio-handoff.normalizeStudioHandoffSnapshot',handoff.accepted?{providerHash:snapshot.hash,normalizedHash:handoff.value.hash,revision:saved.revision}: {code:handoff.code},handoff.code??null);
  const components=frontend.components??[];
  if(!components.length)add('D.frontend','NOT_APPLICABLE',saved.id,'Studio inspectFrontend',{components:0},'No recognized dedicated frontend. Unrecognized external frontends need separate inspection.');
  for(const f of components){
    const dep=f.dependencies;
    add('D.frontend.'+f.component_id,dep.javascript||dep.ejs||dep.mvu||dep.tavernHelper?'UNSUPPORTED':dep.parseable?'PASS':'WARN',f.component_id,'Studio inspectFrontend/analyzeFrontend',{sourceHash:f.sourceHash,locator:f.locator,dependencies:dep},dep.dynamicUnknown?'Dynamic syntax is unexecuted; static discovery is not UI acceptance.':null);
    add('D.render.'+f.component_id,'NOT_TESTED',f.component_id,'no browser/runtime frontend execution',{rendered:false},'Static parsing cannot certify actual UI or Host API access.');
  }
  // Explicit bounded declarations in saved metadata are audit assertions, not
  // a new rendering API. They cannot certify arbitrary JavaScript references.
  const refs=native.auditFrontendReferences??[];
  if(!Array.isArray(refs)||refs.length>300)add('D.reference-schema','FAIL',saved.id,'audit static assertion shape',{valid:false},'At most 300 explicit reference assertions are accepted.');
  else for(const [i,r]of refs.entries()){
    if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['scope','characterId','category','key','type','interface'].includes(k))){add('D.reference.'+i,'FAIL',saved.id,'audit static assertion shape',{valid:false},'AUDIT_REFERENCE_SHAPE');continue;}
    const v=declarations(native.stateBlueprint).find(v=>key(v)===key(r));
    const p=publicProjection?.declared.find(v=>key(v)===key(r));
    const exists=!!v,allowed=exists&&!!p&&r.interface==='publicBlueprintState',typeOK=exists&&r.type===v.type;
    add('D.reference.'+i,allowed&&typeOK?'PASS':'FAIL',`${saved.id}/${key(r)}`,'saved auditFrontendReferences + core publicBlueprintState',{exists,publiclyAvailable:allowed,typeMatches:typeOK,known:p?.known??false,interface:r.interface,coverage:'explicit static assertion only; no renderer or binding API'},!exists?'BLUEPRINT_FIELD_MISSING':!allowed?'FIELD_NOT_PUBLIC_OR_INTERFACE_UNSUPPORTED':!typeOK?'FIELD_TYPE_MISMATCH':null);
  }
  if(components.length)add('D.reference-coverage','NOT_TESTED',saved.id,'no arbitrary code analysis',{assertions:Array.isArray(refs)?refs.length:0},'Explicit assertions are partial; arbitrary source references and live Host API behavior are not certified.');
  const executable=[];
  function walk(value,path,depth=0){if(depth>40)return;if(typeof value==='string'){if(/<%|<script\b|\b(?:MVU|TavernHelper|updateVariables|rollDice)\b/i.test(value))executable.push(path);}else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))walk(v,path+'/'+k,depth+1);}
  walk(snapshot.card,'card');
  const extensions=snapshot.card?.data?.extensions??{};
  for(const k of ['regex_scripts','tavern_helper','scripts'])if(own(extensions,k))executable.push('card/data/extensions/'+k);
  if(executable.length)add('C.scripts','UNSUPPORTED',saved.id,'static syntax/extension inventory',{paths:executable.slice(0,100),total:executable.length,executed:false},'Card JS/MVU/EJS/dice executors are not run. Natural-language conditions/dice remain model guidance.');
  add('C.mechanics','WARN',saved.id,'Runtime capability boundary',{hostMechanical:['literal worldbook selector','typed state validation','source hash verification','Snapshot isolation'],modelSoftRules:['natural-language conditions','prose dice/calculation instructions'],unsupported:['authored JS','EJS','MVU','recursive worldbook execution'],scriptInventoryComplete:false},'Static inventory is bounded and cannot prove the absence of every script dependency.');
  add('C.memory-runtime','NOT_TESTED',saved.id,'Character Agent v1 Runtime; no turn executed',{fixedSettings:'character ID + saved snapshot',mutableStateMemory:'Runtime owner-scoped State/Memory',consultation:'one-shot advice, not committed events',director:'omniscient author notes permitted'},'Saved metadata cannot prove actual consultations or memory behavior. Run isolated scripted Runtime regression separately.');
  add('D.live-isolation','NOT_TESTED',saved.id,'no live Run created',{newRevisionRequiresNewRun:true},'Pure handoff validation does not prove a production UI, old-Run isolation or long play.');
  add('formal-play','NOT_TESTED',saved.id,'no production/model execution',{models:0,embeddings:0,runsCreated:0},'Formal play requires separate explicit authorization.');
  if(snapshot.derivedFacts)run('W01.host-derived-facts',saved.id,'versioned independent public rules / shared bounded AST',()=>{const c=derivedFactsPackage(snapshot.derivedFacts,snapshot.stateBlueprint,snapshot.characters);return {id:c.id,version:c.version,hash:c.hash,facts:c.facts.length,writerFacts:c.facts.filter(f=>f.provideToWriter).length};});
  if(snapshot.frontend){
    run('W01.frontend-contract',saved.id,'scean-html-bindings-v1 / shared Blueprint + HTML/CSS + AST admission',()=>{
      const normalized=normalizeStudioHandoffSnapshot(snapshot);
      const f=validateFrontend(normalized.frontend,normalized.stateBlueprint,normalized.characters,normalized.derivedFacts);
      return {hash:f.hash,aliases:f.bindings.length};
    });
    add('W01.browser','NOT_TESTED',saved.id,'separate isolated Desktop/Web acceptance required',{frontendHash:snapshot.frontend.hash,profile:'scean-html-bindings-v1'},'Static admission does not certify browser rendering, commit lifecycle or model play.');
    add('W01.world-actions','UNSUPPORTED',saved.id,'v1 zero world-action capability',{actions:[],futureContract:'versioned opt-in runtime/capability admission'},'Local details disclosure only; no WorldState write or rules engine.');
  }
  const counts=Object.fromEntries(['PASS','FAIL','WARN','UNSUPPORTED','NOT_TESTED','NOT_APPLICABLE'].map(s=>[s,items.filter(i=>i.status===s).length]));
  return {schemaVersion:1,skill:'scean-compatibility-audit',version:AUDIT_VERSION,saved,applicableDomains:['A','B','C','D'],counts,items,limits:{layers:['static','runtime selector probes'],semanticQualityReviewed:false,authoredCodeExecuted:false,modelsInvoked:0,embeddingsInvoked:0,productionReady:false,automaticEdits:false}};
}
