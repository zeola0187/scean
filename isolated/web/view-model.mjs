export const stageNames = Object.freeze({ memory:'讀取可用記憶', director:'構思', character:'角色諮詢', adjudicate:'行動裁定', writer:'單一 Writer 正文',writer_repair:'正文局部校修',validation:'本機正文檢查',draft:'草稿', prose:'正文', prose_repair:'局部校修', banlist:'禁詞檢查', post_stat:'結算世界與記憶', commit:'保存' });
export const statusNames = Object.freeze({ pending:'進行中', completed:'完成', failed:'失敗', cancelled:'已取消', committed:'已提交', not_called:'未呼叫', not_recorded:'未記錄' });
export function generationAvailability(mode, models, writingMode='single_writer') {
  const actualMode=String(mode??models?.mode??'');
  const scripted=/script|mock|offline/i.test(actualMode);
  if(actualMode==='interactive'){
    const blocked=models?.interactive?.enabled!==true;
    return {blocked,remaining:null,requiresActivation:blocked,message:blocked?'使用者互動模式尚未啟用模型連線。可先查看保存內容；欲生成新回合，請在輸入區確認本次啟動的模型使用授權。':''};
  }
  const remaining=models?.remaining??models?.generationGate?.remaining;
  const blocked=!scripted&&Number.isFinite(remaining)&&remaining<(writingMode==='single_writer'?3:4);
  return {blocked,remaining:Number.isFinite(remaining)?remaining:null,requiresActivation:false,message:blocked?`本次授權剩餘 ${remaining} 次生成，不足完整新輪；可查看保存內容，追加真模型需新授權。`:''};
}
export function interactiveEnableRequest(mode, interactive, acknowledged) {
  if(mode!=='interactive'||interactive?.enabled===true||acknowledged!==true||typeof interactive?.activationToken!=='string'||!interactive.activationToken||interactive?.acknowledgement!=='enable-existing-dsh-provider-for-this-launch')return null;
  return {mode:'interactive',activationToken:interactive.activationToken,acknowledgement:'enable-existing-dsh-provider-for-this-launch'};
}
export function progressText(value) {
  const events = Array.isArray(value) ? value : value?.events ?? value?.progress ?? [];
  const event = Array.isArray(events) ? events.at(-1) : events;
  if (!event?.stage) return value?.pending ? '本輪處理中；等待階段紀錄。' : '';
  return `${stageNames[event.stage] ?? event.stage} · ${statusNames[event.status] ?? event.status}${event.sequence ? ` · #${event.sequence}` : ''}`;
}
export function titleOf(snapshot) { return snapshot?.card?.data?.name ?? snapshot?.card?.name ?? snapshot?.cardId ?? '未命名故事'; }
export function openingOf(run) {
  if(typeof run?.openingDisplay==='string')return run.openingDisplay;
  const opening = run?.snapshot?.opening;
  if (opening?.text) return opening.text;
  return run?.snapshot?.card?.data?.first_mes ?? run?.snapshot?.card?.first_mes ?? '';
}
export function requestForInput(draft, input, makeId = () => crypto.randomUUID()) {
  return draft?.input === input && draft.requestId ? draft.requestId : makeId();
}
export function shouldSubmit(event, composing) { return !!(!composing && !event.isComposing && event.keyCode !== 229 && event.key === 'Enter' && (event.ctrlKey || event.metaKey)); }
// An epoch changes before selection starts. A response belonging to an earlier
// run can complete safely, but cannot change the newly selected run's view.
export class SelectionEpoch {
  constructor(){this.value=0;this.runId=null;}
  select(runId){this.runId=runId;return {value:++this.value,runId};}
  current(token){return !!token && token.value===this.value && token.runId===this.runId;}
  capture(){return {value:this.value,runId:this.runId};}
}
export class PrivateDiagnosticsSession {
  constructor(viewerId,now=()=>Date.now()){this.viewerId=viewerId;this.now=now;this.serial=0;this.runId=null;this.grant=null;}
  begin(runId){this.serial++;this.runId=runId;this.grant=null;return {serial:this.serial,runId,viewerId:this.viewerId};}
  current(token){return token?.serial===this.serial&&token.runId===this.runId;}
  adopt(token,result){
    const expiresAt=typeof result?.expiresAt==='number'?result.expiresAt:Date.parse(result?.expiresAt);
    if(!this.current(token)||result?.runId!==token.runId||typeof result.grantToken!=='string'||!Number.isFinite(expiresAt)||expiresAt<=this.now())return false;
    this.grant={runId:token.runId,viewerId:this.viewerId,grantToken:result.grantToken,expiresAt};return true;
  }
  request(){return this.grant&&this.grant.expiresAt>this.now()?{runId:this.grant.runId,viewerId:this.viewerId,grantToken:this.grant.grantToken}:null;}
  clear(){const prior=this.grant?{runId:this.grant.runId,viewerId:this.viewerId,grantToken:this.grant.grantToken}:null;this.serial++;this.runId=null;this.grant=null;return prior;}
}
// requestId identifies a retryable input. operationId identifies one specific
// submission of that input, so an older cancel cannot own a later retry.
export class OperationOwnership {
  constructor(){this.serial=0;this.active=null;}
  start(runId,requestId,makeId=()=>crypto.randomUUID()) {
    this.serial++;this.active=Object.freeze({runId,requestId,operationId:makeId()});return this.active;
  }
  reset(){this.serial++;this.active=null;}
  capture(){return {serial:this.serial};}
  current(token){return token?.serial===this.serial;}
  target(runId){return this.active?.runId===runId&&this.active.operationId?{runId,operationId:this.active.operationId}:null;}
  observe(progress,token){
    if(!this.current(token))return false;
    const next=progress?.pending&&progress.operationId?{runId:progress.runId,requestId:progress.requestId,operationId:progress.operationId}:null;
    if(next?.runId!==this.active?.runId||next?.operationId!==this.active?.operationId){this.serial++;this.active=next?Object.freeze(next):null;}
    return true;
  }
}
// A completed Host operation is authoritative even if its original RPC reply
// never arrives. Exact identity prevents stale progress from releasing a newer
// submission; unknown outcomes and history operations retain their own recovery.
export function settledTurnProgress(operation,progress){
  return operation?.kind==='turn' && progress?.pending===false &&
    progress.runId===operation.runId && progress.requestId===operation.requestId &&
    progress.operationId===operation.operationId &&
    ['committed','failed','cancelled','retired'].includes(progress.status);
}
export const worldLabels = Object.freeze({ locations:'地點', tasks:'任務', resources:'資源', equipment:'設備', time:'時間', effects:'效果', facts:'世界資訊' });
export function valueText(value, depth=0) {
  if (value===null) return '—';
  if (typeof value!=='object') return String(value);
  if (depth>3) return '（展開 Inspector 查看）';
  if (Array.isArray(value)) return value.map(v=>valueText(v,depth+1)).join('、') || '無';
  return Object.entries(value).map(([k,v])=>`${k}：${valueText(v,depth+1)}`).join('；') || '無';
}
export function committedMessages(run) {
  const messages=[];const opening=openingOf(run);
  if(opening)messages.push({kind:'opening',label:'固定開場',body:opening});
  for(const turn of run?.turns??[]) {
    messages.push({kind:'player',label:`你 · 第 ${turn.turn} 回合`,body:turn.input,commitId:turn.commitId});
    messages.push({...(turn.dialoguePresentation?{dialoguePresentation:turn.dialoguePresentation,bodyHash:turn.bodyHash}:{}),kind:'story',label:`故事 · 第 ${turn.turn} 回合`,body:turn.body,commitId:turn.commitId});
  }
  return messages;
}

