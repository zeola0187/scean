// Host-owned story time. No Date, model, filesystem or executable calendar rules.
import {SceanError,clone,hash,json,safeId} from './contracts.mjs';
const fail=code=>{throw new SceanError(code);};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
function fields(v,allowed,required=[]){if(!obj(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!allowed.includes(k)))fail('STORY_TIME_FIELDS');}
const int=(v,min=0,max=1000000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const clockAliases=new Set(['storyClock','story_clock','currentTime','currentDate','current_time','current_date','now']);
export const DEFAULT_STORY_TIME=Object.freeze({schemaVersion:1,calendar:{id:'story-relative',version:1,kind:'relative'},hoursPerDay:24,minutesPerHour:60,periods:{morning:{start:360,end:719},afternoon:{start:720,end:1079},night:{start:1080,end:1439}},initial:{dayOrdinal:1,precision:'day'}});
export function storyTimeDefinition(input){
 const d=clone(input??DEFAULT_STORY_TIME);
 fields(d,['schemaVersion','calendar','hoursPerDay','minutesPerHour','periods','initial'],['schemaVersion','calendar','hoursPerDay','minutesPerHour','periods','initial']);
 if(d.schemaVersion!==1||!int(d.hoursPerDay,1,100)||!int(d.minutesPerHour,1,1000))fail('STORY_CALENDAR_INVALID');
 fields(d.calendar,['id','version','kind','monthLengths','monthNames','weekLength','era','anchor'],['id','version','kind']);safeId(d.calendar.id);
 if(!int(d.calendar.version,1)||!['relative','fixed-month'].includes(d.calendar.kind))fail('STORY_CALENDAR_INVALID');
 if(d.calendar.kind==='fixed-month'){
  if(!Array.isArray(d.calendar.monthLengths)||!d.calendar.monthLengths.length||d.calendar.monthLengths.length>50||d.calendar.monthLengths.some(n=>!int(n,1,1000)))fail('STORY_CALENDAR_INVALID');
  const a=d.calendar.anchor;fields(a,['year','month','day'],['year','month','day']);
  if(!int(a.year,1,1000000)||!int(a.month,1,d.calendar.monthLengths.length)||!int(a.day,1,d.calendar.monthLengths[a.month-1]))fail('STORY_CALENDAR_INVALID');
  if(d.calendar.monthNames!==undefined&&(!Array.isArray(d.calendar.monthNames)||d.calendar.monthNames.length!==d.calendar.monthLengths.length||d.calendar.monthNames.some(s=>typeof s!=='string'||!s.trim()||s.length>64)))fail('STORY_CALENDAR_INVALID');
 }
 if(d.calendar.weekLength!==undefined&&!int(d.calendar.weekLength,1,100))fail('STORY_CALENDAR_INVALID');
 if(d.calendar.era!==undefined&&(typeof d.calendar.era!=='string'||d.calendar.era.length>64))fail('STORY_CALENDAR_INVALID');
 if(!obj(d.periods)||Object.keys(d.periods).length>24)fail('STORY_CALENDAR_INVALID');
 for(const [key,p]of Object.entries(d.periods)){safeId(key);fields(p,['start','end'],['start','end']);if(!int(p.start,0,dayMinutes(d)-1)||!int(p.end,p.start,dayMinutes(d)-1))fail('STORY_PERIOD_INVALID');}
 fields(d.initial,['dayOrdinal','precision','minuteOfDay','periodId'],['dayOrdinal','precision']);
 initialPosition(d);return d;
}
export const dayMinutes=d=>d.hoursPerDay*d.minutesPerHour;
export function tick(p,d){if(!obj(p)||Object.keys(p).some(k=>!['dayOrdinal','minuteOfDay'].includes(k))||!int(p.dayOrdinal,1,1000000)||!int(p.minuteOfDay,0,dayMinutes(d)-1))fail('STORY_POSITION_INVALID');return (p.dayOrdinal-1)*dayMinutes(d)+p.minuteOfDay;}
export function point(t,d){if(!int(t,0,1000000*dayMinutes(d)-1))fail('STORY_POSITION_INVALID');return {dayOrdinal:Math.floor(t/dayMinutes(d))+1,minuteOfDay:t%dayMinutes(d)};}
function initialPosition(d){
 const i=d.initial;if(!int(i.dayOrdinal,1,1000000)||!['day','period','minute'].includes(i.precision))fail('STORY_INITIAL_INVALID');
 if(i.precision==='day'){if(i.minuteOfDay!==undefined||i.periodId!==undefined)fail('STORY_INITIAL_INVALID');return {earliest:{dayOrdinal:i.dayOrdinal,minuteOfDay:0},latest:{dayOrdinal:i.dayOrdinal,minuteOfDay:dayMinutes(d)-1}};}
 if(i.precision==='period'){const p=d.periods[i.periodId];if(!p||i.minuteOfDay!==undefined)fail('STORY_INITIAL_INVALID');return {earliest:{dayOrdinal:i.dayOrdinal,minuteOfDay:p.start},latest:{dayOrdinal:i.dayOrdinal,minuteOfDay:p.end}};}
 if(!int(i.minuteOfDay,0,dayMinutes(d)-1)||i.periodId!==undefined)fail('STORY_INITIAL_INVALID');return {earliest:{dayOrdinal:i.dayOrdinal,minuteOfDay:i.minuteOfDay},latest:{dayOrdinal:i.dayOrdinal,minuteOfDay:i.minuteOfDay}};
}
export function initializeStoryClock(snapshot){const d=storyTimeDefinition(snapshot.storyTimeDefinition);return {schemaVersion:1,definitionHash:hash(d),position:initialPosition(d),precision:d.initial.precision,...(d.initial.periodId?{periodId:d.initial.periodId}:{}),revision:0,sourceRef:{kind:'run_initialization',snapshotHash:snapshot.hash}};}
export function validateStoryClock(c,d){
 fields(c,['schemaVersion','definitionHash','position','precision','periodId','revision','sourceRef'],['schemaVersion','definitionHash','position','precision','revision','sourceRef']);
 fields(c.position,['earliest','latest'],['earliest','latest']);
 const lo=tick(c.position.earliest,d),hi=tick(c.position.latest,d);
 if(c.schemaVersion!==1||c.definitionHash!==hash(d)||!int(c.revision)||lo>hi||hi-lo>31*dayMinutes(d)||!['minute','period','day','range'].includes(c.precision))fail('STORY_CLOCK_INVALID');
 if(c.precision==='minute'&&lo!==hi||c.precision==='day'&&(c.position.earliest.dayOrdinal!==c.position.latest.dayOrdinal||c.position.earliest.minuteOfDay!==0||c.position.latest.minuteOfDay!==dayMinutes(d)-1))fail('STORY_CLOCK_PRECISION');
 if(c.precision==='period'){const p=d.periods[c.periodId];if(!p||c.position.earliest.dayOrdinal!==c.position.latest.dayOrdinal||c.position.earliest.minuteOfDay!==p.start||c.position.latest.minuteOfDay!==p.end)fail('STORY_CLOCK_PRECISION');}
 else if(c.periodId!==undefined)fail('STORY_CLOCK_PRECISION');
 if(!obj(c.sourceRef)||!['run_initialization','time_resolution','history_restore'].includes(c.sourceRef.kind))fail('STORY_CLOCK_SOURCE');return c;
}
export function calendarDate(day,d){
 if(d.calendar.kind==='relative')return {label:`故事第 ${day} 日`,dayOrdinal:day};
 const lengths=d.calendar.monthLengths,a=d.calendar.anchor,yearLength=lengths.reduce((x,n)=>x+n,0),ordinal=(a.year-1)*yearLength+lengths.slice(0,a.month-1).reduce((x,n)=>x+n,0)+a.day-1+day-1;
 let remain=ordinal%yearLength,month=1;while(remain>=lengths[month-1])remain-=lengths[month++-1];const year=Math.floor(ordinal/yearLength)+1,date=remain+1;
  return {year,month,day:date,label:`${d.calendar.era??''}${year}年 ${d.calendar.monthNames?.[month-1]??`${month}月`} ${date}日`,...(d.calendar.weekLength?{weekday:ordinal%d.calendar.weekLength+1}:{})};
}
export function readStoryClock(run,c=run.storyClock){
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);validateStoryClock(c,d);
 const view={...clone(c),calendarId:d.calendar.id,earliestDate:calendarDate(c.position.earliest.dayOrdinal,d),latestDate:calendarDate(c.position.latest.dayOrdinal,d),authority:'host_story_clock',readOnly:true};
 return Object.freeze(view);
}
// Presentation only; preserve the Clock's precision and the authored day length.
export function storyClockLabel(run,c=run.storyClock){
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition);validateStoryClock(c,d);
 const date=p=>calendarDate(p.dayOrdinal,d).label;
 const at=p=>`${date(p)} ${String(Math.floor(p.minuteOfDay/d.minutesPerHour)).padStart(2,'0')}:${String(p.minuteOfDay%d.minutesPerHour).padStart(2,'0')}`;
 if(c.precision==='day')return date(c.position.earliest);
 if(c.precision==='period'){
  const names={morning:'上午',afternoon:'下午',night:'夜間',morning_watch:'早班',afternoon_shift:'下午班',evening_hearth:'晚間',night_drift:'夜航'};
  return `${date(c.position.earliest)} · ${names[c.periodId]??c.periodId}（時段）`;
 }
 return c.precision==='minute'?at(c.position.earliest):`${at(c.position.earliest)} ～ ${at(c.position.latest)}（範圍）`;
}
export function resolveTimeOperation(base,op,d,sourceRef,{maxAdvanceDays=31}={}){
 validateStoryClock(base,d);fields(op,['kind','amount','target','sourceRefs'],['kind']);
 if(op.sourceRefs!==undefined&&(json(op.sourceRefs)!==json(['input'])))fail('TIME_SOURCE_INVALID');
 if(!['hold','advance_by','advance_to'].includes(op.kind))fail('TIME_OPERATION_INVALID');
 let lo=tick(base.position.earliest,d),hi=tick(base.position.latest,d),precision=base.precision,periodId=base.periodId;
 if(op.kind==='hold'){if(op.amount!==undefined||op.target!==undefined)fail('TIME_OPERATION_INVALID');return clone(base);}
 if(op.kind==='advance_by'){
  fields(op.amount,['days','hours','minutes']);if(op.target!==undefined||!Object.keys(op.amount).length||Object.values(op.amount).some(n=>!int(n,0,1000000)))fail('TIME_OPERATION_INVALID');
  const delta=(op.amount.days??0)*dayMinutes(d)+(op.amount.hours??0)*d.minutesPerHour+(op.amount.minutes??0);
  if(!int(delta,0,maxAdvanceDays*dayMinutes(d)))fail('TIME_OPERATION_LIMIT');lo+=delta;hi+=delta;
  if(delta%daily(d)===0&&base.precision==='day')precision='day';else if(delta===0)precision=base.precision;else precision=lo===hi?'minute':'range';
  if(precision!=='period')periodId=undefined;
 }else{
  fields(op.target,['dayOrdinal','dayOffset','nextDay','minuteOfDay','periodId','date']);if(op.amount!==undefined)fail('TIME_OPERATION_INVALID');
  const t=op.target;const selectors=['dayOrdinal','dayOffset','nextDay','date'].filter(k=>t[k]!==undefined);if(selectors.length!==1){const e=new SceanError('TIME_TARGET_INVALID');e.timeArgumentIssue={path:'/target',reason:selectors.length?'multiple_date_selectors':'missing_date_selector'};throw e;}
  let day;
  if(t.dayOrdinal!==undefined){if(!int(t.dayOrdinal,1,1000000))fail('TIME_TARGET_INVALID');day=t.dayOrdinal;}
  else if(t.date){if(d.calendar.kind!=='fixed-month')fail('TIME_TARGET_INVALID');fields(t.date,['year','month','day'],['year','month','day']);const c=d.calendar,a=c.anchor,x=t.date;if(!int(x.year,1,1000000)||!int(x.month,1,c.monthLengths.length)||!int(x.day,1,c.monthLengths[x.month-1]))fail('TIME_TARGET_INVALID');const serial=q=>(q.year-1)*c.monthLengths.reduce((s,n)=>s+n,0)+c.monthLengths.slice(0,q.month-1).reduce((s,n)=>s+n,0)+q.day-1;day=serial(x)-serial(a)+1;}
  else{if(base.position.earliest.dayOrdinal!==base.position.latest.dayOrdinal)fail('NEEDS_TIME_PRECISION');if(t.nextDay!==undefined&&t.nextDay!==true||t.dayOffset!==undefined&&!int(t.dayOffset,0,maxAdvanceDays))fail('TIME_TARGET_INVALID');day=base.position.earliest.dayOrdinal+(t.nextDay?1:t.dayOffset);}
  if(t.periodId!==undefined){const p=d.periods[t.periodId];if(!p||t.minuteOfDay!==undefined)fail('NEEDS_TIME_PRECISION');lo=tick({dayOrdinal:day,minuteOfDay:p.start},d);hi=tick({dayOrdinal:day,minuteOfDay:p.end},d);precision='period';periodId=t.periodId;}
  else if(t.minuteOfDay!==undefined){lo=hi=tick({dayOrdinal:day,minuteOfDay:t.minuteOfDay},d);precision='minute';periodId=undefined;}
  else{lo=tick({dayOrdinal:day,minuteOfDay:0},d);hi=tick({dayOrdinal:day,minuteOfDay:dayMinutes(d)-1},d);precision='day';periodId=undefined;}
  if(lo<tick(base.position.latest,d))fail('NEEDS_TIME_PRECISION');
  if(hi-tick(base.position.earliest,d)>maxAdvanceDays*dayMinutes(d))fail('TIME_OPERATION_LIMIT');
 }
 const after={...clone(base),position:{earliest:point(lo,d),latest:point(hi,d)},precision,revision:base.revision+1,sourceRef:clone(sourceRef)};delete after.periodId;if(periodId)after.periodId=periodId;validateStoryClock(after,d);return after;
}
const daily=dayMinutes;
export function assertNoWritableClock(state,blueprint){
 for(const bucket of [state.world,...Object.values(state.characters??{}).flatMap(c=>[c.public??{},c.private??{}])]){
  if(Object.keys(bucket).some(k=>clockAliases.has(k))||Object.values(bucket).some(v=>obj(v)&&Object.keys(v).some(k=>clockAliases.has(k))))fail('STORY_CLOCK_WRITE_FORBIDDEN');
  for(const [key,value]of Object.entries(bucket.time??{})){
   if(!blueprint?.variables.some(v=>v.category==='time'&&v.key===key&&['duration','deadline','timer'].includes(v.temporalKind))&&(!obj(value)||!['duration','deadline','timer'].includes(value.temporalKind)))fail('STORY_CLOCK_WRITE_FORBIDDEN');
   if(['current','now','storyClock','story_clock'].includes(key))fail('STORY_CLOCK_WRITE_FORBIDDEN');
  }
  if(Object.hasOwn(bucket.effects??{},'story_events'))fail('PUBLIC_EVENT_WRITE_FORBIDDEN');
 }
 for(const v of blueprint?.variables??[])if(v.category==='time'&&v.authority!=='story_clock_projection'&&!['duration','deadline','timer'].includes(v.temporalKind)||clockAliases.has(v.key))fail('STORY_CLOCK_WRITE_FORBIDDEN');
}
export function assertTemporalChanges(changes,blueprint){for(const c of changes??[]){
 const typed=blueprint?.variables.some(v=>v.category==='time'&&v.key===c.key&&v.scope===c.scope&&v.characterId===c.characterId&&['duration','deadline','timer'].includes(v.temporalKind));
 if(clockAliases.has(c.key)||c.category==='time'&&(['current','now'].includes(c.key)||!typed&&(c.operation!=='set'||!['duration','deadline','timer'].includes(c.value?.temporalKind))))fail('STORY_CLOCK_WRITE_FORBIDDEN');
 if(c.category==='effects'&&c.key==='story_events')fail('PUBLIC_EVENT_WRITE_FORBIDDEN');
}}

