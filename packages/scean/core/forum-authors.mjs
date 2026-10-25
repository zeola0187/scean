import {clone,hash,json,SceanError,safeId,text} from './contracts.mjs';

const fail=code=>{throw new SceanError(code);};
const fields=(v,keys,code='FORUM_AUTHOR_CONTRACT')=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail(code);};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export {AMBIENT_INVITATION_LIMIT} from './forum-policy-constants.mjs';
export const isAmbientAuthor=row=>row?.author?.kind==='ambient';
export const characterAuthorId=row=>row?.author?(row.author.kind==='character'?row.author.characterId:null):(row?.authorId??null);
export const authorFields=row=>row.author===undefined?{authorId:row.authorId}:{author:clone(row.author)};
export const authorKey=row=>isAmbientAuthor(row)?'ambient':characterAuthorId(row);
export const sameAuthor=(a,b)=>json(authorFields(a))===json(authorFields(b));

export function validateAmbientName(value){
 if(typeof value!=='string'||!value.trim()||[...value].length>40||/[<>\p{Cc}\p{Cf}]/u.test(value))fail('AMBIENT_NAME_INVALID');
 return value;
}
export function validateRoutineAuthor(row,version,policy,{artifact=false}={}){
 if(version===1){if(Object.hasOwn(row,'author'))fail('FORUM_AUTHOR_VERSION');if(row.kind==='calendar_plan'?row.authorId!==null:!policy.authorIds.includes(row.authorId))fail('ROUTINE_JOB_INVALID');return;}
 if(version!==2||Object.hasOwn(row,'authorId'))fail('FORUM_AUTHOR_VERSION');
 if(row.kind==='calendar_plan'){if(row.author!==null)fail('FORUM_AUTHOR_CONTRACT');return;}
 const a=row.author;
 if(a?.kind==='character'){fields(a,['kind','characterId']);safeId(a.characterId);if(!policy.authorIds.includes(a.characterId))fail('FORUM_AUTHOR_CONTRACT');return;}
 if(a?.kind!=='ambient'||row.kind!=='forum_post'||policy.ambientPosts?.enabled!==true)fail('FORUM_AUTHOR_CONTRACT');
 fields(a,artifact?['kind','displayName']:['kind']);if(artifact)validateAmbientName(a.displayName);
}

/** The old Character output contract stays unchanged; only ambient is v2. */
export function validateExpressionProposal(job,v){
 const ambient=isAmbientAuthor(job);
 fields(v,['schemaVersion','kind',ambient?'author':'authorId','decision','title','text','epistemic'],'ROUTINE_FIELDS');
 if(v.schemaVersion!==(ambient?2:1)||v.kind!==job.kind||!['publish','decline'].includes(v.decision)||!['subjective','belief','rumor','unverified','experience'].includes(v.epistemic)||typeof v.title!=='string'||v.title.length>120||typeof v.text!=='string'||v.text.length>(job.kind==='diary'?2400:1600))fail('ARTIFACT_CONTRACT');
 if(ambient){if(job.kind!=='forum_post')fail('FORUM_AUTHOR_CONTRACT');fields(v.author,['kind','displayName']);if(v.author.kind!=='ambient')fail('FORUM_AUTHOR_CONTRACT');validateAmbientName(v.author.displayName);}
 else if(v.authorId!==characterAuthorId(job))fail('ARTIFACT_CONTRACT');
 if(v.decision==='publish'){text(v.text,job.kind==='diary'?2400:1600);if(job.kind!=='forum_reply')text(v.title,120);}
 return clone(v);
}
export function makeDeclineReceipt(job,proposal){
 const normalized=validateExpressionProposal(job,proposal);if(normalized.decision!=='decline'||!digest(job.inputHash))fail('DECLINE_RECEIPT_INVALID');
 return{schemaVersion:1,inputHash:job.inputHash,proposalHash:hash(normalized),proposal:normalized};
}
export function validateDeclineReceipt(job){
 const r=job.decisionReceipt;fields(r,['schemaVersion','inputHash','proposalHash','proposal']);
 if(job.status!=='declined'||r.schemaVersion!==1||!digest(r.inputHash)||r.inputHash!==job.inputHash||r.proposalHash!==hash(r.proposal)||validateExpressionProposal(job,r.proposal).decision!=='decline')fail('DECLINE_RECEIPT_INVALID');
 return true;
}
