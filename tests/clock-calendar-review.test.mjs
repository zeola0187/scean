import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {routineFixture} from '../fixtures/w29-routine-synthetic.mjs';
import {DEFAULT_STORY_TIME,storyClockLabel,resolveTimeOperation,storyTimeDefinition} from '../core/story-clock.mjs';
import {clone,hash} from '../core/contracts.mjs';
import {publicRunView,publicInspection,publicTurnResult} from '../core/inspection.mjs';
import {jobContract,validateBackgroundProposal,calendarFailureDiagnostic,calendarDiagnosticCode,calendarPlanningStatus} from '../core/world-routine.mjs';
import {publicRoutineRead} from '../plugin/world-routine-reader.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {calendarPlanningText,calendarDiagnosticText} from '../isolated/web/world-routine-ui.mjs';
const period={...clone(DEFAULT_STORY_TIME),periods:{...clone(DEFAULT_STORY_TIME.periods),afternoon_shift:{start:720,end:1079}},initial:{dayOrdinal:1,precision:'period',periodId:'afternoon_shift'}};
const proposal=(events=[])=>({schemaVersion:1,kind:'calendar_plan',dayStart:1,dayEnd:7,events});
const event=(patch={})=>({key:'public-repair',label:'Synthetic public repair',scope:'public_world',start:{dayOrdinal:2,minuteOfDay:0},end:{dayOrdinal:2,minuteOfDay:120},announcement:'public',requiredForScene:false,...patch});
async function fixture(options={}){return routineFixture({policy:{forum:false},...options});}

test('player Clock label preserves period/day precision; public State rows omit only Host current, Inspector keeps raw Clock',async()=>{
 const bp={schemaVersion:1,id:'synthetic-watch',version:1,extensionPolicy:'allow',variables:[{scope:'world',category:'facts',key:'ship_watch_period',displayName:'自訂船上作息',type:'string',visibility:'public'}]};
 const f=await fixture({snapshot:{storyTimeDefinition:period,stateBlueprint:bp,initialState:{schemaVersion:1,blueprintId:bp.id,blueprintVersion:1,values:[{scope:'world',category:'facts',key:'ship_watch_period',value:'作者自訂作息原文',source:{id:'synthetic-card',version:1}}]}}});try{
  const r=await f.read(),before=hash(r),view=publicRunView(r),inspector=publicInspection(r);
  assert.equal(view.storyClockLabel,'故事第 1 日 · 下午班（時段）');assert(!/12:00|17:59/.test(view.storyClockLabel));
  assert(!view.worldView.otherState.some(x=>x.category==='time'&&x.key==='current'));
  assert.equal(view.worldView.declared.find(x=>x.key==='ship_watch_period').value,'作者自訂作息原文');
  assert.equal(inspector.state.world.time.current.authority,'host_story_clock');assert.equal(inspector.storyClock.definitionHash,r.storyClock.definitionHash);
  assert.equal(hash(await f.read()),before);assert.equal(f.calls.length,0);
 }finally{await f.host.close();}
 const day=await fixture({snapshot:{storyTimeDefinition:DEFAULT_STORY_TIME}});try{assert.equal(storyClockLabel(await day.read()),'故事第 1 日');}finally{await day.host.close();}
});

