// One editorial slot: a complete selected style Skill OR custom text.
export function mountProseStyle({request,secureContext=true,document=globalThis.document,makeId=()=>globalThis.crypto.randomUUID(),confirmDiscard=message=>globalThis.confirm(message)}){
 const $=id=>document.getElementById(id),input=$('prose-style-input'),select=$('prose-style-select'),status=$('prose-style-status'),file=$('prose-style-import-file');
 let runId=null,serial=0,saved=null,busy=false,dirty=false,pending=null,conflict=false,draftSkill=null,library={revision:0,styles:[]},importPending=null;
 const controls=()=>{const locked=!runId||busy||!saved||!!pending||!!importPending;input.disabled=locked;select.disabled=locked;$('prose-style-save').disabled=locked||!dirty||!secureContext||conflict;$('prose-style-clear').disabled=locked;$('prose-style-cancel').disabled=locked;$('prose-style-reload').disabled=!runId||busy;file.disabled=locked||!secureContext||!Number.isSafeInteger(library.revision);$('prose-style-import').disabled=file.disabled;};
 const ref=row=>row?{id:row.id,label:row.label,version:row.version,sha256:row.sha256}:null;
 const sameRef=(a,b)=>!a&&!b||!!a&&!!b&&['id','label','version','sha256'].every(k=>a[k]===b[k]);
 const updateDirty=()=>{dirty=input.value!==(saved?.text??'')||!sameRef(draftSkill,saved?.skill);controls();};
 function options(value){if(!document.createElement||!select.replaceChildren)return;const rows=[['preset','沿用卡片／Preset'],['custom','自訂文風'],...(library.styles??[]).map(s=>[s.id,s.label])];if(value&&!rows.some(([id])=>id===value))rows.push([value,'原選風格（未安裝或已變更）']);const nodes=rows.map(([id,label])=>{const o=document.createElement('option');o.value=id;o.textContent=label;if(id===value&&!['preset','custom'].includes(id)&&!library.styles.some(s=>s.id===id))o.disabled=true;return o;});select.replaceChildren(...nodes);}
 const describe=()=>saved?.skill?`目前使用：${saved.skill.label} · 第 ${saved.revision} 版`:saved?.text?`目前使用本局自訂文風 · 第 ${saved.revision} 版`:'目前沿用卡片與 Preset 文風';
 function show(value){if(value.library)library=value.library;saved=value;input.value=value.text??'';draftSkill=value.skill??null;const choice=draftSkill?.id??(value.text?'custom':'preset');options(choice);select.value=choice;dirty=false;pending=null;conflict=false;status.textContent=describe();if(value.selectionAvailability?.status==='unavailable')status.textContent+='；所選 Skill 未安裝、已變更或無法讀取，新回合無法使用。可重新選擇，或明確改為自訂後保存。';if(library.status==='unavailable')status.textContent+='；本機文風包無法讀取。';controls();}
 async function read({discard=false}={}){
  if(!runId||busy)return;if(discard&&dirty&&!pending&&!confirmDiscard('重新讀取會放棄未保存的文風草稿。要繼續嗎？'))return;
  const epoch=serial,current=runId;busy=true;controls();
  try{const value=await request('proseStyle',{runId:current});if(epoch!==serial)return;
   if(importPending){const imported=value.library?.operationId===importPending.operationId;importPending=null;show(value);status.textContent=imported?'已確認文風包匯入；選擇並保存後才套用。':'已重新讀取文風包；請確認選項後再操作。';}
   else if(pending){if(value.operationId===pending.operationId){show(value);status.textContent='已確認保存。下一個新回合採用；舊請求重試仍沿用原設定。';}
    else if(value.revision===pending.expectedRevision){pending=null;saved=value;if(value.library)library=value.library;status.textContent='未查到這次保存；草稿保留，可再次保存。';}
    else{pending=null;conflict=true;saved=value;status.textContent='其他視窗已更新文風；草稿保留。請先複製草稿，再重新讀取。';}}
   else show(value);
  }catch(error){if(epoch===serial)status.textContent='讀取失敗：'+error.message;}
  finally{if(epoch===serial){busy=false;controls();}}
 }
 input.addEventListener('input',()=>{draftSkill=null;select.value=input.value?'custom':'preset';updateDirty();status.textContent='自訂草稿；保存後才套用，不會再疊加原選風格。';});
 select.addEventListener('change',()=>{if(select.disabled)return;const row=library.styles?.find(s=>s.id===select.value);if(row){input.value=row.text;draftSkill=ref(row);status.textContent='已載入完整文風 Skill 草稿；保存後才套用。';}else if(select.value==='preset'){input.value='';draftSkill=null;status.textContent='將沿用卡片與 Preset 文風；保存後才生效。';}else if(select.value==='custom'){draftSkill=null;status.textContent='已改為自訂草稿；可直接編輯並保存。';}updateDirty();});
 $('prose-style-clear').addEventListener('click',()=>{input.value='';draftSkill=null;select.value='preset';status.textContent='清空草稿；再保存才會還原卡片與 Preset 文風。';updateDirty();});
 $('prose-style-cancel').addEventListener('click',()=>{if(!pending&&saved)show(saved);});
 $('prose-style-reload').addEventListener('click',()=>void read({discard:true}));
 $('prose-style-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('prose-style-save').disabled)return;const epoch=serial;pending={runId,text:input.value,...(draftSkill?{skillId:draftSkill.id,skillHash:draftSkill.sha256}:{}),expectedRevision:saved.revision,operationId:makeId()};busy=true;controls();status.textContent='正在保存文風…';
  try{const value=await request('proseStyleSave',pending);if(epoch!==serial)return;show(value);status.textContent='已保存。下一個新回合採用；正在生成與同一請求重試保留原設定。';}
  catch(error){if(epoch!==serial)return;if(error.code==='VERSION_CONFLICT'){pending=null;conflict=true;status.textContent='未保存：其他視窗已更新文風，草稿仍保留。請先複製草稿，再重新讀取。';}
   else if(['CONNECTION_UNKNOWN','PROSE_STYLE_SAVE_UNKNOWN','AbortError','TimeoutError'].includes(error.code??error.name))status.textContent='保存結果尚未確認。請重新讀取確認，避免重複保存。';
   else{pending=null;status.textContent='未保存：'+(['STYLE_SKILL_UNAVAILABLE','STYLE_SKILL_CHANGED','STYLE_LIBRARY_CORRUPT'].includes(error.code)?'所選 Skill 未安裝、已變更或不可用；請重新選擇。':error.message);}}
  finally{if(epoch===serial){busy=false;controls();}}
 });
 $('prose-style-import').addEventListener('click',()=>{if(!file.disabled)file.click();});
 file.addEventListener('change',async()=>{
  if(file.disabled||!file.files?.[0])return;const selected=file.files[0],epoch=serial;if(selected.size>1024*1024){status.textContent='文風包過大，請選擇 1MiB 以內的 JSON 文風包。';file.value='';return;}
  busy=true;controls();status.textContent='正在匯入本機文風包…';
  try{const pack=JSON.parse(await selected.text());if(epoch!==serial)return;importPending={runId,pack,expectedRevision:library.revision,operationId:makeId()};const value=await request('writingStylesImport',importPending);if(epoch!==serial)return;library=value;importPending=null;const choice=select.value;options(choice);select.value=choice;status.textContent=`已匯入文風包；共 ${value.styles.length} 個可用風格。選擇並保存後才套用。`;}
  catch(error){if(epoch!==serial)return;if(['CONNECTION_UNKNOWN','STYLE_LIBRARY_SAVE_UNKNOWN','AbortError','TimeoutError'].includes(error.code??error.name))status.textContent='匯入結果尚未確認，請重新讀取後再操作。';else{importPending=null;status.textContent='未匯入：'+(error.code==='VERSION_CONFLICT'?'文風包已被其他視窗更新，請重新讀取。':'請選擇有效的 SCEAN JSON 文風包。');}}
  finally{if(epoch===serial){busy=false;file.value='';controls();}}
 });
 for(const [id,text] of [['prose-style-example-light','以輕快而自然的對話節奏推進，敘述簡潔，保留角色各自的語氣。'],['prose-style-example-quiet','以克制、清楚的文字描寫，減少形容詞，讓具體的動作與短暫沉默承載情緒。']])$(id).addEventListener('click',()=>{if(input.disabled)return;input.value=text;draftSkill=null;select.value='custom';updateDirty();input.focus();});
 controls();return {select(next){if(next===runId)return;serial++;runId=next;saved=null;pending=null;importPending=null;busy=false;dirty=false;conflict=false;draftSkill=null;library={revision:0,styles:[]};input.value='';options('preset');select.value='preset';status.textContent=next?'正在讀取本局文風…':'請先選一段故事。';controls();if(next)void read();}};
}
