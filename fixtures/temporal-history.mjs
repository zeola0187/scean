// Complete, synthetic historical checkpoints for offline prebuilt fixtures.
// This is a fixture constructor, not a product save migration API.
import {recordActivityCheckpoint,initializeTemporal,prepareTemporalCandidate,temporalReceipt} from '../core/state-operations.mjs';
import {hash,clone} from '../core/contracts.mjs';
export function constructTemporalFixture(run){
 const original=run.turns;initializeTemporal(run);let clock=run.storyClock,activity=run.worldActivity,head=null;
 for(const [index,t]of original.entries()){
  const base={...run,version:(t.commitVersion??index+1)-1,state:t.stateBefore,head,storyClock:clock,worldActivity:activity,storyRevision:index};
  const c=prepareTemporalCandidate(base,{kind:'hold'},{requestId:t.requestId,inputHash:hash(t.input)});
  Object.assign(t,{clockBefore:clone(c.clockBefore),clockAfter:clone(c.clockAfter),worldActivityBefore:recordActivityCheckpoint(run.worldActivityCheckpoints,c.worldActivityBefore),worldActivityAfter:recordActivityCheckpoint(run.worldActivityCheckpoints,c.worldActivityAfter),timeResolution:temporalReceipt(c)});
  Object.assign(run.receipts[t.requestId].result,{storyClock:clone(c.clockAfter),candidateRef:c.candidateRef});clock=c.clockAfter;activity=c.worldActivityAfter;head=t.commitId;
 }
 run.storyClock=clock;run.worldActivity=activity;run.storyRevision=original.length;return run;
}
