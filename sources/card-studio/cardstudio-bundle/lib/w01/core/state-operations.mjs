import {activeCalendarIds,routineCalendarPlan,validateWorldRoutine} from './world-routine.mjs';
import {clone,hash,json,SceanError,safeId,validateSnapshot} from './contracts.mjs';
import {normalizePostBodyTime,storyTimeDefinition,initializeStoryClock,validateStoryClock,readStoryClock,resolveTimeOperation,tick,point,dayMinutes,assertNoWritableClock,assertTemporalChanges} from './story-clock.mjs';
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
const timeTargetSchema={type:'object',additionalProperties:false,oneOf:['dayOrdinal','dayOffset','nextDay','date'].map(key=>({required:[key],not:{anyOf:['dayOrdinal','dayOffset','nextDay','date'].filter(k=>k!==key).map(k=>({required:[k]}))}})),not:{required:['minuteOfDay','periodId']},properties:{dayOrdinal:{type:'integer',minimum:1},dayOffset:{type:'integer',minimum:0},nextDay:{type:'boolean',enum:[true]},minuteOfDay:{type:'integer',minimum:0},periodId:{type:'string'},date:{type:'object',additionalProperties:false,required:['year','month','day'],properties:{year:{type:'integer'},month:{type:'integer'},day:{type:'integer'}}}}};
const timeAmountSchema={type:'object',additionalProperties:false,minProperties:1,properties:{days:{type:'integer',minimum:0},hours:{type:'integer',minimum:0},minutes:{type:'integer',minimum:0}}};
const timeAdvanceSchema={type:'object',additionalProperties:false,required:['kind'],oneOf:[{properties:{kind:{const:'advance_to'}},required:['target'],not:{required:['amount']}},{properties:{kind:{const:'advance_by'}},required:['amount'],not:{required:['target']}}],properties:{kind:{enum:['advance_to','advance_by']},amount:timeAmountSchema,target:timeTargetSchema}};
const timeRefinementSchema={type:'object',additionalProperties:false,required:['target','basis'],properties:{target:timeTargetSchema,basis:{type:'object',additionalProperties:false,required:['kind','sourceRef'],properties:{kind:{enum:['source_statement','editorial_choice']},sourceRef:{type:'string',minLength:1,maxLength:160},quote:{type:'string',minLength:1,maxLength:300}},allOf:[{if:{properties:{kind:{const:'editorial_choice'}}},then:{properties:{sourceRef:{const:'input'}},not:{required:['quote']}}}]}}};
const forbidden=keys=>({not:{anyOf:keys.map(key=>({required:[key]}))}});
export const TIME_TOOL={type:'function',function:{name:'resolve_turn_time',description:'Deterministic transaction candidate before Writer/advice, not a commit. Ordinary unchanged dialogue may use supplied hold. The Clock range is uncertainty about NOW, not an interval already elapsed. You may refine a genuinely unknown same-story-day origin inside its existing range, grounded in public timeSources or an explicitly labelled editorial_choice, without asking the player for every minute. Prefer ONE refine_then_advance call for origin+endpoint; use refine_only only when no advance is intended. Do not replace known time or explicit player overrides. Source statement may cite input, selected opening, or active history:<commitId>; opening is INITIAL scene, never proof later turns are still at that time. Host checks structure/range/provenance, never prose meaning. Keep period/day precision when sufficient. advance_to requires exactly one day selector; same day is dayOffset:0, period alone incomplete. Honor any playerOverride origin/endpoint. Never use hold/zero progress or a guessed next day to erase a failed advance. True unresolved conflicts or mechanically unresolvable necessary events: send needsPrecision:true alone; no guessing. Must settle before time-dependent Character/Stat advice; use returned candidateRef.',parameters:{type:'object',additionalProperties:false,oneOf:[{required:['needsPrecision'],properties:{needsPrecision:{enum:[true]}},...forbidden(['kind','amount','target','refinement','advance'])},{required:['kind'],properties:{needsPrecision:{enum:[false]}},allOf:[{if:{properties:{kind:{const:'hold'}}},then:forbidden(['amount','target','refinement','advance'])},{if:{properties:{kind:{const:'advance_by'}}},then:{required:['amount'],...forbidden(['target','refinement','advance'])}},{if:{properties:{kind:{const:'advance_to'}}},then:{required:['target'],...forbidden(['amount','refinement','advance'])}},{if:{properties:{kind:{const:'refine_only'}}},then:{required:['refinement'],...forbidden(['amount','target','advance'])}},{if:{properties:{kind:{const:'refine_then_advance'}}},then:{required:['refinement','advance'],...forbidden(['amount','target'])}}]}],properties:{needsPrecision:{type:'boolean'},kind:{enum:['hold','advance_by','advance_to','refine_only','refine_then_advance']},sourceRefs:{type:'array',items:{enum:['input']},minItems:1,maxItems:1},amount:timeAmountSchema,target:timeTargetSchema,refinement:timeRefinementSchema,advance:timeAdvanceSchema}}}};
export const isOriginResolutionOperation=op=>['refine_only','refine_then_advance'].includes(op?.kind);
function sourceRows(run,input,inputHash){
 const rows=[{ref:'input',kind:'player_input',text:input??'',hash:inputHash??hash(input??'')}];
 if(typeof run.snapshot.opening?.text==='string')rows.push({ref:'opening',kind:'selected_initial_opening_not_current_time',text:run.snapshot.opening.text,hash:hash(run.snapshot.opening.text)});
 const head=run.head??null,index=head===null?-1:run.turns.findIndex(t=>t.commitId===head);
 if(head!==null&&index<0)fail('TIME_SOURCE_STALE');
 for(const turn of run.turns.slice(0,index+1))rows.push({ref:'history:'+turn.commitId,kind:'active_committed_public_story',text:turn.body,hash:hash(turn.body)});
 return rows;
}
export function timeSourceCatalog(run,input){const rows=sourceRows(run,input,hash(input));return {policyVersion:1,modelRefinement:'same_known_story_day_only',sources:[...rows.filter(r=>r.ref==='input'||r.ref==='opening'),...rows.filter(r=>r.ref.startsWith('history:')).slice(-8)].map(({text,...r})=>r),historyReferences:'Other active history:<commitId> sources may be located through the existing history tools. Retired, future or private sources are forbidden.',semanticResponsibility:'Director interprets source time and player priority. Ref existence is not proof of semantic correctness. Never replay the opening as current time after intervening story.'};}
function resolutionBasis(run,basis,{input,inputHash}={}){
 fields(basis,['kind','sourceRef','quote'],['kind','sourceRef']);if(!['source_statement','editorial_choice'].includes(basis.kind)||typeof basis.sourceRef!=='string')fail('TIME_BASIS_INVALID');
 const source=sourceRows(run,input,inputHash).find(s=>s.ref===basis.sourceRef);if(!source)fail('TIME_SOURCE_INVALID');
 if(basis.kind==='editorial_choice'&&(basis.sourceRef!=='input'||Object.hasOwn(basis,'quote')))fail('TIME_BASIS_INVALID');
 if(basis.quote!==undefined&&(typeof basis.quote!=='string'||!basis.quote.trim()||basis.quote.length>300||!source.text.includes(basis.quote)))fail('TIME_QUOTE_INVALID');
 return {kind:basis.kind,sourceRef:source.ref,sourceHash:source.hash,...(basis.quote!==undefined?{quote:basis.quote}:{})};
}
function targetClock(base,target,d,sourceRef,maxAdvanceDays){const seed={...clone(base),position:{earliest:{dayOrdinal:base.position.earliest.dayOrdinal,minuteOfDay:0},latest:{dayOrdinal:base.position.earliest.dayOrdinal,minuteOfDay:0}},precision:'minute'};delete seed.periodId;return resolveTimeOperation(seed,{kind:'advance_to',target:clone(target),sourceRefs:['input']},d,sourceRef,{maxAdvanceDays});}
function refineOrigin(base,target,d,sourceRef,maxAdvanceDays,{allowEqual=false}={}){
 if(base.position.earliest.dayOrdinal!==base.position.latest.dayOrdinal)fail('TIME_ORIGIN_DAY_UNRESOLVED');
 const origin=targetClock(base,target,d,sourceRef,maxAdvanceDays),lo=tick(origin.position.earliest,d),hi=tick(origin.position.latest,d),baseLo=tick(base.position.earliest,d),baseHi=tick(base.position.latest,d);
 if(lo<baseLo||hi>baseHi)fail('TIME_REFINEMENT_OUTSIDE_BASE');if(!allowEqual&&lo===baseLo&&hi===baseHi)fail('TIME_REFINEMENT_NOT_NARROWER');
 origin.revision=base.revision;return origin;
}
function recoveryIntent(args){
 const advance=args?.kind==='refine_then_advance'?args.advance:args;
 if(advance?.kind==='advance_by'&&advance.amount)return {kind:'advance_by',amount:clone(advance.amount)};
 const target=args?.kind==='refine_only'?args.refinement?.target:advance?.kind==='advance_to'?advance.target:null;
 if(!target||typeof target!=='object')return null;const selectors=['dayOrdinal','dayOffset','nextDay','date'];
 return {kind:args.kind==='refine_only'?'refine_only':'advance_to',target:Object.fromEntries(Object.entries(target).filter(([k])=>!selectors.includes(k))),providedSelectors:Object.fromEntries(Object.entries(target).filter(([k])=>selectors.includes(k)))};
}
export function validateTimeRecovery(intent,args){
 if(!intent)fail('TOOL_RECOVERY_INTENT_CHANGED');const advance=args?.kind==='refine_then_advance'?args.advance:args;
 if(intent.kind==='advance_by'){if(advance?.kind!=='advance_by'||!same(advance.amount,intent.amount))fail('TOOL_RECOVERY_INTENT_CHANGED');return;}
 const target=intent.kind==='refine_only'&&args?.kind==='refine_only'?args.refinement?.target:intent.kind==='advance_to'&&advance?.kind==='advance_to'?advance.target:null;
 if(!target)fail('TOOL_RECOVERY_INTENT_CHANGED');
 const selectors=['dayOrdinal','dayOffset','nextDay','date'],rest=Object.fromEntries(Object.entries(target).filter(([k])=>!selectors.includes(k)));
 if(!same(rest,intent.target))fail('TOOL_RECOVERY_INTENT_CHANGED');
 if(Object.keys(intent.providedSelectors).length){const keys=selectors.filter(k=>target[k]!==undefined);if(keys.length!==1||!Object.hasOwn(intent.providedSelectors,keys[0])||!same(target[keys[0]],intent.providedSelectors[keys[0]]))fail('TOOL_RECOVERY_INTENT_CHANGED');}
}
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
 const active={};for(const o of activity.occurrences){if(o.status!=='occurred')continue;if(o.phase==='start')active[o.eventId]={label:o.label,active:true,sourceRef:o.recordVersion===2?{kind:'post_stat_event',occurrenceId:o.id,observedClock:clone(o.observedClock)}:{kind:'public_event',occurrenceId:o.id,effectivePosition:o.position}};else delete active[o.eventId];}return active;
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
export function validateTimeConfirmation(run,value){
 if(value===undefined)return null;
 fields(value,['schemaVersion','confirmed','mode','target','base',...(value?.schemaVersion===2?['role']:[])]);
 fields(value.base,['runId','snapshotHash','version','head','clockHash']);
 if(![1,2].includes(value.schemaVersion)||value.confirmed!==true||!['refine','advance_to'].includes(value.mode)||value.schemaVersion===2&&(!['origin','endpoint'].includes(value.role)||value.role==='origin'&&value.mode!=='refine'||value.role==='endpoint'&&value.mode!=='advance_to'))fail('TIME_CONFIRMATION_INVALID');
 const b=value.base;if(b.runId!==run.runId||b.snapshotHash!==run.snapshot.hash||b.version!==run.version||b.head!==(run.head??null)||b.clockHash!==hash(run.storyClock))fail('TIME_CONFIRMATION_STALE');
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition),op={kind:'advance_to',target:clone(value.target),sourceRefs:['input']};
 if(value.schemaVersion===2){
  if(value.role==='origin')refineOrigin(run.storyClock,value.target,d,{kind:'time_resolution'},run.worldRoutine?366:31,{allowEqual:true});
  else{const endpoint=targetClock(run.storyClock,value.target,d,{kind:'time_resolution'},run.worldRoutine?366:31);if(tick(endpoint.position.earliest,d)<tick(run.storyClock.position.earliest,d))fail('TIME_BEFORE_KNOWN');}
  return clone(value);
 }
 // Use the existing target parser, with a mechanical lower-bound surrogate only
 // for explicitly confirmed refinement. No narrative parsing or guessed time.
 const seed=value.mode==='refine'?{...clone(run.storyClock),position:{earliest:clone(run.storyClock.position.earliest),latest:clone(run.storyClock.position.earliest)},precision:'minute'}:clone(run.storyClock);delete seed.periodId;
 if(value.mode!=='refine'&&run.storyClock.periodId)seed.periodId=run.storyClock.periodId;
 const resolved=resolveTimeOperation(seed,op,d,{kind:'time_resolution'},{maxAdvanceDays:run.worldRoutine?366:31}),lo=tick(resolved.position.earliest,d),hi=tick(resolved.position.latest,d);
 if(value.mode==='refine'&&(lo<tick(run.storyClock.position.earliest,d)||hi>tick(run.storyClock.position.latest,d)||lo===tick(run.storyClock.position.earliest,d)&&hi===tick(run.storyClock.position.latest,d)))fail('TIME_CONFIRMATION_NOT_REFINEMENT');
 return clone(value);
}
export function timeControlView(run){if(!run.storyClock)return null;const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);return {schemaVersion:1,base:{runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null,clockHash:hash(run.storyClock)},definition:{hoursPerDay:d.hoursPerDay,minutesPerHour:d.minutesPerHour,periods:clone(d.periods)},uncertain:run.storyClock.precision!=='minute',initialDayPrecision:run.turns.length===0&&run.storyClock.precision==='day'};}
export function timeToolArgumentRecovery(error,name,args){
 if(error?.category&&error.category!=='tool')return null;
 const historyPaths={INVALID_HISTORY_TOOL_ARGUMENTS:['/','unexpected_fields'],HISTORY_QUERY_INVALID:['/query','invalid_query'],HISTORY_SEARCH_MODE_INVALID:['/mode','invalid_mode'],HISTORY_SEARCH_LIMIT:['/limit','out_of_range'],HISTORY_READ_RADIUS:['/radius','out_of_range'],HISTORY_READ_LIMIT:['/maxChars','out_of_range']};
 if(['search_history','read_history'].includes(name)&&Object.hasOwn(historyPaths,error?.code??'')){const [path,reason]=historyPaths[error.code];return {ok:false,code:error.code,recovery:'correct_arguments',validation:{path,reason},candidateUnchanged:true,effects:'none',instruction:'Correct the read-only query once within the declared tool schema. Do not change Run, authorization or source. Unknown facts are not permission to guess.'};}
 if(name==='resolve_turn_time'&&error?.code==='NEEDS_TIME_PRECISION'&&error?.timeOriginIssue?.reason==='unresolved_origin')return {ok:false,code:'NEEDS_TIME_PRECISION',recovery:'resolve_origin',validation:{path:'/refinement',reason:'unresolved_origin'},candidateUnchanged:true,effects:'none',intent:recoveryIntent(args),instruction:'The target overlaps the original uncertainty, not a proven backwards jump. Within the SAME known story day, use one refine_then_advance with a legal public source or labelled editorial_choice, retaining the original advance target. Do not guess another day, hold, or replay successful tools. If true conflict remains, request needsPrecision:true.'};
 const issue=error?.timeArgumentIssue;
 if(name==='resolve_turn_time'&&!recoveryIntent(args))return null;
 if(name!=='resolve_turn_time'||error?.code!=='TIME_TARGET_INVALID'||issue?.path!=='/target'||!['missing_date_selector','multiple_date_selectors'].includes(issue.reason))return null;
 return {ok:false,code:'TIME_TARGET_INVALID',recovery:'correct_arguments',validation:clone(issue),requiredExactlyOne:['dayOrdinal','dayOffset','nextDay','date'],intent:recoveryIntent(args),candidateUnchanged:true,effects:'none',instruction:'Correct arguments once using only explicit player intent and supplied evidence. Retain the original valid target fields and advance purpose; never replace it with hold or zero progress. Same-day selector is dayOffset:0 when established. A genuinely unknown same-day origin may instead be resolved by refine_then_advance with legal provenance; true conflicts request needsPrecision:true, never guess another day.'};
}
export function prepareTemporalCandidate(run,operation,{requestId,inputHash,input,calendarCut,planMemo=new Map(),confirmation,pendingEndpoint=false,provisional=false}={}){ 
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);calendarCut??=run.worldRoutine?{cutHash:run.worldRoutine.currentCalendarCut}:undefined;const planKey=calendarCut?.cutHash??'fixed';let plan=planMemo.get(planKey);if(!plan){plan=run.worldRoutine?routineCalendarPlan(run,calendarCut):validatePublicEvents(run.snapshot.publicEvents,d);planMemo.set(planKey,plan);}validateStoryClock(run.storyClock,d);assertNoWritableClock(run.state,run.snapshot.stateBlueprint);
 if(operation.needsPrecision===true){fields(operation,['needsPrecision','sourceRefs'],['needsPrecision']);if(operation.sourceRefs!==undefined&&!same(operation.sourceRefs,['input']))fail('TIME_SOURCE_INVALID');fail('NEEDS_TIME_PRECISION');}
 if(Object.hasOwn(operation,'needsPrecision')){if(operation.needsPrecision!==false)fail('TIME_OPERATION_INVALID');operation=clone(operation);delete operation.needsPrecision;}
 const base={runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null,storyRevision:run.storyRevision,epoch:run.storyEpoch,clockHash:hash(run.storyClock),stateHash:hash(run.state),activityHash:hash(run.worldActivity),definitionHash:hash(d),planHash:hash(plan),requestId,inputHash};
 const candidateRef='tc-'+hash(confirmation?.schemaVersion===2?[base,operation,{playerOverrideHash:hash(confirmation)}]:[base,operation]).slice(0,20),sourceRef={kind:'time_resolution',requestId,candidateRef,operationHash:hash(operation)};
 let after,originResolution,timeOverride,endpointPending=false;
 const maxAdvanceDays=run.worldRoutine?366:31,confirmed=confirmation?validateTimeConfirmation(run,confirmation):null;
 if(operation.kind==='confirm_time'){
  if(!confirmed||confirmed.schemaVersion!==1||!same(operation,{kind:'confirm_time',mode:confirmed.mode,target:confirmed.target,sourceRefs:['player_confirmation']}))fail('TIME_CONFIRMATION_REQUIRED');
  const seed=confirmed.mode==='refine'?{...clone(run.storyClock),position:{earliest:clone(run.storyClock.position.earliest),latest:clone(run.storyClock.position.earliest)},precision:'minute'}:clone(run.storyClock);if(confirmed.mode==='refine')delete seed.periodId;
  after=resolveTimeOperation(seed,{kind:'advance_to',target:confirmed.target,sourceRefs:['input']},d,sourceRef,{maxAdvanceDays});after.revision=run.storyClock.revision+1;
 }else{
  let origin=run.storyClock,advance=operation;
  if(confirmed?.schemaVersion===1)fail('TIME_CONFIRMATION_REQUIRED');
  if(confirmed?.schemaVersion===2){timeOverride={schemaVersion:2,role:confirmed.role,confirmationHash:hash(confirmed),target:clone(confirmed.target)};
   if(confirmed.role==='origin'){origin=refineOrigin(run.storyClock,confirmed.target,d,sourceRef,maxAdvanceDays,{allowEqual:true});originResolution={schemaVersion:1,source:'player_override',clock:clone(origin)};}
  }
  if(isOriginResolutionOperation(operation)){
   fields(operation,['kind','refinement','advance','sourceRefs'],operation.kind==='refine_only'?['kind','refinement']:['kind','refinement','advance']);
   if(operation.kind==='refine_only'&&Object.hasOwn(operation,'advance'))fail('TIME_OPERATION_INVALID');
   if(operation.sourceRefs!==undefined&&!same(operation.sourceRefs,['input']))fail('TIME_SOURCE_INVALID');
   fields(operation.refinement,['target','basis']);
   const basis=resolutionBasis(run,operation.refinement.basis,{input,inputHash});origin=refineOrigin(origin,operation.refinement.target,d,sourceRef,maxAdvanceDays);originResolution={schemaVersion:1,source:confirmed?.role==='origin'?'model_with_player_constraint':'model',clock:clone(origin),basis};
   advance=operation.kind==='refine_only'?{kind:'hold'}:clone(operation.advance);
   if(operation.kind==='refine_then_advance'){fields(advance,['kind','amount','target'],['kind']);if(!['advance_to','advance_by'].includes(advance.kind))fail('TIME_OPERATION_INVALID');}
  }
  try{after=resolveTimeOperation(origin,advance,d,sourceRef,{maxAdvanceDays});}
  catch(e){
   if(e.code==='NEEDS_TIME_PRECISION'&&!originResolution&&advance.kind==='advance_to'&&run.storyClock.precision!=='minute'&&run.storyClock.position.earliest.dayOrdinal===run.storyClock.position.latest.dayOrdinal){
    try{const target=targetClock(run.storyClock,advance.target,d,sourceRef,maxAdvanceDays);if(tick(target.position.earliest,d)>=tick(run.storyClock.position.earliest,d)&&tick(target.position.earliest,d)<tick(run.storyClock.position.latest,d))e.timeOriginIssue={reason:'unresolved_origin'};}catch{}
   }throw e;
  }
  if(originResolution)after={...clone(after),revision:run.storyClock.revision+1,sourceRef:clone(sourceRef)};
  if(tick(after.position.latest,d)-tick(run.storyClock.position.earliest,d)>maxAdvanceDays*dayMinutes(d))fail('TIME_OPERATION_LIMIT');
  if(confirmed?.schemaVersion===2&&confirmed.role==='endpoint'){
   const expected=targetClock(run.storyClock,confirmed.target,d,sourceRef,maxAdvanceDays);
   if(!same(after.position,expected.position)||after.precision!==expected.precision||after.periodId!==expected.periodId){if(pendingEndpoint&&operation.kind==='hold'&&!originResolution)endpointPending=true;else fail('TIME_CONFIRMATION_ENDPOINT_REQUIRED');}
  }
 }
 const activity=clone(run.worldActivity),transitions=[];let settlementPending=false;
 const earliest=tick(after.position.earliest,d),latest=tick(after.position.latest,d),baseLo=tick(run.storyClock.position.earliest,d);
 const ordered=plan.flatMap(e=>['end','start'].map(phase=>({e,phase,at:tick(e[phase],d)}))).sort((a,b)=>a.at-b.at||(a.phase==='end'?-1:1)-(b.phase==='end'?-1:1)||a.e.id.localeCompare(b.e.id));
 for(const {e,phase,at}of ordered){
  if(at<baseLo||at>latest)continue;
  const semantic=hash([e.id,phase,at]);if(activity.occurrences.some(o=>o.semantic===semantic))continue;
  if(at>earliest){if(e.requiredForScene){if(!provisional)fail('NEEDS_TIME_PRECISION');settlementPending=true;}transitions.push({eventId:e.id,phase,position:clone(e[phase]),status:'possibly_due'});continue;}
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
 const candidate={schemaVersion:1,...(settlementPending?{settlementPending:true}:{}),...(originResolution?{originResolution}:{}),...(timeOverride?{timeOverride}:{}),...(endpointPending?{endpointPending:true}:{}),...(calendarCut?{calendarCut:clone(calendarCut)}:{}),candidateRef,base,operation:clone(operation),clockBefore:clone(run.storyClock),clockAfter:after,stateHash:hash(run.state),worldActivityBefore:clone(run.worldActivity),worldActivityAfter:activity,transitions:clone(transitions),createdObligationIds:created,protectedTargets:[{scope:'world',category:'time',key:'current'},{scope:'world',category:'effects',key:'story_events'}]};
 candidate.hash=hash(candidate);return candidate;
}

