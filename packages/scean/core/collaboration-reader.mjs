import {hash,SceanError}from'./contracts.mjs';
import {publicData,publicStateForModel,eligibleMemory}from'./memory-policy.mjs';
const fail=code=>{throw new SceanError(code);},obj=v=>v&&typeof v==='object'&&!Array.isArray(v),copy=v=>structuredClone(v);
const SECTIONS=['knownFacts','effectiveConstraints','expressedCommitmentsOrRefusals','characterPositions','unknowns'];
const clean=v=>typeof v==='string'?v.replace(/(?:sk-proj-|sk-|gh[pousr]_|github_pat_|AIza)[A-Za-z0-9_-]{24,}|Bearer\s+[A-Za-z0-9._-]{16,}|-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[疑似憑證已省略]'):'';
const fmt=v=>clean(typeof v==='string'?v:JSON.stringify(v??null,null,2));
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,copy(v[k])]));
const scalars=(v,keys)=>Object.fromEntries(keys.filter(k=>['string','number','boolean'].includes(typeof v?.[k])).map(k=>[k,typeof v[k]==='string'?clean(v[k]):v[k]]));
const publicMemories=(rows,runId)=>(Array.isArray(rows)?rows:[]).filter(m=>eligibleMemory(m,{runId,audience:'public'})).map(m=>({...scalars(publicData(m),['id','text','credibility']),epistemic:scalars(m.epistemic,['kind']),source:scalars(m.source,['runId','turn','commitId','bodyHash','version'])}));

