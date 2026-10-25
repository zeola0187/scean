import {isAmbientAuthor,characterAuthorId,authorFields} from './forum-authors.mjs';
import {narrativeSources} from './engine.mjs';
// Audience-specific immutable packet construction; domain/save validators do
// not import worldbook/player-text/authoring dependencies through this module.
import {clone} from './contracts.mjs';
import {readStoryClock,storyTimeDefinition} from './story-clock.mjs';
import {projectStoryState} from './state-operations.mjs';
import {routineCut,activeArtifacts,routineCalendarPlan,calendarView,jobContract,ROUTINE_LIMITS} from './world-routine.mjs';
import {ownerCharacterContext,ownerStateForModel,eligibleMemory,publicData} from './memory-policy.mjs';
import {stripWorldbookContainers,selectWorldbooks} from './worldbook.mjs';
export function backgroundPacket(run,job){
 const cut=routineCut(run,job.day),actor=characterAuthorId(job)?run.snapshot.characters.find(a=>a.id===characterAuthorId(job)):null,entry=job.basis.entryCommitId?run.turns.find(t=>t.commitId===job.basis.entryCommitId):null,state=entry?.stateBefore??run.baselineState,atRun={...run,state,storyClock:cut.clock,worldActivity:{...run.worldActivity,occurrences:run.worldActivity.occurrences.filter(o=>cut.eventFrontier.includes(o.id))}};

 // Positive projection also enforces the historical cut independently of the
 // canonical validator. A forged frontier must not disclose future content.
 let socialChars=0;
 const available=activeArtifacts(run).filter(a=>['forum_post','forum_reply'].includes(a.kind)&&a.day<=job.day&&job.basis.frontier.some(f=>f.id===a.id&&f.hash===a.hash)).slice(0,ROUTINE_LIMITS.contextItems).filter(a=>{socialChars+=a.text.length+(a.title?.length??0);return socialChars<=ROUTINE_LIMITS.contextChars;});
 const social=available.map(a=>({id:a.id,kind:a.kind,...authorFields(a),day:a.day,position:clone(a.position),parentId:a.parentId,title:a.title,text:a.text,epistemic:a.epistemic,sourceRef:{kind:'forum_statement',artifactId:a.id,hash:a.hash}}));
 const definition=storyTimeDefinition(run.snapshot.storyTimeDefinition);
 if(isAmbientAuthor(job)){return{author:{kind:'ambient'},publicContext:run.worldRoutine.policy.ambientPosts.publicContext,timeDefinition:definition,clock:readStoryClock(atRun),source:{...clone(job.basis),meaning:'Immutable public story-day entry cut; no later prose or private Character material.'},publicWorld:publicData(cut.publicState.world),calendar:calendarView(atRun,cut.clock).slice(-8),forum:social,medium:{id:run.worldRoutine.policy.medium.id,label:run.worldRoutine.policy.medium.label},outputContract:jobContract(job,definition),instructions:'Choose a temporary anonymous display name and a small independent public-world topic. You may decline. You are not any named Character; do not impersonate them or create persistent identity, private memories, replies or world facts. Attributed subjective claims only. Do not infer secrets, future events or anything beyond the supplied public cut.'};}
 const shared=narrativeSources({card:stripWorldbookContainers(run.snapshot.card),preset:run.snapshot.preset,worldbook:run.snapshot.worldbook});
 const common={rpPreset:clone(shared.preset??{}),timeDefinition:definition,clock:readStoryClock(atRun),source:{...clone(job.basis),meaning:'Immutable story-day entry cut; no later prose or private other-character records.'},publicWorld:clone(cut.publicState.world),calendar:calendarView(atRun,cut.clock).slice(-8),forum:social,medium:clone(run.worldRoutine.policy.medium),outputContract:jobContract(job,definition)};
 if(job.kind==='calendar_plan')return{...common,clock:readStoryClock(run),publicWorld:projectStoryState(run).world,window:{dayStart:job.day,dayEnd:job.day+6,unplannedDays:clone(job.coverageDays)},world:clone(shared.card??{}),worldbook:clone(shared.worldbook??{entries:[]}),establishedEvents:routineCalendarPlan(run).filter(e=>e.end.dayOrdinal>=job.day&&e.start.dayOrdinal<=job.day+6),instructions:'Plan only small PUBLIC world events on unplannedDays in this seven-day window. No private character schedules. Keep established events. Future plans are not occurred events. Choose at most8; zero is legitimate. No clock/state writes.'};
 const records=run.memories.filter(m=>eligibleMemory(m,{runId:run.runId,audience:'owner',characterId:actor.id})&&run.turns.some(t=>t.commitId===m.source.commitId&&t.turn<(entry?.turn??1))).sort((a,b)=>b.source.turn-a.source.turn).slice(0,8);
 return{...common,background:clone(shared.card??{}),character:stripWorldbookContainers(ownerCharacterContext(actor,{characterId:actor.id})),ownState:ownerStateForModel(state,actor.id),memory:{records:clone(records)},worldbook:{entries:selectWorldbooks(run.snapshot,{playerInput:'',config:run.snapshot.worldbookSelection??{}}).entries},parent:job.parentId?social.find(a=>a.id===job.parentId)??null:null,instructions:job.kind==='diary'?'Write your own PRIVATE subjective entry only when explicitly requested. Never write other people or State.':'Choose your own topic, content and position. It may be unrelated to the plot/calendar. Speak only as yourself. You may decline. Claims never update State. No private diary of another character is supplied.'};
}
