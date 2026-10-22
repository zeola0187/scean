import {mountWritingMode} from './writing-mode-ui.mjs';
import {mountProseStyle} from './prose-style-ui.mjs';
import {mountPlayerIdentity} from './player-identity-ui.mjs';
import {mountCardFrontend} from './card-frontend.mjs';
import {captureReadingAnchor,restoreReadingAnchor} from './reading-layout.mjs';
import { SelectionEpoch, OperationOwnership, PrivateDiagnosticsSession, generationAvailability, interactiveEnableRequest, progressText, inspectorStageRoute, titleOf, requestForInput, shouldSubmit, committedMessages, worldLabels, valueText, blueprintStateRows, activeDraftReceipt } from './view-model.mjs';
import { mountStudio } from './studio.mjs';
import { mountPlayerShell } from './player-shell.mjs';
import {createNotificationClient,mountNotificationControls,showNotificationToast} from './notifications.mjs';
import {mountChapterSettings} from './chapter-settings-ui.mjs';
import {chapterAutomationSummary,chapterOperationSummary} from './summary-settings-ui.mjs';
import {mountOpeningSelection} from './opening-selection-ui.mjs';
import {HistorySync} from './history-sync.mjs';
import {mountPlayerIdeas} from './player-ideas-ui.mjs';
import {mountPlayerReaders} from './player-readers-ui.mjs';
import {mountPresentationPanel} from './presentation-panel-ui.mjs';
const shell=mountPlayerShell();
const cardFrontend=mountCardFrontend({preserveReading:()=>{
  const reading=shell.reading,anchor=captureReadingAnchor(reading),top=reading.scrollTop;
  return()=>{if(anchor)restoreReadingAnchor(reading,anchor);else reading.scrollTop=top;};
}});
const native=globalThis.__SCEAN_NATIVE__;
let initialized=false,nativeSelection=null,nativeContextSerial=0,nativeNotificationTarget=null;
let banListDirty=false,banListBusy=false;
native?.onSelect(selection=>{nativeSelection=selection?.runId??null;nativeNotificationTarget=selection?.notificationTarget??null;if(initialized)void syncNativeContext(nativeSelection).then(()=>openNotificationTarget(nativeNotificationTarget)).catch(error=>setError('turn-error',error));});

const $ = id => document.getElementById(id);
const view = new SelectionEpoch();
const operations = new OperationOwnership();
// Never replace secure browser randomness with an insecure LAN fallback.
const secureClient=(native||globalThis.isSecureContext!==false)&&typeof globalThis.crypto?.randomUUID==='function';
function pageViewerIdentity(){
  if(!secureClient)return null;
  let saved,type;try{type=globalThis.performance?.getEntriesByType('navigation')?.[0]?.type;if(type==='reload'||type==='back_forward')saved=sessionStorage.getItem('scean-draft-viewer');}catch{}
  const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved??'')?saved:crypto.randomUUID();
  try{sessionStorage.setItem('scean-draft-viewer',id);}catch{}
  return id;
}
let viewerId=pageViewerIdentity();
function adoptNativeViewer(value){if(native&&typeof value==='string'&&/^[\w-]{1,160}$/.test(value)){viewerId=value;privateDiagnostics.viewerId=value;}}
const privateDiagnostics = new PrivateDiagnosticsSession(viewerId);
const outstandingOperations=new Map();
if(secureClient)try{for(const value of JSON.parse(sessionStorage.getItem('scean-outstanding-operations')??'[]'))if(value&&typeof value.runId==='string'&&typeof value.operationId==='string'&&typeof value.kind==='string')outstandingOperations.set(value.runId,value);}catch{}
let nativeScopeKey=null,runReadSerial=0,navigationSerial=0,notificationTargetSerial=0,canonicalRefreshNeeded=false,selectionRead=null;
let diagnosticsBusy=false,diagnosticsTimer=null;
let historyBusy=false,backupBusy=false,historyTarget=null,regenInput=null;
let pageSerial=0,pageController=null,pageBusy=false,historyPageState=null,loadedTurns=[];
const historySync=new HistorySync();let submissionReading=null,userScrollEpoch=0;
for(const event of ['wheel','touchmove','pointerdown'])shell.reading.addEventListener(event,()=>{userScrollEpoch++;},{passive:true});
shell.reading.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))userScrollEpoch++;});
let narrativeSerial=0,narrativeController=null,narrativeBusy=false,narrativeData=null,recallSerial=0;
let inspectorSerial=0,activeNarrativeOperation=null;
let chapterData=null,chapterSerial=0,chapterDetailSerial=0,chapterSettingsDirty=false,selectedChapterId=null;
const state = { token:null, mode:null, generationBlocked:false,writingMode:'single_writer', interactive:null, enableBusy:false, catalog:[], run:null, draft:null, pending:false, submitting:false, localTurn:null, lastOperation:null, failure:null, composing:false, pollBusy:false, operationUnknown:false, disconnected:false, nextPollAt:0, pollFailures:0, draftTimer:null, draftQueue:Promise.resolve(), chatKey:null };
const globalChapterSettings=mountChapterSettings({secureContext:secureClient,request:(action,payload,signal)=>api(action,payload,signal),onSaved:()=>{if(view.runId)void refreshChapters();}});
const writingMode=mountWritingMode({onMode:(mode,runId)=>{if(state.run?.runId===runId){state.writingMode=mode;void refreshModels().catch(()=>{});}},request:(action,payload)=>api(action,payload),secureContext:secureClient});
const proseStyle=mountProseStyle({request:(action,payload)=>api(action,payload),secureContext:secureClient});
const openingSelection=mountOpeningSelection({enabled:!!native,request:(action,payload)=>api(action,payload),onCreated:async result=>{await refreshRuns();await selectRun(result.runId);shell.committed();},onOffer:()=>shell.show('library'),openStudio:()=>native.openStudio()});