// Frozen public plans are context, never automatically performed events.
export function postBodyEventCatalog(run,{calendarCut={cutHash:run.worldRoutine?.currentCalendarCut}}={}){
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition),now=tick(run.storyClock.position.earliest,d);
 const rows=clone(run.snapshot.publicEvents??[]);
 if(run.worldRoutine){const ids=run.worldRoutine.calendarCuts[calendarCut.cutHash];if(!Array.isArray(ids)||hash(ids)!==calendarCut.cutHash)fail('CALENDAR_CUT_INVALID');
  for(const id of ids){const p=run.worldRoutine.publications.find(p=>p.id===id);if(!p)fail('CALENDAR_SOURCE_MISSING');
   const visible=tick(p.announcedAt.position.latest,d)<=now||same(p.announcedAt.position,run.storyClock.position);
   if(visible)for(const e of p.events)if(e.announcement==='public')rows.push({id:e.id,label:e.label,start:clone(e.start),end:clone(e.end),...(e.condition?{condition:clone(e.condition)}:{}),requiredForScene:e.requiredForScene});
  }
 }
 return rows.map(e=>{const prior=run.worldActivity.occurrences.filter(o=>o.eventId===e.id).at(-1);return {...e,status:prior?.decision??(prior?.phase==='end'&&prior.status==='occurred'?'completed':prior?.phase==='start'&&prior.status==='occurred'?'active':'planned_not_occurred'),due:tick(e.start,d)<=now};});
}
export function preparePostTemporalCandidate(run,operation,{requestId,inputHash,input,calendarCut,confirmation}={}){
 fields(operation,['kind','bodyHash','time','eventChanges'],['kind','bodyHash','time','eventChanges']);
 if(operation.kind!=='post_body'||typeof operation.bodyHash!=='string'||!/^[a-f0-9]{64}$/.test(operation.bodyHash))fail('POST_STATE_FORMAT');
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);calendarCut??=run.worldRoutine?{cutHash:run.worldRoutine.currentCalendarCut}:undefined;
 const plan=run.worldRoutine?routineCalendarPlan(run,calendarCut):validatePublicEvents(run.snapshot.publicEvents,d);
 const base={runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null,storyRevision:run.storyRevision,epoch:run.storyEpoch,clockHash:hash(run.storyClock),stateHash:hash(run.state),activityHash:hash(run.worldActivity),definitionHash:hash(d),planHash:hash(plan),requestId,inputHash};
 const candidateRef='ps-'+hash([base,operation,confirmation??null]).slice(0,20),sourceRef={kind:'time_resolution',requestId,candidateRef,operationHash:hash(operation)};
 let origin=run.storyClock;const confirmed=confirmation?validateTimeConfirmation(run,confirmation):null;
 if(confirmed?.schemaVersion===1)fail('TIME_CONFIRMATION_REQUEST_CHANGED');
 if(confirmed?.role==='origin')origin=refineOrigin(origin,confirmed.target,d,sourceRef,run.worldRoutine?366:31,{allowEqual:true});
 const after=normalizePostBodyTime(origin,operation.time,d,sourceRef,{maxAdvanceDays:run.worldRoutine?366:31});after.revision=run.storyClock.revision+1;
 if(confirmed?.role==='endpoint'){const target=targetClock(run.storyClock,confirmed.target,d,sourceRef,run.worldRoutine?366:31);if(!same(after.position,target.position))fail('TIME_CONFIRMATION_ENDPOINT_REQUIRED');}
 const activity=clone(run.worldActivity),transitions=[],catalog=postBodyEventCatalog(run,{...(calendarCut?{calendarCut}:{})}),ids=new Set();
 if(!Array.isArray(operation.eventChanges)||operation.eventChanges.length>200)fail('POST_STATE_FORMAT');
 for(const e of operation.eventChanges){fields(e,['eventId','status']);if(ids.has(e.eventId)||!['active','completed','cancelled','not_occurred'].includes(e.status))fail('POST_STATE_FORMAT');ids.add(e.eventId);
  const planEvent=catalog.find(p=>p.id===e.eventId);if(!planEvent)fail('PUBLIC_EVENT_SOURCE_INVALID');
  const previous=activity.occurrences.filter(o=>o.eventId===e.eventId).at(-1);
   if(previous?.decision==='completed'&&e.status!=='completed'||previous?.phase==='end'&&previous.status==='occurred'&&!previous.decision&&e.status!=='completed')fail('PUBLIC_EVENT_HISTORY_CONFLICT');
  if(previous?.decision===e.status)continue;
  const semantic=hash(['post-body-event-v1',e.eventId,e.status,operation.bodyHash,after.position]);
  const phase=e.status==='active'?'start':'end',status=['active','completed'].includes(e.status)||previous?.phase==='start'&&previous.status==='occurred'?'occurred':'did_not_occur';
  const o={id:'occ-'+hash([run.runId,run.storyEpoch,semantic]).slice(0,24),semantic,eventId:e.eventId,label:planEvent.label,phase,position:clone(after.position.earliest),status,decision:e.status,recordVersion:2,observedClock:clone(after.position),epoch:run.storyEpoch,sourceRef:{kind:'post_stat_event',snapshotHash:run.snapshot.hash,bodyHash:operation.bodyHash,planHash:hash(plan)},predicateInputsHash:hash(null)};
  activity.occurrences.push(o);transitions.push(o);
 }
 const created=[];
 for(let day=run.storyClock.position.earliest.dayOrdinal+1;day<=after.position.earliest.dayOrdinal;day++){
  if(activity.dailyObligations.some(o=>o.day===day))continue;
  const boundary={...clone(after),position:{earliest:{dayOrdinal:day,minuteOfDay:0},latest:{dayOrdinal:day,minuteOfDay:0}},precision:'minute'};delete boundary.periodId;
  const past={...activity,occurrences:activity.occurrences.filter(o=>tick(o.position,d)<=tick(boundary.position.earliest,d))};
  const cut=cutFor(run,boundary,past,day,run.head??null);activity.sourceCuts.push(cut);
  const obligation={id:'forum-'+hash([run.runId,run.storyEpoch,day]).slice(0,24),day,epoch:run.storyEpoch,sourceCutId:cut.id,status:'pending',kind:'daily_forum_coverage',workerEnabled:run.snapshot.worldRoutineDefinition?.forum===true};activity.dailyObligations.push(obligation);created.push(obligation.id);
 }
 if(activity.sourceCuts.length>1000||activity.occurrences.length>2048)fail('TEMPORAL_CAPACITY');
 const candidate={schemaVersion:1,...(calendarCut?{calendarCut:clone(calendarCut)}:{}),candidateRef,base,operation:clone(operation),clockBefore:clone(run.storyClock),clockAfter:after,stateHash:hash(run.state),worldActivityBefore:clone(run.worldActivity),worldActivityAfter:activity,transitions,createdObligationIds:created,protectedTargets:[{scope:'world',category:'time',key:'current'},{scope:'world',category:'effects',key:'story_events'}]};candidate.hash=hash(candidate);return candidate;
}

