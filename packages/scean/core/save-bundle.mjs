import {publicTurnDialogue} from './dialogue-projection.mjs';
import {validateWritingMode,validateWritingModeReference} from './writing-mode.mjs';
import {validateProseStyle,validateProseStyleReference} from './prose-style.mjs';
import {validatePlayerIdentity} from './player-identity.mjs';
import { SceanError, clone, hash, json, safeId, validateSnapshot, validateState } from './contracts.mjs';
import { validateMemoryPolicy } from './memory-policy.mjs';
import { validateBlueprint, materializeInitialState, validateBlueprintState, validateBlueprintStateChanges } from './state-blueprint.mjs';
import { normalizeBanList } from './banlist.mjs';
import { applyStatProposal } from './stat-contract.mjs';
import { validateNarrative } from './narrative.mjs';
import {validateCharacterSources} from './character-sources.mjs';

export const SAVE_FORMAT = 'scean.run';
export const SAVE_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, depth: 64, nodes: 300000, turns: 1000, retired: 256, receipts: 4096, records: 100000 });
const ROOT = ['schemaVersion','runId','version','head','snapshot','openingId','baselineState','baselineProvenance','state','stateProvenance','memories','playerHistory','turns','receipts','operationReceipts','retired','banList','proseStyle','writingMode','createdAt','updatedAt'];
const ROOT_D = [...ROOT, 'narrative'];
const fail = code => { throw new SceanError(code); };
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const same = (a,b) => json(a) === json(b);
const integer = (v, min=0) => Number.isSafeInteger(v) && v >= min;
const fields = (v, allowed, required=[]) => { if (!plain(v) || required.some(k=>!Object.hasOwn(v,k)) || Object.keys(v).some(k=>!allowed.includes(k))) fail('SAVE_FIELDS'); };
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const ENV = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer[_-]?token|providerCredentials|credentials|permissionToken|csrfToken|hostLease|sdkPath|runtimePath|profilePath|dataRoot|tempPath)$/i;
const ABS = /^(?:[a-z]:[\\/]|\\\\|file:\/\/|\/[^\s])/i;

// This is a structural portability boundary, not a semantic secret classifier.
// Unknown story keys remain intact. No payload-provided reference is opened.
function bounded(value, { portability=true }={}) {
  let nodes=0,checkPortability=false; const active=new Set(),cardSelectors=new WeakSet();
  function walk(v, depth,cardPointer=false) {
    if (++nodes > SAVE_LIMITS.nodes || depth > SAVE_LIMITS.depth) fail('SAVE_LIMIT');
    if (typeof v === 'string') { if(Buffer.byteLength(v,'utf8')>SAVE_LIMITS.bytes)fail('SAVE_LIMIT');if (checkPortability && ABS.test(v)&&!cardPointer) fail('SAVE_ENVIRONMENT_PATH'); if (/\p{Surrogate}/u.test(v)) fail('SAVE_UNICODE'); return; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if ((!Array.isArray(v) && !plain(v)) || active.has(v)) fail('SAVE_JSON');
    if (Object.getOwnPropertySymbols(v).length) fail('SAVE_JSON'); active.add(v);
    const descriptors=Object.getOwnPropertyDescriptors(v);
    for (const [key,d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key==='length') continue;
      if (['__proto__','constructor','prototype'].includes(key) || !Object.hasOwn(d,'value') || !d.enumerable) fail('SAVE_JSON');
      if (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key)) fail('SAVE_JSON');
      if (checkPortability && ENV.test(key)) fail('SAVE_ENVIRONMENT_FIELD');
      if (checkPortability && /^(?:\$ref|\$include|externalFile|loadFrom|filePath)$/i.test(key) && typeof d.value==='string' && /^(?:\.\.[\\/]|https?:|file:|[a-z]:|[\\/])/i.test(d.value)) fail('SAVE_EXTERNAL_REFERENCE');
      if (/\p{Surrogate}/u.test(key)) fail('SAVE_UNICODE');
      walk(d.value,depth+1,key==='path'&&cardSelectors.has(v));
    }
    if (Array.isArray(v) && Object.keys(v).length!==v.length) fail('SAVE_JSON'); active.delete(v);
  }
  // Complete the data-only validation before examining any domain fields: a
  // getter/proxy-shaped payload must not execute through selector validation.
  walk(value,0); if (Buffer.byteLength(json(value),'utf8') > SAVE_LIMITS.bytes) fail('SAVE_LIMIT');
  if(portability){
    const run=value?.format===SAVE_FORMAT?value.run:value,snapshot=run?.schemaVersion===1?run.snapshot:null;
    if(snapshot){
      // Only the two canonical roster locations may contain this exception.
      // Revalidate each binding's exact card target and digest. A `path` in an
      // arbitrary extension or a merely similar object remains nonportable.
      for(const actors of [snapshot.characters,snapshot.card?.data?.extensions?.scean?.characters])if(Array.isArray(actors))for(const actor of actors){
        try{validateCharacterSources(actor,snapshot);}catch{continue;}
        for(const source of actor?.sourceBindings?.sources??[])if(source.kind==='card_field'&&typeof source.path==='string'&&source.path.startsWith('/data/')&&!source.path.split('/').some(part=>part==='.'||part==='..')&&!/[\\\u0000-\u001f]/.test(source.path))cardSelectors.add(source);
      }
    }
    nodes=0;checkPortability=true;walk(value,0);
  }
}

