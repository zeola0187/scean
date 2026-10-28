// Public player DTOs. All dates, cutoffs and event statuses are Host projections.
import {clone,hash,SceanError} from '../core/contracts.mjs';
import {calendarDate,readStoryClock,storyClockLabel,storyTimeDefinition,dayMinutes,tick} from '../core/story-clock.mjs';
import {calendarView,forumReader,routineStatus,routineCut,calendarPlanningStatus} from '../core/world-routine.mjs';
const fail=()=>{throw new SceanError('ROUTINE_QUERY_INVALID');};
export function publicRoutineRead(run,{kind,windowStart,day,eventOffset=0,threadId,beforeSequence,afterSequence,limit=12}={}){
 const base={runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:run.head??null};
 if(!run.storyClock)return {...base,status:'not_enabled',clock:null,entries:[],days:[]};
 const d=storyTimeDefinition(run.snapshot.storyTimeDefinition),clock=readStoryClock(run),today=clock.position.earliest.dayOrdinal;
 const pointLabel=p=>`${calendarDate(p.dayOrdinal,d).label} ${String(Math.floor(p.minuteOfDay/d.minutesPerHour)).padStart(2,'0')}:${String(p.minuteOfDay%d.minutesPerHour).padStart(2,'0')}`;
 const positionLabel=p=>tick(p.earliest,d)===tick(p.latest,d)?pointLabel(p.earliest):`${pointLabel(p.earliest)} ～ ${pointLabel(p.latest)}`;
 const status=run.worldRoutine?routineStatus(run):{status:'not_enabled'};
 // Reader never exposes private job metadata, even if a Diary task exists.
 const medium=run.worldRoutine?.policy.medium,binding=medium?.availability,cut=run.worldRoutine?routineCut(run,today):null;
 const forumState=!run.worldRoutine?.policy.forum?'not_enabled':!medium?'medium_unconfigured':binding&&hash(cut.publicState.world[binding.category]?.[binding.key]??null)!==hash(binding.equals)?'medium_unavailable':!run.worldRoutine.policy.authorIds.length?'no_eligible_author':'available';
 const publicStatus={enabled:!!run.worldRoutine,forumState,medium:run.worldRoutine?.policy.medium?.label??run.worldRoutine?.policy.medium?.name??null,forumDays:status.forumDays??null,jobs:(status.jobs??[]).filter(j=>j.kind!=='diary'&&j.day===today).slice(-14).map(j=>({kind:j.kind,status:j.status,day:j.day,error:j.error}))};
 const authors=(run.snapshot.characters??[]).map(a=>({id:a.id,name:a.name}));
 const common={...base,clock,clockLabel:storyClockLabel(run),authors,publicStatus};
 if(kind==='calendar'){
  const start=windowStart??today;if(!Number.isInteger(start)||start<1||start>today||!Number.isInteger(eventOffset)||eventOffset<0||eventOffset>10000)fail();
  const last=Math.min(start+6,today+6),selected=day??start;if(!Number.isInteger(selected)||selected<start||selected>last)fail();
  const activity=run.worldActivity?.occurrences??[],state=id=>{const s=activity.find(o=>o.eventId===id&&o.phase==='start'),e=activity.find(o=>o.eventId===id&&o.phase==='end');return s?.status==='pending_resolution'?'pending_resolution':s?.status==='did_not_occur'?'did_not_occur':e?.status==='occurred'?'completed':s?.status==='occurred'?'active':'planned_not_occurred';};
  const authored=(run.snapshot.publicEvents??[]).map(e=>({...clone(e),status:state(e.id),sourceRef:{kind:'snapshot_public_event',snapshotHash:run.snapshot.hash,eventId:e.id}}));
  const events=[...authored,...calendarView(run,run.storyClock,{limit:2048,currentPublicationCut:run.worldRoutine?.currentCalendarCut??null})].sort((a,b)=>tick(a.start,d)-tick(b.start,d)||a.id.localeCompare(b.id));
  const onDay=(e,n)=>tick(e.start,d)<n*dayMinutes(d)&&tick(e.end,d)>=(n-1)*dayMinutes(d);
  const matching=events.filter(e=>onDay(e,selected)),entries=matching.slice(eventOffset,eventOffset+50).map(e=>({...e,startLabel:pointLabel(e.start),endLabel:pointLabel(e.end)}));
  return {...common,status:'available',planning:calendarPlanningStatus(run),windowStart:start,previousWindow:start>1?Math.max(1,start-7):null,nextWindow:start<today?Math.min(today,start+7):null,today,selectedDay:selected,days:Array.from({length:last-start+1},(_,i)=>({day:start+i,label:calendarDate(start+i,d).label,count:events.filter(e=>onDay(e,start+i)).length})),entries,nextOffset:matching.length>eventOffset+entries.length?eventOffset+entries.length:null};
 }
 if(!run.worldRoutine||!run.worldRoutine.policy.forum)return {...common,status:'not_enabled',entries:[],nextCursor:null};
 const value=forumReader(run,{threadId:kind==='thread'?threadId:undefined,beforeSequence,afterSequence,limit});
 const project=a=>({...a,timeLabel:positionLabel(a.position)});
 return {...common,...value,entries:value.entries.map(project),...(value.parent?{parent:project(value.parent)}:{})};
}
