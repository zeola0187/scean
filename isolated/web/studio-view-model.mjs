export const studioUploadLimit=512*1024;
export function validateStudioFile(file,type){
  if(!file||!Number.isFinite(file.size)||file.size<=0)throw new Error('請選擇非空白的官方匯出檔。');
  if(file.size>studioUploadLimit)throw new Error('單一匯出檔超過 512 KiB；請在來源另行匯出較小的 JSON 工作副本。');
  if(!(type==='card'?/\.(json|png)$/i:/\.json$/i).test(file.name??''))throw new Error(type==='card'?'角色卡僅接受 JSON 或 PNG 匯出檔。':'世界書僅接受 JSON 匯出檔。');
  return true;
}
export function studioCardData(document){return document?.card?.data??document?.card??{};}
export function studioSavedRoster(document){
  const roster=document?.roster??studioCardData(document).extensions?.scean?.characters;
  return Array.isArray(roster)?structuredClone(roster):[];
}
export function validateStudioRoster(roster){
  if(!Array.isArray(roster)||!roster.length||roster.length>100)throw new Error('請明確建立 1 至 100 位角色；不可從整張多角色卡自動猜測名冊。');
  const ids=new Set();
  for(const [index,actor] of roster.entries()){
    const label=`角色 ${index+1}`;
    if(!actor||typeof actor!=='object'||Array.isArray(actor)||typeof actor.id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(actor.id)||actor.id==='player'||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(actor.id))throw new Error(`${label} 的穩定 ID 須使用英數字、底線或連字號，且不可使用保留名稱。`);
    if(ids.has(actor.id))throw new Error(`穩定 ID「${actor.id}」重複；每位角色必須獨立。`);ids.add(actor.id);
    if(typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>500)throw new Error(`${label} 需要明確名稱（最多 500 字）。`);
    if(typeof actor.description!=='string'||!actor.description.trim()||actor.description.length>100000)throw new Error(`${label} 需要完整的角色專屬背景；無資料時請明確寫出未知，不會由系統補猜。`);
    if(actor.identity!==undefined){
      const identity=actor.identity;
      if(!identity||typeof identity!=='object'||!['user-explicit','card-explicit'].includes(identity.source)||Object.keys(identity).some(key=>!['gender','pronouns','source'].includes(key))||!['gender','pronouns'].some(key=>typeof identity[key]==='string'&&identity[key].trim()))throw new Error(`${label} 的性別／代詞須連同明確來源保存；留白代表未指定。`);
      for(const key of ['gender','pronouns'])if(identity[key]!==undefined&&(typeof identity[key]!=='string'||!identity[key].trim()||identity[key].length>500))throw new Error(`${label} 的身份欄位格式不正確。`);
    }
  }
  return structuredClone(roster);
}
export function studioSingleRoleDraft(document){
  const data=studioCardData(document);
  return [{id:'card-main',name:data.name??'',description:data.description??''}];
}
export function studioOpenings(document){
  const data=studioCardData(document);
  return [{index:0,title:'主開場',text:data.first_mes??''},...(Array.isArray(data.alternate_greetings)?data.alternate_greetings:[]).map((text,index)=>({index:index+1,title:`替代開場 ${index+1}`,text}))];
}
export function studioHandoffAllowed(document,{singleCharacter=false,dirty=false,busy=false}={}){
  if(!(document?.id&&document.type==='card'&&document.revision!==undefined&&!dirty&&!busy))return false;
  try{validateStudioRoster(studioSavedRoster(document));return true;}catch{return false;}
}
export function studioHandoffPayload(document,{singleCharacter=false,worldbook,openingIndex=0}={}){
  if(!studioHandoffAllowed(document))throw new Error('此卡缺少合法的已保存名冊；請先明確建立並保存角色名冊為新版本。');
  if(!Number.isInteger(openingIndex)||!studioOpenings(document).some(o=>o.index===openingIndex))throw new Error('所選開場不屬於目前保存版本。');
  return {documentId:document.id,expectedRevision:document.revision,presetId:'scean-default',openingIndex,...(worldbook?{worldbookDocumentId:worldbook.id,worldbookRevision:worldbook.revision}:{})};
}