/** Parse raw JSON without accepting duplicate members, before normal JSON.parse. */
export function parseRunBundle(raw) {
  if (typeof raw !== 'string') fail('SAVE_JSON');
  if (Buffer.byteLength(raw,'utf8') > SAVE_LIMITS.bytes) fail('SAVE_LIMIT');
  let i=0,nodes=0; const ws=()=>{while(/[\x20\t\r\n]/.test(raw[i]??'!'))i++;};
  const string=()=> { const start=i++; while(i<raw.length){const c=raw[i++];if(c==='"'){try{return JSON.parse(raw.slice(start,i));}catch{fail('SAVE_JSON');}}if(c==='\\')i++;}fail('SAVE_JSON'); };
  function value(depth) {
    if(++nodes>SAVE_LIMITS.nodes || depth>SAVE_LIMITS.depth) fail('SAVE_LIMIT'); ws();
    if(raw[i]==='"'){string();return;}
    if(raw[i]==='{') { i++;ws();const keys=new Set();if(raw[i]==='}'){i++;return;}
      while(true){ws();if(raw[i]!=='"')fail('SAVE_JSON');const k=string();if(keys.has(k))fail('SAVE_DUPLICATE_MEMBER');keys.add(k);ws();if(raw[i++]!==':')fail('SAVE_JSON');value(depth+1);ws();const c=raw[i++];if(c==='}')return;if(c!==',')fail('SAVE_JSON');}
    }
    if(raw[i]==='['){i++;ws();if(raw[i]===']'){i++;return;}while(true){value(depth+1);ws();const c=raw[i++];if(c===']')return;if(c!==',')fail('SAVE_JSON');}}
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));if(!match)fail('SAVE_JSON');i+=match[0].length;
  }
  value(0);ws();if(i!==raw.length)fail('SAVE_JSON');
  try { const parsed=JSON.parse(raw);bounded(parsed);return parsed; } catch(e) { if(e instanceof SceanError)throw e;fail('SAVE_JSON'); }
}