test('Clock label uses custom calendar, minutesPerHour/day length and explicit uncertain ranges; old Run remains readable',async()=>{
 const def={...clone(DEFAULT_STORY_TIME),hoursPerDay:20,minutesPerHour:90,periods:{watch_custom:{start:90,end:179}},calendar:{id:'synthetic-moons',version:1,kind:'fixed-month',monthLengths:[2,3],monthNames:['甲月','乙月'],era:'合成曆 ',anchor:{year:7,month:2,day:3}},initial:{dayOrdinal:1,precision:'minute',minuteOfDay:1791}};
 const f=await fixture({snapshot:{storyTimeDefinition:def}});try{
  const r=await f.read();assert.equal(storyClockLabel(r),'合成曆 7年 乙月 3日 19:81');
  const next=resolveTimeOperation(r.storyClock,{kind:'advance_by',amount:{minutes:20}},storyTimeDefinition(def),{kind:'time_resolution'});assert.equal(storyClockLabel(r,next),'合成曆 8年 甲月 1日 00:11');
  const range={...clone(r.storyClock),precision:'range',position:{earliest:{dayOrdinal:1,minuteOfDay:1791},latest:{dayOrdinal:2,minuteOfDay:11}}};assert.match(storyClockLabel(r,range),/19:81 ～ 合成曆 8年 甲月 1日 00:11（範圍）/);
  const legacy=clone(r);delete legacy.storyClock;delete legacy.worldRoutine;legacy.state.world.time={authored_date:'舊局第七夜'};const v=publicRunView(legacy);assert.equal(v.storyClockLabel,undefined);assert.equal(v.state.world.time.authored_date,'舊局第七夜');assert.equal(publicRoutineRead(legacy,{kind:'calendar'}).status,'not_enabled');
 }finally{await f.host.close();}
});

test('calendar schema/example/rules agree on unplanned starts, strict latest cutoff and end horizon',async()=>{
 const f=await fixture({snapshot:{storyTimeDefinition:period}});try{
  const r=await f.read(),j=f.host.worldRoutine.nextJob(r),c=jobContract(j,r.snapshot.storyTimeDefinition,r.storyClock),e=c.schema.properties.events.items;
  assert.deepEqual(e.properties.start.properties.dayOrdinal.enum,[1,2,3,4,5,6,7]);assert.equal(e.properties.start.oneOf[0].properties.minuteOfDay.minimum,1080);
  assert.equal(e.properties.end.anyOf[1].properties.minuteOfDay.const,0);assert(c.rules.some(x=>x.includes('strictly later than clock.position.latest')));
  assert.equal(validateBackgroundProposal(r,j,c.example).events.length,1);assert.deepEqual(validateBackgroundProposal(r,j,proposal()),{decision:'publish',events:[]});
  assert.equal(validateBackgroundProposal(r,j,proposal([event({start:{dayOrdinal:1,minuteOfDay:1080},end:{dayOrdinal:8,minuteOfDay:0}})])).events.length,1);
  const custom={...r.snapshot.storyTimeDefinition,hoursPerDay:20,minutesPerHour:90};assert.equal(jobContract(j,custom,r.storyClock).schema.properties.events.items.properties.start.properties.minuteOfDay.maximum,1799);
 }finally{await f.host.close();}
});

const badCases=[
 ['version',v=>v.schemaVersion=2,'schemaVersion'],['kind',v=>v.kind='diary','kind'],['window',v=>v.dayEnd=8,'dayEnd'],
 ['fields',v=>v.PRIVATE_FIELD_CANARY='PRIVATE_VALUE_CANARY','$'],['start_day',v=>v.events[0].start.dayOrdinal=8,'events[0].start.dayOrdinal'],
 ['not_future',v=>v.events[0].start={dayOrdinal:1,minuteOfDay:1079},'events[0].start'],['horizon',v=>v.events[0].end={dayOrdinal:8,minuteOfDay:1},'events[0].end'],
 ['interval',v=>v.events[0].end=clone(v.events[0].start),'events[0].end'],['position',v=>v.events[0].start.minuteOfDay=1440,'events[0].start'],
 ['scope',v=>v.events[0].scope='character_private','events[0].scope'],['announcement',v=>v.events[0].announcement='secret','events[0].announcement'],
 ['required_for_scene',v=>v.events[0].requiredForScene='false','events[0].requiredForScene'],['key',v=>v.events[0].key='con','events[0].key'],
 ['label',v=>v.events[0].label='  ','events[0].label'],['condition',v=>v.events[0].condition={category:'facts',key:'constructor',equals:true},'events[0].condition.key'],
 ['condition',v=>v.events[0].condition={category:'facts',key:'public',equals:{PRIVATE_CANARY:'secret'}},'events[0].condition.equals'],
 ['duplicate_key',v=>v.events.push(clone(v.events[0])),'events[1].key'],['event_limit',v=>v.events=Array.from({length:9},()=>event()),'events']
];
for(const [reason,change,path]of badCases)test('calendar bounded diagnostic: '+reason+' '+path,async()=>{
 const f=await fixture({snapshot:{storyTimeDefinition:period}});try{
  const r=await f.read(),j=f.host.worldRoutine.nextJob(r),v=proposal([event()]);change(v);
  assert.throws(()=>validateBackgroundProposal(r,j,v),e=>{assert.deepEqual(calendarFailureDiagnostic(e),{reason,path});const code=calendarDiagnosticCode(e);assert(code.length<=64);assert.deepEqual(calendarFailureDiagnostic({code}),{reason,path});assert(!code.includes('PRIVATE'));return true;});
  assert.equal(f.calls.length,0);
 }finally{await f.host.close();}
});

