// Pure bounded invitation evidence. No clock, storage, model or provider port.
import {hash,SceanError} from './contracts.mjs';
import {AMBIENT_INVITATION_LIMIT,characterAuthorId,isAmbientAuthor,validateDeclineReceipt} from './forum-authors.mjs';

const fail=()=>{throw new SceanError('AMBIENT_DECLINE_EVIDENCE_INVALID');};
const branchKey=j=>`${j.basis.epoch}:${j.lifecycleRevision}:${j.day}`;
export function invitationIndex(run){
 const byId=new Map(),byDay=new Map();for(const j of run.worldRoutine.jobs){byId.set(j.id,j);const k=branchKey(j);if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(j);}return{byId,byDay};
}
function mediumStatus(policy,cut){
 const m=policy.medium;if(!m)return'medium_unconfigured';const b=m.availability;
 return b&&hash(cut.publicState.world[b.category]?.[b.key]??null)!==hash(b.equals)?'medium_unavailable':null;
}
function qualified(policy,cut){return policy.authorIds.filter(id=>cut.publicState.characters?.[id]?.public?.facts?.forum_available!==false);}
function sameCut(job,cut,run){return job.basis.runId===run.runId&&job.basis.snapshotHash===run.snapshot.hash&&job.basis.cutId===cut.id&&job.basis.cutHash===hash(cut)&&job.basis.day===cut.day;}
const invitations=jobs=>jobs.filter(j=>j.kind==='forum_post'&&!isAmbientAuthor(j));

export function dayForumOutcome(run,day,{active=[],index}={}){
 const r=run.worldRoutine;if(r?.schemaVersion!==2||r.policy.ambientPosts?.enabled!==true)return{status:'not_opted_in',eligible:false};
 const cut=run.worldActivity.sourceCuts.find(c=>c.day===day);if(!cut)return{status:'source_stale',eligible:false};
 const medium=mediumStatus(r.policy,cut);if(medium)return{status:medium,eligible:false};
 const ids=qualified(r.policy,cut);if(!ids.length)return{status:'no_eligible_author',eligible:false};
 if(active.some(a=>a.kind==='forum_post'&&a.day===day))return{status:'already_published',eligible:false};
 const key=`${run.storyEpoch}:${run.recycle?.revision??0}:${day}`,jobs=index?.byDay.get(key)??r.jobs.filter(j=>branchKey(j)===key);
 const ambient=jobs.find(isAmbientAuthor);if(ambient)return{status:'ambient_'+ambient.status,eligible:false};
 const selected=invitations(jobs);
 if(!selected.length)return{status:'not_offered',eligible:false};
 if(selected.length>AMBIENT_INVITATION_LIMIT||new Set(selected.map(characterAuthorId)).size!==selected.length||selected.some(j=>!ids.includes(characterAuthorId(j))||!sameCut(j,cut,run)||j.basis.entryCommitId&&!run.turns.some(t=>t.commitId===j.basis.entryCommitId)))return{status:'source_stale',eligible:false};
 for(const j of selected){
  if(j.status!=='declined')return{status:j.status==='failed'?'provider_failed':j.status,eligible:false};
  try{validateDeclineReceipt(j);}catch{return{status:'decline_evidence_invalid',eligible:false};}
 }
 if(selected.length<AMBIENT_INVITATION_LIMIT&&ids.some(id=>!selected.some(j=>characterAuthorId(j)===id)))return{status:'invitation_budget_wait',eligible:false};
 return{status:'all_offered_declined',eligible:true,invitationCount:selected.length,invitationLimit:AMBIENT_INVITATION_LIMIT,invitationRefs:selected.map(j=>({jobId:j.id,decisionHash:hash(j.decisionReceipt)}))};
}

/** Also validates retired branches, using the caller's verified retained cuts. */
export function validateAmbientInvitations(run,job,{index,cuts}={}){
 if(!isAmbientAuthor(job))return true;
 const refs=job.invitationRefs;if(!Array.isArray(refs)||!refs.length||refs.length>AMBIENT_INVITATION_LIMIT||new Set(refs.map(r=>r.jobId)).size!==refs.length)fail();
 const cut=cuts?.get(job.basis.cutId)??run.worldActivity.sourceCuts.find(c=>c.id===job.basis.cutId);
 if(!cut||mediumStatus(run.worldRoutine.policy,cut)||!sameCut(job,cut,run))fail();
 const ids=qualified(run.worldRoutine.policy,cut);if(!ids.length)fail();
 const keyed=index??invitationIndex(run),selected=invitations(keyed.byDay.get(branchKey(job))??[]);
 if(selected.length!==refs.length||selected.length>AMBIENT_INVITATION_LIMIT||new Set(selected.map(characterAuthorId)).size!==selected.length)fail();
 for(const ref of refs){
  if(!ref||Object.keys(ref).length!==2||typeof ref.jobId!=='string'||typeof ref.decisionHash!=='string')fail();
  const j=keyed.byId.get(ref.jobId);
  if(!j||!selected.includes(j)||!ids.includes(characterAuthorId(j))||j.status!=='declined'||!sameCut(j,cut,run)||j.basis.entryCommitId!==job.basis.entryCommitId||ref.decisionHash!==hash(j.decisionReceipt))fail();
  validateDeclineReceipt(j);
 }
 if(selected.length<AMBIENT_INVITATION_LIMIT&&ids.some(id=>!selected.some(j=>characterAuthorId(j)===id)))fail();
 return true;
}