function checkSources(records, turns, run, kind) {
  if (!Array.isArray(records) || records.length>SAVE_LIMITS.records) fail('SAVE_LIMIT');
  const byId=new Map(), known=new Set(run.snapshot.characters.map(c=>c.id));
  for(const row of records) {
    if(!plain(row))fail('SAVE_RECORD');safeId(row.id);if(byId.has(row.id))fail('SAVE_DUPLICATE_ID');byId.set(row.id,row);
    if(!integer(row.version,1) || typeof row.text!=='string' || !row.text.trim() || row.text.length>10000)fail('SAVE_RECORD');
    const s=row.source, t=s&&turns.get(s.commitId);
    fields(s,['runId','turn','commitId','bodyHash','requestId','attemptId','snapshotHash','cardId','revision','rosterHash'],['runId','turn','commitId','bodyHash','requestId','attemptId','snapshotHash','cardId','revision','rosterHash']);
    if(!t || s.runId!==run.runId || s.turn!==t.turn || s.bodyHash!==t.bodyHash || s.requestId!==t.requestId || s.attemptId!==t.attemptId || s.snapshotHash!==run.snapshot.hash || s.cardId!==run.snapshot.cardId || !same(s.revision,run.snapshot.revision) || s.rosterHash!==hash(run.snapshot.characters))fail('SAVE_SOURCE');
    if(kind==='memory'){fields(row,['id','version','source','text','characterIds','visibility','participants','quotes','metadata','schemaVersion','access','knowers','epistemic','credibility']);validateMemoryPolicy(row,known);}
    else {fields(row,['id','version','source','text','epistemic','credibility','participants','quotes','metadata','schemaVersion','role','scope']);if(row.schemaVersion!==1 || row.role!=='player_history' || !same(row.scope,{kind:'player_only'}) || !plain(row.epistemic)||Object.keys(row.epistemic).length!==1||!['fact','experience','belief','rumor','unverified'].includes(row.epistemic.kind) || !['confirmed','subjective','unverified','disputed'].includes(row.credibility))fail('SAVE_PLAYER_HISTORY');}
    fields(row.participants,['speakers','actors','decisionMakers'],['speakers','actors','decisionMakers']);
    for(const ids of Object.values(row.participants)) if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>id!=='player'&&!known.has(id)))fail('SAVE_RECORD_ACTOR');
    if(row.quotes!==undefined) {if(!Array.isArray(row.quotes)||row.quotes.length>20)fail('SAVE_QUOTES');for(const q of row.quotes){fields(q,['speakerId','text'],['speakerId','text']);if(typeof q.text!=='string'||!q.text.trim()||q.text.length>10000||!t.body.includes(q.text)||(q.speakerId!==null&&q.speakerId!=='player'&&!known.has(q.speakerId)))fail('SAVE_QUOTES');}}
  }
  const owned=new Set();
  for(const t of turns.values()) {
    const ids=kind==='memory'?t.memoryIds:t.playerHistoryIds;
    if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length)fail('SAVE_RECORD_IDS');
    for(const id of ids){if(owned.has(id)||byId.get(id)?.source.commitId!==t.commitId)fail('SAVE_RECORD_IDS');owned.add(id);}
  }
  if(owned.size!==records.length)fail('SAVE_RECORD_IDS');return byId;
}

