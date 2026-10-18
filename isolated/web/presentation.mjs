// Additive v1 presentation preferences only. Never persist story or credentials.
export const presentationKey='scean.presentation.v1';
export function normalizePresentation(value){
  if(value?.schemaVersion!==undefined&&value.schemaVersion!==1)value=null;
  return {schemaVersion:1,theme:['light','dark','system'].includes(value?.theme)?value.theme:'system',readingSize:['normal','large'].includes(value?.readingSize)?value.readingSize:'large',darkPalette:['forest','black','wine'].includes(value?.darkPalette)?value.darkPalette:'forest',readingWidth:['comfortable','wide'].includes(value?.readingWidth)?value.readingWidth:'wide',leftCollapsed:value?.leftCollapsed===true,rightCollapsed:value?.rightCollapsed===true};
}
export function presentationTheme(choice,dark){return choice==='system'?(dark?'dark':'light'):choice;}
export async function loadPresentation({native,storage}={}){
  if(native){const result=await native.request('native.presentationGet');return {...normalizePresentation(result),persistence:result?.persistence};}
  try{if(!storage)throw Error('Storage unavailable');const raw=storage.getItem(presentationKey);return {...normalizePresentation(raw&&raw.length<=1024?JSON.parse(raw):null),persistence:raw?'saved':'default'};}catch{return {...normalizePresentation(null),persistence:'unavailable'};}
}
export async function savePresentation(value,{native,storage}={}){
  const safe=normalizePresentation(value);
  if(native)return native.request('native.presentationSave',safe);
  try{if(!storage)throw Error('Storage unavailable');storage.setItem(presentationKey,JSON.stringify(safe));return {...safe,persistence:'saved'};}
  catch{return {...safe,persistence:'unavailable'};}
}
export function mountPresentation({font,theme,palette,width,left,right,status,beforeLayoutChange,root=document.documentElement,body=document.body,native=globalThis.__SCEAN_NATIVE__,media=globalThis.matchMedia?.('(prefers-color-scheme: dark)'),storage}={}){
  if(!native&&!storage){try{storage=globalThis.localStorage;}catch{}}
  let value=normalizePresentation(null),changed=0,queue=Promise.resolve(),systemDark=media?.matches===true;
  const apply=()=>{
    const restore=beforeLayoutChange?.(value);
    root.dataset.theme=presentationTheme(value.theme,systemDark);root.style.colorScheme=root.dataset.theme;root.dataset.darkPalette=value.darkPalette;
    body.dataset.readingSize=value.readingSize;body.dataset.readingWidth=value.readingWidth;body.dataset.leftCollapsed=String(value.leftCollapsed);body.dataset.rightCollapsed=String(value.rightCollapsed);
    font.value=value.readingSize;theme.value=value.theme;if(palette)palette.value=value.darkPalette;if(width)width.value=value.readingWidth;
    for(const [button,collapsed,label] of [[left,value.leftCollapsed,'書架'],[right,value.rightCollapsed,'此刻']])if(button){button.textContent=(collapsed?'展開':'收合')+label;button.setAttribute('aria-expanded',String(!collapsed));}
    restore?.();
  };
  const update=(patch={})=>{
    changed++;value=normalizePresentation({...value,theme:theme.value,readingSize:font.value,...(palette?{darkPalette:palette.value}:{}),...(width?{readingWidth:width.value}:{}),...patch});apply();
    status.textContent='正在保存顯示偏好…';
    const serial=changed,copy={...value};queue=queue.catch(()=>{}).then(()=>savePresentation(copy,{native,storage}));
    queue.then(result=>{if(serial===changed)status.textContent=result.persistence==='unavailable'?'本次已套用；無法保存此入口的偏好。':'已保存此裝置、此入口的顯示偏好。';}).catch(()=>{if(serial===changed)status.textContent='本次已套用；偏好尚未保存。';});
  };
  const change=()=>update(),toggleLeft=()=>update({leftCollapsed:!value.leftCollapsed}),toggleRight=()=>update({rightCollapsed:!value.rightCollapsed});
  for(const control of [font,theme,palette,width])control?.addEventListener('change',change);
  left?.addEventListener('click',toggleLeft);right?.addEventListener('click',toggleRight);
  const systemChange=()=>{if(!native){systemDark=media?.matches===true;if(value.theme==='system')apply();}};if(!native)media?.addEventListener?.('change',systemChange);
  const environment=next=>{if(typeof next?.dark==='boolean'){systemDark=next.dark;if(value.theme==='system')apply();}};
  const unsubscribe=native?.onPresentation?.(environment);
  if(native)native.request('native.presentationEnvironment').then(environment).catch(()=>{});
  apply();
  const ready=loadPresentation({native,storage}).then(saved=>{if(changed===0){value=normalizePresentation(saved);apply();status.textContent=saved.persistence==='unavailable'?'本次已套用；無法保存此入口的偏好。':'偏好只保存於此裝置、此入口；其他瀏覽器或裝置需另外設定。';}}).catch(()=>{if(changed===0)status.textContent='無法讀取偏好；已套用跟隨系統與預設配色。';});
  return {ready,dispose(){for(const control of [font,theme,palette,width])control?.removeEventListener('change',change);left?.removeEventListener('click',toggleLeft);right?.removeEventListener('click',toggleRight);media?.removeEventListener?.('change',systemChange);unsubscribe?.();}};
}
