import {constructTemporalFixture} from './temporal-history.mjs';
import {hash,validateSnapshot} from '../core/contracts.mjs';
import {materializeInitialState} from '../core/state-blueprint.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {historySnapshot} from './synthetic-history-c.mjs';
import {narrativeSourceHash} from '../core/narrative.mjs';

// Invented fixture only: no provider, credential, private production card or session.
// Direct construction measures storage and paging without pretending to be 1,000 model turns.
export const D_PRIVATE='SYNTHETIC_D_KALT_ONLY: pump seal serial Q7 has an internal fracture.';
export const D_SHARED='Kalt told Sio that a pump inspection is pending; the serial and fracture remain undisclosed.';
const copy=structuredClone;
export function syntheticLongrun({turns=100,runId=`synthetic-d-${turns}`,bodyRepeats=5,chapters=0,validate=true,transformSnapshot}={}){
  if(!Number.isSafeInteger(turns)||turns<0||turns>1000)throw Error('Synthetic fixture supports 0..1000 turns');
  const raw=historySnapshot();raw.cardId='synthetic-longrun-d';raw.card={name:'Synthetic research ship D',description:'Offline long-form storage, archive and history fixture.'};
  // One initial provenance row remains constant; no growing per-turn state snapshots.
  raw.stateBlueprint.variables=raw.stateBlueprint.variables.filter(v=>v.key==='fuel');
  raw.initialState.values=raw.initialState.values.filter(v=>v.key==='fuel');
  transformSnapshot?.(raw);
  const snapshot=validateSnapshot(raw),initial=materializeInitialState(snapshot.stateBlueprint,snapshot.initialState,snapshot.characters);
  const stamp='2026-10-16T00:00:00.000Z';
  const run={schemaVersion:1,runId,version:turns,head:null,snapshot,baselineState:copy(initial.state),state:copy(initial.state),baselineProvenance:copy(initial.provenance),stateProvenance:copy(initial.provenance),turns:[],memories:[],playerHistory:[],receipts:{},operationReceipts:{},retired:[],banList:[],createdAt:stamp,updatedAt:stamp};
  for(let turn=1;turn<=turns;turn++){
    const key=String(turn).padStart(4,'0'),commitId=`d-commit-${key}`,requestId=`d-request-${key}`,attemptId=`d-attempt-${key}`;
    const input=`Continue the research watch ${turn}.`;
    const event=turn===1?'Aer promised to return the copper compass at the northern dock. PROMISE_COMPASS':turn===2?'Sio received the copper compass from Aer; the engine calibration task remained unfinished.':turn===30?D_SHARED:`Watch ${turn}: the calibration task remained open; the copper compass was logged at the northern dock.`;
    const body=event+' '+`Research log ${key}: the public crew checked the chart and waited for weather reports. `.repeat(bodyRepeats);
    const bodyHash=hash(body),source={runId,turn,commitId,bodyHash,requestId,attemptId,snapshotHash:snapshot.hash,cardId:snapshot.cardId,revision:snapshot.revision,rosterHash:hash(snapshot.characters)};
    const memories=[];
    if(turn===1||turn===30||turn%25===0){
      const kind=turn===1?'private':turn===30?'known_event':'world_public',knowers=turn===1?['kalt']:turn===30?['kalt','sio']:[];
      memories.push({schemaVersion:2,id:`d-memory-${key}`,version:turn,text:turn===1?D_PRIVATE:turn===30?D_SHARED:`The public research clock completed watch ${turn}.`,source:copy(source),access:{kind},knowers,characterIds:knowers,visibility:kind==='world_public'?'public':'characters',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:turn===30?['kalt']:[],actors:['kalt'],decisionMakers:[]}});
    }
    const histories=turn%10===0?[{schemaVersion:1,id:`d-player-${key}`,version:turn,source:copy(source),text:`The player remembers waiting during watch ${turn}.`,role:'player_history',scope:{kind:'player_only'},epistemic:{kind:'experience'},credibility:'subjective',participants:{speakers:[],actors:['player'],decisionMakers:[]}}]:[];
    const row={turn,commitVersion:turn,commitId,requestId,attemptId,input,body,bodyHash,stateBefore:copy(initial.state),stateAfter:copy(initial.state),memoryIds:memories.map(m=>m.id),playerHistoryIds:histories.map(m=>m.id),stateProvenanceBefore:copy(initial.provenance),stateProvenanceAfter:copy(initial.provenance),committedAt:stamp};
    run.turns.push(row);run.memories.push(...memories);run.playerHistory.push(...histories);run.head=commitId;
    run.receipts[requestId]={status:'committed',inputHash:hash(input),commitId,attemptId,result:{runId,requestId,version:turn,turn,body,state:copy(initial.state),memories:copy(memories),playerHistory:copy(histories),commitId,status:'committed'}};
  }
  if(chapters){
    if(!Number.isSafeInteger(chapters)||chapters<1||chapters>Math.min(20,turns))throw Error('Invalid synthetic chapter count');
    const ends=Array.from({length:chapters},(_,i)=>Math.floor(turns*(i+1)/chapters));
    run.narrative={schemaVersion:1,currentSummaryId:null,summaries:[],chapters:[],operations:{}};
    for(const t of run.turns){const version=t.turn+ends.filter(n=>n<t.turn).length;t.commitVersion=version;run.receipts[t.requestId].result.version=version;}
    let startTurn=1;
    for(let i=0;i<ends.length;i++){
      const endTurn=ends[i],selected=run.turns.slice(startTurn-1,endTurn),commitIds=selected.map(t=>t.commitId),sourceHashes=selected.map(narrativeSourceHash),operationId=`d-chapter-operation-${i+1}`,baseHead=selected.at(-1).commitId,baseVersion=endTurn+i,title=`Synthetic watch chapter ${i+1}`,chapterId=`d-chapter-${i+1}`;
      const request={kind:'chapter',runId,operationId,expectedVersion:baseVersion,expectedHead:baseHead,title};
      run.narrative.chapters.push({id:chapterId,runId,version:1,order:i+1,title,startTurn,endTurn,commitIds,sourceHashes,sourceHash:hash({commitIds,sourceHashes}),baseHead,baseVersion,perspective:'public_story',visibility:'public',status:'completed',current:true,summaryId:null,summaryVersion:null,provenance:{operationId,algorithm:'explicit-host-close-v1',createdAt:stamp}});
      run.narrative.operations[operationId]={kind:'chapter',operationId,request,fingerprint:hash(request),status:'completed',finishedAt:stamp,result:{status:'completed',operationId,chapterId,version:baseVersion+1,head:baseHead}};
      startTurn=endTurn+1;
    }
    run.version=turns+chapters;
  }
  // Run the exact production portable-domain validation, including every source/ACL/receipt.
  constructTemporalFixture(run);if(validate)validateRunBundle(encodeRunBundle(run));return run;
}
