// Human-only recovery controls. No implicit write retries or automatic opening.
export function mountRunRecycle({document:doc=globalThis.document,request,getCurrent=()=>null,getScopeKey=()=>'',isBusy=()=>false,beforeTrash=async()=>{},onChanged=async()=>{}}){
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;},root=doc.getElementById('runs'),entry=el('button','回收區');entry.id='run-recycle-open';entry.type='button';entry.className='quiet';entry.setAttribute('aria-haspopup','dialog');root.after(entry);
 const status=el('p');status.id='run-recycle-status';status.setAttribute('role','status');entry.after(status);
 const recheck=el('button','查回刪除／恢復結果');recheck.id='run-recycle-recheck';recheck.type='button';recheck.className='quiet';recheck.hidden=true;status.after(recheck);
 const bin=el('dialog');bin.id='run-recycle-dialog';bin.className='run-recycle-dialog';bin.setAttribute('aria-labelledby','run-recycle-title');const title=el('h2','回收區');title.id='run-recycle-title';const binClose=el('button','關閉');binClose.type='button';const list=el('div');list.id='run-recycle-list';const binStatus=el('p');binStatus.setAttribute('role','status');bin.append(title,el('p','僅此卡片的遊玩副本。進度仍保留，可恢復；不會自動開局。'),binClose,binStatus,list);doc.body.append(bin);
 const lookupButton=el('button','查回結果');lookupButton.type='button';lookupButton.id='run-recycle-confirm-lookup';lookupButton.hidden=true;
 const confirm=el('dialog');confirm.id='run-recycle-confirm-dialog';confirm.className='run-recycle-dialog';confirm.setAttribute('aria-labelledby','run-recycle-confirm-title');const heading=el('h2');heading.id='run-recycle-confirm-title';const detail=el('p');detail.id='run-recycle-confirm-detail';const confirmError=el('p');confirmError.setAttribute('role','alert');const cancel=el('button','取消');cancel.type='button';cancel.id='run-recycle-cancel';const commit=el('button');commit.type='button';commit.id='run-recycle-confirm';confirm.append(heading,detail,confirmError,lookupButton,cancel,commit);doc.body.append(confirm);
 let storage;try{storage=doc.defaultView?.sessionStorage;}catch{}const storageKey='scean-run-lifecycle-pending-v1';let pending=null,target=null,busy=false,serial=0,opener=entry;
 try{const value=JSON.parse(storage?.getItem(storageKey)??'null');if(value&&typeof value.scope==='string'&&['runTrash','runRestore'].includes(value.action)&&typeof value.runId==='string'&&typeof value.operationId==='string'&&Number.isInteger(value.expectedLifecycleRevision)&&Number.isInteger(value.expectedVersion))pending=value;}catch{}
 const save=()=>{try{if(pending)storage?.setItem(storageKey,JSON.stringify(pending));else storage?.removeItem(storageKey);}catch{}};
 const controls=()=>{lookupButton.hidden=!pending||pending.scope!==getScopeKey();lookupButton.disabled=busy;commit.disabled=busy||!target;cancel.disabled=busy;recheck.hidden=!pending||pending.scope!==getScopeKey();recheck.disabled=busy;entry.disabled=busy;for(const button of list.querySelectorAll('button'))button.disabled=busy;};
 function reset(){++serial;target=null;if(confirm.open)confirm.close();if(bin.open)bin.close();busy=false;status.textContent='';controls();}
 function openConfirm(row,action,button){
  if(busy)return;opener=button;target={row,action};confirmError.textContent='';heading.textContent=action==='runTrash'?'刪除這個遊玩副本？':'恢復這個遊玩副本？';commit.textContent=action==='runTrash'?'移入回收區':'恢復副本';
  detail.textContent=`${row.title??row.cardId??'遊玩副本'}・已保存 ${row.turnCount??0} 回合。`+(action==='runTrash'?'進度會保留在回收區；來源卡與其他副本不變。':'恢復原本進度，不會自動開局或送出任何內容。');
  if(action==='runTrash'&&getCurrent()?.runId===row.runId&&isBusy()){status.textContent='請等生成、保存與提交結果確認完成後再刪除。';target=null;return;}
  if(bin.open)bin.close('confirm');confirm.returnValue='';confirm.showModal();cancel.focus({preventScroll:true});controls();
 }
 async function loadBin(){
  const token=++serial,scope=getScopeKey();binStatus.textContent='讀取回收區…';list.replaceChildren();
  try{const rows=await request('runRecycleList');if(token!==serial||scope!==getScopeKey())return;binStatus.textContent=rows.length?'選擇要恢復的副本。':'回收區是空的。';
   for(const row of rows){const item=el('section');item.className='run-recycle-item';const text=el('p',`${row.title??row.cardId}・${row.turnCount??0} 回合`),time=el('small',row.lifecycleChangedAt?new Date(row.lifecycleChangedAt).toLocaleString():''),button=el('button','恢復');button.type='button';button.addEventListener('click',()=>openConfirm(row,'runRestore',button));item.append(text,time,button);list.append(item);}
  }catch(error){if(token===serial)binStatus.textContent=error.message??'目前無法讀取回收區，請稍後再試。';}controls();
 }
 async function finish(value){
  pending=null;save();target=null;busy=false;if(confirm.open)confirm.close('applied');status.textContent=value.status==='trashed'?'副本已移入回收區，進度保留。':'副本已恢復，可從書架繼續。';controls();await onChanged(value);if(bin.open)await loadBin();
 }
 async function lookup(){
  if(!pending||pending.scope!==getScopeKey()||busy)return;const token=serial,scope=getScopeKey();busy=true;controls();
  try{const value=await request('runLifecycleStatus',{runId:pending.runId,operationId:pending.operationId});if(token!==serial||scope!==getScopeKey())return;if(value.operationStatus==='committed')await finish(value);else status.textContent='尚未查到完成回執。可稍後再查，或明確重試同一次操作；不會自動重送。';}
  catch(error){if(token===serial)status.textContent=error.message??'結果仍無法確認；請保留此頁，稍後查回。';}finally{if(token===serial){busy=false;controls();}}
 }
 entry.addEventListener('click',()=>{if(busy)return;bin.returnValue='';bin.showModal();binClose.focus({preventScroll:true});void loadBin();});binClose.addEventListener('click',()=>bin.close());
 bin.addEventListener('close',()=>{if(bin.returnValue!=='confirm')entry.focus({preventScroll:true});});
 cancel.addEventListener('click',()=>{if(!busy)confirm.close('cancel');});confirm.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 for(const dialog of [bin,confirm])dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();if(dialog!==confirm||!busy)dialog.close('cancel');}});
 confirm.addEventListener('close',()=>{if(confirm.returnValue!=='applied')opener?.focus({preventScroll:true});});
 recheck.addEventListener('click',()=>void lookup());lookupButton.addEventListener('click',()=>void lookup());
 commit.addEventListener('click',async()=>{
  if(busy||!target)return;const chosen=target,token=serial,scope=getScopeKey();busy=true;confirmError.textContent='';controls();
  try{
   if(pending&&pending.scope===scope&&(pending.runId!==chosen.row.runId||pending.action!==chosen.action))throw Error('請先查回前一次副本操作的結果。');
   if(chosen.action==='runTrash'&&getCurrent()?.runId===chosen.row.runId){if(isBusy())throw Error('請等生成、保存與提交結果確認完成。');await beforeTrash();}
   if(token!==serial||scope!==getScopeKey())return;
   pending=pending?.scope===scope?pending:{scope,action:chosen.action,runId:chosen.row.runId,operationId:globalThis.crypto.randomUUID(),expectedLifecycleRevision:chosen.row.lifecycleRevision??0,expectedVersion:chosen.row.version,expectedHead:chosen.row.head??null,confirmed:true};save();
   const {scope:ignored,action:ignoredAction,...payload}=pending,value=await request(chosen.action,payload);if(token!==serial||scope!==getScopeKey())return;await finish(value);
  }catch(error){if(token===serial){const known=['RUN_BUSY','RUN_LIFECYCLE_CHANGED','VERSION_CONFLICT','HISTORY_HEAD_CONFLICT','RUN_LIFECYCLE_UNRESOLVED','RUN_LIFECYCLE_CONFIRM_REQUIRED','RUN_LIFECYCLE_DENIED'];if(known.includes(error.code)){pending=null;save();}confirmError.textContent=(error.message??'操作結果無法確認。')+(pending?' 請查回結果；不會自動重送。':'');}}
  finally{if(token===serial){busy=false;controls();}}
 });
 controls();return {reset,update:controls,lookup,addAction(container,row){const button=el('button','刪除副本');button.type='button';button.className='quiet run-trash';button.setAttribute('aria-label','刪除遊玩副本');button.addEventListener('click',()=>openConfirm(row,'runTrash',button));container.append(button);}};
}
