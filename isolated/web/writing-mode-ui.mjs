// Same Run-scoped settings lifecycle; no generation or implicit opt-in.
export function mountWritingMode({request,secureContext=true,document=globalThis.document,makeId=()=>globalThis.crypto.randomUUID(),onMode=()=>{}}){
 const $=id=>document.getElementById(id),input=$('writing-mode-input'),status=$('writing-mode-status');
 let runId=null,serial=0,saved=null,busy=false,dirty=false,pending=null,conflict=false,availability=null;
 const label=mode=>({current:'舊版三階段（相容）',materials:'舊版素材整理（相容）',single_writer:'單一 Writer'}[mode]??'未知模式');
 const controls=()=>{input.disabled=!runId||busy||!saved||!!pending;$('writing-mode-save').disabled=!saved||busy||!dirty||!!pending||conflict||!secureContext||(availability?.[input.value]?.status==='unavailable');$('writing-mode-cancel').disabled=!saved||busy||!!pending;$('writing-mode-reload').disabled=!runId||busy;};
 function show(value){if(value.availability)availability=value.availability;saved=value;if(value.mode!=='single_writer'&&input.options&&![...input.options].some(o=>o.value===value.mode)){const o=document.createElement('option');o.value=value.mode;o.textContent=label(value.mode);o.disabled=true;input.append(o);}input.value=value.mode;input.hidden=value.mode==='single_writer';$('writing-mode-label').hidden=input.hidden;$('writing-mode-save').hidden=input.hidden;$('writing-mode-cancel').hidden=input.hidden;dirty=false;pending=null;conflict=false;status.textContent=(availability?.[value.mode]?.status==='unavailable'?'目前設定':'目前使用')+label(value.mode)+(value.revision?' · 設定第 '+value.revision+' 版':'');for(const mode of ['materials','single_writer'])if(availability?.[mode]?.status==='unavailable')status.textContent+='；'+label(mode)+'的寫作 Skill '+(availability[mode].code==='WRITING_SKILL_CHANGED'?'版本不符':'未安裝或不可用')+'，不能生成或保存此模式；可切回現行模式。';onMode(value.mode,runId);controls();}
 async function read(){
  if(!runId||busy)return;const epoch=serial,current=runId;busy=true;controls();
  try{const value=await request('writingMode',{runId:current});if(epoch!==serial)return;
   if(pending){if(value.operationId===pending.operationId){show(value);status.textContent='已確認保存：'+label(value.mode)+'。下一個新回合生效。';}
    else if(value.revision===pending.expectedRevision){pending=null;saved=value;status.textContent='未查到這次保存；草稿保留，可再次保存。';}
    else{pending=null;conflict=true;saved=value;status.textContent='其他視窗已更新模式；草稿保留，請放棄草稿並重新讀取後再選。';}}
   else show(value);
  }catch(error){if(epoch===serial)status.textContent='讀取失敗：'+error.message;}
  finally{if(epoch===serial){busy=false;controls();}}
 }
 input.addEventListener('change',()=>{dirty=input.value!==(saved?.mode??'current');controls();});
 $('writing-mode-cancel').addEventListener('click',()=>{if(saved&&!pending)show(saved);});
 // The button explicitly says it discards an unsaved selection; no native modal.
 $('writing-mode-reload').addEventListener('click',()=>void read());
 $('writing-mode-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('writing-mode-save').disabled)return;const epoch=serial;pending={runId,mode:input.value,expectedRevision:saved.revision,operationId:makeId()};busy=true;controls();status.textContent='正在保存寫作方式…';
  try{const value=await request('writingModeSave',pending);if(epoch!==serial)return;show(value);status.textContent='已保存：'+label(value.mode)+'。下一個新回合生效；原請求重試保持原模式。';}
  catch(error){if(epoch!==serial)return;if(error.code==='VERSION_CONFLICT'){pending=null;conflict=true;status.textContent='未保存：模式版本已改變，原選擇仍保留。請放棄草稿並重新讀取。';}
   else if(['WRITING_SKILL_UNAVAILABLE','WRITING_SKILL_CHANGED'].includes(error.code)){pending=null;status.textContent=error.code==='WRITING_SKILL_UNAVAILABLE'?'未保存：此模式的寫作 Skill 尚未安裝或無法讀取。請使用現行模式，或安裝對應 Skill 後再試。':'未保存：此模式的寫作 Skill 與預期版本不符。請使用現行模式，或重新安裝正確版本。';}
   else if(['CONNECTION_UNKNOWN','WRITING_MODE_SAVE_UNKNOWN','AbortError','TimeoutError'].includes(error.code??error.name))status.textContent='保存結果尚未確認，請重新讀取原操作結果。';
   else{pending=null;status.textContent='未保存：'+error.message;}}
  finally{if(epoch===serial){busy=false;controls();}}
 });
 controls();return {select(next){if(next===runId)return;serial++;runId=next;saved=null;availability=null;busy=false;dirty=false;pending=null;conflict=false;input.value='single_writer';status.textContent=next?'正在讀取本局寫作方式…':'請先選一局故事。';controls();if(next)void read();}};
}
