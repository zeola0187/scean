import test from 'node:test';import assert from 'node:assert/strict';
import {routineFixture} from '../fixtures/w29-routine-synthetic.mjs';import {DEFAULT_STORY_TIME} from '../core/story-clock.mjs';import {calendarView} from '../core/world-routine.mjs';import {hash} from '../core/contracts.mjs';
test('P2C day precision shows current-cut public announcements immediately, hides unannounced plans and rejects stale cut/clock',async()=>{
 for(const precision of ['day','period'])for(const unannounced of [false,true]){const definition=structuredClone(DEFAULT_STORY_TIME);if(precision==='period')definition.initial={dayOrdinal:1,precision:'period',periodId:'morning'};const f=await routineFixture({unannounced,snapshot:{storyTimeDefinition:definition}});try{
  await f.pulse(1);const run=await f.read(),before=hash(run),n=f.calls.length,cut=run.worldRoutine.currentCalendarCut;
  const dto=await f.host.worldRoutine.read({runId:run.runId,view:'player',kind:'calendar',day:2},{principal:'test',allowGlobalSettings:true});assert.equal(dto.entries.length,unannounced?0:1);if(!unannounced)assert.equal(dto.entries[0].status,'planned_not_occurred');assert.equal(run.storyClock.precision,precision);assert.equal(dto.clock.position.earliest.dayOrdinal,1);
  // Historical/default Agent views retain their original conservative cutoff.
  assert.equal(calendarView(run,run.storyClock).length,0);
  assert.throws(()=>calendarView(run,run.storyClock,{currentPublicationCut:'0'.repeat(64)}),{code:'CALENDAR_READER_SOURCE_CHANGED'});
  assert.throws(()=>calendarView(run,{...run.storyClock,revision:run.storyClock.revision+1},{currentPublicationCut:cut}),{code:'CALENDAR_READER_SOURCE_CHANGED'});
  assert.equal(hash(await f.read()),before);assert.equal(f.calls.length,n);
 }finally{await f.host.close();}}
});