export function normalizePostBodyTime(base,decision,d,sourceRef,{maxAdvanceDays=31}={}){
 const fail=(code,path,reason)=>{throw Object.assign(new SceanError(code),{validation:{path,reason}});};
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
 const fields=(v,allowed,required,path)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('POST_STATE_FORMAT',path,'fields');};
 validateStoryClock(base,d);if(!object(decision))fail('POST_STATE_FORMAT','/time','object_required');
 let lo=tick(base.position.earliest,d),hi=tick(base.position.latest,d),precision=base.precision,periodId=base.periodId;
 const keys=Object.keys(decision);
 if(Object.hasOwn(decision,'unchanged')){
  fields(decision,['unchanged'],['unchanged'],'/time');if(decision.unchanged!==true)fail('POST_STATE_FORMAT','/time/unchanged','true_required');
 }else if(Object.hasOwn(decision,'elapsedMinutes')){
  fields(decision,['elapsedMinutes'],['elapsedMinutes'],'/time');const delta=decision.elapsedMinutes;
  if(!integer(delta)||delta>maxAdvanceDays*dayMinutes(d))fail('POST_TIME_INVALID','/time/elapsedMinutes','out_of_range');
  lo+=delta;hi+=delta;if(delta){precision=lo===hi?'minute':base.precision==='day'&&delta%dayMinutes(d)===0?'day':'range';periodId=undefined;}
 }else{
  fields(decision,['dayOrdinal','periodId','minuteOfDay'],['dayOrdinal'],'/time');
  if(!integer(decision.dayOrdinal,1)||decision.dayOrdinal>1000000||Object.hasOwn(decision,'periodId')&&Object.hasOwn(decision,'minuteOfDay'))fail('POST_TIME_INVALID','/time','invalid_position');
  let start=0,end=dayMinutes(d)-1;precision='day';periodId=undefined;
  if(Object.hasOwn(decision,'periodId')){const p=d.periods[decision.periodId];if(typeof decision.periodId!=='string'||!p)fail('POST_TIME_INVALID','/time/periodId','unknown_period');start=p.start;end=p.end;precision='period';periodId=decision.periodId;}
  if(Object.hasOwn(decision,'minuteOfDay')){if(!integer(decision.minuteOfDay)||decision.minuteOfDay>=dayMinutes(d))fail('POST_TIME_INVALID','/time/minuteOfDay','out_of_range');start=end=decision.minuteOfDay;precision='minute';}
  lo=tick({dayOrdinal:decision.dayOrdinal,minuteOfDay:start},d);hi=tick({dayOrdinal:decision.dayOrdinal,minuteOfDay:end},d);
  const known=tick(base.position.earliest,d);if(hi<known)fail('POST_TIME_INVALID','/time','before_known_clock');
  if(lo<known){lo=known;precision=lo===hi?'minute':'range';periodId=undefined;}
 }
 if(hi-tick(base.position.earliest,d)>maxAdvanceDays*dayMinutes(d))fail('TIME_OPERATION_LIMIT','/time','advance_limit');
 const after={...clone(base),position:{earliest:point(lo,d),latest:point(hi,d)},precision,revision:base.revision+1,sourceRef:clone(sourceRef)};
 delete after.periodId;if(periodId)after.periodId=periodId;validateStoryClock(after,d);return after;
}