function validateRun(run, { narrative=false, player=false }={}) {
  fields(run,[...(narrative?ROOT_D:ROOT),...(player?['playerIdentity']:[])],['schemaVersion','runId','version','head','snapshot','state','memories','playerHistory','turns','receipts','operationReceipts','retired','banList','createdAt','updatedAt']);
  if(run.writingMode!==undefined)validateWritingMode(run.writingMode,run.runId);
  if(run.proseStyle!==undefined)validateProseStyle(run.proseStyle,run.runId);
  if(run.schemaVersion!==1)fail('SAVE_RUN_VERSION');safeId(run.runId);if(!integer(run.version))fail('SAVE_RUN_VERSION');
  if(player){if(!Object.hasOwn(run,'playerIdentity'))fail('INVALID_PLAYER_IDENTITY');validatePlayerIdentity(run.playerIdentity,run);}
  if(run.openingId!==undefined)safeId(run.openingId);
  if(!digest(run.snapshot?.hash))fail('SAVE_SNAPSHOT_HASH');const snap=validateSnapshot(run.snapshot);
  const bp=validateBlueprint(snap.stateBlueprint,snap.characters), initial=materializeInitialState(bp,snap.initialState,snap.characters);
  validateBlueprintState(bp,run.state,snap.characters);
  if(!Array.isArray(run.turns)||run.turns.length>SAVE_LIMITS.turns||!Array.isArray(run.retired)||run.retired.length>SAVE_LIMITS.retired)fail('SAVE_LIMIT');
  if(!plain(run.receipts)||!plain(run.operationReceipts)||Object.keys(run.receipts).length+Object.keys(run.operationReceipts).length>SAVE_LIMITS.receipts)fail('SAVE_LIMIT');
  if(!same(normalizeBanList(run.banList),run.banList)||typeof run.createdAt!=='string'||typeof run.updatedAt!=='string'||!Number.isFinite(Date.parse(run.createdAt))||!Number.isFinite(Date.parse(run.updatedAt)))fail('SAVE_RUN_METADATA');
  const turns=new Map(),requests=new Set(),attempts=new Set();let previous;
  for(let index=0;index<run.turns.length;index++) {
    const t=run.turns[index];fields(t,['turn','requestId','commitId','input','body','bodyHash','dialoguePresentation','stateBefore','stateAfter','memoryIds','playerHistoryIds','attemptId','committedAt','commitVersion','stateProvenanceBefore','stateProvenanceAfter'],['turn','requestId','commitId','input','body','bodyHash','stateBefore','stateAfter','memoryIds','playerHistoryIds','attemptId','committedAt']);
    for(const key of ['requestId','commitId','attemptId'])safeId(t[key]);
    if(t.turn!==index+1 || turns.has(t.commitId)||requests.has(t.requestId)||attempts.has(t.attemptId)||typeof t.input!=='string'||!t.input.trim()||t.input.length>20000||typeof t.body!=='string'||!t.body.trim()||t.body.length>200000||t.bodyHash!==hash(t.body)||typeof t.committedAt!=='string'||!Number.isFinite(Date.parse(t.committedAt)))fail('SAVE_TURN');
    validateBlueprintState(bp,t.stateBefore,snap.characters);validateBlueprintState(bp,t.stateAfter,snap.characters);
    if(t.commitVersion!==undefined&&(!integer(t.commitVersion,1)||t.commitVersion>run.version||(index&&run.turns[index-1].commitVersion>=t.commitVersion)))fail('SAVE_TURN_VERSION');
    if(previous&&!same(previous,t.stateBefore))fail('SAVE_STATE_CHAIN');previous=t.stateAfter;turns.set(t.commitId,t);requests.add(t.requestId);attempts.add(t.attemptId);
  }
  const head=run.turns.at(-1)?.commitId??null;if(run.head!==head||run.version<run.turns.length)fail('SAVE_HEAD');
  if(previous&&!same(previous,run.state))fail('SAVE_STATE_CHAIN');
  if(run.baselineState!==undefined){validateBlueprintState(bp,run.baselineState,snap.characters);if(!same(run.turns[0]?.stateBefore??run.state,run.baselineState))fail('SAVE_BASELINE_STATE');}
  // Blueprint runs have an explicit immutable initial-state contract.
  if(bp&&!same(run.turns[0]?.stateBefore??run.state,initial.state))fail('SAVE_INITIAL_STATE');
  const memories=checkSources(run.memories,turns,run,'memory'),history=checkSources(run.playerHistory,turns,run,'history');
  const retired=new Set();
  for(const row of run.retired){
    fields(row,['commitId','requestId','attemptId','turn','bodyHash','reason','operationId','retiredAtVersion','replacedBy'],['commitId','requestId','attemptId','turn','bodyHash','reason','operationId','retiredAtVersion','replacedBy']);
    for(const k of ['commitId','requestId','attemptId','operationId'])safeId(row[k]);
    if(row.replacedBy!==null)safeId(row.replacedBy);
    if(retired.has(row.commitId)||turns.has(row.commitId)||requests.has(row.requestId)||attempts.has(row.attemptId)||!integer(row.turn,1)||!integer(row.retiredAtVersion,1)||row.retiredAtVersion>run.version||!digest(row.bodyHash)||!['rollback','regenerate'].includes(row.reason)||(row.reason==='rollback'&&row.replacedBy!==null)||(row.reason==='regenerate'&&row.replacedBy===null))fail('SAVE_AUDIT');retired.add(row.commitId);requests.add(row.requestId);attempts.add(row.attemptId);
  }
  for(const [requestId,r] of Object.entries(run.receipts)) {
    safeId(requestId);if(!plain(r)||!digest(r.inputHash))fail('SAVE_RECEIPT');safeId(r.commitId);safeId(r.attemptId);
    if(r.status==='retired') { fields(r,['status','inputHash','commitId','attemptId','retiredBy','retiredAtVersion'],['status','inputHash','commitId','attemptId','retiredBy','retiredAtVersion']);const audit=run.retired.find(x=>x.commitId===r.commitId);if(!audit||audit.requestId!==requestId||audit.attemptId!==r.attemptId||audit.operationId!==r.retiredBy||audit.retiredAtVersion!==r.retiredAtVersion)fail('SAVE_RECEIPT');safeId(r.retiredBy);continue; }
    fields(r,['status','inputHash','commitId','attemptId','result'],['inputHash','commitId','attemptId','result']);const t=turns.get(r.commitId),v=r.result;
    if(r.status!==undefined&&r.status!=='committed')fail('SAVE_RECEIPT');
    fields(v,['runId','requestId','version','turn','body','state','memories','playerHistory','commitId','status','trace'],['runId','requestId','version','turn','body','state','memories','commitId','status']);
    checkTrace(v.trace,t?.attemptId);
    if(!t||t.requestId!==requestId||r.attemptId!==t.attemptId||r.inputHash!==hash(t.input)||v.status!=='committed'||v.runId!==run.runId||v.requestId!==requestId||v.commitId!==t.commitId||v.turn!==t.turn||v.body!==t.body||!integer(v.version,1)||v.version>run.version||(t.commitVersion!==undefined&&v.version!==t.commitVersion)||!same(v.state,t.stateAfter)||!same(v.memories,t.memoryIds.map(id=>memories.get(id)))||!same(v.playerHistory??[],t.playerHistoryIds.map(id=>history.get(id))))fail('SAVE_RECEIPT');
  }
  for(const t of turns.values())if(run.receipts[t.requestId]?.commitId!==t.commitId||run.receipts[t.requestId]?.status==='retired')fail('SAVE_RECEIPT');
  for(let i=1;i<run.turns.length;i++)if(run.receipts[run.turns[i-1].requestId].result.version>=run.receipts[run.turns[i].requestId].result.version)fail('SAVE_TURN_VERSION');
  for(let i=1;i<run.retired.length;i++)if(run.retired[i-1].retiredAtVersion>=run.retired[i].retiredAtVersion)fail('SAVE_AUDIT');
  for(const row of run.retired){if(run.receipts[row.requestId]?.status!=='retired'||run.receipts[row.requestId]?.commitId!==row.commitId||!run.operationReceipts[row.operationId])fail('SAVE_AUDIT');if(row.replacedBy&&!turns.has(row.replacedBy)&&!retired.has(row.replacedBy))fail('SAVE_AUDIT');}
  for(const [operationId,r] of Object.entries(run.operationReceipts)){
    safeId(operationId);fields(r,['kind','fingerprint','request','result'],['kind','fingerprint','request','result']);const v=r.result,q=r.request;
    if(!['rollback','regenerate'].includes(r.kind)||!digest(r.fingerprint)||!plain(v))fail('SAVE_OPERATION_RECEIPT');
    const requestFields=['kind','runId','operationId','expectedVersion','expectedHead',...(r.kind==='regenerate'?['requestId','guidance']:[])];
    fields(q,requestFields,requestFields);
    if(q.kind!==r.kind||q.runId!==run.runId||q.operationId!==operationId||!integer(q.expectedVersion)||q.expectedHead!==v.retiredCommitId||q.expectedVersion!==v.version-1||hash(q)!==r.fingerprint)fail('SAVE_OPERATION_REQUEST');
    safeId(q.expectedHead);
    if(r.kind==='regenerate'){
      safeId(q.requestId);
      if(q.requestId!==v.requestId||typeof q.guidance!=='string'||q.guidance.length>10000||(q.guidance!==''&&!q.guidance.trim()))fail('SAVE_OPERATION_REQUEST');
    }
    fields(v,['status','kind','runId','operationId','version','head','retiredCommitId','requestId','commitId','turn','body','state','memories','playerHistory','trace','retiredBy','retiredAtVersion'],['status','kind','runId','operationId','version','head','retiredCommitId']);
    if(v.kind!==r.kind||v.runId!==run.runId||v.operationId!==operationId||!integer(v.version,1)||v.version>run.version||!retired.has(v.retiredCommitId)||!['committed','retired'].includes(v.status))fail('SAVE_OPERATION_RECEIPT');
    if(v.head!==null&&!turns.has(v.head)&&!retired.has(v.head))fail('SAVE_OPERATION_RECEIPT');
    const target=run.retired.find(x=>x.commitId===v.retiredCommitId);if(target.operationId!==operationId||target.reason!==r.kind||target.retiredAtVersion!==v.version)fail('SAVE_OPERATION_RECEIPT');
    if(r.kind==='regenerate'&&target.replacedBy!==v.commitId)fail('SAVE_OPERATION_RECEIPT');
    if(v.status==='retired'){
      if(['body','state','memories','playerHistory','trace','turn'].some(k=>Object.hasOwn(v,k))||r.kind!=='regenerate'||!retired.has(v.commitId))fail('SAVE_OPERATION_RECEIPT');
      const a=run.retired.find(x=>x.commitId===v.commitId);if(a.requestId!==v.requestId||a.operationId!==v.retiredBy||a.retiredAtVersion!==v.retiredAtVersion)fail('SAVE_OPERATION_RECEIPT');
    }else if(r.kind==='regenerate'){
      const t=turns.get(v.commitId);if(!t||v.head!==t.commitId||target.replacedBy!==t.commitId||v.requestId!==t.requestId||v.turn!==t.turn||v.body!==t.body||!same(v.state,t.stateAfter)||!same(v.memories,t.memoryIds.map(id=>memories.get(id)))||!same(v.playerHistory??[],t.playerHistoryIds.map(id=>history.get(id))))fail('SAVE_OPERATION_RECEIPT');checkTrace(v.trace,t.attemptId);
    }else if(['requestId','commitId','turn','body','state','memories','playerHistory','trace','retiredBy','retiredAtVersion'].some(k=>Object.hasOwn(v,k)))fail('SAVE_OPERATION_RECEIPT');
  }
  const provenance=(rows,allowed)=>{if(!Array.isArray(rows)||!bp)fail('SAVE_PROVENANCE');const seen=new Set();for(const p of rows){fields(p,['target','kind','operation','blueprintId','blueprintVersion','source'],['target','kind','blueprintId','blueprintVersion','source']);if(p.blueprintId!==bp.id||p.blueprintVersion!==bp.version||typeof p.target!=='string'||seen.has(json(p)))fail('SAVE_PROVENANCE');seen.add(json(p));if(p.kind==='initial'){if(!initial.provenance.some(x=>same(x,p)))fail('SAVE_PROVENANCE');}else if(!['declared-update','dynamic'].includes(p.kind)||!['set','remove'].includes(p.operation)||!allowed.has(p.source?.id)||!integer(p.source.version,1)||p.source.version>run.version)fail('SAVE_PROVENANCE');}for(const p of initial.provenance)if(!rows.some(x=>same(x,p)))fail('SAVE_PROVENANCE');};
  if(bp&&!Array.isArray(run.stateProvenance))fail('SAVE_PROVENANCE');
  if(run.baselineProvenance!==undefined&&(!bp||!same(run.baselineProvenance,initial.provenance)))fail('SAVE_PROVENANCE');
  if(run.stateProvenance!==undefined)provenance(run.stateProvenance,turns);
  const preceding=new Map();let lastProvenance;
  for(const t of run.turns){
    if(t.stateProvenanceBefore!==undefined){provenance(t.stateProvenanceBefore,preceding);if(lastProvenance&&!same(lastProvenance,t.stateProvenanceBefore))fail('SAVE_PROVENANCE');}
    preceding.set(t.commitId,t);
    if(t.stateProvenanceAfter!==undefined){provenance(t.stateProvenanceAfter,preceding);lastProvenance=t.stateProvenanceAfter;}
  }
  if(lastProvenance&&!same(lastProvenance,run.stateProvenance))fail('SAVE_PROVENANCE');
  if(bp)for(const t of run.turns){
    const rows=run.stateProvenance.filter(p=>p.source.id===t.commitId),changes=[];
    for(const p of rows){
      let target;try{target=JSON.parse(p.target);}catch{fail('SAVE_PROVENANCE');}
      if(!Array.isArray(target)||target.length!==4)fail('SAVE_PROVENANCE');
      const [scope,characterId,category,key]=target;
      const change={scope,...(characterId===null?{}:{characterId}),category,key,operation:p.operation,...(scope==='character'?{visibility:'public'}:{})};
      const bucket=(scope==='world'?t.stateAfter.world:t.stateAfter.characters[characterId]?.public)?.[category];
      if(p.operation==='set'){if(!plain(bucket)||!Object.hasOwn(bucket,key))fail('SAVE_PROVENANCE');change.value=clone(bucket[key]);}
      else if(bucket&&Object.hasOwn(bucket,key))fail('SAVE_PROVENANCE');
      const receiptVersion=run.receipts[t.requestId].result.version;if(p.source.version!==receiptVersion)fail('SAVE_PROVENANCE');
      const expected=validateBlueprintStateChanges(bp,[change],snap.characters,{source:{id:t.commitId,version:receiptVersion},publicView:true});
      if(!same(expected,[p]))fail('SAVE_PROVENANCE');changes.push(change);
    }
    const applied=applyStatProposal({contractVersion:2,stateChanges:changes,memories:[]},t.stateBefore,snap.characters,t.body,{publicView:true});
    if(!same(applied.state,t.stateAfter))fail('SAVE_PROVENANCE_STATE');
  }
  if(narrative)validateNarrative(run);
  const safe=clone(run);for(const turn of safe.turns){if(turn.dialoguePresentation){const display=publicTurnDialogue(safe,turn);if(display.dialoguePresentation)turn.dialoguePresentation=display.dialoguePresentation;else delete turn.dialoguePresentation;}}return safe;
}

