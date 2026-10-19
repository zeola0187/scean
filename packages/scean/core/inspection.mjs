import {openingDisplay} from './player-identity.mjs';
import {projectDerivedFacts} from './derived-facts.mjs';
import {frontendProjection,validateFrontend} from './frontend.mjs';
import {publicBlueprintState} from './state-blueprint.mjs';
import {clone} from './contracts.mjs';
import {publicCharacter,publicData,publicStateForModel,eligibleMemory} from './memory-policy.mjs';

const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,clone(value[key])]));
// A content hash is an identifying fingerprint, not a redaction. Canonical hashes
// and provenance remain available only through the existing private grant.
const restricted=()=>({status:'restricted'});
const stateView=value=>value?publicStateForModel(value):{world:{},characters:{}};
const publicMemory=(memory,runId)=>eligibleMemory(memory,{runId,audience:'public'})?publicData(memory):{
  content:restricted(),
};
const sourceReasons=new Set(['required_core','within_capacity','stage_boundary','embedded_book_requires_selection','request_rejected_core_overflow','capacity_low_priority']);
const safeReason=value=>sourceReasons.has(value)?value:'restricted';
/** Only explicitly public/system source identities cross this boundary. Unknown
 * visibility is restricted; restricted counts never carry per-source identity. */
export function publicContextBudget(value){
  if(!value||typeof value!=='object')return {status:'not_recorded'};
  const result=pick(value,['schemaVersion','stage','status','estimateMethod','estimateOnly','contextWindow','capacitySource','outputReserve','outputReserveSource','outputReservePhase','outputSnapshotBound','preparedContextWindow','providerFinalOutputReserve','providerFinalOutputSource','sdkFinishKind','toolReserve','overheadReserve','inputCapacity','candidateEstimate','requiredEstimate','includedEstimate','actualUsage','reason','policy','estimatedOverflow']);
  result.sources=[];
  const summary={status:'restricted',count:0,includedCount:0,excludedCount:0,estimatedTokens:0,reasons:{}};
  for(const source of value.sources??[]){
    if(['public','system'].includes(source.visibility))result.sources.push(pick(source,['sourceID','path','priority','visibility','estimate','mandatory','included','reason']));
    else{summary.count++;summary[source.included?'includedCount':'excludedCount']++;if(Number.isFinite(source.estimate)&&source.estimate>=0)summary.estimatedTokens+=source.estimate;const reason=safeReason(source.reason);summary.reasons[reason]=(summary.reasons[reason]??0)+1;}
  }
  result.restrictedSources=summary;return result;
}
function publicAssemblyDiagnostics(value){
  const result=pick(value,['status','beforeBytes','afterBytes','savedBytes','tokenEstimate','narrative','derivedFacts','chapterRecall']);
  if(!value?.worldbook)return result;
  const book=value.worldbook,privateBooks=new Set((book.books??[]).filter(row=>row.reason==='private_scope').map(row=>row.sourceId));
  const privateEntries=new Set((book.entries??[]).filter(row=>row.reason==='private_scope'||privateBooks.has(row.sourceId)).map(row=>row.ref));
  const allowed=row=>row.reason!=='private_scope'&&!privateBooks.has(row.sourceId)&&!privateEntries.has(row.ref);
  // Even an otherwise public book can contain a private entry. Its whole-book
  // hash and arbitrary unsupported extension names are not public diagnostics.
  const provenance=['sourceId','path','bookId','bookVersion','status','reason','identicalTo'];
  result.worldbook={...pick(book,['schemaVersion','status']),
    books:(book.books??[]).filter(allowed).map(row=>pick(row,provenance)),
    entries:(book.entries??[]).filter(allowed).map(row=>pick(row,[...provenance,'ref','entryId','primaryHits','secondaryHits','placement','priority','order','mode'])),
    warnings:(book.warnings??[]).filter(allowed).map(row=>pick(row,['code','sourceId','ref','fallback'])),
    scan:(book.scan??[]).filter(allowed).map(row=>pick(row,['sourceId','window','currentInputAlwaysIncluded','material'])),
    selectionOrder:(book.selectionOrder??[]).filter(ref=>!privateEntries.has(ref)),presentationOrder:(book.presentationOrder??[]).filter(ref=>!privateEntries.has(ref)),
    stageUse:Array.isArray(book.stageUse)?book.stageUse.map(row=>({...pick(row,['stage','status','providerDispatch']),refs:(row.refs??[]).filter(ref=>!privateEntries.has(ref))})):book.stageUse??'not_recorded',
    restrictedSources:{status:'restricted',books:privateBooks.size,entries:privateEntries.size}};
  return result;
}
function publicStage(stage){
  const result=pick(stage,['stage','status','startedAt','finishedAt','error']);
  if(stage.access)result.access=stage.access.kind==='character_private'?{kind:'character_private',status:'restricted'}:pick(stage.access,['kind']);
  if(stage.derivedFactsUse)result.derivedFactsUse=pick(stage.derivedFactsUse,['stage','status','providerDispatch','providedFactIds','config','canonical','snapshotHash']);
  if(stage.contextBudget)result.contextBudget=publicContextBudget(stage.contextBudget);
  if(stage.prompt!==undefined)result.prompt=stage.prompt?restricted():{status:'not_recorded'};
  if(stage.result!==undefined)result.result=stage.result?{...pick(stage.result,['model','route','usage','attempts']),content:restricted()}:{status:'not_recorded'};
  return result;
}
export function publicSnapshot(snapshot){
  if(!snapshot)return snapshot;
  const title=snapshot.card?.data?.name??snapshot.card?.name??snapshot.cardId;
  const opening=snapshot.opening?Object.fromEntries(['id','title','text'].filter(key=>typeof snapshot.opening[key]==='string').map(key=>[key,snapshot.opening[key]])):undefined;
  return {...publicData(pick(snapshot,['schemaVersion','cardId','revision','hash'])),...(opening?{opening}:{}),
    card:{name:typeof title==='string'?title:'SCEAN',content:restricted(snapshot.card)},
    worldbook:restricted(snapshot.worldbook),preset:restricted(snapshot.preset),
    characters:(snapshot.characters??[]).map(publicCharacter),source:restricted(snapshot.source)};
}
function publicTool(tool){
  const base=pick(tool,['id','name','arguments','kind','status','startedAt','finishedAt','error']);
  if(tool.name==='consult_character'){
    // A.1 only forwards the explicit public advice envelope. Legacy untyped text
    // remains in authorized detailed diagnostics, never treated as a new grant.
    const advice=tool.result?.advice;
    if(advice?.adviceVersion===1)base.result={advice:pick(advice,['adviceVersion','characterId','observable','publicUtterances','intendedDisclosures']),status:'public_advice_not_event'};
    else if(tool.result)base.result=restricted(tool.result);
  }else if(['adjudicate_action','search_history','read_history'].includes(tool.name))base.result=clone(tool.result??{status:'not_recorded'});
  return base;
}
export function publicTurnResult(result){
  if(!result)return {status:'not_recorded'};
  const projected=pick(result,['runId','requestId','version','turn','body','commitId','status']);
  if(result.state)projected.state=stateView(result.state);
  if(result.memories)projected.memories=result.memories.map(m=>publicMemory(m,result.runId??m.source?.runId));
  if(result.playerHistory)projected.playerHistory={status:'restricted',count:result.playerHistory.length};
  if(result.trace)projected.trace={...pick(result.trace,['attemptId','operationId']),stages:(result.trace.stages??[]).map(publicStage),tools:(result.trace.tools??[]).map(publicTool)};
  return projected;
}
function publicAttempt(attempt,runId){
  const result=pick(attempt,['schemaVersion','attemptId','runId','requestId','operationId','baseVersion','status','startedAt','finishedAt','input','inputSnapshot','directorComplete','requestOutcome','commitId','error','recovery']);
  if(attempt.assemblyDiagnostics)result.assemblyDiagnostics=publicAssemblyDiagnostics(attempt.assemblyDiagnostics);
  if(attempt.contextPreflights)result.contextPreflights=attempt.contextPreflights.map(publicContextBudget);
  if(attempt.assembly)result.assembly=restricted(attempt.assembly);
  result.stages=(attempt.stages??[]).map(stage=>({prompt:{status:'not_recorded'},result:{status:'not_recorded'},...publicStage(stage)}));
  result.tools=(attempt.tools??[]).map(publicTool);
  if(attempt.commit){const c=attempt.commit;result.commit={...pick(c,['status','contractVersion','commitId','expectedVersion','nextVersion','bodyHash']),
    stateBefore:stateView(c.stateBefore),stateAfter:stateView(c.stateAfter),
    memories:(c.memories??[]).map(m=>publicMemory(m,runId)),playerHistory:{status:'restricted',count:c.playerHistory?.length??0}};}
  return result;
}
/** Public/shared inspection is a projection, never a serialization of canonical storage. */
export function publicInspection(run){
  const publicIds=new Set((run.memories??[]).filter(memory=>eligibleMemory(memory,{runId:run.runId,audience:'public'})).map(memory=>memory.id));
  return {...pick(run,['schemaVersion','runId','version','head','openingId','createdAt','updatedAt','banList','availability','lastFailure']),
    history:{retiredCount:run.retired?.length??0,operationCount:Object.keys(run.operationReceipts??{}).length},
    ...(run.playerIdentity?{playerIdentity:pick(run.playerIdentity,['schemaVersion','name','boundVersion','afterTurn']),openingDisplay:openingDisplay(run)}:{}),snapshot:publicSnapshot(run.snapshot),state:stateView(run.state),
    ...(run.snapshot?.derivedFacts?{derivedFacts:projectDerivedFacts(run)}:{}),
    ...(run.snapshot?.frontend?{frontendDiagnostics:publicFrontendDiagnostics(run)}:{}),
    ...(run.snapshot?.stateBlueprint ? {worldView:publicBlueprintState(run.snapshot.stateBlueprint,run.state)} : {}),
    memories:(run.memories??[]).map(m=>publicMemory(m,run.runId)),
    playerHistory:{status:'restricted',count:run.playerHistory?.length??0},
    turns:(run.turns??[]).map(turn=>({...pick(turn,['turn','requestId','commitId','input','body','bodyHash','attemptId','committedAt']),
      memoryIds:(turn.memoryIds??[]).filter(id=>publicIds.has(id)),restrictedMemoryCount:(turn.memoryIds??[]).filter(id=>!publicIds.has(id)).length,
      playerHistory:{status:'restricted',count:turn.playerHistoryIds?.length??0},
      stateBefore:stateView(turn.stateBefore),stateAfter:stateView(turn.stateAfter)})),
    receipts:Object.fromEntries(Object.entries(run.receipts??{}).map(([key,r])=>[key,r.status==='retired'?pick(r,['status','commitId','attemptId','retiredBy','retiredAtVersion']):{...pick(r,['inputHash','commitId','attemptId']),result:publicTurnResult(r.result)}])),
    attempts:(run.attempts??[]).map(a=>a.status==='retired'?pick(a,['attemptId','requestId','commitId','status','requestOutcome']):publicAttempt(a,run.runId)),
    diagnostics:{scope:'public',privateContext:'restricted',authorizationRequired:true}};
}