const playerIdentity=mountPlayerIdentity({request:(action,payload)=>api(action,payload),onBound:async()=>{await reconcile();await refreshRuns();}});
function preservePlayerReading(){const anchor=captureReadingAnchor(shell.reading,{allowEnd:false}),top=shell.reading.scrollTop;return()=>{if(anchor)restoreReadingAnchor(shell.reading,anchor);else shell.reading.scrollTop=top;shell.adoptReading?.();};}
const playerContext=()=>state.run?{...state.run,epoch:nativeContextSerial+':'+view.capture().value,selectionStamp:nativeContextSerial+':'+view.capture().value,sessionId:nativeScopeKey,cardId:state.run.snapshot?.cardId,disabled:state.pending||state.submitting||historyBusy||backupBusy||state.generationBlocked}:null;
const playerIdeas=mountPlayerIdeas({document,request:(action,payload,signal)=>api(action,payload,signal),getContext:playerContext,preserveReading:preservePlayerReading});
const playerReaders=mountPlayerReaders({document,request:(action,payload,signal)=>api(action,payload,signal),getContext:playerContext,preserveReading:preservePlayerReading,onNavigate:target=>{if(target.runId===view.runId){shell.show('story');return loadHistory({anchorCommitId:target.commitId});}}});
const presentationPanel=mountPresentationPanel({document,request:(action,payload,signal)=>api(action,payload,signal),getContext:playerContext,preserveReading:preservePlayerReading});
const newBodyOpen=node('button','查看新正文','quiet');newBodyOpen.type='button';newBodyOpen.id='new-body-open';newBodyOpen.hidden=true;document.querySelector('.composer-actions').append(newBodyOpen);
newBodyOpen.addEventListener('click',()=>{if(storyHead())void loadHistory({anchorCommitId:storyHead()});});
function node(tag, text, className) { const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e; }
function setError(id,error) { const el=$(id);el.textContent=error ? `${error.message ?? '操作未完成。'}${error.code ? `（${error.category ? error.category+' / ':''}${error.code}）` : ''}` : '';el.hidden=!error; }
function connection(ok){if(!ok)cardFrontend.heartbeat(false);state.disconnected=!ok;$('connection').textContent=ok?(native?'舞台已連線':'本機隔離環境已連線'):'連線中斷 · 可重新查詢';}
function diagnosticsControls(){
  $('diagnostics-grant').disabled=!state.run||diagnosticsBusy||!!privateDiagnostics.grant||!$('diagnostics-consent').checked;
  $('diagnostics-consent').disabled=diagnosticsBusy||!!privateDiagnostics.grant;
  $('diagnostics-revoke').hidden=!privateDiagnostics.grant&&!diagnosticsBusy;
}
async function clearPrivateDiagnostics(message='詳細內容已清除；未授權讀取私密診斷。'){
  const prior=privateDiagnostics.clear(),clearedSerial=privateDiagnostics.serial;clearTimeout(diagnosticsTimer);diagnosticsTimer=null;diagnosticsBusy=false;
  $('private-inspection').textContent='';$('private-inspection').hidden=true;$('diagnostics-consent').checked=false;
  $('diagnostics-status').textContent=message;setError('diagnostics-error',null);diagnosticsControls();
  if(prior){try{await api('diagnosticsRevoke',prior);}catch{if(privateDiagnostics.serial===clearedSerial)$('diagnostics-status').textContent='本機詳細內容已清除；伺服器撤銷尚未確認，授權將在期限到達後失效。';}}
}
function updateModels(models){
  const scripted=/script|mock|offline/i.test(state.mode??'');const availability=generationAvailability(state.mode,models,state.writingMode);
  if(state.interactive?.activationToken!==models.interactive?.activationToken||models.interactive?.enabled===true)$('interactive-consent').checked=false;
  state.interactive=state.mode==='interactive'?models.interactive??null:null;
  state.generationBlocked=availability.blocked;
  $('mode-banner').textContent=availability.message||(scripted?'離線合成模型模式 · 用於操作與故障測試，不代表真實模型或敘事品質。':state.mode==='interactive'?'使用者互動模式 · 已啟用既有 DSH 連線；每次送出會使用供應商額度，費用未知。':'隔離試玩 · 使用既有 DSH 模型設定 · 正式安裝與私人 Run 保持獨立');
  $('mode-banner').classList.toggle('scripted',scripted||availability.blocked);
  if(native)$('mode-banner').textContent='目前對話的卡片舞臺 · 只列出同一卡片各保存版本的故事';
  const publicDescription={mode:models.mode??state.mode,source:models.source??models.label??'DSH',...(models.requested?{requested:models.requested}:{}),...(models.effective?{effective:models.effective}:{}),...(models.selectionSource?{selectionSource:models.selectionSource}:{}),...(availability.remaining!==null?{remaining:availability.remaining}:{})};
  $('model-source').textContent=`模型來源：${valueText(publicDescription)}。${scripted?'目前使用離線合成模型。':'隔離環境以啟動時 DSH 選擇為準，改模型請重啟。'}實際路由與用量保存在本輪診斷。`;
  controls();
}
async function refreshModels(){updateModels(await api('models'));}
async function api(action,payload={},signal) {
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Host response timed out','TimeoutError')),action==='playerIdeas'?180000:12000);
  try{return await requestApi(action,payload,controller.signal);}
  catch(error){
    if(controller.signal.aborted&&!signal?.aborted){connection(false);throw Object.assign(new Error('Host 回應逾時；原操作可能仍在背景執行，將查回原操作。'),{code:'CONNECTION_UNKNOWN',category:'transport'});}
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function requestApi(action,payload={},signal) {
  if(native){
    const contextSerial=nativeContextSerial;
    try{return await native.request(action,payload,signal);}
    catch(error){
      if(contextSerial===nativeContextSerial&&['CARD_CONTEXT_CHANGED','CARD_CONTEXT_REQUIRED'].includes(error.code)&&action!=='native.context')void syncNativeContext(null).catch(e=>setError('turn-error',e));
      throw error;
    }
  }
  let response,data;
  try {
    response=await fetch('/api',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Scean-Token':state.token},body:JSON.stringify({action,...payload}),signal});
    data=await response.json();
  } catch(error) {
    if(error.name==='AbortError')throw error;
    connection(false);throw Object.assign(new Error('無法確認伺服器結果。輸入仍保留；請查詢儲存結果後再重試。'),{code:'CONNECTION_UNKNOWN',category:'transport'});
  }
  connection(true);
  if(!response.ok||!data.ok)throw Object.assign(new Error(data.error?.message ?? '操作未完成。'),data.lastFailure??data.error??{code:`HTTP_${response.status}`});
  return data.value;
}
const notifications=native?null:createNotificationClient({call:(action,payload)=>api(action,payload),onTarget:target=>openNotificationTarget(target),showToast:showNotificationToast});
const notificationControls=mountNotificationControls({request:async(action,payload={})=>{
  if(native){if(action==='capabilities')return native.request('native.notificationCapabilities');if(action==='enable')return native.request('native.notificationEnable');return native.request('native.notificationConfigure',action==='mute'?{runId:view.runId}:payload);}
  if(action==='capabilities')return notifications.capabilities();if(action==='enable')return notifications.enable();return notifications.configure(action==='mute'?{runId:view.runId}:payload);
}});
native?.onNotificationSettings?.(value=>notificationControls.render(value));
async function openNotificationTarget(target){
  if(!target||typeof target.eventId!=='string')return;
  const contextSerial=nativeContextSerial,serial=++notificationTargetSerial,priorSelection=view.capture();
  let exact;try{exact=native?await native.request('native.notificationTarget',{eventId:target.eventId}):await notifications.target(target.eventId);}
  catch(error){if(serial!==notificationTargetSerial||contextSerial!==nativeContextSerial||!view.current(priorSelection))return;throw error;}
  if(serial!==notificationTargetSerial||contextSerial!==nativeContextSerial||!view.current(priorSelection))return;
  if(exact.runId!==target.runId||exact.commitId!==target.commitId)throw Object.assign(Error('此回覆已撤回或替換。'),{code:'NOTIFICATION_TARGET_UNAVAILABLE'});
  const selected=await selectRun(exact.runId);if(!selected||!view.current(selected)||contextSerial!==nativeContextSerial||serial!==notificationTargetSerial)return;
  await loadHistory({anchorCommitId:exact.commitId});if(!view.current(selected)||contextSerial!==nativeContextSerial||serial!==notificationTargetSerial)return;shell.committed();nativeNotificationTarget=null;
}
window.addEventListener('pagehide',event=>{if(!event.persisted)notifications?.dispose();});
function option(select,value,label){const e=node('option',label);e.value=String(value);select.append(e);}
function card(){return state.catalog.find(c=>String(c.id)===$('card').value);}
function revision(){return card()?.revisions.find(r=>String(r.id??r.revision)===$('revision').value);}
function opening(){return revision()?.openings?.find(o=>String(o.id)===$('opening').value);}
function renderCards(){ $('card').replaceChildren();for(const c of state.catalog)option($('card'),c.id,c.title??c.id);renderRevisions(); }
function renderRevisions(){ $('revision').replaceChildren();for(const r of card()?.revisions??[])option($('revision'),r.id??r.revision,r.label??r.title??`版本 ${r.revision}`);renderOpenings(); }
function renderOpenings(){ $('opening').replaceChildren();for(const o of revision()?.openings??[])option($('opening'),o.id,o.title??o.label??o.id);renderPreview(); }
function renderPreview(){ $('opening-preview').textContent=opening()?.text??'';$('create').disabled=!opening();shell.preview(card(),revision(),opening()); }

async function refreshRuns(){
  const contextSerial=nativeContextSerial,rows=await api('list');if(contextSerial!==nativeContextSerial)return [];$('runs').replaceChildren();
  if(!rows.length){$('runs').append(node('p',native?'目前卡片尚無相關 Run；請回 Studio 交接已保存版本，開啟新局。':'尚無紀錄；先選卡開新局。','hint'));return rows;}
  for(const row of [...rows].reverse()) {
    const button=node('button',state.catalog.find(c=>c.id===row.cardId)?.title??row.title??row.cardId??row.runId);
    button.type='button';button.dataset.runId=row.runId;button.setAttribute('aria-current',String(view.runId===row.runId));
    if(row.playerName)button.append(node('small','主角：'+row.playerName));
    button.append(node('small',`${row.revision??'—'} · ${row.runId}`));
    button.addEventListener('click',()=>selectRun(row.runId).catch(e=>setError('turn-error',e)));$('runs').append(button);
  }
  return rows;
}
function clearNativeView(){
  playerIdeas.reset();playerReaders.reset();presentationPanel.reset();showNotificationToast({clear:true});
  writingMode.select(null);proseStyle.select(null);cardFrontend.clear();
  openingSelection.reset();
  openingSelection.setRun(null);
  view.select(null);operations.reset();resetLongform(false);clearTimeout(state.draftTimer);
  void clearPrivateDiagnostics();
  Object.assign(state,{run:null,draft:null,pending:false,submitting:false,failure:null,localTurn:null,lastOperation:null,operationUnknown:false,chatKey:null});
  loadedTurns=[];historyPageState=null;banListDirty=false;regenInput=null;historyTarget=null;
  historyBusy=false;backupBusy=false;
  $('history-dialog').close();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  for(const id of ['input','banlist-input'])$(id).value='';
  for(const id of ['chat','runs','state-summary'])$(id).replaceChildren();
  $('run-title').textContent='目前卡片的故事';$('run-version').textContent='';$('progress').textContent='';$('draft-status').textContent='';
  $('inspection').textContent='尚未展開讀取。';$('export-consent').checked=false;$('import-consent').checked=false;$('run-import-file').value='';
  setError('turn-error',null);controls();shell.show('library');
}
async function syncNativeContext(runId){
  const serial=++nativeContextSerial;clearNativeView();
  let context;try{context=await api('native.context');}catch(error){if(serial!==nativeContextSerial)return;throw error;}if(serial!==nativeContextSerial)return;
  const scope=context.cardScope;nativeScopeKey=JSON.stringify(scope??null);adoptNativeViewer(context.viewerId);
  $('card-title').textContent=scope?.title??'請先選取卡片';
  $('card-description').textContent=scope?'這張卡的已保存故事列於下方。欲以新版本開局，請回 Studio 交接。':'請在目前對話的 Card Studio 選取角色卡，再開啟舞臺。';
  $('data-source').textContent=scope?`目前卡片：${scope.cardId}（所有已保存版本的 Run）。`:'此對話尚無可確認的卡片；請在 Card Studio 選卡。';
  let rows;try{rows=await refreshRuns();}catch(error){if(serial!==nativeContextSerial)return;throw error;}if(serial!==nativeContextSerial)return;
  if(runId&&!rows.some(row=>row.runId===runId)){setError('turn-error',Object.assign(new Error('指定的 Run 不屬於目前卡片，未開啟。'),{code:'CARD_SCOPE_MISMATCH'}));return;}
  const selected=runId??rows[0]?.runId;
  if(selected){try{await selectRun(selected);}catch(error){if(serial!==nativeContextSerial)return;throw error;}}
  else $('chat').append(node('p',scope?'此卡尚無故事。請回 Studio 交接已保存版本，建立新局。':'請先在目前對話的 Studio 選取卡片。','empty'));
  if(scope&&await openingSelection.refresh()&&serial===nativeContextSerial)shell.show('library');
}
function controls(){
  const hasRun=!!state.run, busy=state.pending||state.submitting||historyBusy||backupBusy||playerIdentity.isBusy();
  playerIdentity.update(state.run,state.pending||state.submitting||historyBusy||backupBusy);
  $('input').disabled=!hasRun||busy;
  $('send').disabled=!hasRun||busy||state.generationBlocked||!$('input').value.trim();
  $('cancel').hidden=!state.pending;$('cancel').disabled=!operations.target(view.runId);
  $('retry').hidden=!state.failure||busy||!state.draft?.input;
  $('retry').disabled=state.generationBlocked;
  $('recheck').hidden=!state.failure||(busy&&!state.operationUnknown);$('recheck').disabled=state.pollBusy;
  $('provisional').hidden=!state.pending||!!state.localTurn&&!['turn','regenerate'].includes(state.localTurn.kind);
  $('pending-input').textContent=regenInput??state.draft?.input??'';
  $('save-status').textContent=!hasRun?'尚未開局':busy?'本輪尚未提交':historySync.dirty?'本輪已保存，正在讀取正文':historySync.newAvailable?'已保存 · 有新正文':`已保存 · v${state.run.version}`;
  newBodyOpen.hidden=!hasRun||!storyHead();newBodyOpen.disabled=pageBusy;newBodyOpen.textContent=historySync.dirty?'已保存，讀取正文中':historySync.newAvailable?'有新正文 · 查看':'查看本輪正文';
  playerIdeas.update(playerContext());presentationPanel.update(playerContext());
  $('input').setAttribute('aria-busy',String(busy));
  $('interactive-activation').hidden=state.mode!=='interactive'||state.interactive?.enabled===true;
  $('interactive-enable').disabled=state.enableBusy||!interactiveEnableRequest(state.mode,state.interactive,$('interactive-consent').checked);
  $('interactive-consent').disabled=state.enableBusy;
  $('banlist-save').disabled=!hasRun||busy||banListBusy;
  $('banlist-input').disabled=!hasRun||busy||banListBusy;
  diagnosticsControls();
  historyControls();
  longformControls();
}
function canonicalStamp(run=state.run){return run?{runId:run.runId,version:run.version,head:storyHead(run)}:null;}
function sameCanonical(a,b){return !!a&&!!b&&a.runId===b.runId&&a.version===b.version&&a.head===b.head;}
function canonicalPairMatches(value,stamp){return !!value&&!!stamp&&value.version===stamp.version&&value.head===stamp.head;}
function scheduleCanonicalRefresh(){canonicalRefreshNeeded=true;state.nextPollAt=0;}
function relatedReadCurrent(selected,baseline,value){
  if(!view.current(selected)||!sameCanonical(baseline,canonicalStamp()))return false;
  if(value&&((value.runId!==undefined&&value.runId!==selected.runId)||(value.version!==undefined&&value.version!==baseline.version)||(Object.hasOwn(value,'head')&&value.head!==baseline.head))){scheduleCanonicalRefresh();return false;}
  return true;
}
function acceptsCanonicalSnapshot(run,progress,receipt,selected){
  if(run?.runId!==selected.runId||!Number.isSafeInteger(run.version)||run.version<0)return false;
  const stamp=canonicalStamp(run),current=canonicalStamp();
  if(!(stamp.head===null||typeof stamp.head==='string'))return false;
  if(current?.runId===stamp.runId&&(stamp.version<current.version||stamp.version===current.version&&stamp.head!==current.head))return false;
  if(receipt?.runId!==selected.runId||!canonicalPairMatches(receipt.canonical,stamp))return false;
  if(progress?.runId!==selected.runId||progress.canonical&&!canonicalPairMatches(progress.canonical,stamp))return false;
  return true;
}
async function readCanonicalSnapshot(selected,owner,serial,{includeDraft=false}={}){
  for(let attempt=0;attempt<3;attempt++){
    let values;try{values=await Promise.all([
      api('runView',{runId:selected.runId,...(state.draft?.requestId?{requestId:state.draft.requestId}:{})}),
      api('progress',{runId:selected.runId}),api('operationStatus',operationLookup(selected.runId)),
      includeDraft?api('draftGet',{runId:selected.runId,viewerId}):undefined
    ]);}catch(error){if(!view.current(selected)||!operations.current(owner)||serial!==runReadSerial)return null;throw error;}
    const [run,progress,receipt,draft]=values;
    if(!view.current(selected)||!operations.current(owner)||serial!==runReadSerial)return null;
    if(acceptsCanonicalSnapshot(run,progress,receipt,selected)){canonicalRefreshNeeded=false;return {run,progress,receipt,draft};}
    // Only repeat read-only queries. Never observe a mismatched receipt, clear
    // a draft, or replay a generation while a publication crosses these reads.
    scheduleCanonicalRefresh();
  }
  setError('turn-error',Object.assign(new Error('Host 存檔與操作回條正同步中；保留目前畫面，稍後重新查回。'),{code:'CANONICAL_READ_INCONSISTENT'}));
  return null;
}
function renderRun(run){
  openingSelection.setRun(run);
  state.run=run;historySync.want(run);cardFrontend.update(run);proseStyle.select(run.runId);writingMode.select(run.runId);
  playerReaders.update(playerContext());presentationPanel.update(playerContext());
  if(!banListDirty)$('banlist-input').value=(run.banList??[]).map(x=>typeof x==='string'?x:x.text??x.phrase??'').join('\n');
  $('run-title').textContent=titleOf(run.snapshot);
  $('run-version').textContent=`固定版本 ${run.snapshot?.revision??'—'} · Run ${run.runId} · 摘要 ${run.snapshot?.hash?.slice(0,12)??'未記錄'} · ${run.turnCount??run.turns?.length??0} 回合`;
  renderWorld(run.state?.world??{},run.worldView,run.lastTurn??run.turns?.at(-1));
  controls();
}
function renderChat(){
  const projected={...state.run,turns:loadedTurns};
  if(historyPageState?.hasMore)projected.snapshot={...state.run?.snapshot,opening:null,card:{}};
  const wanted=committedMessages(projected),existing=new Map([...$('chat').querySelectorAll('article[data-message-key]')].map(el=>[el.dataset.messageKey,el]));
  for(const child of [...$('chat').children])if(!child.dataset.messageKey)child.remove();
  const keep=new Set();let previous=null;
  for(const item of wanted){
    const key=`${state.run.runId}:${item.commitId??'opening'}:${item.kind}`;keep.add(key);
    let article=existing.get(key);
    if(!article){article=node('article',undefined,`message ${item.kind}`);article.dataset.messageKey=key;
      if(item.commitId)article.dataset.commitId=item.commitId;
      const header=node('header',item.label);if(item.commitId)header.append(node('small','已提交'));
      article.append(header,node('div',item.body,'body'));
    }
    // Keep existing nodes in place: summary/status changes never reconstruct chat.
    const next=previous?previous.nextElementSibling:$('chat').firstElementChild;
    if(next!==article)$('chat').insertBefore(article,next);
    previous=article;
  }
  for(const [key,el] of existing)if(!keep.has(key))el.remove();
  if(!wanted.length)$('chat').append(node('p','這一局已準備好，輸入第一個行動吧。','empty'));
  cardFrontend.history({runId:state.run?.runId,snapshotHash:state.run?.snapshot.hash,head:loadedTurns.at(-1)?.commitId??null});
}
function resetLongform(){
  historySync.reset();submissionReading=null;
  // Navigation detaches this view; only an explicit cancel stops Host work.
  activeNarrativeOperation=null;
  chapterSerial++;chapterDetailSerial++;chapterData=null;selectedChapterId=null;chapterSettingsDirty=false;
  $('chapter-summary-list').replaceChildren();$('chapter-summary-detail').replaceChildren();$('chapter-summary-detail').hidden=true;
  $('chapter-config-status').textContent='尚未讀取分章設定。';$('chapter-operation-status').textContent='';setError('chapter-error',null);
  pageSerial++;pageController?.abort();pageController=null;pageBusy=false;historyPageState=null;loadedTurns=[];
  narrativeSerial++;narrativeController?.abort();narrativeController=null;narrativeBusy=false;narrativeData=null;recallSerial++;inspectorSerial++;
  $('summary-content').replaceChildren();$('chapters').replaceChildren();$('history-hits').replaceChildren();$('history-read').textContent='';$('history-read').hidden=true;
  $('summary-status').textContent='尚未讀取摘要。';$('history-search-status').textContent='';$('history-page-status').textContent='正在讀取近期原文…';
  $('inspection').textContent='尚未展開讀取。';setError('history-page-error',null);setError('summary-error',null);
}
function longformControls(){
  const selected=!!state.run,busy=state.pending||state.submitting||historyBusy||backupBusy;
  $('history-earlier').disabled=!selected||pageBusy||!historyPageState?.hasMore;
  $('history-latest').disabled=!selected||pageBusy;
  $('summary-start').disabled=!selected||busy||narrativeBusy||narrativeData?.enabled!==true;
  $('summary-refresh').disabled=!selected||narrativeBusy;
  $('summary-cancel').hidden=!activeNarrativeOperation||activeNarrativeOperation.kind!=='summaryStart';
  $('chapter-close').disabled=!selected||busy||narrativeBusy||!(state.run.turnCount??state.run.turns?.length);
  $('history-search').disabled=!selected;
  chapterControls();
}
function captureStoryReading(){
  const reading=shell.reading,box=reading.getBoundingClientRect(),anchor=captureReadingAnchor(reading,{allowEnd:false}),top=reading.scrollTop;
  const visible=[...$('chat').querySelectorAll('.story[data-commit-id]')].filter(node=>{const bounds=node.getBoundingClientRect();return bounds.bottom>box.top&&bounds.top<box.bottom;});
  return {follow:shell.atEnd(),anchorCommitId:visible.at(-1)?.dataset.commitId??loadedTurns[0]?.commitId,
    restore(){if(anchor)restoreReadingAnchor(reading,anchor);else reading.scrollTop=top;}};
}
async function loadHistory({earlier=false,anchorCommitId,priorHead,readingBefore,latest=false,ownCommitId}={}){
  if(!view.runId||earlier&&!historyPageState?.beforeCursor)return;
  const selected=view.capture(),baseline=canonicalStamp(),serial=++pageSerial;pageController?.abort();pageController=new AbortController();pageBusy=true;longformControls();
  $('history-page-status').textContent='正在讀取原文頁…';setError('history-page-error',null);
  const oldCursor=historyPageState?.beforeCursor;
  const scrollEpoch=userScrollEpoch;
  const scrollBefore={top:shell.reading.scrollTop,height:shell.reading.scrollHeight,follow:readingBefore?.follow??shell.atEnd()};
  const preserve=!!readingBefore&&!latest&&!anchorCommitId&&!ownCommitId;
  const preserveOld=preserve&&(!scrollBefore.follow||historySync.historical);
  const readingAnchor=preserveOld?readingBefore.anchorCommitId:undefined;
  const historical=earlier||!!anchorCommitId&&anchorCommitId!==baseline.head||!!readingAnchor;
  try{
    let page,retiredAnchor=false;
    try{page=await api('historyPage',{runId:selected.runId,limit:10,...(earlier?{cursor:oldCursor}:{}),...((anchorCommitId??readingAnchor)?{anchorCommitId:anchorCommitId??readingAnchor}:{})},pageController.signal);}
    catch(error){
      if(!readingAnchor||!['HISTORY_COMMIT_RETIRED','HISTORY_COMMIT_NOT_FOUND'].includes(error.code))throw error;
      if(!view.current(selected)||serial!==pageSerial||!relatedReadCurrent(selected,baseline))return;
      retiredAnchor=true;page=await api('historyPage',{runId:selected.runId,limit:10},pageController.signal);
    }
    if(!view.current(selected)||serial!==pageSerial)return;
    if(!relatedReadCurrent(selected,baseline,page)||!historySync.loaded(page,{historical:historical&&!retiredAnchor})){
      historySync.failed();$('history-page-status').textContent='本輪已保存，正在讀取正文';return;
    }
    const readerMoved=scrollEpoch!==userScrollEpoch,readingAfter=readerMoved?captureStoryReading():null;
    const mergeForReading=readerMoved&&page.turns.some(t=>t.commitId===loadedTurns.at(-1)?.commitId);
    const turns=new Map((earlier||mergeForReading?loadedTurns:[]).map(turn=>[turn.commitId,turn]));
    for(const turn of page.turns)turns.set(turn.commitId,turn);
    loadedTurns=[...turns.values()].sort((a,b)=>a.turn-b.turn);
    historyPageState=page;
    renderChat();
    const range=loadedTurns.length?`${loadedTurns[0].turn}–${loadedTurns.at(-1).turn}`:'無';
    $('history-page-status').textContent=`目前顯示 ${range} 回合 · ${historyPageState.hasMore?'可載入更早原文':'已到故事起點'}${anchorCommitId?' · 原文定位':''}`;
    if(readingAnchor)$('history-page-status').textContent+=retiredAnchor?' · 原閱讀回合已失效，顯示有效原文':' · 保留原閱讀位置；回到最新原文可看最新面板';
    // Restore only after status wrapping has settled, including narrow screens.
    if(earlier)shell.reading.scrollTop=scrollBefore.top+shell.reading.scrollHeight-scrollBefore.height;
    else if(readerMoved)readingAfter.restore();
    else if(latest)shell.scrollEnd();
    else if(anchorCommitId||ownCommitId){
      const commit=anchorCommitId??ownCommitId,target=[...$('chat').querySelectorAll('.player[data-commit-id]')].find(el=>el.dataset.commitId===commit);
      target?.classList.add('history-target');
      if(target)shell.reading.scrollTop+=target.getBoundingClientRect().top-shell.reading.getBoundingClientRect().top-16;
    }else if(preserve)readingBefore.restore();
    shell.adoptReading?.();
  }catch(error){if(serial===pageSerial&&relatedReadCurrent(selected,baseline)&&error.name!=='AbortError'){
    historySync.failed();$('history-page-status').textContent='本輪已保存，正在讀取正文；目前顯示的內容保留。';
    setError('history-page-error',error.code==='HISTORY_PAGE_TURN_TOO_LARGE'?error:null);
  }}finally{if(view.current(selected)&&serial===pageSerial){pageBusy=false;longformControls();controls();}}
}
async function loadInspector(){
  if(!view.runId||!$('inspector').open)return;
  const selected=view.capture(),baseline=canonicalStamp(),serial=++inspectorSerial;$('inspection').textContent='正在讀取公開 Inspector…';
  try{const result=await api('inspect',{runId:selected.runId});if(serial===inspectorSerial&&relatedReadCurrent(selected,baseline,result)&&$('inspector').open){$('inspection').textContent=JSON.stringify(result,null,2);$('inspection-route').textContent=inspectorStageRoute(result);}}
  catch(error){if(serial===inspectorSerial&&relatedReadCurrent(selected,baseline))$('inspection').textContent=`Inspector 讀取失敗：${error.message} (${error.code??'unknown'})`;}
}
function renderNarrative(value){
  narrativeData=value;
  const summaries=value.summaries??[],current=summaries.find(row=>row.current&&row.status==='completed');
  const last=(value.operations??[]).at(-1);
  $('summary-status').textContent=`${value.enabled===true?value.autoArmed?'長篇摘要已授權自動維護；封章後執行有界壓縮。':'長篇摘要 Adapter 已啟用；可在下方明示啟用自動維護，或手動補救。':'長篇摘要 Adapter 未啟用。'} ${last?`最近操作：${last.status}`:'not_started'}${current?` · 目前摘要 ${current.startTurn}–${current.endTurn} 回合 · v${current.version}`:' · 尚無有效滾動摘要'}${value.coverage?.coverageStatus==='blocked'?' · 正文保護已阻擋下一輪：請補齊摘要，全文仍可查回。':` · 未摘要原文 ${value.coverage?.uncoveredTurns??0} 回合完整保留`}`;
  if(value.contextMode==='chapter_3_plus_8')$('summary-status').textContent='Writer 已使用 3＋8 章節上下文；以下為舊 rolling 相容資料，不會重複送入。 '+$('summary-status').textContent;
  $('summary-content').replaceChildren();
  if(current){
    const section=node('section',undefined,'summary-card');section.dataset.summaryId=current.id;
    section.append(node('h3',`有效摘要 · ${current.startTurn}–${current.endTurn}`),node('p',current.text));
    if(current.startCommitId){const button=node('button','查回摘要來源原文','quiet');button.type='button';button.addEventListener('click',()=>void loadHistory({anchorCommitId:current.startCommitId}));section.append(button);}
    $('summary-content').append(section);
  }
  const stale=summaries.filter(row=>row.status==='stale').length;
  if(stale)$('summary-content').append(node('p',`${stale} 份摘要已失效，未作目前故事參考。`,'hint'));
  $('chapters').replaceChildren();
  for(const chapter of value.chapters??[]){
    const button=node('button',`${chapter.order}. ${chapter.title} · ${chapter.startTurn}–${chapter.endTurn} · ${chapter.current?'有效':chapter.status}`,'quiet');
    button.type='button';button.dataset.chapterId=chapter.id;button.disabled=!chapter.current||!chapter.startCommitId;
    button.addEventListener('click',()=>void loadHistory({anchorCommitId:chapter.startCommitId}));$('chapters').append(button);
  }
  if(!value.chapters?.length)$('chapters').append(node('p','尚未歸檔章節；玩家可在適當位置明確結束本章。','hint'));
  longformControls();
}
async function refreshNarrative(){
  if(!view.runId)return;
  const selected=view.capture(),baseline=canonicalStamp(),serial=++narrativeSerial;
  try{
    const value=await api('summaryStatus',{runId:selected.runId});if(serial!==narrativeSerial||!relatedReadCurrent(selected,baseline))return;
    const status=await api('operationStatus',{runId:selected.runId});if(serial!==narrativeSerial||!relatedReadCurrent(selected,baseline))return;
    if(status.runId!==selected.runId||!canonicalPairMatches(status.canonical,baseline)){scheduleCanonicalRefresh();return;}renderNarrative(value);
  }
  catch(error){if(serial===narrativeSerial&&relatedReadCurrent(selected,baseline)){setError('summary-error',error);$('summary-status').textContent='摘要狀態讀取失敗；不會重新生成。';}}
  if(serial===narrativeSerial&&relatedReadCurrent(selected,baseline))await refreshChapters();
}
function chapterControls(){
  const busy=narrativeBusy||state.pending||state.submitting||historyBusy||backupBusy,hasRun=!!state.run;
  $('chapter-settings-save').disabled=!hasRun||busy;
  $('chapter-auto-check').disabled=!hasRun||busy||chapterData?.enabled!==true||chapterData?.settings?.autoEnabled!==true||chapterData?.autoArmed!==true;
  $('chapter-summary-refresh').disabled=!hasRun||narrativeBusy;
  $('chapter-operation-cancel').hidden=!activeNarrativeOperation?.kind?.startsWith('chapter')||activeNarrativeOperation.kind==='chapterSettings';
  for(const button of $('chapter-summary-list').querySelectorAll('.chapter-backfill'))button.disabled=busy||chapterData?.enabled!==true||button.dataset.current!=='true';
}
function renderChapterIndex(value){
  chapterData=value;const settings=value.settings??{};
  if(!chapterSettingsDirty){$('chapter-auto-enabled').checked=settings.autoEnabled===true;$('chapter-token-threshold').value=settings.tokenThreshold??16000;$('chapter-buffer-turns').value=settings.bufferTurns??6;$('chapter-detail').value=settings.detail??'auto';}
  const eligibility=value.eligibility??{};
  $('chapter-config-status').textContent=chapterAutomationSummary(value);
  if(!narrativeBusy||value.chapterWork)$('chapter-operation-status').textContent=chapterOperationSummary(value);
  $('chapter-summary-list').replaceChildren();
  for(const chapter of value.chapters??[]){
    const section=node('section',undefined,'chapter-summary-row');section.dataset.chapterId=chapter.id;
    section.append(node('h4',`${chapter.order}. ${chapter.title}`),node('p',`第 ${chapter.startTurn}–${chapter.endTurn} 回合 · 來源 ${chapter.current?'有效':chapter.status} · 摘要 ${!chapter.summaryId&&chapter.summaryStatus==='not_started'?'missing / not_started':chapter.summaryStatus??'missing'}`,'chapter-summary-state'));
    const actions=node('div',undefined,'chapter-summary-actions'),open=node('button','展開本章摘要','quiet'),backfill=node('button',chapter.summaryId?'重新產生本章摘要':'補建本章摘要','quiet chapter-backfill');
    open.type=backfill.type='button';open.classList.add('chapter-summary-open');open.disabled=!chapter.current;backfill.dataset.current=String(chapter.current===true);
    open.addEventListener('click',()=>void readChapterDetail(chapter.id));backfill.addEventListener('click',()=>void mutateChapter('chapterSummarize',{chapterId:chapter.id,detail:$('chapter-detail').value}));actions.append(open,backfill);section.append(actions);$('chapter-summary-list').append(section);
  }
  if(!value.chapters?.length)$('chapter-summary-list').append(node('p','尚未歸檔章節。可手動結束本章，或明確啟用門檻檢查。','hint'));
  const selected=(value.chapters??[]).find(row=>row.id===selectedChapterId);
  if(selectedChapterId&&(!selected||!selected.current)){chapterDetailSerial++;$('chapter-summary-detail').replaceChildren(node('p','這一章的來源已失效；原摘要不作目前故事參考。'));}
  chapterControls();
}
async function refreshChapters(){
  if(!view.runId)return;const selected=view.capture(),baseline=canonicalStamp(),serial=++chapterSerial;
  try{const result=await api('chapterStatus',{runId:selected.runId});if(serial===chapterSerial&&relatedReadCurrent(selected,baseline,result))renderChapterIndex(result);}
  catch(error){if(serial===chapterSerial&&relatedReadCurrent(selected,baseline)){setError('chapter-error',error);$('chapter-config-status').textContent='章節狀態讀取失敗；未啟動生成。';}}
}
async function readChapterDetail(chapterId){
  if(!view.runId)return;const selected=view.capture(),baseline=canonicalStamp(),serial=++chapterDetailSerial;selectedChapterId=chapterId;
  $('chapter-summary-detail').hidden=false;$('chapter-summary-detail').replaceChildren(node('p','正在讀取本章摘要…'));
  try{
    const result=await api('chapterStatus',{runId:selected.runId,chapterId});if(serial!==chapterDetailSerial||!relatedReadCurrent(selected,baseline,result))return;
    const chapter=result.chapters?.find(row=>row.id===chapterId),container=$('chapter-summary-detail');container.replaceChildren();
    if(!chapter||!chapter.current){container.append(node('p','章節不存在或來源已失效；不顯示舊摘要。'));return;}
    container.dataset.chapterId=chapter.id;
    container.append(node('h3',`${chapter.order}. ${chapter.summary?.title??chapter.title}`),node('p',`摘要 ${chapter.summaryStatus??'missing'} · 第 ${chapter.startTurn}–${chapter.endTurn} 回合 · ${chapter.id}`,'hint'));
    const summary=chapter.summary;
    if(summary){container.append(node('p',summary.summary,'chapter-summary-text'));const fields=node('dl');for(const [key,label] of [['keywords','關鍵詞'],['characters','角色'],['locations','地點'],['plotThreads','未決情節'],['emotionalTone','情緒基調']]){const value=summary[key];fields.append(node('dt',label),node('dd',Array.isArray(value)?value.join('、')||'未記錄':value??'未記錄'));}container.append(fields);}
    else container.append(node('p','本章尚無有效獨立摘要，可使用「補建本章摘要」。','hint'));
    const anchor=chapter.startCommitId??chapter.source?.startCommitId;if(anchor){const jump=node('button','查回本章來源原文','quiet');jump.type='button';jump.classList.add('chapter-detail-source');jump.addEventListener('click',()=>void loadHistory({anchorCommitId:anchor}));container.append(jump);}
  }catch(error){if(serial===chapterDetailSerial&&relatedReadCurrent(selected,baseline))$('chapter-summary-detail').replaceChildren(node('p',`章節讀取失敗：${error.message} (${error.code??'unknown'})`));}
}
async function mutateChapter(kind,payload={}){
  if(!state.run||narrativeBusy||state.pending||state.submitting)return;
  const selected=view.capture();setError('chapter-error',null);
  $('chapter-operation-status').textContent='正在交由 Host 接受章節操作；可在重連後查回狀態。';
  await sendHostOperation(kind,payload);
  if(view.current(selected)&&kind==='chapterSummarize'&&!state.pending)await readChapterDetail(payload.chapterId);
}
async function mutateNarrative(kind){
  if(!state.run||narrativeBusy||state.pending||state.submitting)return;
  const recentWindow=Number($('recent-window').value);
  if(kind==='summaryStart'&&(!Number.isInteger(recentWindow)||recentWindow<1||recentWindow>50)){setError('summary-error',new Error('近期回合數必須是 1–50。'));return;}
  if(kind==='chapterClose'&&!$('chapter-title').value.trim()){setError('summary-error',new Error('請填寫章節標題。'));return;}
  setError('summary-error',null);$('summary-status').textContent='正在交由 Host 接受操作；背景操作不因切換 Run 而取消。';
  await sendHostOperation(kind,kind==='summaryStart'?{recentWindow}:{title:$('chapter-title').value.trim()});
}

async function searchHistoryUI(event){
  event.preventDefault();if(!view.runId)return;
  const selected=view.capture(),baseline=canonicalStamp(),serial=++recallSerial,query=$('history-query').value.trim();if(!query)return;
  $('history-search-status').textContent='正在搜尋有效原文…';$('history-hits').replaceChildren();$('history-read').hidden=true;
  try{
    const result=await api('historySearch',{runId:selected.runId,query,limit:8});
    if(serial!==recallSerial||!relatedReadCurrent(selected,baseline,result))return;
    $('history-search-status').textContent=`找到 ${result.hits.length} 筆${result.hasMore?'（尚有更多；請縮小搜尋）':''} · 僅歷史參考`;
    for(const hit of result.hits){
      const item=node('section',undefined,'history-hit');item.append(node('p',`第 ${hit.turn} 回合 · ${hit.snippet}`));
      const read=node('button','回讀這段原文','quiet'),jump=node('button','跳到故事位置','quiet');read.type=jump.type='button';
      read.addEventListener('click',()=>void readHistoryUI(hit));jump.addEventListener('click',()=>void loadHistory({anchorCommitId:hit.commitId}));item.append(read,jump);$('history-hits').append(item);
    }
  }catch(error){if(serial===recallSerial&&relatedReadCurrent(selected,baseline))$('history-search-status').textContent=`搜尋失敗：${error.message} (${error.code??'unknown'})`;}
}
async function readHistoryUI(hit){
  const selected=view.capture(),baseline=canonicalStamp(),serial=++recallSerial;$('history-read').hidden=false;$('history-read').textContent='正在回讀來源原文…';
  try{const result=await api('historyRead',{runId:selected.runId,locator:hit.locator,radius:0});if(serial===recallSerial&&relatedReadCurrent(selected,baseline,result))$('history-read').textContent=`${result.label}\n\n`+result.turns.map(turn=>`第 ${turn.turn} 回合 · ${turn.commitId}\n玩家：${turn.input}\n正文：${turn.body}`).join('\n\n');}
  catch(error){if(serial===recallSerial&&relatedReadCurrent(selected,baseline))$('history-read').textContent=`回讀失敗：${error.message} (${error.code??'unknown'})`;}
}
function renderWorld(world,worldView,lastTurn){
  $('state-summary').replaceChildren();
  const projected=blueprintStateRows(worldView,lastTurn);
  if(projected){
    for(const [title,rows] of [['主要狀態',projected.declared],['其他狀態',projected.other]]){
      const groups=new Map();for(const row of rows){const name=worldLabels[row.category]??row.category??'已記錄狀態';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);}
      for(const [category,entries] of groups){const section=node('section',undefined,'state-group');section.append(node('h3',category),node('p',title,'hint'));const list=node('ul');for(const row of entries)list.append(node('li',`${row.label}：${row.text}`));section.append(list);$('state-summary').append(section);}
    }
    if(!$('state-summary').childElementCount)$('state-summary').append(node('p','尚無公開狀態紀錄。','hint'));return;
  }
  for(const [key,value] of Object.entries(world)){
    const section=node('section',undefined,'state-group');section.append(node('h3',worldLabels[key]??key));
    const list=node('ul');
    for(const [name,item] of value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[['',value]])list.append(node('li',`${name?name+'：':''}${valueText(item)}`));
    section.append(list);$('state-summary').append(section);
  }
  if(!$('state-summary').childElementCount)$('state-summary').append(node('p','尚無世界狀態紀錄。','hint'));
}
function captureDraft(){
  if(!view.runId||state.run?.runId!==view.runId||state.pending)return null;
  const input=$('input').value;state.draft={runId:view.runId,viewerId,input,requestId:requestForInput(state.draft,input)};
  return {...state.draft};
}
async function saveDraft(){
  clearTimeout(state.draftTimer);
  const draft=captureDraft();if(!draft)return;
  const token=view.capture();$('draft-status').textContent='保存輸入草稿中…';
  const job=state.draftQueue.catch(()=>{}).then(()=>api('draftSave',draft));state.draftQueue=job;
  try{await job;if(view.current(token)&&state.draft?.requestId===draft.requestId)$('draft-status').textContent='輸入草稿已保存 · Ctrl / ⌘ + Enter 送出';}
  catch(error){if(view.current(token)){$('draft-status').textContent='草稿尚未保存，請保留此分頁。';setError('turn-error',error);}throw error;}
}
function restoreDraft(draft){
  if(draft?.status==='retired'){
    state.draft=null;$('input').value='';$('draft-status').textContent='此輸入對應的舊回合已退役；未當作已提交故事，請以新輸入開始。';controls();return;
  }
  state.draft=draft?.input?draft:null;$('input').value=draft?.input??'';
  if(draft?.status==='unknown'){
    $('draft-status').textContent='提交回執與有效故事尚未確認一致；保留輸入，請先查詢存檔結果。';controls();return;
  }
  $('draft-status').textContent=draft?.input?'已恢復未完成的輸入草稿。':'Enter 換行；Ctrl / ⌘ + Enter 送出。';controls();
}
async function selectRun(runId){
  const contextSerial=nativeContextSerial,navigation=++navigationSerial;
  if(runId===view.runId){const selected=view.capture();await reconcile();if(!view.current(selected)||navigation!==navigationSerial)return;shell.committed();return selected;}
  void clearPrivateDiagnostics();
  if(view.runId&&!state.pending&&!state.submitting){
    try{await saveDraft();}catch(error){if(contextSerial!==nativeContextSerial||navigation!==navigationSerial)return;throw error;}
  }
  if(contextSerial!==nativeContextSerial||navigation!==navigationSerial)return;
  banListDirty=false;$('banlist-status').textContent='';
  writingMode.select(null);proseStyle.select(null);
  const token=view.select(runId);operations.reset();historyBusy=false;clearTimeout(state.draftTimer);resetLongform();
  cardFrontend.clear();state.run=null;state.draft=null;state.pending=false;state.submitting=false;state.operationUnknown=false;state.failure=null;state.localTurn=null;state.lastOperation=null;state.chatKey=null;regenInput=null;
  historyTarget=null;$('history-dialog').close();$('export-consent').checked=false;$('history-status').textContent='僅可操作最後有效已提交回合。';setError('history-error',null);
  $('input').value='';$('progress').textContent='讀取已保存的 Run…';setError('turn-error',null);controls();
  const serial=++runReadSerial,owner=operations.capture();let snapshot;selectionRead=token;
  try{snapshot=await readCanonicalSnapshot(token,owner,serial,{includeDraft:true});}
  catch(error){if(!view.current(token)||contextSerial!==nativeContextSerial||serial!==runReadSerial)return;throw error;}
  finally{if(selectionRead===token)selectionRead=null;}
  if(!snapshot||!view.current(token)||serial!==runReadSerial)return;
  const {run,draft,progress,receipt}=snapshot;
  restoreDraft(draft);renderRun(run);observeOperation(receipt,progress);
  await Promise.all([loadHistory(),refreshNarrative()]);
  if(!view.current(token)||serial!==runReadSerial)return;
  if($('inspector').open)void loadInspector();
  state.failure=state.pending?null:receipt.failure??run.lastFailure;setError('turn-error',state.failure);
  $('progress').textContent=operationText(receipt,progress);controls();
  for(const button of $('runs').querySelectorAll('button'))button.setAttribute('aria-current',String(button.dataset.runId===runId));
  if(!native)try{sessionStorage.setItem('scean-selected-run',runId);}catch{}
  shell.committed();
  if(!state.pending)$('input').focus({preventScroll:true});return token;
}
// Only public identities are persisted. Inputs, model output, diagnostics and
// credentials are never copied into this recovery index.
function persistOutstanding(){try{sessionStorage.setItem('scean-outstanding-operations',JSON.stringify([...outstandingOperations.values()]));}catch{}}
function rememberOperation(operation){outstandingOperations.set(operation.runId,{runId:operation.runId,operationId:operation.operationId,requestId:operation.requestId??null,kind:operation.kind});persistOutstanding();}
function forgetOperation(operation){if(outstandingOperations.get(operation.runId)?.operationId===operation.operationId){outstandingOperations.delete(operation.runId);persistOutstanding();}}
function operationLookup(runId){const operation=outstandingOperations.get(runId);return {runId,...(operation?{operationId:operation.operationId}:{})};}
function operationText(receipt,progress){
  if(state.operationUnknown)return '連線中斷；操作結果尚待 Host 確認。正在查回原操作，請勿重新送出。';
  if(receipt?.pending)return progressText(progress)||`Host 背景操作：${receipt.kind??'operation'} / ${receipt.status}`;
  if(receipt?.status==='interrupted')return 'Host 曾重新啟動，原操作已中止；未自動重新送出模型。請確認存檔後手動決定下一步。';
  if(receipt?.status==='unknown')return 'Host 無法確認原操作結果；請確認目前存檔後再手動決定下一步。';
  return progressText(progress)||(receipt?.operationId?`Host 操作：${receipt.kind??'operation'} / ${receipt.status}`:'');
}
function observeOperation(receipt,progress){
  const runId=view.runId,tracked=outstandingOperations.get(runId);
  const missing=receipt?.status==='not_found'||receipt?.status==='not_recorded';
  const terminal=receipt&&!receipt.pending&&!missing;
  if(tracked&&(terminal||receipt?.status==='not_found')&&receipt.operationId===tracked.operationId)forgetOperation(tracked);
  // A terminal lookup for our older operation must not conceal a newer job
  // another browser started after it completed.
  const pending=receipt?.pending?receipt:progress?.pending?progress:null;
  state.operationUnknown=false;state.pending=!!pending;
  const observed=pending?{...pending,runId,pending:true}:{runId,pending:false};
  operations.observe(observed,operations.capture());
  if(pending){state.failure=null;setError('turn-error',null);}
  if(pending?.operationId){
    const prior=state.localTurn;
    state.localTurn=prior?.operationId===pending.operationId?prior:{runId,operationId:pending.operationId,requestId:pending.requestId,kind:pending.kind??'turn'};
    if(state.localTurn.kind==='summaryStart'||state.localTurn.kind?.startsWith('chapter')){activeNarrativeOperation=state.localTurn;narrativeBusy=true;}
    else{activeNarrativeOperation=null;narrativeBusy=false;}
  }else{
    state.localTurn=null;activeNarrativeOperation=null;narrativeBusy=false;regenInput=null;
  }
  if(terminal){state.lastOperation=receipt;if(receipt.failure){state.failure=receipt.failure;setError('turn-error',receipt.failure);}}
  if(terminal&&receipt.kind==='chapterSettings'&&receipt.status==='completed'){chapterSettingsDirty=false;}
  return terminal;
}
async function reconcile(){
  if(!view.runId)return;
  const token=view.capture(),operationToken=operations.capture(),serial=++runReadSerial,priorHead=storyHead();
  const snapshot=await readCanonicalSnapshot(token,operationToken,serial,{includeDraft:!state.run});
  if(!snapshot||!view.current(token)||serial!==runReadSerial)return;
  const {run,progress,receipt,draft}=snapshot;
  if(draft&&!state.draft)restoreDraft(draft);
  const wasPending=state.pending,priorDraft=state.draft,changed=priorHead!==storyHead(run),readingBefore=(changed||historySync.dirty)?captureStoryReading():undefined;
  renderRun(run);const terminal=observeOperation(receipt,progress);$('progress').textContent=operationText(receipt,progress);
  // The canonical receipt wins even if the submit acknowledgement was lost.
  if(priorDraft?.requestId&&activeDraftReceipt(run,priorDraft.requestId)){
    restoreDraft(null);state.failure=null;setError('turn-error',null);
  }else if(!state.pending){state.failure=receipt.failure??run.lastFailure??null;setError('turn-error',state.failure);}
  const own=submissionReading,ownTurn=run.lastTurn??run.turns?.at(-1);
  const ownCommitId=own&&own.runId===run.runId&&own.requestId===ownTurn?.requestId&&own.scrollEpoch===userScrollEpoch&&own.canLocate?ownTurn.commitId:undefined;
  if(changed||!historyPageState||historySync.due())await loadHistory({priorHead,readingBefore,ownCommitId});
  if(own&&own.requestId===ownTurn?.requestId&&!historySync.dirty)submissionReading=null;
  await refreshNarrative();
  if(!view.current(token)||serial!==runReadSerial)return;
  if($('inspector').open)void loadInspector();
  if(wasPending&&terminal){void refreshModels().catch(()=>{});void refreshRuns().catch(()=>{});}
  controls();return run;
}
async function sendHostOperation(kind,payload={},base={}){
  const selected=view.capture(),operation={...operations.start(selected.runId,payload.requestId),kind};
  const ownership=operations.capture();state.localTurn=operation;state.pending=true;state.submitting=true;state.operationUnknown=false;state.failure=null;
  if(kind==='summaryStart'||kind.startsWith('chapter')){activeNarrativeOperation=operation;narrativeBusy=true;}
  rememberOperation(operation);controls();
  try{
    const submitted={...payload,kind,runId:selected.runId,operationId:operation.operationId,viewerId,baseVersion:base.version??state.run.version,baseHead:Object.hasOwn(base,'head')?base.head:storyHead()};
    await notifications?.watch(submitted);
    const receipt=await api('operationSubmit',submitted);void notifications?.refresh();
    if(!view.current(selected)||!operations.current(ownership))return;
    // Host may return an earlier admission for the same request identity.
    if(receipt.operationId&&receipt.operationId!==operation.operationId){
      forgetOperation(operation);const resolved={...operation,operationId:receipt.operationId};rememberOperation(resolved);state.localTurn=resolved;
      operations.observe({...resolved,pending:receipt.pending},operations.capture());
    }
    state.submitting=false;await reconcile();
  }catch(error){
    if(!view.current(selected)||!operations.current(ownership))return;
    state.failure=error;setError('turn-error',error);
    // A lost response may hide acceptance or a completed commit. Keep the
    // original identity locked until a read-only lookup resolves it.
    if(error.code==='CONNECTION_UNKNOWN'||error.name==='AbortError')state.operationUnknown=true;
    else{forgetOperation(operation);state.pending=false;state.localTurn=null;activeNarrativeOperation=null;narrativeBusy=false;operations.reset();}
    try{await reconcile();}catch{if(view.current(selected)){state.operationUnknown=true;state.pending=true;}}
  }finally{
    if(view.current(selected)&&(!state.localTurn||state.localTurn.operationId===operation.operationId)){state.submitting=false;controls();if(!state.pending)$('input').focus({preventScroll:true});}
  }
}
async function submitTurn(retry=false){
  if(backupBusy||historyBusy||state.pending||state.submitting||state.generationBlocked||!view.runId||!$('input').value.trim()||state.composing)return;
  const token=view.capture(),readingIntent={runId:view.runId,scrollEpoch:userScrollEpoch,canLocate:!historySync.historical};state.submitting=true;controls();
  try{await saveDraft();}catch(error){if(view.current(token)){state.submitting=false;controls();}throw error;}
  if(!view.current(token))return;
  const draft={...state.draft};if(!draft?.input){state.submitting=false;controls();return;}
  submissionReading={...readingIntent,requestId:draft.requestId};
  setError('turn-error',null);$('progress').textContent='正在交由 Host 接受操作；斷線後會查回同一操作。';
  const prior=state.lastOperation;
  const retryOf=retry&&prior?.kind==='turn'&&prior.requestId===draft.requestId&&['failed','cancelled','interrupted'].includes(prior.status)?prior.operationId:null;
  await sendHostOperation('turn',{input:draft.input,requestId:draft.requestId,...(retryOf?{retryOf}:{})});
}
async function refreshConnectionScope(){
  if(native){
    const context=await api('native.context');
    if(JSON.stringify(context.cardScope??null)!==nativeScopeKey){await syncNativeContext(null);return false;}
  }else{
    const response=await fetch('/api/bootstrap',{credentials:'same-origin'});
    if(!response.ok)throw Object.assign(new Error('無法重新確認 Host 連線授權。'),{code:'CONNECTION_UNKNOWN'});
    const boot=await response.json();if(!boot.csrfToken)throw Object.assign(new Error('缺少 Host 連線授權。'),{code:'CONNECTION_UNKNOWN'});
    adoptNativeViewer(boot.viewerId);state.token=boot.csrfToken;state.mode=String(boot.mode??state.mode);updateModels({...boot.models,interactive:boot.models?.interactive??boot.interactive});
  }
  return true;
}
async function poll({force=false,scope=false}={}){
  if(state.pollBusy||state.submitting||selectionRead||!initialized||!view.runId||(!force&&Date.now()<state.nextPollAt))return;
  state.pollBusy=true;const token=view.capture(),operationToken=operations.capture();let serial=++runReadSerial;
  try{
    if((scope||state.disconnected)&&!await refreshConnectionScope())return;
    if(!view.current(token)||!operations.current(operationToken)||serial!==runReadSerial)return;
    const lookup=operationLookup(token.runId),[receipt,progress]=await Promise.all([api('operationStatus',lookup),api('progress',{runId:token.runId})]);
    if(!view.current(token)||!operations.current(operationToken)||serial!==runReadSerial)return;
    // Compare canonical state even while idle. Another browser can commit a
    // complete operation between two polls, so pending need never be observed.
    const canonical=receipt.canonical;
    const changed=canonical&&(canonical.version!==state.run?.version||canonical.head!==storyHead());
    const known=outstandingOperations.has(token.runId)||!!state.localTurn;
    const aligned=receipt.runId===token.runId&&canonicalPairMatches(canonical,canonicalStamp())&&progress.runId===token.runId&&(!progress.canonical||canonicalPairMatches(progress.canonical,canonicalStamp()));
    if(force||changed||known||canonicalRefreshNeeded||historySync.due()||!aligned||state.pending!==!!(receipt.pending||progress.pending)){const syncing=reconcile();serial=runReadSerial;await syncing;}
    else{
      const presentation=await api('presentation',{runId:token.runId});
      if(!view.current(token)||!operations.current(operationToken)||serial!==runReadSerial)return;
      if(presentation.presentationRevision!==(state.run?.presentationRevision??0)){const syncing=reconcile();serial=runReadSerial;await syncing;}
      else{cardFrontend.heartbeat(true);observeOperation(receipt,progress);$('progress').textContent=operationText(receipt,progress);controls();}
    }
    if(view.current(token)&&serial===runReadSerial)state.pollFailures=0;
  }catch(error){if(view.current(token)&&serial===runReadSerial){
    connection(false);state.pollFailures=Math.min(state.pollFailures+1,6);
    if(outstandingOperations.has(token.runId)||state.pending){state.operationUnknown=true;state.pending=true;setError('turn-error',error);$('progress').textContent=operationText();controls();}
  }}finally{
    state.pollBusy=false;state.nextPollAt=Date.now()+(state.pollFailures?Math.min(30000,1000*2**state.pollFailures):state.pending||canonicalRefreshNeeded?650:document.visibilityState==='hidden'?10000:2500);
  }
}
function resumeConnection(){state.nextPollAt=0;void poll({force:true,scope:true});}

function storyHead(run=state.run){return run?.head??run?.turns?.at(-1)?.commitId??null;}
function historyControls(){
  const busy=backupBusy||historyBusy||state.pending||state.submitting;
  const hasLast=!!(state.run?.turnCount??state.run?.turns?.length)&&!!storyHead();
  $('rollback-open').disabled=!hasLast||busy;
  $('regenerate-open').disabled=!hasLast||busy||state.generationBlocked;
  $('run-export').disabled=!state.run||busy||backupBusy||!$('export-consent').checked;
  $('run-import').disabled=busy||backupBusy||!$('import-consent').checked||!$('run-import-file').files?.length;
  for(const id of ['export-consent','import-consent','run-import-file'])$(id).disabled=backupBusy;
}
function openHistory(kind){
  if(backupBusy||historyBusy||state.pending||state.submitting||!(state.run?.turnCount??state.run?.turns?.length))return;
  const last=state.run.lastTurn??state.run.turns.at(-1);
  historyTarget={kind,selection:view.capture(),runId:state.run.runId,expectedVersion:state.run.version,expectedHead:storyHead(),input:last.input,turn:last.turn};
  $('history-title').textContent=kind==='rollback'?'回退最後有效回合':'重生成最後有效回合';
  $('history-target').textContent=`Run ${state.run.runId} · v${state.run.version} · 第 ${last.turn} 回合 · ${historyTarget.expectedHead}`;
  $('history-input').textContent=last.input;
  $('history-warning').textContent=kind==='rollback'?'確認後，此輪正文、玩家輸入及其 State、記憶和來源紀錄會共同退役，恢復到前一個有效回合。僅可回退此處指定的最後回合。':'沿用本輪原始玩家輸入，從上一輪狀態生成候選。候選驗證與原子替換成功前，原回合仍然有效；取消或失敗保留原回合。';
  $('history-confirm').textContent=kind==='rollback'?'確認回退此回合':'確認生成候選';
  $('regen-guidance').hidden=$('regen-guidance-label').hidden=kind!=='regenerate';$('regen-guidance').value='';setError('history-dialog-error',null);
  $('history-dialog').showModal();$('history-dismiss').focus();
}
async function applyHistory(){
  const target=historyTarget;
  if(!target||!view.current(target.selection)||historyBusy||state.pending||state.submitting)return;
  if(state.run.version!==target.expectedVersion||storyHead()!==target.expectedHead){setError('history-dialog-error',Object.assign(new Error('最後回合已變更，請關閉後重新確認目標。'),{code:'STALE_HISTORY_TARGET'}));return;}
  const guidance=$('regen-guidance').value.trim(),isRegen=target.kind==='regenerate';
  historyTarget=null;$('history-dialog').close();setError('history-error',null);
  await clearPrivateDiagnostics('歷史操作已開始，詳細診斷已清除。');
  if(!view.current(target.selection))return;
  regenInput=isRegen?target.input:null;
  $('history-status').textContent='正在交由 Host 接受操作；只以 Host 存檔與操作回條確認結果。';
  await sendHostOperation(target.kind,{...(isRegen?{requestId:crypto.randomUUID(),...(guidance?{guidance}:{})}:{confirmation:'rollback-last-committed-turn'})},{version:target.expectedVersion,head:target.expectedHead});
  if(view.current(target.selection))$('history-status').textContent=state.pending?'Host 背景操作進行中；重連後可查回。':`已重新讀取 Host 存檔 v${state.run.version}；請依目前故事與操作狀態確認結果。`;
}

async function exportRun(){
  if(backupBusy||!state.run||!$('export-consent').checked)return;
  const selected=view.capture();backupBusy=true;controls();setError('backup-error',null);
  $('backup-status').textContent='正在建立完整私人備份…';
  try{
    const bundle=await api('exportRun',{runId:selected.runId,acknowledgement:'export-private-run-data'});
    if(!view.current(selected))return;
    const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');
    link.href=url;link.download=`scean-run-${selected.runId.replace(/[^a-zA-Z0-9_-]/g,'_')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('backup-status').textContent='完整私人備份已交給瀏覽器下載。請妥善保管檔案。';
  }catch(error){if(view.current(selected))setError('backup-error',error);}
  finally{backupBusy=false;$('export-consent').checked=false;controls();}
}
async function importRun(){
  const file=$('run-import-file').files?.[0];
  if(backupBusy||!file||!$('import-consent').checked)return;
  backupBusy=true;controls();setError('backup-error',null);$('backup-status').textContent='正在驗證檔案；完成全部驗證前不建立 Run。';
  try{
    if(file.size>16*1024*1024)throw Object.assign(new Error('備份檔案超過 16 MiB 上限。'),{code:'SAVE_TOO_LARGE'});
    const bundle=await file.text();
    // Preserve raw JSON for the Host duplicate-member validator. Parsing here
    // is only syntax feedback; never send the lossy parsed object for import.
    try{JSON.parse(bundle);}catch{throw Object.assign(new Error('備份不是完整有效的 JSON，可能已截斷或損毀。'),{code:'INVALID_SAVE_JSON'});}
    const result=await api('importRun',{bundle,acknowledgement:'import-private-run-data'});
    await refreshRuns();await selectRun(result.runId);
    $('backup-status').textContent=`完整性與結構驗證通過，已匯入 Run ${result.runId}。可繼續遊玩；私人資料不會出現在普通 Inspector。`;
    $('run-import-file').value='';
  }catch(error){setError('backup-error',error);$('backup-status').textContent='匯入未成功，未覆蓋既有 Run。請查看驗證結果或衝突原因。';}
  finally{backupBusy=false;$('import-consent').checked=false;controls();}
}
for(const id of ['chapter-auto-enabled','chapter-token-threshold','chapter-buffer-turns','chapter-detail'])$(id).addEventListener('input',()=>{chapterSettingsDirty=true;});
$('chapter-settings-form').addEventListener('submit',event=>{
  event.preventDefault();const settings={autoEnabled:$('chapter-auto-enabled').checked,tokenThreshold:Number($('chapter-token-threshold').value),bufferTurns:Number($('chapter-buffer-turns').value),detail:$('chapter-detail').value};
  if(!Number.isInteger(settings.tokenThreshold)||settings.tokenThreshold<4000||settings.tokenThreshold>32000||!Number.isInteger(settings.bufferTurns)||settings.bufferTurns<0||settings.bufferTurns>50){setError('chapter-error',new Error('門檻必須為 4000–32000，保護回合數必須為 0–50 的整數。'));return;}
  void mutateChapter('chapterSettings',{settings});
});
$('chapter-summary-refresh').addEventListener('click',()=>void refreshChapters());
$('chapter-auto-check').addEventListener('click',()=>void mutateChapter('chapterAuto'));
$('chapter-operation-cancel').addEventListener('click',async()=>{
  const operation=activeNarrativeOperation,selected=view.capture();if(!operation?.kind.startsWith('chapter'))return;
  $('chapter-operation-cancel').disabled=true;
  try{await api('chapterCancel',{runId:operation.runId,operationId:operation.operationId});if(view.current(selected)){$('chapter-operation-status').textContent='已請求取消；查詢操作回執確認結果。';await refreshChapters();}}
  catch(error){if(view.current(selected))setError('chapter-error',error);}
  finally{$('chapter-operation-cancel').disabled=false;}
});
$('history-earlier').addEventListener('click',()=>void loadHistory({earlier:true}));
$('history-latest').addEventListener('click',()=>void loadHistory({latest:true}));
$('agent-diagnose').hidden=!native;
$('agent-diagnose').addEventListener('click',()=>{if(view.runId)void native.request('native.diagnose',{runId:view.runId}).catch(e=>setError('turn-error',e));});
$('inspector').addEventListener('toggle',()=>{if($('inspector').open)void loadInspector();else{inspectorSerial++;$('inspection').textContent='尚未展開讀取。';}});
$('summary-start').addEventListener('click',()=>void mutateNarrative('summaryStart'));
$('summary-refresh').addEventListener('click',()=>void refreshNarrative());
$('chapter-close').addEventListener('click',()=>void mutateNarrative('chapterClose'));
$('history-search-form').addEventListener('submit',event=>void searchHistoryUI(event));
$('summary-cancel').addEventListener('click',async()=>{
  const operation=activeNarrativeOperation,selected=view.capture();if(!operation)return;
  $('summary-cancel').disabled=true;
  try{await api('summaryCancel',{runId:operation.runId,operationId:operation.operationId});if(view.current(selected)){$('summary-status').textContent='已請求取消；查詢操作回執確認結果。';await refreshNarrative();}}
  catch(error){if(view.current(selected))setError('summary-error',error);}
  finally{$('summary-cancel').disabled=false;}
});
$('rollback-open').addEventListener('click',()=>openHistory('rollback'));
$('regenerate-open').addEventListener('click',()=>openHistory('regenerate'));
$('history-dismiss').addEventListener('click',()=>{historyTarget=null;$('history-dialog').close();});
$('history-dialog').addEventListener('cancel',()=>{historyTarget=null;});
$('history-confirm').addEventListener('click',()=>applyHistory().catch(error=>setError('history-error',error)));
for(const id of ['export-consent','import-consent','run-import-file'])$(id).addEventListener('change',historyControls);
$('run-export').addEventListener('click',()=>{void exportRun();});
$('run-import').addEventListener('click',()=>{void importRun();});
$('card').addEventListener('change',renderRevisions);$('revision').addEventListener('change',renderOpenings);$('opening').addEventListener('change',renderPreview);
$('diagnostics-consent').addEventListener('change',diagnosticsControls);
$('diagnostics-revoke').addEventListener('click',()=>{void clearPrivateDiagnostics();});
$('diagnostics-grant').addEventListener('click',async()=>{
  if(!view.runId||!state.run||diagnosticsBusy||privateDiagnostics.grant||!$('diagnostics-consent').checked)return;
  const selected=view.capture(),token=privateDiagnostics.begin(selected.runId);diagnosticsBusy=true;diagnosticsControls();setError('diagnostics-error',null);
  $('diagnostics-status').textContent='正在取得此 Run 的本機詳細診斷授權…';
  try{
    const grant=await api('diagnosticsGrant',{runId:selected.runId,viewerId:token.viewerId,acknowledgement:'show-private-character-context-for-this-run'});
    if(!view.current(selected)||!privateDiagnostics.adopt(token,grant)){
      await api('diagnosticsRevoke',{runId:selected.runId,viewerId:token.viewerId,grantToken:grant.grantToken}).catch(()=>{});
      if(view.current(selected)&&privateDiagnostics.current(token))await clearPrivateDiagnostics('授權未成立或已過期；未顯示詳細診斷。');return;
    }
    diagnosticsTimer=setTimeout(()=>{void clearPrivateDiagnostics('詳細診斷授權已到期，內容已清除。');},Math.max(1,privateDiagnostics.grant.expiresAt-Date.now()));
    const detailed=await api('diagnosticsRead',privateDiagnostics.request());
    if(!view.current(selected)||!privateDiagnostics.current(token)||!privateDiagnostics.request())return;
    if(detailed.runId!==selected.runId||detailed.diagnostics?.scope!=='operator-private')throw new Error('詳細診斷的 Run 或權限範圍不符。');
    $('private-inspection').textContent=JSON.stringify(detailed,null,2);$('private-inspection').hidden=false;
    $('diagnostics-status').textContent=`已讀取此 Run 的詳細診斷（版本 ${detailed.version??'未記錄'}）。此內容不隨新回合自動更新；撤銷、切 Run 或授權到期後會清除。`;
  }catch(error){if(view.current(selected)&&privateDiagnostics.current(token)){await clearPrivateDiagnostics('詳細診斷讀取未完成，授權與本機內容已清除。');setError('diagnostics-error',error);}}
  finally{if(privateDiagnostics.current(token)){diagnosticsBusy=false;diagnosticsControls();}}
});
$('interactive-consent').addEventListener('change',controls);
$('interactive-enable').addEventListener('click',async()=>{
  const request=interactiveEnableRequest(state.mode,state.interactive,$('interactive-consent').checked);
  if(!request||state.enableBusy)return;
  state.enableBusy=true;setError('interactive-error',null);controls();
  try{
    await api('interactiveEnable',request);
    await refreshModels();
    if(state.interactive?.enabled!==true)throw Object.assign(new Error('尚未確認啟用結果；請重新整理模型狀態。'),{code:'ACTIVATION_NOT_CONFIRMED'});
  }catch(error){setError('interactive-error',error);}
  finally{state.enableBusy=false;controls();}
});
$('create-form').addEventListener('submit',async e=>{
  e.preventDefault();$('create').disabled=true;setError('create-error',null);
  try{
    const created=await api('create',{cardId:card().id,revisionId:revision().id??revision().revision,openingId:opening().id,playerName:$('create-player-name').value});
    await refreshRuns();await selectRun(created.runId);
    if(matchMedia('(max-width:650px)').matches)$('setup').open=false;
    shell.committed();
  }catch(error){setError('create-error',error);}finally{renderPreview();}
});
$('turn-form').addEventListener('submit',e=>{e.preventDefault();submitTurn().catch(error=>setError('turn-error',error));});
$('input').addEventListener('compositionstart',()=>{state.composing=true;});
$('input').addEventListener('compositionend',()=>{state.composing=false;});
$('input').addEventListener('keydown',e=>{if(shouldSubmit(e,state.composing)){e.preventDefault();submitTurn().catch(error=>setError('turn-error',error));}});
$('input').addEventListener('input',()=>{
  captureDraft();state.failure=null;setError('turn-error',null);controls();
  $('draft-status').textContent='輸入草稿尚未保存…';clearTimeout(state.draftTimer);state.draftTimer=setTimeout(()=>saveDraft().catch(()=>{}),450);
});
$('retry').addEventListener('click',()=>submitTurn(true).catch(error=>setError('turn-error',error)));
$('recheck').addEventListener('click',resumeConnection);
$('cancel').addEventListener('click',async()=>{
  const token=view.capture(),operationToken=operations.capture(),target=operations.target(token.runId);
  if(!target){await reconcile().catch(error=>setError('turn-error',error));return;}
  $('cancel').disabled=true;
  try{const result=await api('cancel',target);if(view.current(token)&&operations.current(operationToken)){$('progress').textContent=result.cancelRequested?'已提出取消，正在核對是否已提交…':'該次操作已結束或身分不符，正在核對目前狀態…';await reconcile();}}
  catch(error){if(view.current(token)&&operations.current(operationToken))setError('turn-error',error);}
  finally{if(view.current(token))controls();}
});
$('refresh').addEventListener('click',()=>refreshModels().then(()=>refreshRuns()).then(()=>reconcile()).catch(error=>setError('turn-error',error)));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!state.pending)saveDraft().catch(()=>{});if(document.visibilityState==='visible')resumeConnection();if(document.visibilityState==='visible'&&privateDiagnostics.grant&&!privateDiagnostics.request())void clearPrivateDiagnostics('詳細診斷授權已到期，內容已清除。');});
for(const event of ['online','focus','pageshow'])window.addEventListener(event,resumeConnection);
window.addEventListener('beforeunload',event=>{if(state.pending||$('draft-status').textContent.includes('尚未保存')){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{void clearPrivateDiagnostics('分頁已離開，詳細診斷內容已清除。');});

async function init(){
  try{
    if(!secureClient){state.generationBlocked=true;throw Object.assign(new Error('此瀏覽器頁面缺少安全上下文與安全 UUID。請使用 localhost 或經授權配置的 HTTPS；Tailscale 傳輸加密不等於 HTTPS。'),{code:'SECURE_CONTEXT_REQUIRED'});}
    let boot;
    if(native)boot=await native.bootstrap();
    else{const response=await fetch('/api/bootstrap',{credentials:'same-origin'});if(!response.ok)throw new Error('無法讀取隔離環境。');boot=await response.json();}
    adoptNativeViewer(boot.viewerId);state.token=boot.csrfToken;if(!native&&!state.token)throw new Error('缺少本機連線授權。');
    state.mode=String(boot.mode??'unknown');updateModels({...boot.models,interactive:boot.models?.interactive??boot.interactive});
    void globalChapterSettings.refresh();void playerIdentity.refreshDefaults();
    $('data-source').textContent=`資料：${boot.dataRootLabel??'隔離資料目錄'}。`;
    const catalog=await api('catalog');state.catalog=catalog.cards??[];renderCards();
    try{await refreshModels();}
    catch(error){$('model-source').textContent=`模型選擇暫不可讀：${error.message}`;}
    initialized=true;
    if(native){await syncNativeContext(nativeSelection);await openNotificationTarget(nativeNotificationTarget);}
    else{
      const runs=await refreshRuns();let selected;try{selected=sessionStorage.getItem('scean-selected-run');}catch{}
      if(selected&&runs.some(r=>r.runId===selected))await selectRun(selected);
      else if(runs.length)await selectRun(runs.at(-1).runId);
      else $('chat').append(node('p','選卡、選版本與開場，開始自己的故事。','empty'));
    }
    connection(true);void notifications?.refresh();setInterval(()=>void poll(),650);
  }catch(error){connection(false);setError('create-error',error);$('mode-banner').textContent='環境尚未就緒，請確認隔離啟動視窗中的狀態，再重新整理。';}
}
if(native){$('create-player-name').hidden=true;document.querySelector('label[for="create-player-name"]').hidden=true;$('studio-open').textContent='從 Studio 交接已保存卡片';$('studio-open').addEventListener('click',()=>native.openStudio());}
else mountStudio({api,onRunCreated:async result=>{await refreshRuns();await selectRun(result.runId);shell.committed();}});
$('banlist-input').addEventListener('input',()=>{banListDirty=true;});
$('banlist-form').addEventListener('submit',async event=>{event.preventDefault();if($('banlist-save').disabled||!state.run)return;const selected=view.capture();banListBusy=true;controls();$('banlist-status').textContent='正在保存…';try{await api('banList',{runId:selected.runId,expectedVersion:state.run.version,banList:$('banlist-input').value.split('\n').map(s=>s.trim()).filter(Boolean)});if(view.current(selected)){banListDirty=false;await reconcile();$('banlist-status').textContent='已保存；往後回合使用目前 BanList。';}}catch(error){if(view.current(selected))$('banlist-status').textContent='未保存：'+error.message;}finally{banListBusy=false;controls();}});
init();