function checkTrace(trace,attemptId){
  if(trace===undefined)return;
  fields(trace,['attemptId','operationId','stages','proseStyle','writingMode'],['attemptId','stages']);
  if(trace.writingMode!==undefined)validateWritingModeReference(trace.writingMode);
  if(trace.proseStyle!==undefined)validateProseStyleReference(trace.proseStyle);
  if(trace.attemptId!==attemptId)fail('SAVE_RECEIPT');safeId(trace.attemptId);if(trace.operationId!==undefined)safeId(trace.operationId);
  if(!Array.isArray(trace.stages)||trace.stages.length>256)fail('SAVE_RECEIPT');
  for(const stage of trace.stages){fields(stage,['stage','status'],['stage','status']);if(!['director','character','adjudicate','draft','prose','prose_repair','writer','writer_repair','validation','post_stat'].includes(stage.stage)||stage.status!=='completed')fail('SAVE_RECEIPT');}
}
function portableReceipt(receipt) {
  const out=clone(receipt);
  if(out.result?.trace?.proseStyle?.revision===0)delete out.result.trace.proseStyle;
  if(out.result?.trace)out.result.trace={...(out.result.trace.writingMode?{writingMode:clone(out.result.trace.writingMode)}:{}),...(out.result.trace.proseStyle?{proseStyle:clone(out.result.trace.proseStyle)}:{}),attemptId:out.result.trace.attemptId,...(out.result.trace.operationId?{operationId:out.result.trace.operationId}:{}),stages:(out.result.trace.stages??[]).map(s=>({stage:s.stage,status:s.status}))};
  return out;
}
export function encodeRunBundle(run) {
  // Never copy Host/provider fields or raw attempt traces into the portable domain.
  const hasNarrative=Object.hasOwn(run,'narrative'),hasPlayer=Object.hasOwn(run,'playerIdentity');
  const portable=Object.fromEntries([...(hasNarrative?ROOT_D:ROOT),...(hasPlayer?['playerIdentity']:[])].filter(k=>Object.hasOwn(run,k)).map(k=>{const d=Object.getOwnPropertyDescriptor(run,k);if(!Object.hasOwn(d,'value'))fail('SAVE_JSON');bounded(d.value,{portability:false});return[k,clone(d.value)];}));
  if(portable.head===undefined)portable.head=portable.turns?.at(-1)?.commitId??null;portable.operationReceipts??={};portable.retired??=[];portable.playerHistory??=[];
  portable.receipts=Object.fromEntries(Object.entries(portable.receipts??{}).map(([key,value])=>[key,portableReceipt(value)]));
  portable.operationReceipts=Object.fromEntries(Object.entries(portable.operationReceipts).map(([key,value])=>[key,portableReceipt(value)]));
  for(const turn of portable.turns??[]){if(turn.dialoguePresentation){try{const display=publicTurnDialogue(portable,turn);if(display.dialoguePresentation){bounded(display.dialoguePresentation);turn.dialoguePresentation=display.dialoguePresentation;}else delete turn.dialoguePresentation;}catch{delete turn.dialoguePresentation;}}}
  if(Buffer.byteLength(JSON.stringify(portable),'utf8')>SAVE_LIMITS.bytes)for(const turn of portable.turns??[])delete turn.dialoguePresentation;
  bounded(portable);validateRun(portable,{narrative:hasNarrative,player:hasPlayer});
  const bundle={format:SAVE_FORMAT,schemaVersion:portable.turns.some(t=>t.dialoguePresentation)?7:(portable.writingMode!==undefined||Object.values(portable.receipts).some(r=>r.result?.trace?.writingMode!==undefined))?6:(portable.proseStyle!==undefined||Object.values(portable.receipts).some(r=>r.result?.trace?.proseStyle!==undefined))?5:hasPlayer?4:hasNarrative?(portable.narrative.schemaVersion===2?3:2):1,manifest:{runId:portable.runId,version:portable.version,head:portable.head,snapshotHash:portable.snapshot.hash,sha256:hash(portable)},run:portable};
  bounded(bundle);return bundle;
}
export function validateRunBundle(value) {
  const bundle=typeof value==='string'?parseRunBundle(value):value;bounded(bundle);
  fields(bundle,['format','schemaVersion','manifest','run'],['format','schemaVersion','manifest','run']);if(bundle.format!==SAVE_FORMAT||![1,2,3,4,5,6,7].includes(bundle.schemaVersion)||(bundle.schemaVersion===2&&bundle.run?.narrative?.schemaVersion!==1)||(bundle.schemaVersion===3&&bundle.run?.narrative?.schemaVersion!==2))fail('SAVE_FORMAT_VERSION');
  const styleDomain=Object.hasOwn(bundle.run??{},'proseStyle')||Object.values(bundle.run?.receipts??{}).some(r=>r?.result?.trace?.proseStyle!==undefined);
  const modeDomain=Object.hasOwn(bundle.run??{},'writingMode')||Object.values(bundle.run?.receipts??{}).some(r=>r?.result?.trace?.writingMode!==undefined);
  const dialogueDomain=bundle.run?.turns?.some(t=>Object.hasOwn(t,'dialoguePresentation'))===true;
  if(bundle.schemaVersion===7?!dialogueDomain:dialogueDomain||(bundle.schemaVersion===6?!modeDomain:modeDomain||(bundle.schemaVersion===5)!==styleDomain))fail('SAVE_FORMAT_VERSION');
  const m=bundle.manifest;fields(m,['runId','version','head','snapshotHash','sha256'],['runId','version','head','snapshotHash','sha256']);
  if(!digest(m.sha256)||m.sha256!==hash(bundle.run))fail('SAVE_DIGEST');
  if(m.runId!==bundle.run.runId||m.version!==bundle.run.version||m.head!==bundle.run.head||m.snapshotHash!==bundle.run.snapshot.hash)fail('SAVE_MANIFEST');
  return validateRun(bundle.run,{narrative:bundle.schemaVersion>=4?Object.hasOwn(bundle.run,'narrative'):bundle.schemaVersion>=2,player:bundle.schemaVersion===4||bundle.schemaVersion>=5&&Object.hasOwn(bundle.run,'playerIdentity')});
}