export function studioBlueprintDraft(document){
  const scean=studioCardData(document).extensions?.scean??{},b=scean.stateBlueprint;
  return {id:b?.id??'studio-state',version:b?.version??1,extensionPolicy:b?.extensionPolicy??'allow',variables:structuredClone(b?.variables??[]).map(variable=>{
    const initial=scean.initialState?.values?.find(v=>v.scope===variable.scope&&v.characterId===variable.characterId&&v.category===variable.category&&v.key===variable.key);
    return {...variable,initialText:initial?JSON.stringify(initial.value):'',initialSource:initial?.source};
  })};
}
export function studioBlueprintPayload(draft,characters,source={id:'studio-human-editor',version:1}){
  if(!draft||!Array.isArray(draft.variables)||draft.variables.length>200)throw new Error('狀態變數最多 200 項。');
  const safe=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)&&! /^(?:constructor|prototype|__proto__|con|prn|aux|nul)$/i.test(value);
  if(!safe(draft.id)||!Number.isSafeInteger(draft.version)||draft.version<1)throw new Error('藍圖需要穩定 ID 與正整數版本。');
  if(!['allow','deny'].includes(draft.extensionPolicy))throw new Error('請選擇動態狀態擴充政策。');
  const ids=new Set(characters.map(c=>c.id)),seen=new Set(),variables=[],values=[];
  for(const row of draft.variables){
    const {initialText,initialSource,...variable}=structuredClone(row);
    const key=[variable.scope,variable.characterId??'',variable.category,variable.key].join(':');
    if(!safe(variable.key)||seen.has(key))throw new Error('狀態 key 必須合法且同一範圍內不可重複。');seen.add(key);
    if(typeof variable.displayName!=='string'||!variable.displayName.trim())throw new Error('請填寫狀態顯示名稱。');
    if(!['world','character'].includes(variable.scope)||variable.scope==='character'&&!ids.has(variable.characterId))throw new Error('角色範圍需要名冊中的穩定角色 ID。');
    if(variable.scope==='world')delete variable.characterId;
    if(!['locations','tasks','resources','equipment','time','effects','facts'].includes(variable.category))throw new Error('狀態分類不合法。');
    if(!['number','string','boolean','enum','json'].includes(variable.type))throw new Error('請選擇合法型別。');
    if(!['public','restricted'].includes(variable.visibility))throw new Error('請選擇可見範圍。');
    if(variable.unit!==undefined&&(variable.type!=='number'||typeof variable.unit!=='string'||!variable.unit.trim()||variable.unit.length>100))throw new Error('單位需為短文字。');
    if(variable.type==='enum'&&(!Array.isArray(variable.enumValues)||!variable.enumValues.length||variable.enumValues.some(v=>typeof v!=='string'||!v)||new Set(variable.enumValues).size!==variable.enumValues.length))throw new Error('enum 需要至少一個非空選項。');
    for(const k of ['min','max'])if(variable[k]!==undefined&&(variable.type!=='number'||!Number.isFinite(variable[k])))throw new Error('範圍必須是有限數字。');
    if(variable.min!==undefined&&variable.max!==undefined&&variable.min>variable.max)throw new Error('最小值不可大於最大值。');
    if(variable.type!=='enum'&&variable.enumValues!==undefined)throw new Error('只有 enum 型別可填寫選項。');
    if(variable.requiredFields!==undefined&&(variable.type!=='json'||!Array.isArray(variable.requiredFields)))throw new Error('必要子欄位僅適用 JSON 型別。');
    if(variable.category==='tasks'&&variable.type!=='json')throw new Error('任務分類需使用 JSON 型別。');
    variables.push(variable);
    if(initialText?.trim()){
      let value;try{value=JSON.parse(initialText);}catch{throw new Error('初值需為合法 JSON；文字請使用雙引號。');}
      if(variable.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||variable.min!==undefined&&value<variable.min||variable.max!==undefined&&value>variable.max))throw new Error('數字初值不符合型別或範圍。');
      if(variable.type==='string'&&typeof value!=='string'||variable.type==='boolean'&&typeof value!=='boolean'||variable.type==='enum'&&!variable.enumValues.includes(value))throw new Error('初值不符合宣告型別或 enum。');
      if(variable.category==='tasks'&&(!value||typeof value!=='object'||Array.isArray(value)||typeof value.status!=='string'||!value.status.trim()||!Array.isArray(value.assignees)||value.assignees.some(id=>id!=='player'&&!ids.has(id))||typeof value.progress!=='number'||value.progress<0||value.progress>100))throw new Error('任務初值需要 status、合法 assignees 與 0–100 progress。');
      for(const field of variable.requiredFields??[])if(!value||!Object.hasOwn(value,field))throw new Error('初值缺少必要子欄位：'+field);
      values.push({scope:variable.scope,...variable.characterId?{characterId:variable.characterId}:{},category:variable.category,key:variable.key,value,source:initialSource??source});
    }
  }
  return {stateBlueprint:{schemaVersion:1,id:draft.id,version:draft.version,extensionPolicy:draft.extensionPolicy,variables},initialState:{schemaVersion:1,blueprintId:draft.id,blueprintVersion:draft.version,values}};
}