test('failed model output persists only bounded diagnostics; player/read/export/restart do not dispatch or expose output',async()=>{
 const f=await fixture({onCall:async a=>a.stage==='calendar_plan'?{text:JSON.stringify(proposal([event({label:'PRIVATE_OUTPUT_CANARY',start:{dayOrdinal:1,minuteOfDay:0}})]))}:null});let restart;
 try{
  await f.pulse(1);const r=await f.read(),job=r.worldRoutine.jobs[0],dto=publicRoutineRead(r,{kind:'calendar'});assert.equal(job.error,'CALENDAR_NOT_FUTURE__E0_START');assert.equal(dto.planning.state,'failed');assert.match(calendarPlanningText(dto.planning),/未晚於目前時間範圍/);
  const journal=JSON.parse(await fs.readFile(f.host.worldRoutine.journal(job),'utf8'));assert.deepEqual(journal.failureDiagnostic,{reason:'not_future',path:'events[0].start'});assert(!JSON.stringify(journal).includes('PRIVATE_OUTPUT_CANARY'));assert(!JSON.stringify(dto).includes('PRIVATE_OUTPUT_CANARY'));assert.equal(journal.response,undefined);
  validateRunBundle(encodeRunBundle(r));const n=f.calls.length,before=hash(r);for(let i=0;i<5;i++)publicRoutineRead(await f.read(),{kind:'calendar'});restart=await new SceanHost({engine:f.engine,root:f.root+'/host',worldRoutineAutomatic:false}).init();await f.pulse(1);assert.equal(f.calls.length,n);assert.equal(hash(await f.read()),before);
  assert.equal(calendarFailureDiagnostic({failureDiagnostic:{reason:'fields',path:'PRIVATE_OUTPUT_CANARY'}}),null);
 }finally{await restart?.close();await f.host.close();}
});

