import {clone, hash, SceanError} from './contracts.mjs';

const stale = () => { throw new SceanError('STAGE_SOURCE_STALE'); };
export const resumeFormat = 'single-writer-tools-v1';

export function stageBasis(run, request) {
  return hash({format:resumeFormat, runId:run.runId, request, snapshot:run.snapshot.hash,
    head:run.head??null, version:run.version, epoch:run.storyEpoch, lifecycle:run.recycle?.revision??0,
    clock:run.storyClock, state:run.state, activity:run.worldActivity,
    calendarCut:run.worldRoutine?.currentCalendarCut??null, banList:run.banList});
}

export function newStageRecord(basis) {
  return {format:resumeFormat,basis,calls:{},tools:{},batches:{},dispatches:{},routes:{},next:'director'};
}

export function recoverStageRecord(source, basis) {
  const record=source?.stageCheckpoint;
  if(source?.provisional || !record || record.format!==resumeFormat || record.basis!==basis ||
     hash(record)!==source.stageChecksum || !source.assembly || hash(source.assembly)!==record.assemblyHash) stale();
  return clone(record);
}

export function stageFailure(attempt) {
  const cp=attempt?.stageCheckpoint;
  if(!cp?.assemblyHash || attempt.bodyCheckpoint || attempt.provisional) return {};
  const blocked=['STAGE_SOURCE_STALE','STAGE_LEDGER_INVALID','STAGE_CHECKPOINT_TOO_LARGE','STAGE_DISPATCH_LIMIT','WRITER_BODY_FORMAT','WRITER_BODY_HASH_CHANGED','CHARACTER_ADVICE_TOO_LARGE','INVALID_TOOL_ID','INVALID_TOOL_ARGUMENTS','TOOL_NOT_ALLOWED','TOOL_RECOVERY_INCOMPLETE','MODEL_SELECTION_REQUIRED','MODEL_ROUTE_REQUEST_CHANGED','MODEL_ROUTE_PIN_CORRUPT','CONTEXT_PACKET_TOO_LARGE','MODEL_CATALOG_CHANGED',
    'WRITER_HANDOFF_INVALID','WRITER_HANDOFF_SOURCE_INVALID','WRITER_ADVICE_NOT_COMMITMENT','BANLIST_REPAIR_EXHAUSTED',
    'DIRECTOR_TOOL_LIMIT','HISTORY_TOOL_LIMIT','CHARACTER_ADVICE_IDENTITY','COMMIT_OUTCOME_UNKNOWN','PERSISTENCE_READ_FAILED'];
  const room=!cp.waiting || ((cp.dispatches[cp.waiting.group]??0)<cp.waiting.limit && (cp.dispatches[cp.waiting.key]??0)<2);
  return {stageAvailable:true,resumeAttemptId:attempt.attemptId,resumeStage:cp.next,
    canStageResume:!blocked.includes(attempt.error?.code) && !(/^(CHARACTER_ADVICE_|BANLIST_REPAIR_|WRITER_HANDOFF_)/.test(attempt.error?.code??'')) && (room || !!cp.calls[cp.waiting?.key]?.output)};
}

// Only the original stage event contains the possibly private packet and output.
// References survive later attempts; use run-local checked reads, never client data.
export async function stageEvent(store, attempt, ref) {
  const source=ref.attempt===attempt.attemptId?attempt:await store.readAttempt(attempt.runId,ref.attempt);
  if(source.requestId!==attempt.requestId || source.runId!==attempt.runId) stale();
  const event=source.stages[ref.index];
  if(!event || event.stage!==ref.stage || hash(event.prompt)!==ref.promptHash) stale();
  if(ref.output && (!event.result || hash(event.result)!==ref.output)) stale();
  return event;
}

export function stageAllowance(budget, cp, {key,group,limit}, reserve, checkpoint) {
  return {...budget, get remaining(){return Math.min(budget.remaining,limit-(cp.dispatches[group]??0),2-(cp.dispatches[key]??0));},
    get effectiveSelection(){return cp.routes[group]??budget.effectiveSelection;},
    pinEffective(route){
      if(cp.routes[group] && hash(cp.routes[group])!==hash(route)) stale();
      cp.routes[group]??=clone(route); return budget.pinEffective(route);
    },
    async take(){
      if((cp.dispatches[group]??0)>=limit || (cp.dispatches[key]??0)>=2) throw new SceanError('STAGE_DISPATCH_LIMIT');
      await budget.take();
      cp.dispatches=await reserve({key,group,limit},cp.dispatches);
      cp.waiting={key,group,limit};
      await checkpoint();
      return cp.dispatches[group];
    }};
}