// Host supplies only public blueprint projection. No fallback reads private snapshot extensions.
export function blueprintStateRows(worldView,lastTurn){
  if(!worldView||!Array.isArray(worldView.declared)||!Array.isArray(worldView.otherState))return null;
  const label=row=>`${row.characterId?row.characterId+' · ':''}${row.displayName??row.key}`;
  const prior=row=>row.scope==='character'?lastTurn?.stateBefore?.characters?.[row.characterId]?.public?.[row.category]:lastTurn?.stateBefore?.world?.[row.category];
  const change=row=>{
    if(!lastTurn?.stateBefore)return '';
    const old=prior(row),has=old&&Object.hasOwn(old,row.key);
    if(!has)return row.known===false?'':'（本輪新增）';
    if(row.known===false)return '（本輪移除）';
    return JSON.stringify(old[row.key])===JSON.stringify(row.value)?'':`（原為 ${valueText(old[row.key])}${row.unit?' '+row.unit:''}）`;
  };
  return {declared:worldView.declared.filter(row=>row.visibility===undefined||row.visibility==='public').map(row=>({label:label(row),text:(row.known?`${valueText(row.value)}${row.unit?' '+row.unit:''}`:'未知')+change(row),category:row.category})),other:worldView.otherState.filter(row=>row.visibility===undefined||row.visibility==='public').map(row=>({label:label(row),text:valueText(row.value)+change(row),category:row.category}))};
}

// A retired receipt records an old operation, never an active story commit.
export function activeDraftReceipt(run, requestId) {
  const receipt=run?.receipts?.[requestId]??(run?.requestReceipt?.requestId===requestId?run.requestReceipt:null);
  if(!receipt||receipt.status==='retired')return false;
  if(receipt.status!=='committed'&&receipt.result?.status!=='committed')return false;
  return (run.turns??[]).some(turn=>turn.commitId===receipt.commitId)||run.lastTurn?.commitId===receipt.commitId||receipt.active===true;
}
export function inspectorStageRoute(value){const stages=value?.attempts?.at(-1)?.stages??[];return stages.length?'實際流程：'+stages.map(s=>(stageNames[s.stage]??'未識別階段')+(s.modelCall===false?'（本機）':'')+'·'+(statusNames[s.status]??'未知')).join(' → '):'尚無生成階段紀錄。';}