test('explicit recovery reuses pinned job within two daily calls; cap, stale source and new story day stay bounded',async()=>{
 let fail=true;const f=await fixture({onCall:async a=>fail&&a.stage==='calendar_plan'?{text:'{}$$$$PRIVATE_OUTPUT_CANARY'}:null});try{
  await f.pulse(1);let r=await f.read(),j=r.worldRoutine.jobs[0];assert.equal(j.error,'CALENDAR_JSON__ROOT');const n=f.calls.length;
  await f.host.worldRoutine.retry({runId:r.runId,jobId:j.id});assert.equal(f.calls.length,n);assert.equal(calendarPlanningStatus(await f.read()).state,'queued');fail=false;await f.pulse(1);r=await f.read();assert.equal(r.worldRoutine.jobs.length,1);assert.equal(r.worldRoutine.jobs[0].attempts,2);assert.equal(calendarPlanningStatus(r).state,'planned');assert.equal(f.calls.filter(x=>x.stage==='calendar_plan').length,2);
 }finally{await f.host.close();}
 const cap=await fixture({onCall:async a=>a.stage==='calendar_plan'?{text:'{}'}:null});try{
  await cap.pulse(1);let r=await cap.read(),j=r.worldRoutine.jobs[0];await cap.turn(null,'new-head');assert.equal(calendarPlanningStatus(await cap.read()).state,'stale');await assert.rejects(cap.host.worldRoutine.retry({runId:r.runId,jobId:j.id}),{code:'BACKGROUND_SOURCE_STALE'});
  await cap.pulse(1);r=await cap.read();assert.equal(calendarPlanningStatus(r).state,'daily_limit');const n=cap.calls.length,before=hash(r);await cap.pulse(1);await assert.rejects(cap.host.worldRoutine.retry({runId:r.runId,jobId:r.worldRoutine.jobs.at(-1).id}),{code:'CALENDAR_DAY_DISPATCH_LIMIT'});assert.equal(cap.calls.length,n);assert.equal(hash(await cap.read()),before);
  const result=await cap.turn({kind:'advance_by',amount:{days:1},sourceRefs:['input']},'next-day');const next=await cap.read(),offered=cap.host.worldRoutine.nextJob(next);assert.equal(publicTurnResult(result,next).storyClockLabel,'故事第 2 日 10:00');assert.equal(offered.kind,'calendar_plan');assert.equal(offered.day,2);assert.deepEqual(offered.coverageDays,[2,3,4,5,6,7,8]);assert.equal(calendarPlanningStatus(next).state,'waiting');
 }finally{await cap.host.close();}
});

test('planning presentation distinguishes valid empty plan, not enabled, waiting, running, interrupted, cap and old generic failure',async()=>{
 const f=await fixture({emptyCalendar:true});try{
  assert.equal(calendarPlanningStatus(await f.read()).state,'waiting');await f.pulse(1);const r=await f.read(),dto=publicRoutineRead(r,{kind:'calendar'});assert.equal(dto.entries.length,0);assert.equal(dto.planning.state,'planned');assert.match(calendarPlanningText(dto.planning),/規劃已完成/);
  const disabled=clone(r);disabled.worldRoutine.policy.calendar=false;assert.equal(calendarPlanningStatus(disabled).state,'not_enabled');
  for(const state of ['not_enabled','waiting','queued','running','failed','interrupted','stale','daily_limit'])assert(calendarPlanningText({state}));
  assert.match(calendarPlanningText({state:'daily_limit',error:'CALENDAR_CONTRACT',attemptsUsed:2,attemptLimit:2}),/舊記錄只保存契約拒絕/);
  assert(!calendarPlanningText({state:'failed',failureDiagnostic:{reason:'fields',path:'<PRIVATE>'}}).includes('<PRIVATE>'));
 }finally{await f.host.close();}
});


test('read-only planner classification checks queued/running/interrupted and SourceCut staleness without scheduling',async()=>{
 const f=await fixture();try{const base=await f.read(),job=f.host.worldRoutine.nextJob(base),before=hash(base);
  for(const status of ['queued','running','failed','interrupted']){const r=clone(base),j=clone(job);j.status=status;j.attempts=status==='queued'?0:1;j.error='CALENDAR_FIELDS__ROOT';r.worldRoutine.jobs.push(j);assert.equal(calendarPlanningStatus(r).state,status);}
  const stale=clone(base),j=clone(job);j.status='failed';j.attempts=1;j.basis.cutHash='0'.repeat(64);stale.worldRoutine.jobs.push(j);assert.equal(calendarPlanningStatus(stale).state,'stale');
  assert.equal(calendarDiagnosticText({failureDiagnostic:{reason:'not_future',path:'events[0].start'}}),'原因代碼：not_future\n欄位：events[0].start');assert.equal(calendarDiagnosticText({failureDiagnostic:{reason:'PRIVATE_CANARY',path:'$'}}),'');
  assert.equal(hash(await f.read()),before);assert.equal(f.calls.length,0);
 }finally{await f.host.close();}
});