export function candidateView(run,c){return {schemaVersion:1,...(c.settlementPending?{settlementPending:true}:{}),...(c.originResolution?{originResolution:clone(c.originResolution)}:{}),...(c.timeOverride?{playerOverride:clone(c.timeOverride)}:{}),...(c.endpointPending?{endpointPending:true}:{}),resolutionPolicy:{version:1,modelOriginRefinement:'same_known_story_day_only',source:'legal public statements or labelled editorial choices within unknown origin; never rewrite known facts',playerPriority:'playerOverride is binding; origin may only be narrowed within player bounds when needed, never widened or contradicted; preserve an endpoint override exactly'},status:'transaction_candidate_not_published',candidateRef:c.candidateRef,candidateHash:c.hash,clockBefore:readStoryClock(run,c.clockBefore),clock:readStoryClock(run,c.clockAfter),transitions:clone(c.transitions),publicEffects:effects(c.worldActivityAfter),protectedTargets:clone(c.protectedTargets),definition:storyTimeDefinition(run.snapshot.storyTimeDefinition),rules:['This candidate is not committed. Preserve known time and player constraints. Legal origin refinement inside uncertainty is allowed by resolutionPolicy, never fabrication of source facts or a guessed next day. If settlementPending or endpointPending, resolve time before advice or handoff.','Respect the ordered event transitions, including intervening start/end even if the endpoint effect is absent.','Host public events can occur without being mentioned in the prose. No ordinary State Patch may overwrite these time/event projections.']};}
// Historical before/after checkpoints already live on the owning turn. Keep a
// bounded receipt rather than duplicating both checkpoints inside it again.
export function temporalReceipt(c){
 // Run/snapshot/input/State/clock/activity/definition/plan pins are recovered
 // from the owning immutable turn. The full candidate hash still authenticates
 // all those pins by deterministic replay; do not store duplicate trees.
 const {version,head,epoch,storyRevision}=c.base;
 return {schemaVersion:1,receiptVersion:c.operation.kind==='post_body'?2:1,...(c.calendarCut?{calendarCut:clone(c.calendarCut)}:{}),candidateRef:c.candidateRef,candidateHash:c.hash,base:{version,head,epoch,storyRevision},operation:clone(c.operation),transitions:clone(c.transitions),createdObligationIds:clone(c.createdObligationIds)};
}
export function validateTemporalPost(proposal,c,body,blueprint){
 if(c.endpointPending)fail('TIME_CONFIRMATION_ENDPOINT_REQUIRED');
 if(c.settlementPending)fail('NEEDS_TIME_PRECISION');
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
 const digest=hash([run.worldRoutine??null,run.worldActivityCheckpoints,run.retired??[],run.runId,run.snapshot.hash,run.baselineState,run.baselineStoryClock,run.baselineWorldActivity,run.head??null,run.storyClock,run.worldActivity,run.storyEpoch,run.storyRevision,provisionalRestore??null,run.operationReceipts?.[run.storyClock.sourceRef?.operationId]??null,run.turns.map(t=>[t.turn,t.commitId,t.commitVersion,t.input,hash(t.body),t.requestId,t.stateBefore,t.clockBefore,t.clockAfter,t.worldActivityBefore,t.worldActivityAfter,t.timeResolution,t.timeConfirmation??null,run.receipts[t.requestId]?.timeConfirmation??null,run.receipts[t.requestId]?.result?.storyClock??null,run.receipts[t.requestId]?.result?.candidateRef??null])]);
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
   // Body identity must be checked even when the mechanical replay is cached.
   if(t.timeResolution.receiptVersion===2&&(t.timeResolution.operation.kind!=='post_body'||t.timeResolution.operation.bodyHash!==hash(t.body)))fail('TEMPORAL_SOURCE_INVALID');
  if(!same(run.receipts[t.requestId]?.timeConfirmation??null,t.timeConfirmation??null)||t.timeConfirmation?.schemaVersion===1&&t.timeResolution.operation.kind!=='confirm_time')fail('TIME_CONFIRMATION_INVALID');
  const planIds=t.timeResolution.calendarCut?run.worldRoutine.calendarCuts[t.timeResolution.calendarCut.cutHash]:null;
  const planFingerprint=planIds?planIds.map(id=>{const p=run.worldRoutine.publications.find(p=>p.id===id);return[p.id,p.hash];}):null;
  const timeSourcePin=isOriginResolutionOperation(t.timeResolution.operation)?resolutionBasis(pseudo,t.timeResolution.operation.refinement.basis,{input:t.input,inputHash:hash(t.input)}):null;
   const replayDigest=hash([timeSourcePin,run.runId,run.snapshot.hash,!!run.worldRoutine,t.turn,t.commitId,t.commitVersion,t.input,t.requestId,t.stateBefore,t.clockBefore,t.clockAfter,t.worldActivityBefore.checkpointHash,t.worldActivityAfter.checkpointHash,t.timeResolution,t.timeConfirmation??null,receipt?.storyClock??null,receipt?.candidateRef??null,planFingerprint]);
  if(!validatedTurnReplays.has(replayDigest)){
   const c=(t.timeResolution.receiptVersion===2?preparePostTemporalCandidate:prepareTemporalCandidate)(pseudo,t.timeResolution.operation,{requestId:t.requestId,inputHash:hash(t.input),input:t.input,planMemo,confirmation:t.timeConfirmation,...(t.timeResolution.calendarCut?{calendarCut:t.timeResolution.calendarCut}:{})});
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