/** Bounded ordinary view: never walks attempts or transmits the story aggregate. */
export function publicRunView(run,{requestId}={}){
  const last=run.turns?.at(-1),receipt=requestId?run.receipts?.[requestId]:null;
  return {...pick(run,['schemaVersion','runId','version','head','createdAt','updatedAt','banList']),
    turnCount:run.turns?.length??0,...(run.snapshot?.derivedFacts?{derivedFacts:projectDerivedFacts(run)}:{}),cardFrontend:publicFrontend(run),...(run.playerIdentity?{playerIdentity:pick(run.playerIdentity,['schemaVersion','name','boundVersion','afterTurn']),openingDisplay:openingDisplay(run)}:{}),snapshot:publicSnapshot(run.snapshot),state:stateView(run.state),
    ...(run.snapshot?.stateBlueprint?{worldView:publicBlueprintState(run.snapshot.stateBlueprint,run.state)}:{}),
    lastTurn:last?{...pick(last,['turn','requestId','commitId','input','body']),stateBefore:stateView(last.stateBefore),stateAfter:stateView(last.stateAfter)}:null,
    ...(receipt?{requestReceipt:{requestId,commitId:receipt.commitId,status:receipt.status==='retired'?'retired':run.turns.some(t=>t.commitId===receipt.commitId&&t.requestId===requestId)?'committed':'unknown'}}:{}),
    history:{retiredCount:run.retired?.length??0},diagnostics:{scope:'public',privateContext:'restricted'}};
}

// Trusted player receives an exact, minimal, commit-only projection. Card iframe
// receives rendered values only and has neither this packet nor an RPC endpoint.
export function publicFrontend(run){
  if(!run.snapshot?.frontend)return null;
  try{const f=validateFrontend(run.snapshot.frontend,run.snapshot.stateBlueprint,run.snapshot.characters,run.snapshot.derivedFacts);
    return {status:'ready',frontend:{id:f.id,hash:f.hash,tree:f.tree,safeCss:f.safeCss,conditions:f.conditions},projection:frontendProjection(run)};
  }catch(e){return {status:'unavailable',code:/^FRONTEND_[A-Z_]+$/.test(e.code??'')?e.code:'FRONTEND_UNAVAILABLE'};}
}

export function publicFrontendDiagnostics(run){
  const p=publicFrontend(run);if(!p||p.status!=='ready')return p;
  return {status:p.status,profile:'scean-html-bindings-v1',hash:p.frontend.hash,canonical:p.projection.canonical,values:Object.fromEntries(Object.entries(p.projection.values).map(([alias,v])=>[alias,{status:v.status,type:v.type}]))};
}
