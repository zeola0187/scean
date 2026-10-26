import {activeCalendarIds,routineCalendarPlan,validateWorldRoutine} from './world-routine.mjs';
import {clone,hash,json,SceanError,safeId,validateSnapshot} from './contracts.mjs';
import {storyTimeDefinition,initializeStoryClock,validateStoryClock,readStoryClock,resolveTimeOperation,tick,point,dayMinutes,assertNoWritableClock,assertTemporalChanges} from './story-clock.mjs';
import {publicStateForModel} from './memory-policy.mjs';
const fail=code=>{throw new SceanError(code);};
const same=(a,b)=>json(a)===json(b);
// Chapter/background commits often preserve the exact same temporal aggregate.
// Cache only its content digest, never an object identity or mutable Run. Every
// temporal replay input and receipt is hashed again, including on cache hits.
const validatedTemporalDigests=new Set();
// Content digests only. Every raw checkpoint, source plan and replay input is
// rehashed before reuse; never cache a mutable Run/object identity.
const validatedTurnReplays=new Set();
const fields=(v,keys,required=keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k)))fail('TEMPORAL_FIELDS');};
export const TIME_TOOL={type:'function',function:{name:'resolve_turn_time',description:'Host deterministic pre-Writer settlement. Use once for explicit elapsed time / sleep to next-day morning; ordinary unchanged dialogue uses the supplied hold candidate without a call. Read returned candidate and finish handoff with its candidateRef. Unspecified elapsed duration/endpoint: send {needsPrecision:true,sourceRefs:["input"]} alone. Never combine needsPrecision:true with kind, amount or target; it requests time clarification, not hold or invented time. Must precede time-dependent Character/Stat advice. Source input only; never calculate a resolved clock yourself.',parameters:{type:'object',additionalProperties:false,oneOf:[{required:['needsPrecision'],properties:{needsPrecision:{enum:[true]}},not:{anyOf:[{required:['kind']},{required:['amount']},{required:['target']}]}},{properties:{needsPrecision:{enum:[false]}}}],properties:{needsPrecision:{type:'boolean',description:'True is a separate clarification request: only needsPrecision and optional sourceRefs are allowed, never kind, amount or target. False may accompany a valid time operation.'},kind:{type:'string',enum:['hold','advance_by','advance_to']},sourceRefs:{type:'array',items:{type:'string',enum:['input']},minItems:1,maxItems:1},amount:{type:'object',additionalProperties:false,properties:{days:{type:'integer',minimum:0},hours:{type:'integer',minimum:0},minutes:{type:'integer',minimum:0}}},target:{type:'object',additionalProperties:false,properties:{dayOrdinal:{type:'integer',minimum:1},dayOffset:{type:'integer',minimum:0},nextDay:{type:'boolean',enum:[true]},minuteOfDay:{type:'integer',minimum:0},periodId:{type:'string'},date:{type:'object',additionalProperties:false,required:['year','month','day'],properties:{year:{type:'integer'},month:{type:'integer'},day:{type:'integer'}}}}}}}}};
export function validatePublicEvents(input,d){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>32)fail('PUBLIC_EVENT_LIMIT');const ids=new Set();
 for(const e of input){fields(e,['id','label','start','end','condition','requiredForScene'],['id','label','start','end']);safeId(e.id);if(ids.has(e.id)||typeof e.label!=='string'||!e.label.trim()||e.label.length>300)fail('PUBLIC_EVENT_INVALID');ids.add(e.id);
  if(tick(e.start,d)>=tick(e.end,d))fail('PUBLIC_EVENT_INVALID');
  if(e.requiredForScene!==undefined&&typeof e.requiredForScene!=='boolean')fail('PUBLIC_EVENT_INVALID');
  if(e.condition!==undefined){fields(e.condition,['category','key','equals']);if(!['facts','resources','locations'].includes(e.condition.category)||typeof e.condition.key!=='string'||!e.condition.key.trim()||e.condition.key.length>128||['constructor','prototype','__proto__'].includes(e.condition.key))fail('PUBLIC_EVENT_INVALID');}
 }return clone(input);
}
function effects(activity){
 const active={};for(const o of activity.occurrences){if(o.status!=='occurred')continue;if(o.phase==='start')active[o.eventId]={label:o.label,active:true,sourceRef:{kind:'public_event',occurrenceId:o.id,effectivePosition:o.position}};else delete active[o.eventId];}return active;
}
export function projectStoryState(run,{state=run.state,clock=run.storyClock,activity=run.worldActivity??{occurrences:[]}}={}){
 if(!state)return state;
 const view=publicStateForModel(state);if(!clock)return view;
 view.world.time={...(view.world.time??{}),current:readStoryClock(run,clock)};
 view.world.effects={...(view.world.effects??{}),story_events:effects(activity)};return view;
}
function cutFor(run,clock,activity,day,anchor){
 const id='cut-'+hash([run.runId,run.storyEpoch,day,anchor,run.snapshot.hash]).slice(0,24);
 return {schemaVersion:1,id,runId:run.runId,snapshotHash:run.snapshot.hash,epoch:run.storyEpoch,day,anchorCommitId:anchor,clock:clone(clock),publicState:projectStoryState(run,{clock,activity}),eventFrontier:activity.occurrences.map(o=>o.id),sourceKind:'story_day_entry',policyVersion:1};
}
export function recordActivityCheckpoint(checkpoints,activity,{parentActivity,compact=false}={}){
 const checkpointHash=hash(activity);if(!Object.hasOwn(checkpoints,checkpointHash)){
  const parentHash=parentActivity?hash(parentActivity):null,keys=['occurrences','dailyObligations','sourceCuts'];
  if(compact&&parentHash&&checkpoints[parentHash]&&keys.every(k=>activity[k].length>=parentActivity[k].length&&same(activity[k].slice(0,parentActivity[k].length),parentActivity[k])))checkpoints[checkpointHash]={checkpointVersion:2,parentHash,append:Object.fromEntries(keys.map(k=>[k,clone(activity[k].slice(parentActivity[k].length))]))};
  else checkpoints[checkpointHash]=clone(activity);
 }return {checkpointHash};
}
function activityPayload(run,key,memo=new Map(),visiting=new Set()){
 if(memo.has(key))return memo.get(key);const v=run.worldActivityCheckpoints?.[key];if(!v)fail('ACTIVITY_CHECKPOINT_MISSING');if(visiting.has(key)||visiting.size>2048)fail('ACTIVITY_CHECKPOINT_CYCLE');visiting.add(key);let value=v;
 if(v.checkpointVersion===2){fields(v,['checkpointVersion','parentHash','append']);fields(v.append,['occurrences','dailyObligations','sourceCuts']);if(Object.values(v.append).some(x=>!Array.isArray(x)))fail('ACTIVITY_CHECKPOINT_INVALID');const p=activityPayload(run,v.parentHash,memo,visiting);value={schemaVersion:1,...Object.fromEntries(['occurrences','dailyObligations','sourceCuts'].map(k=>[k,[...p[k],...v.append[k]]]))};}
 if(hash(value)!==key)fail('ACTIVITY_CHECKPOINT_HASH');visiting.delete(key);memo.set(key,value);return value;
}
function lookupActivityCheckpoint(run,reference,memo){fields(reference,['checkpointHash']);if(typeof reference.checkpointHash!=='string'||!/^[a-f0-9]{64}$/.test(reference.checkpointHash))fail('ACTIVITY_CHECKPOINT_MISSING');return activityPayload(run,reference.checkpointHash,memo);}
export function resolveActivityCheckpoint(run,reference,{memo}={}){return lookupActivityCheckpoint(run,reference,memo);}
function validateActivityCheckpoints(run){
 const table=run.worldActivityCheckpoints;
 if(!table||typeof table!=='object'||Array.isArray(table)||Object.keys(table).length>2*(run.turns.length+(run.retired?.length??0))+2)fail('ACTIVITY_CHECKPOINTS_REQUIRED');
 const memo=new Map(),used=new Set([hash(run.baselineWorldActivity),hash(run.worldActivity)]);
 for(const t of [...run.turns,...(run.retired??[])])for(const reference of [t.worldActivityBefore,t.worldActivityAfter]){lookupActivityCheckpoint(run,reference,memo);used.add(reference.checkpointHash);}
 for(const [key,payload]of Object.entries(table)){
  const activity=activityPayload(run,key,memo);
  if(!/^[a-f0-9]{64}$/.test(key)||hash(activity)!==key)fail('ACTIVITY_CHECKPOINT_HASH');
  fields(activity,['schemaVersion','occurrences','dailyObligations','sourceCuts']);
  if(activity.schemaVersion!==1||!['occurrences','dailyObligations','sourceCuts'].every(k=>Array.isArray(activity[k])))fail('ACTIVITY_CHECKPOINT_INVALID');
  if(!used.delete(key))fail('ACTIVITY_CHECKPOINT_ORPHAN');
 }
 if(used.size)fail('ACTIVITY_CHECKPOINT_MISSING');return memo;
}
export function initializeTemporal(run){
 const clock=initializeStoryClock(run.snapshot),d=storyTimeDefinition(run.snapshot.storyTimeDefinition);validatePublicEvents(run.snapshot.publicEvents,d);assertNoWritableClock(run.state,run.snapshot.stateBlueprint);
 run.storyClock=clock;run.baselineStoryClock=clone(clock);run.storyEpoch=0;run.storyRevision=0;run.worldActivity={schemaVersion:1,occurrences:[],dailyObligations:[],sourceCuts:[]};
 const day=clock.position.earliest.dayOrdinal,cut=cutFor(run,clock,run.worldActivity,day,null);
 run.worldActivity.sourceCuts.push(cut);run.worldActivity.dailyObligations.push({id:'forum-'+hash([run.runId,0,day]).slice(0,24),day,epoch:0,sourceCutId:cut.id,status:'pending',kind:'daily_forum_coverage',workerEnabled:run.snapshot.worldRoutineDefinition?.forum===true});
 run.baselineWorldActivity=clone(run.worldActivity);run.worldActivityCheckpoints={};recordActivityCheckpoint(run.worldActivityCheckpoints,run.worldActivity);return run;
}
export function prepareTemporalCandidate(run,operation,{requestId,inputHash,calendarCut,planMemo=new Map()}={}){
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);calendarCut??=run.worldRoutine?{cutHash:run.worldRoutine.currentCalendarCut}:undefined;const planKey=calendarCut?.cutHash??'fixed';let plan=planMemo.get(planKey);if(!plan){plan=run.worldRoutine?routineCalendarPlan(run,calendarCut):validatePublicEvents(run.snapshot.publicEvents,d);planMemo.set(planKey,plan);}validateStoryClock(run.storyClock,d);assertNoWritableClock(run.state,run.snapshot.stateBlueprint);
 if(operation.needsPrecision===true){fields(operation,['needsPrecision','sourceRefs'],['needsPrecision']);if(operation.sourceRefs!==undefined&&!same(operation.sourceRefs,['input']))fail('TIME_SOURCE_INVALID');fail('NEEDS_TIME_PRECISION');}
 if(Object.hasOwn(operation,'needsPrecision')){if(operation.needsPrecision!==false)fail('TIME_OPERATION_INVALID');operation=clone(operation);delete operation.needsPrecision;}
 const base={runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null,storyRevision:run.storyRevision,epoch:run.storyEpoch,clockHash:hash(run.storyClock),stateHash:hash(run.state),activityHash:hash(run.worldActivity),definitionHash:hash(d),planHash:hash(plan),requestId,inputHash};
 const candidateRef='tc-'+hash([base,operation]).slice(0,20),sourceRef={kind:'time_resolution',requestId,candidateRef,operationHash:hash(operation)};
 const after=resolveTimeOperation(run.storyClock,operation,d,sourceRef,{maxAdvanceDays:run.worldRoutine?366:31}),activity=clone(run.worldActivity),transitions=[];
 const earliest=tick(after.position.earliest,d),latest=tick(after.position.latest,d),baseLo=tick(run.storyClock.position.earliest,d);
 const ordered=plan.flatMap(e=>['end','start'].map(phase=>({e,phase,at:tick(e[phase],d)}))).sort((a,b)=>a.at-b.at||(a.phase==='end'?-1:1)-(b.phase==='end'?-1:1)||a.e.id.localeCompare(b.e.id));
 for(const {e,phase,at}of ordered){
  if(at<baseLo||at>latest)continue;
  const semantic=hash([e.id,phase,at]);if(activity.occurrences.some(o=>o.semantic===semantic))continue;
  if(at>earliest){if(e.requiredForScene)fail('NEEDS_TIME_PRECISION');transitions.push({eventId:e.id,phase,position:clone(e[phase]),status:'possibly_due'});continue;}
  const start=activity.occurrences.find(o=>o.eventId===e.id&&o.phase==='start');
  let status='occurred';
  if(phase==='end'&&start?.status!=='occurred')status=start?.status==='pending_resolution'?'pending_resolution':'did_not_occur';
  if(phase==='start'&&e.condition){const bucket=projectStoryState(run,{activity}).world[e.condition.category],value=bucket?.[e.condition.key];status=value===undefined?'pending_resolution':same(value,e.condition.equals)?'occurred':'did_not_occur';}
  if(status==='pending_resolution'&&e.requiredForScene)fail('PUBLIC_EVENT_CONDITION_UNKNOWN');
  const o={id:'occ-'+hash([run.runId,run.storyEpoch,semantic]).slice(0,24),semantic,eventId:e.id,label:e.label,phase,position:clone(e[phase]),status,epoch:run.storyEpoch,sourceRef:{kind:'public_event',snapshotHash:run.snapshot.hash,planHash:hash(plan)},predicateInputsHash:hash(e.condition?projectStoryState(run,{activity}).world[e.condition.category]?.[e.condition.key]??null:null)};
  activity.occurrences.push(o);transitions.push(o);
 }
 // Revisit unresolved predicates without pretending unknown meant false.
 for(const o of activity.occurrences.filter(o=>o.status==='pending_resolution')){const e=plan.find(e=>e.id===o.eventId);if(e?.requiredForScene)fail('PUBLIC_EVENT_CONDITION_UNKNOWN');}
 const created=[];
 for(let day=run.storyClock.position.earliest.dayOrdinal+1;day<=after.position.earliest.dayOrdinal;day++){
  if(activity.dailyObligations.some(o=>o.day===day))continue;
  const boundary={...clone(after),position:{earliest:{dayOrdinal:day,minuteOfDay:0},latest:{dayOrdinal:day,minuteOfDay:0}},precision:'minute'};delete boundary.periodId;
  const past={...activity,occurrences:activity.occurrences.filter(o=>tick(o.position,d)<=tick(boundary.position.earliest,d))};
  const cut=cutFor(run,boundary,past,day,run.head??null);activity.sourceCuts.push(cut);
  const obligation={id:'forum-'+hash([run.runId,run.storyEpoch,day]).slice(0,24),day,epoch:run.storyEpoch,sourceCutId:cut.id,status:'pending',kind:'daily_forum_coverage',workerEnabled:run.snapshot.worldRoutineDefinition?.forum===true};activity.dailyObligations.push(obligation);created.push(obligation.id);
 }
 if(activity.sourceCuts.length>1000||activity.occurrences.length>2048)fail('TEMPORAL_CAPACITY');
 const candidate={schemaVersion:1,...(calendarCut?{calendarCut:clone(calendarCut)}:{}),candidateRef,base,operation:clone(operation),clockBefore:clone(run.storyClock),clockAfter:after,stateHash:hash(run.state),worldActivityBefore:clone(run.worldActivity),worldActivityAfter:activity,transitions:clone(transitions),createdObligationIds:created,protectedTargets:[{scope:'world',category:'time',key:'current'},{scope:'world',category:'effects',key:'story_events'}]};
 candidate.hash=hash(candidate);return candidate;
}
export function candidateView(run,c){return {schemaVersion:1,status:'transaction_candidate_not_published',candidateRef:c.candidateRef,candidateHash:c.hash,clockBefore:readStoryClock(run,c.clockBefore),clock:readStoryClock(run,c.clockAfter),transitions:clone(c.transitions),publicEffects:effects(c.worldActivityAfter),protectedTargets:clone(c.protectedTargets),definition:storyTimeDefinition(run.snapshot.storyTimeDefinition),rules:['This is the sole current time for this candidate. Preserve all known precision; do not invent a time or another day.','Respect the ordered event transitions, including intervening start/end even if the endpoint effect is absent.','Host public events can occur without being mentioned in the prose. No ordinary State Patch may overwrite these time/event projections.']};}
// Historical before/after checkpoints already live on the owning turn. Keep a
// bounded receipt rather than duplicating both checkpoints inside it again.
export function temporalReceipt(c){
 // Run/snapshot/input/State/clock/activity/definition/plan pins are recovered
 // from the owning immutable turn. The full candidate hash still authenticates
 // all those pins by deterministic replay; do not store duplicate trees.
 const {version,head,epoch,storyRevision}=c.base;
 return {schemaVersion:1,receiptVersion:1,...(c.calendarCut?{calendarCut:clone(c.calendarCut)}:{}),candidateRef:c.candidateRef,candidateHash:c.hash,base:{version,head,epoch,storyRevision},operation:clone(c.operation),transitions:clone(c.transitions),createdObligationIds:clone(c.createdObligationIds)};
}
export function validateTemporalPost(proposal,c,body,blueprint){
 if(proposal.candidateRef!==c.candidateRef)fail('TEMPORAL_CANDIDATE_MISMATCH');
 fields(proposal.temporalCheck,['status','quote'],['status']);if(!['consistent','conflict','uncertain'].includes(proposal.temporalCheck.status))fail('TEMPORAL_CHECK_INVALID');
 if(proposal.temporalCheck.quote!==undefined&&(typeof proposal.temporalCheck.quote!=='string'||!body.includes(proposal.temporalCheck.quote)))fail('QUOTE_NOT_IN_FINAL_BODY');
 if(proposal.temporalCheck.status!=='consistent')fail(proposal.temporalCheck.status==='conflict'?'TEMPORAL_BODY_CONFLICT':'NEEDS_TIME_PRECISION');
 assertTemporalChanges(proposal.stateChanges,blueprint);const copy=clone(proposal);delete copy.candidateRef;delete copy.temporalCheck;return copy;
}
export function temporalCheckpoint(run,c,{body,bodyHash,routeHash,writingModeHash,styleHash,inputHash}={}){
 return {schemaVersion:1,status:body===undefined?'candidate_prepared':'body_frozen',candidate:clone(c),pins:{...clone(c.base),inputHash,routeHash:routeHash??null,writingModeHash,styleHash},...(body!==undefined?{body,bodyHash}:{})};
}
export function validateTemporalCheckpoint(run,checkpoint,pins){
 const c=checkpoint?.candidate;if(!c)fail('TEMPORAL_CHECKPOINT_STALE');const {hash:stored,...content}=c;
 const p=checkpoint.pins;
 if(stored!==hash(content)||p.runId!==run.runId||p.snapshotHash!==run.snapshot.hash||p.version!==run.version||p.head!==(run.head??null)||p.epoch!==run.storyEpoch||p.storyRevision!==run.storyRevision||p.clockHash!==hash(run.storyClock)||p.stateHash!==hash(run.state)||p.activityHash!==hash(run.worldActivity)||Object.entries(pins??{}).some(([k,v])=>p[k]!==v)||checkpoint.body!==undefined&&hash(checkpoint.body)!==checkpoint.bodyHash)fail('TEMPORAL_CHECKPOINT_STALE');return true;
}
export function assertBackgroundSource(run,token){if(token.runId!==run.runId||token.snapshotHash!==run.snapshot.hash||token.epoch!==run.storyEpoch||!run.worldActivity.sourceCuts.some(c=>c.id===token.sourceCutId&&hash(c)===token.sourceCutHash))fail('BACKGROUND_SOURCE_STALE');return true;}
export function temporalRestore(run,next,target,operationId){
 if(!run.storyClock)return;
 next.storyClock={...clone(target.clockBefore),revision:run.storyClock.revision+1,sourceRef:{kind:'history_restore',operationId,restoredHead:next.head,predecessorClockHash:hash(target.clockBefore)}};
 next.worldActivity=clone(resolveActivityCheckpoint(run,target.worldActivityBefore));next.storyEpoch=run.storyEpoch+1;next.storyRevision=run.storyRevision+1;
}
export function validateTemporalRun(run,{provisionalRestore}={}){
 if(!run.storyClock){if(['baselineStoryClock','storyEpoch','storyRevision','worldActivity','baselineWorldActivity','worldActivityCheckpoints'].some(k=>Object.hasOwn(run,k))||run.turns?.some(t=>t.timeResolution||t.clockBefore||t.clockAfter)||(run.retired??[]).some(t=>t.worldActivityBefore||t.worldActivityAfter))fail('STORY_CLOCK_REQUIRED');return true;}
 if(['baselineState','baselineStoryClock','storyEpoch','storyRevision','worldActivity','baselineWorldActivity','worldActivityCheckpoints'].some(k=>!Object.hasOwn(run,k)))fail('TEMPORAL_RUN_INVALID');
 if(validateSnapshot(run.snapshot).hash!==run.snapshot.hash)fail('TEMPORAL_SOURCE_INVALID');
 fields(run.worldActivity,['schemaVersion','occurrences','dailyObligations','sourceCuts']);
 if(run.worldActivity.schemaVersion!==1||!['occurrences','dailyObligations','sourceCuts'].every(k=>Array.isArray(run.worldActivity[k])))fail('TEMPORAL_RUN_INVALID');
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);validatePublicEvents(run.snapshot.publicEvents,d);validateStoryClock(run.storyClock,d);assertNoWritableClock(run.state,run.snapshot.stateBlueprint);
 if(!Number.isSafeInteger(run.storyEpoch)||run.storyEpoch!==(run.retired?.length??0)||!Number.isSafeInteger(run.storyRevision)||run.storyRevision!==run.turns.length+2*(run.retired?.length??0)||!same(run.baselineStoryClock,initializeStoryClock(run.snapshot)))fail('TEMPORAL_RUN_INVALID');
 const digest=hash([run.worldRoutine??null,run.worldActivityCheckpoints,run.retired??[],run.runId,run.snapshot.hash,run.baselineState,run.baselineStoryClock,run.baselineWorldActivity,run.head??null,run.storyClock,run.worldActivity,run.storyEpoch,run.storyRevision,provisionalRestore??null,run.operationReceipts?.[run.storyClock.sourceRef?.operationId]??null,run.turns.map(t=>[t.turn,t.commitId,t.commitVersion,t.input,t.requestId,t.stateBefore,t.clockBefore,t.clockAfter,t.worldActivityBefore,t.worldActivityAfter,t.timeResolution,run.receipts[t.requestId]?.result?.storyClock??null,run.receipts[t.requestId]?.result?.candidateRef??null])]);
 if(validatedTemporalDigests.has(digest))return true;const activityMemo=validateActivityCheckpoints(run);validateWorldRoutine(run);
 const seed=initializeTemporal({runId:run.runId,snapshot:run.snapshot,state:clone(run.baselineState)});if(!same(seed.baselineWorldActivity,run.baselineWorldActivity))fail('TEMPORAL_BASELINE_INVALID');
 const planMemo=new Map();let previousClock=run.baselineStoryClock,previousActivity=run.baselineWorldActivity,previousActivityHash=hash(run.baselineWorldActivity);
 for(const t of run.turns){
  if(!t.timeResolution||!t.clockBefore||!t.clockAfter||!t.worldActivityBefore||!t.worldActivityAfter)fail('TEMPORAL_TURN_INCOMPLETE');
  validateStoryClock(t.clockBefore,d);validateStoryClock(t.clockAfter,d);
  const activityBefore=lookupActivityCheckpoint(run,t.worldActivityBefore,activityMemo),activityAfter=lookupActivityCheckpoint(run,t.worldActivityAfter,activityMemo);
  if(!same(t.clockBefore.position,previousClock.position)||t.worldActivityBefore.checkpointHash!==previousActivityHash)fail('TEMPORAL_CHAIN_INVALID');
  const base=t.timeResolution.base,pseudo={...run,state:t.stateBefore,storyClock:t.clockBefore,worldActivity:activityBefore,version:base.version,head:base.head,storyEpoch:base.epoch,storyRevision:base.storyRevision};
  if(base.version!==t.commitVersion-1||base.head!==(run.turns[t.turn-2]?.commitId??null))fail('TEMPORAL_SOURCE_INVALID');
  const receipt=run.receipts[t.requestId]?.result;
  const planIds=t.timeResolution.calendarCut?run.worldRoutine.calendarCuts[t.timeResolution.calendarCut.cutHash]:null;
  const planFingerprint=planIds?planIds.map(id=>{const p=run.worldRoutine.publications.find(p=>p.id===id);return[p.id,p.hash];}):null;
  const replayDigest=hash([run.runId,run.snapshot.hash,!!run.worldRoutine,t.turn,t.commitId,t.commitVersion,t.input,t.requestId,t.stateBefore,t.clockBefore,t.clockAfter,t.worldActivityBefore.checkpointHash,t.worldActivityAfter.checkpointHash,t.timeResolution,receipt?.storyClock??null,receipt?.candidateRef??null,planFingerprint]);
  if(!validatedTurnReplays.has(replayDigest)){
   const c=prepareTemporalCandidate(pseudo,t.timeResolution.operation,{requestId:t.requestId,inputHash:hash(t.input),planMemo,...(t.timeResolution.calendarCut?{calendarCut:t.timeResolution.calendarCut}:{})});
   if(!same(temporalReceipt(c),t.timeResolution)||!same(c.clockAfter,t.clockAfter)||hash(c.worldActivityAfter)!==t.worldActivityAfter.checkpointHash)fail('TEMPORAL_RESOLUTION_INVALID');
   if(!receipt||!same(receipt.storyClock,t.clockAfter)||receipt.candidateRef!==c.candidateRef)fail('TEMPORAL_RECEIPT_INVALID');
   if(validatedTurnReplays.size>=8192)validatedTurnReplays.delete(validatedTurnReplays.values().next().value);validatedTurnReplays.add(replayDigest);
  }
  previousClock=t.clockAfter;previousActivity=activityAfter;previousActivityHash=t.worldActivityAfter.checkpointHash;
 }
 if(!same(run.storyClock.position,previousClock.position)||!same(run.worldActivity,previousActivity))fail('TEMPORAL_HEAD_INVALID');
 if(!same(run.storyClock,previousClock)){
  const s=run.storyClock.sourceRef,receipt=run.operationReceipts[s.operationId];
  const virtual=provisionalRestore?.operationId===s.operationId&&provisionalRestore?.predecessorClockHash===s.predecessorClockHash;
  if(s.kind!=='history_restore'||(!virtual&&(!receipt||receipt.kind!=='rollback'))||s.restoredHead!==(run.head??null)||!same(run.storyClock.position,previousClock.position)||run.storyClock.revision<=previousClock.revision)fail('TEMPORAL_RESTORE_INVALID');
 }
 const cuts=new Set(run.worldActivity.sourceCuts.map(c=>c.id)),days=new Set();
 for(const o of run.worldActivity.dailyObligations){if(days.has(o.day)||!cuts.has(o.sourceCutId)||o.workerEnabled!==(run.snapshot.worldRoutineDefinition?.forum===true)||o.status!=='pending')fail('TEMPORAL_OBLIGATION_INVALID');days.add(o.day);}
 if(validatedTemporalDigests.size>=16)validatedTemporalDigests.delete(validatedTemporalDigests.values().next().value);validatedTemporalDigests.add(digest);
 return true;
}
