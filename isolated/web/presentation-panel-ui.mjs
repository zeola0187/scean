import {renderFrontendDocument} from './frontend-runtime.mjs';

const messages={
 PRESENTATION_BLUEPRINT_REQUIRED:'這段故事沒有原有狀態藍圖，目前不能補上專用面板。官方狀態顯示仍可使用。',
 PRESENTATION_PUBLIC_BINDINGS_REQUIRED:'這段故事沒有可供面板讀取的公開欄位，請繼續使用官方狀態顯示。',
 PRESENTATION_REVISION_CONFLICT:'另一個視窗已更換面板；請重新讀取並預覽。',
 PRESENTATION_PREVIEW_STALE:'故事或面板已更新；請重新預覽目前狀態後再套用。',
 PRESENTATION_PREVIEW_EXPIRED:'預覽已過期；請重新預覽後再套用。',
 PRESENTATION_SOURCE_MISMATCH:'工作卡不屬於這段故事，未套用面板。',
 PRESENTATION_SAVE_UNKNOWN:'套用結果尚未確認。請重新讀取確認，避免重複套用。',
 RUN_BUSY:'這一輪仍在處理，請等保存完成後再套用面板。',
 PRESENTATION_SOURCE_UNAVAILABLE:'目前沒有可讀取的工作卡面板。請先請 Card Studio Agent 製作並保存面板。',
 PRESENTATION_SOURCE_MISSING:'目前沒有可讀取的工作卡面板。請先請 Card Studio Agent 製作並保存面板。',
};
export function mountPresentationPanel({document:doc=globalThis.document,request,getContext=()=>null,preserveReading=()=>()=>{},makeId=()=>globalThis.crypto.randomUUID()}={}){
 const section=doc.createElement('section');section.id='run-presentation-panel';section.setAttribute('aria-label','本局狀態面板');
 const heading=doc.createElement('h3');heading.textContent='本局狀態面板';
 const description=doc.createElement('p');description.textContent='讀取已保存的工作卡面板，預覽這段故事目前的狀態，再決定是否套用。只更換外觀，不改故事進度。';
 const load=doc.createElement('button');load.type='button';load.id='presentation-source-load';load.textContent='讀取工作卡面板';
 const refresh=doc.createElement('button');refresh.type='button';refresh.id='presentation-refresh';refresh.className='quiet';refresh.textContent='重新讀取';
 const original=doc.createElement('button');original.type='button';original.id='presentation-restore-original';original.className='quiet';original.textContent='還原原始面板／官方顯示';
 const previous=doc.createElement('button');previous.type='button';previous.id='presentation-restore-previous';previous.className='quiet';previous.textContent='還原上一版面板';
 const status=doc.createElement('p');status.id='run-presentation-status';status.setAttribute('role','status');
 const bindings=doc.createElement('p');bindings.id='presentation-bindings';bindings.className='hint';
 const previewBox=doc.createElement('section');previewBox.id='presentation-preview';previewBox.hidden=true;
 const previewLabel=doc.createElement('p');previewLabel.id='presentation-preview-label';
 const frame=doc.createElement('iframe');frame.id='presentation-preview-frame';frame.title='本局目前狀態面板預覽';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='width:100%;height:360px;border:1px solid;display:block;background:white;color:black';
 const apply=doc.createElement('button');apply.type='button';apply.id='presentation-apply';apply.textContent='確認套用到這段故事';
 const cancel=doc.createElement('button');cancel.type='button';cancel.id='presentation-preview-cancel';cancel.className='quiet';cancel.textContent='取消預覽';
 previewBox.append(previewLabel,frame,apply,cancel);section.append(heading,description,load,refresh,original,previous,status,bindings,previewBox);
 const parent=doc.getElementById('run-info-panel-dialog')??doc.getElementById('prose-style-form')?.parentElement??doc.getElementById('longform-panel')??doc.getElementById('setup')??doc.body;parent.append(section);
 let selected=null,epoch=0,busy=false,saved=null,preview=null,pending=null;
 const runKey=run=>run?run.runId+':'+run.snapshot?.hash+':'+(run.selectionStamp??run.epoch??''):null;
 const ctx=()=>{const value=getContext();return value?.run??value;};
 const current=key=>key===runKey(ctx())&&key===runKey(selected);
 const exact=value=>value?.runId===selected?.runId&&value?.snapshotHash===selected?.snapshot?.hash&&(!value.canonical||value.canonical.version===selected.version&&value.canonical.head===(selected.head??null));
 const retain=fn=>{const restore=preserveReading();fn();restore?.();};
 function controls(){const unavailable=!selected||!saved||saved.status!=='available',storyBusy=!!ctx()?.disabled;load.disabled=busy||unavailable||!!pending;refresh.disabled=!selected||busy;original.disabled=busy||storyBusy||unavailable||!saved.canRestoreOriginal||!!pending;previous.disabled=busy||storyBusy||unavailable||!saved.canRestorePrevious||!!pending;apply.disabled=busy||storyBusy||!preview||!!pending;cancel.disabled=busy;}
 function clearPreview(){preview=null;previewBox.hidden=true;frame.removeAttribute('srcdoc');}
 function show(value){saved=value;bindings.textContent=value.bindings?.length?'可讀取：'+value.bindings.map(v=>v.displayName+(v.known?'':'（未知）')).join('、'):'';status.textContent=value.status==='available'?(value.usingOriginal?'目前使用原始面板／官方顯示。':'目前使用已套用的本局面板。'):(messages[value.code]??'面板目前不可用，官方狀態顯示與故事仍可使用。');controls();}
 function errorText(error){if(['CONNECTION_UNKNOWN','AbortError','TimeoutError'].includes(error.code??error.name))return messages.PRESENTATION_SAVE_UNKNOWN;if(error.code?.startsWith('FRONTEND_'))return '這個面板與本局既有公開欄位不相容，或包含不支援的內容；未套用。';return messages[error.code]??'面板操作未完成，原故事與狀態保持不變。請重新讀取。';}
 async function read(){
  if(!selected||busy)return;const serial=epoch,key=runKey(selected),runId=selected.runId;busy=true;controls();
  try{const value=await request('presentation',{runId});if(serial!==epoch||!current(key))return;if(!exact(value))throw Object.assign(Error(),{code:'PRESENTATION_PREVIEW_STALE'});retain(()=>{show(value);if(pending){status.textContent=value.lastOperationId===pending.operationId?'已確認面板設定已保存，故事進度不變。':'已重新讀取；請確認目前面板後再操作。';pending=null;clearPreview();controls();}});}
  catch(error){if(serial===epoch&&current(key))status.textContent=errorText(error);}
  finally{if(serial===epoch){busy=false;controls();}}
 }
 load.addEventListener('click',async()=>{
  if(load.disabled)return;const serial=epoch,key=runKey(selected),runId=selected.runId;busy=true;clearPreview();controls();status.textContent='正在讀取工作卡並預覽目前狀態…';
  try{
   const source=await request('presentationSource',{runId});if(serial!==epoch||!current(key))return;
   if(!source?.frontend)throw Object.assign(Error(),{code:'PRESENTATION_SOURCE_UNAVAILABLE'});
   const value=await request('presentationPreview',{runId,frontend:source.frontend,source:source.source,expectedPresentationRevision:saved.presentationRevision});
   if(serial!==epoch||!current(key))return;
   if(!exact(value))throw Object.assign(Error(),{code:'PRESENTATION_PREVIEW_STALE'});
   retain(()=>{preview=value;frame.srcdoc=renderFrontendDocument(value.preview.frontend,value.preview.projection);previewLabel.textContent='目前已保存狀態的預覽'+(value.source?' · '+(value.source.label??'工作卡')+'，第 '+value.source.revision+' 版':'')+'。尚未套用；不會增加或補猜數值。';previewBox.hidden=false;status.textContent='請檢查預覽，確認後再套用。';});
  }catch(error){if(serial===epoch&&current(key))status.textContent=errorText(error);}
  finally{if(serial===epoch){busy=false;controls();}}
 });
 async function save(action,target){
  if(busy||!selected||pending)return;const serial=epoch,key=runKey(selected);pending={runId:selected.runId,expectedPresentationRevision:saved.presentationRevision,operationId:makeId(),confirmed:true,...(action==='presentationApply'?{previewToken:preview.previewToken}:{target})};busy=true;controls();status.textContent='正在保存本局面板設定…';
  try{const value=await request(action,pending);if(serial!==epoch||!current(key))return;retain(()=>{show(value);pending=null;clearPreview();status.textContent='已保存面板設定，故事進度與狀態保持不變。';});}
  catch(error){if(serial!==epoch||!current(key))return;const unknown=['PRESENTATION_SAVE_UNKNOWN','CONNECTION_UNKNOWN','AbortError','TimeoutError'].includes(error.code??error.name);if(!unknown)pending=null;clearPreview();status.textContent=errorText(error);}
  finally{if(serial===epoch){busy=false;controls();}}
 }
 apply.addEventListener('click',()=>{if(!apply.disabled)void save('presentationApply');});
 original.addEventListener('click',()=>{if(!original.disabled)void save('presentationRestore','original');});
 previous.addEventListener('click',()=>{if(!previous.disabled)void save('presentationRestore','previous');});
 refresh.addEventListener('click',()=>void read());cancel.addEventListener('click',()=>retain(()=>{clearPreview();status.textContent='已取消預覽，原面板保持不變。';controls();}));
 function reset(){epoch++;selected=null;saved=null;preview=null;pending=null;busy=false;clearPreview();bindings.textContent='';status.textContent='請先選一段故事。';controls();}
 reset();
 return {update(run){const oldKey=runKey(selected),key=runKey(run);if(key!==oldKey){reset();selected=run;if(run)void read();return;}if(!run)return;const changed=selected?.version!==run.version||selected?.head!==run.head||(run.presentationRevision??0)>(saved?.presentationRevision??0);selected=run;if(changed&&preview)retain(()=>{clearPreview();status.textContent='故事或面板已更新；請重新預覽後再套用。';controls();});if(run.presentation&&(!saved||run.presentation.presentationRevision>saved.presentationRevision)&&!busy&&!pending)retain(()=>show(run.presentation));controls();},reset,refresh:read,dispose(){reset();section.remove();}};
}
