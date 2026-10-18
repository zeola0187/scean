import {validateStudioFile,studioCardData,studioOpenings,studioSavedRoster,studioSingleRoleDraft,validateStudioRoster,studioHandoffAllowed,studioHandoffPayload,studioBlueprintDraft,studioBlueprintPayload} from './studio-view-model.mjs';
import {valueText} from './view-model.mjs';

export function mountStudio({api,onRunCreated}){
  const $=id=>document.getElementById(id),dialog=$('studio-dialog');
  const state={pageId:crypto.randomUUID(),claim:null,busy:false,items:[],document:null,roster:[],blueprint:studioBlueprintDraft(null),handoff:null,releasePromise:null,names:new Map()};
  const option=(select,value,label)=>{const item=document.createElement('option');item.value=String(value);item.textContent=label;select.append(item);};
  const rosterDirty=()=>!!state.document&&JSON.stringify(state.roster)!==JSON.stringify(studioSavedRoster(state.document));
  const cardDirty=()=>!!state.document&&($('studio-description').value!==(studioCardData(state.document).description??'')||$('studio-opening').value!==(studioCardData(state.document).first_mes??''));
  const blueprintDirty=()=>!!state.document&&JSON.stringify(state.blueprint)!==JSON.stringify(studioBlueprintDraft(state.document));
  const dirty=()=>cardDirty()||rosterDirty()||blueprintDirty();
  const status=text=>{$('studio-status').textContent=text;};
  const error=value=>{$('studio-error').textContent=value?`${value.message??'操作未完成。'}${value.code?`（${value.code}）`:''}`:'';$('studio-error').hidden=!value;};
  function controls(){
    const enabled=!!state.claim&&!state.busy,hasCard=!!state.document;
    for(const id of ['studio-card','studio-book','studio-refresh','studio-card-file','studio-book-file','studio-single-role'])$(id).disabled=!enabled;
    $('studio-import-card').disabled=!enabled||!$('studio-card-file').files?.length;
    $('studio-import-book').disabled=!enabled||!$('studio-book-file').files?.length;
    $('studio-description').disabled=!enabled||!hasCard;$('studio-opening').disabled=!enabled||!hasCard;
    $('studio-opening-choice').disabled=!enabled||!hasCard||dirty();
    $('studio-save').disabled=!enabled||!hasCard||!cardDirty()||rosterDirty()||blueprintDirty();
    $('studio-export').disabled=!enabled||!hasCard;
    $('studio-handoff').disabled=!enabled||!studioHandoffAllowed(state.document,{dirty:dirty(),busy:state.busy});
    let rosterError=null;try{validateStudioRoster(state.roster);}catch(e){rosterError=e;}
    $('studio-roster-error').textContent=hasCard&&rosterError?rosterError.message:'';$('studio-roster-error').hidden=!hasCard||!rosterError;
    $('studio-roster-add').disabled=!enabled||!hasCard||state.roster.length>=100;
    $('studio-roster-single').disabled=!enabled||!hasCard||!$('studio-single-role').checked||state.roster.length>0;
    $('studio-roster-save').disabled=!enabled||!hasCard||!rosterDirty()||!!rosterError||blueprintDirty();
    for(const input of $('studio-roster').querySelectorAll('input,textarea,select,button'))input.disabled=!enabled;
    let blueprintError=null,payload;try{payload=studioBlueprintPayload(state.blueprint,state.roster,{id:'studio-human-editor',version:(state.document?.revision??0)+1});}catch(e){blueprintError=e;}
    $('studio-blueprint-error').textContent=hasCard&&blueprintError?blueprintError.message:'';$('studio-blueprint-error').hidden=!hasCard||!blueprintError;
    $('studio-blueprint-preview').textContent=payload?JSON.stringify(payload.initialState,null,2):'請先修正變數欄位。';
    $('studio-blueprint-add').disabled=!enabled||!hasCard||state.blueprint.variables.length>=200;
    $('studio-blueprint-save').disabled=!enabled||!hasCard||!blueprintDirty()||!!blueprintError||!!rosterError;
    for(const input of $('studio-blueprint-section').querySelectorAll('input,textarea,select'))input.disabled=!enabled||!hasCard;
    for(const input of $('studio-blueprint-variables').querySelectorAll('button'))input.disabled=!enabled||!hasCard;
    $('studio-inspect-run').disabled=!enabled||!state.handoff;
    $('studio-release').disabled=!enabled;
    $('studio-open').disabled=state.busy;
    $('studio-reacquire').hidden=!!state.claim;$('studio-reacquire').disabled=state.busy;
  }
  async function work(fn){
    if(state.busy)return;
    state.busy=true;error(null);controls();
    try{await fn();}catch(e){if(/STALE_LEASE|STALE_WORKSPACE|LEASE_EXPIRED|LEASE_REQUIRED|CLAIM_INVALID/.test(e.code??''))state.claim=null;error(e);status('操作未完成；尚未取得成功結果。未保存的編輯仍留在畫面。');}
    finally{state.busy=false;controls();}
  }
  const request=(action,payload={})=>api(`studio.${action}`,{claim:state.claim,...payload});
  async function acquire(){await state.releasePromise?.catch(()=>{});if(!state.claim){const result=await api('studio.acquire',{pageId:state.pageId});state.claim=result.claim;}}
  async function release(){
    const claim=state.claim;if(!claim)return;
    state.claim=null;controls();
    const pending=api('studio.release',{claim});state.releasePromise=pending;
    try{await pending;}finally{if(state.releasePromise===pending)state.releasePromise=null;}
  }
  function renderRoster(){
    $('studio-roster').replaceChildren();
    const create=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
    for(const [index,actor] of state.roster.entries()){
      if(!actor||typeof actor!=='object'||Array.isArray(actor)){
        const invalid=create('fieldset'),note=create('p',`來源名冊第 ${index+1} 列不是有效角色資料；請明確移除此列並重新新增。`),remove=create('button','移除無效角色列');remove.type='button';remove.dataset.rosterRemove=String(index);remove.addEventListener('click',()=>{state.roster.splice(index,1);renderRoster();controls();});invalid.append(note,remove);$('studio-roster').append(invalid);continue;
      }
      const row=create('fieldset');row.dataset.rosterIndex=String(index);const legend=create('legend',actor.name||`角色 ${index+1}`);row.append(legend);
      const field=(key,label,value,{tag='input',rows=3,maxLength=500}={})=>{
        const wrapper=create('label',label),input=create(tag);input.dataset.rosterField=key;input.id=`studio-roster-${index}-${key}`;input.value=value??'';input.maxLength=maxLength;if(tag==='textarea')input.rows=rows;
        wrapper.htmlFor=input.id;wrapper.append(input);row.append(wrapper);return input;
      };
      const mark=()=>{controls();status('名冊有未保存的修改；請使用「保存名冊與卡片為新版本」後再交接。');};
      for(const [key,label,settings] of [['id','穩定 ID（用於記憶與狀態歸屬）',{maxLength:128}],['name','角色名稱',{}],['description','完整角色專屬背景',{tag:'textarea',rows:5,maxLength:100000}]]){
        const input=field(key,label,actor[key],settings);input.addEventListener('input',()=>{actor[key]=input.value;if(key==='name')legend.textContent=input.value||`角色 ${index+1}`;mark();});
      }
      const gender=field('gender','性別（未指定可留白）',actor.identity?.gender);
      const pronouns=field('pronouns','代詞（未指定可留白）',actor.identity?.pronouns);
      const sourceLabel=create('label','身份資料來源'),source=create('select');source.dataset.rosterField='identity-source';source.id=`studio-roster-${index}-identity-source`;sourceLabel.htmlFor=source.id;
      for(const [value,label] of [['','未指定身份'],['card-explicit','原卡明文記載'],['user-explicit','我明確提供／修正']])option(source,value,label);
      source.value=actor.identity?.source??'';sourceLabel.append(source);row.append(sourceLabel);
      const identityChanged=()=>{const next={...(gender.value.trim()?{gender:gender.value}:{}),...(pronouns.value.trim()?{pronouns:pronouns.value}:{})};if(Object.keys(next).length)actor.identity={...next,source:source.value};else delete actor.identity;mark();};
      gender.addEventListener('input',identityChanged);pronouns.addEventListener('input',identityChanged);source.addEventListener('change',identityChanged);
      if(actor.relationships===undefined||typeof actor.relationships==='string'){
        const relationships=field('relationships','關係備註（選填）',actor.relationships,{tag:'textarea',maxLength:100000});relationships.addEventListener('input',()=>{if(relationships.value)actor.relationships=relationships.value;else delete actor.relationships;mark();});
      }else{
        const note=create('p','既有結構化關係原樣保留：'),content=create('p',valueText(actor.relationships));content.className='roster-relationships';row.append(note,content);
      }
      const remove=create('button','移除此角色草稿');remove.type='button';remove.className='quiet';remove.dataset.rosterRemove=String(index);remove.addEventListener('click',()=>{state.roster.splice(index,1);renderRoster();mark();});row.append(remove);
      $('studio-roster').append(row);
    }
    $('studio-roster-source').textContent=state.document?`${studioSavedRoster(state.document).length} 位已保存角色 · 來源：${state.document.rosterSource??'卡片明確 extensions 名冊'}。目前草稿 ${state.roster.length} 位。`:'尚未選卡。';
  }
  function renderBlueprint(){
    $('studio-blueprint-id').value=state.blueprint.id;$('studio-blueprint-version').value=state.blueprint.version;$('studio-blueprint-policy').value=state.blueprint.extensionPolicy;
    const container=$('studio-blueprint-variables');container.replaceChildren();
    const create=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    for(const [index,row] of state.blueprint.variables.entries()){
      const group=create('fieldset');group.dataset.blueprintIndex=String(index);group.append(create('legend',`狀態 ${index+1}`));
      const mark=()=>{controls();status('狀態藍圖有未保存修改；請保存新版本後另開 Run。');};
      const field=(key,label,value,{choices,type='text',textarea=false}={})=>{
        const wrapper=create('label',label),input=create(choices?'select':textarea?'textarea':'input');input.id=`studio-blueprint-${index}-${key}`;input.dataset.blueprintField=key;wrapper.htmlFor=input.id;
        if(choices)for(const [v,l] of choices)option(input,v,l);else if(!textarea)input.type=type;
        input.value=value??'';wrapper.append(input);group.append(wrapper);return input;
      };
      for(const [key,label] of [['key','穩定 key'],['displayName','顯示名稱'],['characterId','角色 ID（僅角色範圍）'],['unit','單位（選填）'],['derivedDescription','衍生值說明（只讀文字，不執行公式）']]){
        const input=field(key,label,row[key]);input.addEventListener('input',()=>{if(input.value||['key','displayName'].includes(key))row[key]=input.value;else delete row[key];mark();});
      }
      for(const [key,label,choices] of [
        ['scope','範圍',[['world','世界'],['character','角色']]],
        ['category','分類',[['locations','地點'],['tasks','任務'],['resources','資源'],['equipment','設備'],['time','時間'],['effects','效果'],['facts','資訊']]],
        ['type','型別',['number','string','boolean','enum','json'].map(v=>[v,v])],
        ['visibility','可見範圍',[['public','公開'],['restricted','受限（不在一般介面顯示）']]]]){
        const input=field(key,label,row[key],{choices});input.addEventListener('change',()=>{row[key]=input.value;if(key==='scope'&&input.value==='world'){delete row.characterId;group.querySelector('[data-blueprint-field="characterId"]').value='';}mark();});
      }
      for(const [key,label] of [['min','最小值（數字）'],['max','最大值（數字）']]){
        const input=field(key,label,row[key],{type:'number'});input.step='any';input.addEventListener('input',()=>{if(input.value==='')delete row[key];else row[key]=Number(input.value);mark();});
      }
      for(const [key,label] of [['enumValues','enum 選項（每行一個）'],['requiredFields','必要 JSON 子欄位（每行一個）']]){
        const input=field(key,label,(row[key]??[]).join('\n'),{textarea:true});input.addEventListener('input',()=>{const entries=input.value.split('\n').map(v=>v.trim()).filter(Boolean);if(entries.length)row[key]=entries;else delete row[key];mark();});
      }
      const readOnly=field('readOnly','唯讀',null,{choices:[['false','否'],['true','是']]});readOnly.value=String(row.readOnly??false);readOnly.addEventListener('change',()=>{row.readOnly=readOnly.value==='true';mark();});
      const initial=field('initial','初值 JSON（留白＝未知；文字需雙引號）',row.initialText,{textarea:true});initial.addEventListener('input',()=>{row.initialText=initial.value;delete row.initialSource;mark();});
      const remove=create('button','移除此狀態變數');remove.type='button';remove.dataset.blueprintRemove=String(index);remove.addEventListener('click',()=>{state.blueprint.variables.splice(index,1);renderBlueprint();mark();});group.append(remove);container.append(group);
    }
  }
  async function readCard(id){
    state.document=id?await request('read',{documentId:id}):null;
    const data=studioCardData(state.document);
    state.roster=studioSavedRoster(state.document);renderRoster();state.blueprint=studioBlueprintDraft(state.document);renderBlueprint();
    if(state.document&&data.name){state.names.set(state.document.id,data.name);const selectedOption=Array.from($('studio-card').options).find(item=>item.value===state.document.id);if(selectedOption)selectedOption.textContent=`${data.name} · 版本 ${state.document.revision}`;}
    $('studio-description').value=data.description??'';$('studio-opening').value=data.first_mes??'';
    $('studio-single-role').checked=false;$('studio-opening-choice').replaceChildren();
    for(const item of studioOpenings(state.document))option($('studio-opening-choice'),item.index,item.title);
    $('studio-opening-preview').textContent=studioOpenings(state.document)[0]?.text??'';
    $('studio-version').textContent=state.document?`${data.name??state.document.id} · 已保存版本 ${state.document.revision} · ${studioHandoffAllowed(state.document)?'卡片已有合法明確角色名冊':'請建立或修正角色名冊並保存後再交接'}`:'選擇一張已匯入角色卡。';
  }
  async function list(preferred){
    const result=await request('list');state.items=result.items??[];
    const previous=preferred??$('studio-card').value,book=$('studio-book').value;
    $('studio-card').replaceChildren();option($('studio-card'),'','選擇工作副本中的已保存卡');
    $('studio-book').replaceChildren();option($('studio-book'),'','使用卡片內嵌世界書（若無則為空）');
    for(const item of state.items){const label=`${item.name??state.names.get(item.id)??item.source?.fileName??item.id} · 版本 ${item.revision}`;if(item.type==='card')option($('studio-card'),item.id,label);if(item.type==='worldbook')option($('studio-book'),item.id,label);}
    if(state.items.some(item=>item.id===previous&&item.type==='card'))$('studio-card').value=previous;
    if(state.items.some(item=>item.id===book&&item.type==='worldbook'))$('studio-book').value=book;
    await readCard($('studio-card').value);
  }
  async function importFile(type,input){
    const file=input.files?.[0];validateStudioFile(file,type);
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('無法讀取所選匯出檔。'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
    const before=new Set(state.items.map(item=>item.id));
    const result=await request('import',{fileName:file.name,type,base64});
    await list();
    const importedId=result.id??result.documentId??result.document?.id??state.items.find(item=>item.type===type&&!before.has(item.id))?.id;
    if(importedId)state.names.set(importedId,file.name);
    if(type==='card'&&importedId){$('studio-card').value=importedId;await readCard(importedId);}
    if(type==='worldbook'&&importedId)$('studio-book').value=importedId;
    input.value='';status('匯出檔已經獨立 Studio 匯入流程保存；請核對版本與內容後交接。');
  }
  $('studio-open').addEventListener('click',()=>{dialog.showModal();work(async()=>{await acquire();await list();if(state.handoff){const attached=await request('attach',{runId:state.handoff.runId,binding:state.handoff.binding});state.handoff={...state.handoff,...attached};}status('已取得此工作副本的操作租約。');});});
  const allowClose=()=>!dirty()||window.confirm('此工作副本尚有未保存的文字或名冊修改。確定離開並捨棄這些修改？');
  $('studio-close').addEventListener('click',()=>{if(allowClose())dialog.close();});
  dialog.addEventListener('cancel',event=>{if(!allowClose())event.preventDefault();});
  dialog.addEventListener('close',()=>{release().catch(error);});
  $('studio-refresh').addEventListener('click',()=>{if(allowClose())work(()=>list());});
  $('studio-card').addEventListener('change',()=>{if(allowClose())work(()=>readCard($('studio-card').value));else $('studio-card').value=state.document?.id??'';});
  $('studio-card-file').addEventListener('change',controls);$('studio-book-file').addEventListener('change',controls);
  $('studio-import-card').addEventListener('click',()=>{if(allowClose())work(()=>importFile('card',$('studio-card-file')));});
  $('studio-import-book').addEventListener('click',()=>{if(allowClose())work(()=>importFile('worldbook',$('studio-book-file')));});
  for(const id of ['studio-description','studio-opening'])$(id).addEventListener('input',()=>{controls();status(dirty()?'有尚未保存的修改；先保存新版本後才能交接。':'內容與已保存版本一致。');});
  $('studio-single-role').addEventListener('change',controls);
  $('studio-roster-add').addEventListener('click',()=>{if(!state.document||state.busy)return;state.roster.push({id:'',name:'',description:''});renderRoster();controls();$('studio-roster').lastElementChild?.querySelector('input')?.focus();});
  $('studio-roster-single').addEventListener('click',()=>{if(!state.document||state.busy||state.roster.length||!$('studio-single-role').checked)return;state.roster=studioSingleRoleDraft(state.document);renderRoster();controls();status('已明確建立單一角色草稿；請核對背景與穩定 ID，保存新版本後才能交接。');});
  $('studio-opening-choice').addEventListener('change',()=>{$('studio-opening-preview').textContent=studioOpenings(state.document).find(item=>item.index===Number($('studio-opening-choice').value))?.text??'';});
  $('studio-save').addEventListener('click',()=>work(async()=>{
    if(rosterDirty()||blueprintDirty())throw new Error('名冊也有修改，請改用「保存名冊與卡片為新版本」。');
    const id=state.document.id;
    await request('patch',{documentId:id,expectedRevision:state.document.revision,description:$('studio-description').value,firstMes:$('studio-opening').value});
    await list(id);status('修改已保存為新版本；既有 Run 的快照未變動。');
  }));
  $('studio-roster-save').addEventListener('click',()=>work(async()=>{
    const roster=validateStudioRoster(state.roster),id=state.document.id;
    const result=await request('patch',{documentId:id,expectedRevision:state.document.revision,description:$('studio-description').value,firstMes:$('studio-opening').value,roster,authorizeRosterSave:true,expectedScopeEpoch:state.claim.authoring_scope?.epoch});
    if(result.authoringClosed){state.claim=null;state.document=null;state.roster=[];renderRoster();$('studio-version').textContent=`已保存版本 ${result.revision}；操作入口已安全關閉。`;status('名冊與卡片已保存成功，但權限範圍還原未完成；請重新啟動隔離 Studio 入口後讀取此保存版本，不要重送保存。');return;}
    if(result.claim)state.claim=result.claim;
    await list(id);status('名冊與卡片文字已共同保存為新版本；既有 Run 的角色背景與快照保持不變。');
  }));
  for(const [id,key] of [['studio-blueprint-id','id'],['studio-blueprint-version','version'],['studio-blueprint-policy','extensionPolicy']])$(id).addEventListener('input',()=>{state.blueprint[key]=key==='version'?Number($(id).value):$(id).value;controls();});
  $('studio-blueprint-add').addEventListener('click',()=>{if(!state.document||state.busy)return;state.blueprint.variables.push({key:'',displayName:'',scope:'world',category:'resources',type:'number',visibility:'public',initialText:''});renderBlueprint();controls();});
  $('studio-blueprint-save').addEventListener('click',()=>work(async()=>{
    const roster=validateStudioRoster(state.roster),id=state.document.id;
    const payload=studioBlueprintPayload(state.blueprint,roster,{id:'studio-human-editor',version:state.document.revision+1});
    const result=await request('patch',{documentId:id,expectedRevision:state.document.revision,expectedScopeEpoch:state.claim.authoring_scope?.epoch,description:$('studio-description').value,firstMes:$('studio-opening').value,...payload,authorizeBlueprintSave:true,...rosterDirty()?{roster,authorizeRosterSave:true}:{}});
    if(result.authoringClosed){state.claim=null;state.document=null;state.roster=[];state.blueprint=studioBlueprintDraft(null);renderRoster();renderBlueprint();status(`已保存版本 ${result.revision}，權限還原未完成，操作入口已關閉。請重新啟動後讀取保存版本，不要重送。`);return;}
    if(result.claim)state.claim=result.claim;await list(id);status('狀態藍圖、初值與卡片已保存為新版本；既有 Run 保留原始快照與狀態。');
  }));
  $('studio-export').addEventListener('click',()=>work(async()=>{
    const result=await request('export',{documentId:state.document.id,expectedRevision:state.document.revision,fileName:`scean-card-revision-${state.document.revision}.json`});
    const bytes=Uint8Array.from(atob(result.base64),character=>character.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:result.mimeType??'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=result.fileName;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('已透過 Studio 原匯出流程下載已保存版本；未保存的編輯不會混入此檔。');
  }));
  $('studio-handoff').addEventListener('click',()=>work(async()=>{
    if(dirty())throw new Error('請先保存修改，再交接已保存版本。');
    const worldbook=state.items.find(item=>item.id===$('studio-book').value&&item.type==='worldbook');
    const payload=studioHandoffPayload(state.document,{worldbook,openingIndex:Number($('studio-opening-choice').value)});
    const result=await request('handoff',payload);state.handoff=result;
    $('studio-run-section').hidden=false;$('studio-run-label').textContent=`Run ${result.runId} · 卡片保存版本 ${payload.expectedRevision} · Preset：SCEAN 預設`;
    $('studio-inspection').textContent='尚未讀取。按「查閱 Run 狀態與記憶」使用此工作副本的唯讀交接權限。';
    status('已建立固定快照的新 Run。');await onRunCreated(result);dialog.close();
  }));
  $('studio-inspect-run').addEventListener('click',()=>work(async()=>{
    const result=await request('inspect',{runId:state.handoff.runId,binding:state.handoff.binding});
    $('studio-inspection').textContent=JSON.stringify(result,null,2);$('studio-inspection').parentElement.open=true;status('已透過合法唯讀交接權限查詢 Run。');
  }));
  $('studio-release').addEventListener('click',()=>work(async()=>{
    if(!allowClose())return;await release();status('工作副本的操作租約已結束。舞台的 Run 不受影響。');dialog.close();
  }));
  $('studio-reacquire').addEventListener('click',()=>work(async()=>{
    await acquire();
    if(state.handoff){const attached=await request('attach',{runId:state.handoff.runId,binding:state.handoff.binding});state.handoff={...state.handoff,...attached};}
    status('操作租約已恢復，未保存文字仍保留；保存時將核對原本的版本。');
  }));
  setInterval(()=>{
    if(!dialog.open||!state.claim||state.busy)return;
    work(async()=>{const renewed=await request('renew');state.claim=renewed.claim;});
  },30000);
  window.addEventListener('beforeunload',event=>{if(dialog.open&&dirty()){event.preventDefault();event.returnValue='';}});
  controls();
}
