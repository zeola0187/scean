// PostStat owns narrative interpretation. This module only normalizes typed decisions.
import {clone,hash,json,SceanError} from './contracts.mjs';
import {normalizePostBodyTime,storyTimeDefinition,validateStoryClock,readStoryClock,tick,point,dayMinutes} from './story-clock.mjs';
import {postStatOutputContract} from './post-stat-output.mjs';

export const POST_BODY_POLICY='post-body-v1';
export const POST_BODY_CAPABILITY='storyState.postBodyAdjudication.v1';
const fail=(code,path,reason)=>{throw Object.assign(new SceanError(code),{validation:{path,reason}});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
function fields(v,allowed,required,path){if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('POST_STATE_FORMAT',path,'fields');}

export {normalizePostBodyTime};

export function committedTemporalView(run){return {policy:POST_BODY_POLICY,status:'committed_start_of_turn_not_endpoint',clock:readStoryClock(run),definition:storyTimeDefinition(run.snapshot.storyTimeDefinition),publicEvents:clone(run.snapshot.publicEvents??[]),rules:['Clock ranges express uncertainty about now, not elapsed intervals.','Writer determines the story; PostStat adjudicates the endpoint after the complete body. No time tool, evidence table or candidate echo is required.','Preserve known facts and player intent. publicEvents are authored public plans, not completed events; causal rules remain applicable. Published routine plans remain in worldRoutine.']};}

export function postBodyOutputContract(characters){
 const base=postStatOutputContract(characters);const schema=clone(base.schema);delete schema.properties.contractVersion;
 schema.required=['time','stateChanges'];
 schema.properties.time={oneOf:[{type:'object',additionalProperties:false,required:['unchanged'],properties:{unchanged:{const:true}}},{type:'object',additionalProperties:false,required:['elapsedMinutes'],properties:{elapsedMinutes:{type:'integer',minimum:0}}},{type:'object',additionalProperties:false,required:['dayOrdinal'],not:{required:['periodId','minuteOfDay']},properties:{dayOrdinal:{type:'integer',minimum:1},periodId:{type:'string'},minuteOfDay:{type:'integer',minimum:0}}}]};
 schema.properties.eventChanges={type:'array',maxItems:200,items:{type:'object',additionalProperties:false,required:['eventId','status'],properties:{eventId:{type:'string'},status:{enum:['active','completed','cancelled','not_occurred']}}}};
 return {policy:POST_BODY_POLICY,npcStateIds:base.npcStateIds,enforcement:'prompt_contract_only',schema,rules:base.rules.filter(r=>!r.startsWith('Quotes must')&&!r.startsWith('Invalid output')).concat(['Return time and stateChanges. memories, playerHistory and eventChanges are optional. No evidence, quotes, sourceRefs, basis or inference classification is required.','Explicit finalBody facts must be accepted. Infer reasonable unstated duration, quantities and consequences. Director plans are absent and never events. Existing world rules and established past facts remain valid without being repeated.','Choose a plausible endpoint or elapsedMinutes. Do not freeze every ordinary scene, erase explicit elapsed time, or always choose zero merely to avoid a causal deadline. Precision may remain day or period.','Public plans may change; being due does not prove they happened. eventChanges uses only supplied public event IDs. not_occurred is an observation as of this turn, not a permanent prohibition; a later turn may observe it occurring. A cancelled plan may be reinstated by later narrative; append a new result, never rewrite an earlier record. A previously completed occurrence remains historical fact. Attributed claims are not automatically objective facts.','Current Clock and story_events remain Host-stored projections of your typed decision, not generic stateChanges keys. State Blueprint, private permissions and numeric limits still apply.'])};
}

export function normalizePostBodyProposal(value){
 fields(value,['time','stateChanges','memories','playerHistory','eventChanges'],['time','stateChanges'],'/');
 if(!Array.isArray(value.stateChanges))fail('POST_STATE_FORMAT','/stateChanges','array_required');
 for(const k of ['memories','playerHistory','eventChanges'])if(value[k]!==undefined&&!Array.isArray(value[k]))fail('POST_STATE_FORMAT','/'+k,'array_required');
 const events=value.eventChanges??[];if(events.length>200)fail('POST_STATE_FORMAT','/eventChanges','limit');const seen=new Set();
 for(const [i,e]of events.entries()){fields(e,['eventId','status'],['eventId','status'],'/eventChanges/'+i);if(typeof e.eventId!=='string'||!['active','completed','cancelled','not_occurred'].includes(e.status)||seen.has(e.eventId))fail('POST_STATE_FORMAT','/eventChanges/'+i,'invalid_or_duplicate_event');seen.add(e.eventId);}
 return {time:clone(value.time),eventChanges:clone(events),stat:{contractVersion:2,stateChanges:clone(value.stateChanges),memories:clone(value.memories??[]),...(value.playerHistory?{playerHistory:clone(value.playerHistory)}:{})}};
}

const recoverable=new Set(['INVALID_MODEL_JSON','POST_STATE_FORMAT','POST_TIME_INVALID','INVALID_STAT_FIELDS','INVALID_STATE_CHANGES','INVALID_STATE_OPERATION','DUPLICATE_STATE_TARGET','INVALID_STAT_JSON','INVALID_MEMORY_TEXT','INVALID_MEMORY_QUOTES','QUOTE_NOT_IN_FINAL_BODY','INVALID_PLAYER_HISTORY','INVALID_PLAYER_HISTORY_TEXT','INVALID_PLAYER_HISTORY_EPISTEMIC','STAT_CONTRACT_VERSION']);
export function postBodyArgumentRecovery(error){if(error?.category&&['persistence','cancelled'].includes(error.category)||!recoverable.has(error?.code))return null;return {code:error.code,path:error.validation?.path??'/',reason:error.validation?.reason??'invalid_shape',effects:'none',instruction:'Correct this public PostStat output once. Keep the exact frozen body, player request and valid decisions. Never replace a valid time with unchanged to conceal a formatting error. No proof or citation is required. Do not request private access.'};}

export function frozenBodyPins(run,{input,policy=POST_BODY_POLICY,routeHash=null,writingModeHash,styleHash}={}){return {policy,runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null,epoch:run.storyEpoch,clockHash:hash(run.storyClock),stateHash:hash(run.state),activityHash:hash(run.worldActivity),inputHash:hash(input),calendarCut:run.worldRoutine?.currentCalendarCut??null,routeHash,writingModeHash,styleHash};}
export function validateFrozenBody(run,checkpoint,pins){
 if(checkpoint?.schemaVersion!==1||typeof checkpoint.body!=='string'||checkpoint.bodyHash!==hash(checkpoint.body)||checkpoint.pins?.policy!==POST_BODY_POLICY||json(checkpoint.pins)!==json(pins)||!integer(checkpoint.dispatchesUsed)||checkpoint.dispatchesUsed>2)fail('SETTLEMENT_SOURCE_STALE','/checkpoint','source_changed');
 return true;
}

export function postBodySystems(systems){
 const out={...systems};
 let director=out.director.split('\n').filter(l=>!l.startsWith('Temporal refinement policy:')).join('\n');
 const start=director.indexOf('The assembly.temporal packet is the sole current candidate.');
 if(start>=0){const end=director.indexOf('Optional worldRoutine',start);director=director.slice(0,start)+(end<0?'':director.slice(end));}
 director=director.replace('Each section is an array of {text,sourceRefs} objects, never strings.','Optional sections may contain strings or {text} objects.').replace('Source citations must use the supplied catalog. A citation is evidence, not automatic truth.','Public source metadata is supplied by Host; no per-statement citations or proof are required.');
 out.director=director+'\nPlan the scene using the current committed world and player request. No resolve_turn_time, time candidate, origin/basis or evidence table is required. Writer establishes new narrative events; your proposals are not events. Return the minimal handoff schema: sceneIntent is required, all five sections optional. Do not rewrite established past world facts or causal rules just because they were not restated.';
 let writer=out.writer;const old='The context.temporal packet fixes the time precision and ordered public-event transitions before prose. Do not change those premises. Include its exact candidateRef in the JSON display envelope.';
 writer=writer.replace(old,'The context.temporal packet is the committed starting clock, not a settled endpoint. Compose the requested transition naturally; PostStat settles the final time and state. Do not produce a time or event proof table.');
 const guide=writer.indexOf('\nRequired display transport');if(guide>=0)writer=writer.slice(0,guide);
 out.writer=writer+'\nReturn one JSON object with finalBody first and dialogue last: {"finalBody":"the complete story","dialogue":[]}. No sceanWriter constant or candidateRef is required. Optional speech annotations use kind, speakerId, text and occurrence as in outputContract. Annotation errors never authorize rewriting the story.';
 out.prose=out.prose.replace('Host temporal fixes the candidate clock and public events. Never change its precision or settled transitions. The draft supplies narrative results within those preconditions.','The supplied temporal packet is the committed starting clock, not a settled endpoint. The draft supplies narrative results; PostStat adjudicates the resulting time after your final prose.');
 let post=out.post_stat;
 const firstEnd=post.indexOf('\nReturn JSON only');if(firstEnd>=0)post=post.slice(firstEnd);
 post=post.replace('Return JSON only using contractVersion 2: {"contractVersion":2,"stateChanges":[],"memories":[]}.','Return JSON only following outputContract: {"time":{"elapsedMinutes":20},"stateChanges":[]}. No contractVersion echo is required; memories, playerHistory and eventChanges are optional.');
 post=post.replace('For remembered speech or decisions, include concise exact supporting quotes where available:', 'Quotes are not required. If voluntarily included they are exact display quotations, not proof of an inference:');
 out.post_stat='You are PostStat, the authoritative world adjudicator after the final Writer body, not an auditor or quotation extractor. Accept facts explicitly established in finalBody. Infer reasonable unstated duration, quantities, possessions, locations, tasks and effects from the body, prior State and lawful world rules. Established past facts and causal rules remain true without Writer repeating them. A proposed scene is not an established fact; Director/Character plans are not supplied and do not become events unless realized. Attributed speech, guesses and rumors are claims, not automatically objective truth.\nDecide the final time: elapsedMinutes, unchanged:true, or dayOrdinal with optional periodId/minuteOfDay. Coarse precision is valid; unknown time is not midnight. Advance ordinary scenes plausibly instead of freezing indefinitely to evade a causal deadline. Honor explicit elapsed time and player priority. Public plans being due does not prove they happened. Use optional eventChanges for supplied public event IDs; distinguish flexible plans from established causal constraints such as a running fuse. Never request an evidence/sourceRefs/basis/inference table. Host checks typed legality, permissions and atomic persistence, not narrative meaning.\n'+post;
 return out;
}