function readPublicState(value){
 if(value===undefined)return {status:'not_recorded'};
 if(!obj(value)||!obj(value.world)||!obj(value.characters)||Object.values(value.characters).some(v=>!obj(v)))return {status:'source_corrupt'};
 return {status:'saved_public_projection',value:publicStateForModel(value)};
}
function usableCheckpoint(a){
 if(!obj(a)||a.stages!==undefined&&(!Array.isArray(a.stages)||a.stages.some(s=>!obj(s)||typeof s.stage!=='string'))||a.tools!==undefined&&(!Array.isArray(a.tools)||a.tools.some(t=>!obj(t)||typeof t.id!=='string'||typeof t.name!=='string')))return false;
 const h=a.writerHandoff;if(h?.kind==='public_writer_handoff'){
  if(!obj(h.interpretation)||h.sourceCatalog!==undefined&&!Array.isArray(h.sourceCatalog))return false;
  for(const k of SECTIONS)if(h.interpretation[k]!==undefined&&(!Array.isArray(h.interpretation[k])||h.interpretation[k].some(r=>!obj(r)||typeof r.text!=='string'||!Array.isArray(r.sourceRefs)||r.sourceRefs.some(s=>typeof s!=='string'))))return false;
 }
 return true;
}
function publicHandoff(value){
 if(!obj(value)||value.kind!=='public_writer_handoff'||value.schemaVersion!==1)return null;
 const interpretation={};for(const k of SECTIONS)interpretation[k]=(Array.isArray(value.interpretation?.[k])?value.interpretation[k]:[]).slice(0,24).map(r=>({text:clean(r.text),sourceRefs:(r.sourceRefs??[]).filter(x=>typeof x==='string').slice(0,8),meaning:'director_interpretation_not_event'}));
 return {sceneIntent:clean(value.sceneIntent),interpretation,sourceCatalog:(Array.isArray(value.sourceCatalog)?value.sourceCatalog:[]).slice(0,256).map(r=>scalars(r,['id','kind','status','commitId','chapterId','summaryId','startTurn','endTurn'])),meaning:'public_handoff_not_event'};
}
export function attemptCanonical(run,attemptId,requestId){
 const turn=(run.turns??[]).find(t=>t.attemptId===attemptId&&(!requestId||t.requestId===requestId));
 if(turn){const r=run.receipts?.[turn.requestId];if(r?.attemptId===attemptId&&r.commitId===turn.commitId&&r.result?.trace?.attemptId===attemptId)return {status:'committed',commitId:turn.commitId,turn:turn.turn};return {status:'unknown'};}
 const retired=Object.values(run.receipts??{}).find(r=>r.status==='retired'&&(r.attemptId??r.result?.trace?.attemptId)===attemptId);
 if(retired)return {status:'retired',commitId:retired.commitId};
 return {status:'not_committed'};
}
function evidenceRecord(tool,index,writer,handoff){
 const base={id:'tool:'+tool.id,kind:tool.name,title:({consult_character:'Director → Character',adjudicate_action:'Director → Stat（主動裁定）',search_history:'Director → 歷史搜尋',read_history:'Director → 歷史閱讀'})[tool.name]??'未知工具',status:tool.status??'not_recorded',sourceRefs:['tool:'+tool.id]};
 const actual=writer?.prompt?.input?.directorHandoff;
 const inPacket=actual?.kind==='public_writer_handoff'&&Array.isArray(actual.evidence)&&actual.evidence.some(e=>e?.source?.toolCallId===tool.id&&e.audience==='public');
 base.deliveryStatus=inPacket?(writer.status==='completed'?'public_reference_in_completed_writer_packet':'assembled_delivery_unconfirmed'):'not_in_saved_writer_packet';
 base.directorCited=SECTIONS.some(k=>Array.isArray(handoff?.interpretation?.[k])&&handoff.interpretation[k].some(r=>Array.isArray(r?.sourceRefs)&&r.sourceRefs.includes('tool:'+tool.id)));
 if(tool.name==='consult_character'){
  base.question=clean(tool.arguments?.question);const a=tool.result?.advice;
  base.note='角色公開建議，不是已發生事件；不包含 withheld、internal、owner Memory 或私密狀態。';
  if(tool.status==='completed'&&a?.adviceVersion===1&&a.kind==='advice_not_event')base.answer=fmt({characterId:clean(a.characterId),observable:scalars(a.observable,['attitude','intent']),publicUtterances:(Array.isArray(a.publicUtterances)?a.publicUtterances:[]).filter(x=>typeof x==='string').map(clean),intendedDisclosures:(Array.isArray(a.intendedDisclosures)?a.intendedDisclosures:[]).map(d=>scalars(d,['topic','publicText']))});
  else if(tool.status==='completed'){base.status='not_recorded';base.note='舊版回應沒有明確公開 envelope，未展開私密原始結果。';}
 }else if(tool.name==='adjudicate_action'){
  base.question=clean(tool.arguments?.action);base.mode=['query','calculate','adjudicate'].includes(tool.arguments?.mode)?tool.arguments.mode:'adjudicate';base.note='主動 Stat 查詢／裁定是建議，並未直接改動 State；與回合末 post_stat 分開。';if(tool.status==='completed')base.answer=clean(tool.result?.text);
 }else if(['search_history','read_history'].includes(tool.name)){
  base.question=fmt({...scalars(tool.arguments,['query','limit','mode','caseSensitive','commitId','radius','maxChars']),...(obj(tool.arguments?.locator)?{locator:scalars(tool.arguments.locator,['kind','commitId','chapterId','summaryId','turn'])}:typeof tool.arguments?.locator==='string'?{locator:clean(tool.arguments.locator)}:{})});base.note='既有已提交歷史的查詢結果，不是新事件或每名角色皆知的事實。';if(tool.status==='completed')base.answer=clean(tool.result?.text);
 }else{base.status='unsupported';base.question='';base.note='來源未列入公開工具白名單。';}
 if(tool.error)base.errorCode=/^[A-Z0-9_]{1,80}$/.test(tool.error.code??'')?tool.error.code:'TOOL_FAILED';
 return base;
}
function recordsFor(run,attempt,canonical){
 const records=[],stages=Array.isArray(attempt.stages)?attempt.stages:[],writer=stages.find(s=>s.stage==='writer'),handoff=attempt.writerHandoff;
 if(attempt.assembly){const a=attempt.assembly;records.push({id:'preparation',kind:'data_reference',title:'公開資料參考',status:'completed',question:'Host 提供的公開 State／Memory 參考',answer:fmt({state:readPublicState(a.worldState),memory:{status:a.memory?.status??'not_recorded',records:publicMemories(a.memory?.records,run.runId)}}),note:'這是已保存的資料準備，不是 Memory／State Agent 對話；未重新檢索。'});}
 else records.push({id:'preparation',kind:'data_reference',title:'公開資料參考',status:attempt.status==='pending'?'source_pending':'not_recorded',note:'此來源尚未保存或舊版未記錄。'});
 const tools=Array.isArray(attempt.tools)?attempt.tools:[];
 records.push({id:'director-tools',kind:'tools_status',title:'Director 主動工具',status:tools.length?'recorded':attempt.directorComplete===true?'not_called':attempt.status==='pending'?'source_pending':'not_recorded',note:tools.length?'以下依實際已保存工具往返列出。':attempt.directorComplete===true?'本輪 Director 已完成，未主動呼叫工具。':'尚未保存工具往返；不能據此斷言沒有呼叫。'});
 for(const [i,t]of tools.entries())records.push(evidenceRecord(t,i,writer,handoff));
 const h=publicHandoff(handoff),delivered=publicHandoff(writer?.prompt?.input?.directorHandoff);
 records.push({id:'director-handoff',kind:'handoff',title:'Director 公開交接',status:h?'completed':attempt.status==='pending'?'source_pending':'not_recorded',...(h?{answer:fmt(h)}:{}),deliveryStatus:delivered?(writer.status==='completed'?'saved_packet_with_completed_model_result':'assembled_delivery_unconfirmed'):'not_recorded',note:'交接與來源引用不等於語義採納；不包含完整 Prompt、Preset 或文風。'});
 if(writer){records.push({id:'writer',kind:'writer',title:'Writer 候選與正文',status:writer.status??'not_recorded',canonicalStatus:canonical.status,note:canonical.status==='committed'?'僅正式 commit 的最終正文是事件來源。':canonical.status==='retired'?'此結果已回滾或被替換，不是目前正式歷史。':'候選尚未成為正式正文；沒有在此複製原始模型全文。',...(canonical.commitId?{commitId:canonical.commitId}:{} )});}
 else for(const [i,s]of stages.entries())if(['draft','prose'].includes(s.stage))records.push({id:'legacy-stage:'+i,kind:s.stage,title:s.stage==='draft'?'舊流程 Draft':'舊流程 Prose',status:s.status??'not_recorded',note:'按實際保存階段顯示；沒有補造 Single Writer 交接。'});
 for(const [i,s]of stages.entries())if(s.stage==='validation')records.push({id:'validation:'+i,kind:'validation',title:'正文驗證／必要局部修復',status:s.status??'not_recorded',note:'以最後驗證後正文為準，候選不自動成為事件。'});
 const post=stages.find(s=>s.stage==='post_stat');
 records.push({id:'post-stat',kind:'post_stat',title:'回合末 post_stat（獨立結算）',status:post?.status??(attempt.status==='pending'?'source_pending':'not_recorded'),question:'依最終正文抽取狀態與記憶提案，並進行提交驗證。',...(attempt.commit?{answer:fmt({status:attempt.commit.status,previousPublicState:readPublicState(attempt.commit.stateBefore),proposedPublicState:readPublicState(attempt.commit.stateAfter),publicMemories:publicMemories(attempt.commit.memories,run.runId)})}:{}),note:'不是 Director 主動 Stat 問答。只有通過驗證並原子提交才生效。'});
 records.push({id:'canonical',kind:'commit',title:'正式歷史狀態',status:canonical.status,...(canonical.commitId?{commitId:canonical.commitId}:{}),note:({committed:'已核對 publishing attempt 的正式提交。',retired:'已回滾或被替換；保留來源紀錄。',not_committed:'沒有找到屬於此 attempt 的正式提交；稍後重試成功不會改寫此狀態。',unknown:'提交身份不完整，結果尚不能確認。'})[canonical.status]});
 return records;
}
function fragment(text,offset,budget=10000){
 text=clean(text);if(!Number.isSafeInteger(offset)||offset<0||offset>text.length||offset>0&&/[\uDC00-\uDFFF]/.test(text[offset])&&/[\uD800-\uDBFF]/.test(text[offset-1]))fail('READER_QUERY_INVALID');
 let lo=offset,hi=Math.min(text.length,offset+budget);while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(Buffer.byteLength(JSON.stringify(text.slice(offset,mid)),'utf8')<=budget)lo=mid;else hi=mid-1;}let end=lo;if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;return {text:text.slice(offset,end),next:end<text.length?end:null};
}
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function cursorValue(cursor,revision){if(cursor===undefined||cursor===null||cursor===0)return 0;try{if(typeof cursor!=='string'||cursor.length>512)fail('READER_QUERY_INVALID');const p=JSON.parse(Buffer.from(cursor,'base64url').toString());if(p.revision!==revision)fail('READER_SOURCE_CHANGED');if(!Number.isSafeInteger(p.offset)||p.offset<0)fail('READER_QUERY_INVALID');return p.offset;}catch(e){if(e.code)throw e;fail('READER_QUERY_INVALID');}}
/** Read model only. Never retrieves Memory, recovers attempts, or changes a Run. */
export function collaborationView(run,{attempt=null,operation=null,attempts=[],sourceStatus='not_recorded',reason=null}={},args={}){
 if(args.expectedSnapshotHash!==undefined&&args.expectedSnapshotHash!==run.snapshot.hash)fail('READER_SOURCE_CHANGED');
 const identity={schemaVersion:1,kind:'collaboration',runId:run.runId,snapshotHash:run.snapshot.hash,head:run.head??null,version:run.version,semanticAdoption:'not_assessed'};
 if(attempt&&(attempt.runId!==run.runId||![attempt.inputSnapshot?.hash,attempt.turnIdentity?.snapshotHash].some(v=>v!==undefined)||[attempt.inputSnapshot?.hash,attempt.turnIdentity?.snapshotHash].some(v=>v!==undefined&&v!==run.snapshot.hash)))return {...identity,status:'association_unknown',source:{checkpointStatus:'not_recorded',readRevision:hash({run:run.runId,snapshot:run.snapshot.hash,status:'association_unknown'})},operation:{kind:operation?.kind??'unknown',status:operation?.status??'unknown',canonicalStatus:'unknown',turnLabel:null},coverage:{status:'partial',reason:'attempt_snapshot_identity_mismatch'},attempts:[],records:[],nextCursor:null};
 if(attempt&&!usableCheckpoint(attempt)){attempt=null;sourceStatus='source_corrupt';reason='checkpoint_schema_unsupported';}
 const selectedId=attempt?.attemptId??operation?.attemptId;
 const canonical=selectedId?attemptCanonical(run,selectedId,attempt?.requestId??operation?.requestId):{status:operation?.status==='unknown'?'unknown':'not_committed'};
 if(attempt&&canonical.status==='not_committed'&&['committed','retired','unknown'].includes(attempt.status))canonical.status='unknown';
 const rows=attempt?recordsFor(run,attempt,canonical):[];
 const revision=hash({attempt:attempt??null,sourceStatus,canonical,operationId:operation?.operationId??null});
 if(args.expectedReadRevision!==undefined&&args.expectedReadRevision!==revision)fail('READER_SOURCE_CHANGED');
 const base={...identity,status:attempt?'ready':sourceStatus,source:{cardRevision:run.snapshot.revision??null,attemptId:attempt?.attemptId??operation?.attemptId??null,operationId:attempt?.operationId??operation?.operationId??null,readRevision:revision,checkpointStatus:attempt?'saved':sourceStatus},operation:{kind:operation?.kind??'turn',status:operation?.status??attempt?.status??'not_recorded',canonicalStatus:canonical.status,turnLabel:canonical.turn??attempt?.turnIdentity?.turn??null},coverage:{status:attempt?(attempt.status==='pending'?'partial':'complete'):'not_recorded',reason:reason??(attempt?'saved_public_projection_only':sourceStatus)},attempts:attempts.slice(0,100),nextCursor:null};
 while(Buffer.byteLength(JSON.stringify(base.attempts),'utf8')>8192&&base.attempts.length){base.attempts.pop();base.coverage.attemptChoicesOmitted=(base.coverage.attemptChoicesOmitted??0)+1;}
 if(canonical.status==='committed')base.source.commitId=canonical.commitId;
 if(args.recordId!==undefined){if(typeof args.recordId!=='string'||!['question','answer'].includes(args.contentField))fail('READER_QUERY_INVALID');const row=rows.find(r=>r.id===args.recordId);if(!row)fail('READER_RECORD_NOT_FOUND');const field=args.contentField,p=fragment(row[field]??'',args.contentOffset??0),value={...base,records:[{...pick(row,['id','kind','title','status','canonicalStatus','note','commitId']),[field]:p.text,[field==='question'?'questionOffset':'answerOffset']:args.contentOffset??0,[field==='question'?'questionNextOffset':'nextContentOffset']:p.next}]};if(Buffer.byteLength(JSON.stringify(value),'utf8')>48000)fail('READER_RESPONSE_LIMIT');return value;}
 const offset=cursorValue(args.cursor,revision),limit=args.limit??12;if(!Number.isSafeInteger(limit)||limit<1||limit>30||offset>rows.length)fail('READER_QUERY_INVALID');
 const records=[];for(const row of rows.slice(offset,offset+limit)){const item={...row};for(const field of ['question','answer'])if(typeof row[field]==='string'){const p=fragment(row[field],0,field==='question'?4000:10000);item[field]=p.text;item[field==='question'?'questionNextOffset':'nextContentOffset']=p.next;}const proposed={...base,records:[...records,item]};if(Buffer.byteLength(JSON.stringify(proposed),'utf8')>48000){if(!records.length)fail('READER_RESPONSE_LIMIT');break;}records.push(item);}
 const next=offset+records.length;return {...base,records,nextCursor:next<rows.length?enc({revision,offset:next}):null};
}
