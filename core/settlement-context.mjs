import {clone,hash,SceanError} from './contracts.mjs';
import {searchHistory,readHistory} from './history-recall.mjs';
import {selectWorldbooks} from './worldbook.mjs';

export const settlementModes = ['legacy','optimized','shadow'];

export function legalTargets(blueprint) {
  const targets = (blueprint?.variables ?? []).filter(v => v.visibility === 'public' && !v.readOnly);
  return {
    operations: ['set','remove'],
    extensionPolicy: blueprint?.extensionPolicy ?? 'allow',
    targets: targets.map(v=>Object.fromEntries(['scope','characterId','category','key','type','enumValues','min','max','requiredFields'].filter(k=>Object.hasOwn(v,k)).map(k=>[k,clone(v[k])]))),
    permission: blueprint?.extensionPolicy==='deny'
      ? 'Closed Blueprint. Each scope, characterId (when present), category and key must exactly match one row. Do not create a counterpart inventory or location field for an NPC when no row exists. A set replaces the whole value. Host Clock is read-only.'
      : 'Use public writable targets. Dynamic keys follow the existing contract, including required task fields and whole-value updates. Host Clock is read-only.'
  };
}

export function optimizedSettlement(packet, run) {
  const {recentDialogue, rollingSummary, chapterContext, ...base} = packet;
  const rules = [];
  selectWorldbooks(run.snapshot, {playerInput:packet.playerInput,playerName:run.playerIdentity?.name,
    config:run.snapshot.worldbookSelection??{},onLookupEligible:entry=>rules.push({ref:entry.ref,content:entry.content})});
  // Rank public committed turns using the existing sparse index. These are references, never current events.
  const query=packet.finalBody.slice(0,512).trim();
  const known=run.turns.length&&query?requestedEvidence({evidenceQuery:query},run):null;
  return {...base,...(known?.records.length?{priorPublicReferences:known.records}:{}),evidencePolicy:{
    publicRules:rules,
    instruction:'The frozen finalBody establishes current events. History may identify an alias or unresolved promise, never settle it again. If necessary request one public history lookup instead of a proposal by returning only {"evidenceQuery":"distinctive name, identity or commitment"}. After lookup return a final proposal. Leave uncertain changes unapplied.'
  }};
}

export function requestedEvidence(result, run) {
  if (!result || !Object.hasOwn(result,'evidenceQuery')) return null;
  if(Object.keys(result).length!==1 || typeof result.evidenceQuery!=='string' || !result.evidenceQuery.trim() || result.evidenceQuery.length>512)throw new SceanError('INVALID_POST_EVIDENCE_QUERY');
  const found=searchHistory(run,{runId:run.runId,mode:'bm25',query:result.evidenceQuery,limit:3});
  const records=found.hits.map(hit=>{
    try{return readHistory(run,{runId:run.runId,commitId:hit.commitId,radius:0,maxChars:4000});}
    catch(error){if(error.code!=='HISTORY_READ_TOO_LARGE')throw error;return {turn:hit.turn,commitId:hit.commitId,snippet:hit.snippet,field:hit.snippetField,partial:true};}
  });
  return {records, status:records.length?'public_history_found':'no_public_match', instruction:'Do not infer an identity from rank alone. Preserve uncertainty when evidence conflicts or is absent.'};
}

function normalizedObject(value){
  if(Array.isArray(value))return value.map(normalizedObject);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalizedObject(value[key])]));
  return value;
}
export class ShadowSettlement {
  constructor(){this.pending=null;}
  submit({model,system,input,run,routePin,requestId,official,validate,record}) {
    if(this.pending)return false;
    const binding={bodyHash:input.bodyHash,priorHead:run.head??null,stateHash:hash(run.state),requestId};
    const start=performance.now(),signal=AbortSignal.timeout(120000);
    this.pending=Promise.resolve().then(async()=>{
      let packet=optimizedSettlement(input,run);
      const usage=[];
      const ask=async()=>{const response=await model.generate({stage:'post_stat',system,input:packet,signal,context:{runId:run.runId,requestId:requestId+'-shadow',...(routePin?{routePin}:{})}});usage.push(response.usage??null);return JSON.parse(response.text);};
      let candidate=await ask();const evidence=requestedEvidence(candidate,run);
      if(evidence){packet={...packet,historicalEvidence:evidence};candidate=await ask();}
      validate(candidate);
      await record({...binding,status:'validated_candidate',sameProposal:hash(normalizedObject(candidate))===hash(normalizedObject(official)),officialHash:hash(official),candidateHash:hash(candidate),candidate,usage,elapsedMs:performance.now()-start});
    }).catch(async e=>{await record({...binding,status:'failed',code:typeof e.code==='string'?e.code:'SHADOW_INVALID',elapsedMs:performance.now()-start});}).catch(()=>{}).finally(()=>{this.pending=null;});
    return true;
  }
}
