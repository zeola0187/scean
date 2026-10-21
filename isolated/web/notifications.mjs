/** Shared live-page notification coordinator. Self-contained for native bundling.
 * Only the explicit enable() UI route can request permission. Never creates a
 * service worker, Push subscription, URL, native IPC or model operation. */
export function createNotificationClient({call,getScope=async()=>({}),onTarget=()=>{},showToast=()=>{},onChange=()=>{},environment=globalThis,pollMs=2500}={}){
  const key='scean.notifications.v1',g=environment;
  let storage;try{storage=g.localStorage;}catch{}
  let settings={schemaVersion:1,destinationId:null,enabled:true,backgroundEnabled:false,stopPending:false};
  try{const saved=JSON.parse(storage?.getItem(key)??'null');if(saved?.schemaVersion===1&&/^[\w-]{1,160}$/.test(saved.destinationId??''))settings={schemaVersion:1,destinationId:saved.destinationId,enabled:saved.enabled!==false,backgroundEnabled:saved.backgroundEnabled===true,stopPending:saved.stopPending===true};}catch{}
  if(!settings.destinationId)settings.destinationId=g.crypto?.randomUUID?.()??null;
  const save=()=>{try{storage?.setItem(key,JSON.stringify(settings));}catch{}};save();
  let timer=null,busy=false,disposed=false,serial=0,lastScope=null,lastStatus=null,problem=null;
  const shown=new Map();
  const capabilities=()=>{
    const supported=g.isSecureContext===true&&typeof g.Notification==='function'&&typeof g.Notification.requestPermission==='function';
    return {supported,permission:supported?g.Notification.permission:'unsupported',enabled:settings.enabled,backgroundEnabled:settings.backgroundEnabled,destinationId:settings.destinationId,livePageOnly:true,status:problem??(supported?'available':'in_page_only')};
  };
  const changed=()=>onChange(capabilities());
  const schedule=()=>{if(!disposed&&!timer)timer=g.setTimeout(()=>{timer=null;void refresh();},pollMs);};
  const scopeKey=scope=>JSON.stringify(scope??{});
  async function context(){const scope=await getScope();if(!scope)return null;return scope;}
  async function exact(eventId,captured){
    const scope=await context();if(!scope||scopeKey(scope)!==scopeKey(captured))throw Object.assign(new Error('請先回到原本對話與卡片。'),{code:'NOTIFICATION_CONTEXT_CHANGED'});
    return call('notificationTarget',{...scope,destinationId:settings.destinationId,eventId});
  }
  async function open(eventId,captured){
    try{const target=await exact(eventId,captured);if(disposed)return;await onTarget(target);}
    catch(error){problem=error.code??'target_unavailable';showToast({message:'此回覆目前無法定位；請回原對話確認是否已撤回或替換。',error:true});changed();}
  }
  async function present(row,scope,token){
    const claim=await call('notificationClaim',{...scope,destinationId:settings.destinationId,eventId:row.eventId});
    if(!claim?.claimed||disposed||token!==serial||!settings.enabled)return;
    // Revalidate after durable consume and immediately before the one attempt.
    await exact(row.eventId,scope);if(disposed||token!==serial)return;
    const click=()=>open(row.eventId,scope),message=row.kind==='regenerate'?'重新生成已保存':'本輪已保存';
    const background=g.document?.visibilityState==='hidden'||g.document?.hasFocus?.()===false;
    const cap=capabilities();
    if(background&&settings.backgroundEnabled&&cap.supported&&cap.permission==='granted'){
      try{
        const notice=new g.Notification('SCEAN',{body:'本輪已保存，點擊查看。',tag:row.eventId,renotify:false,silent:true});
        shown.set(row.eventId,notice);notice.onclick=()=>{notice.close?.();shown.delete(row.eventId);g.focus?.();void click();};
        notice.onclose=()=>shown.delete(row.eventId);let failed=false;notice.onerror=()=>{if(failed)return;failed=true;problem='desktop_unavailable';changed();showToast({message:'本輪已保存；系統通知無法顯示。',open:click});};
        return;
      }catch{problem='desktop_unavailable';changed();}
    }
    showToast({message,open:click});
  }
  async function refresh(){
    if(disposed||busy||!settings.destinationId||!settings.enabled&&!settings.stopPending)return lastStatus;
    busy=true;const token=serial;
    try{
      const scope=await context();if(!scope)return;
      if(settings.stopPending){await call('notificationStop',{...scope,destinationId:settings.destinationId});settings.stopPending=false;save();}
      if(!settings.enabled)return;
      const status=await call('notificationStatus',{...scope,destinationId:settings.destinationId});
      if(disposed||token!==serial)return;
      lastScope=scope;lastStatus=status;
      for(const row of status.watches??[]){
        if(row.status==='suppressed'){shown.get(row.eventId)?.close?.();shown.delete(row.eventId);}
        if(row.status==='ready')await present(row,scope,token);
      }
      if(status.pending)schedule();
      return status;
    }catch{problem='connection_pending';changed();schedule();}
    finally{busy=false;}
  }
  async function watch(request){
    if(disposed||!settings.enabled||!settings.destinationId||!['turn','regenerate'].includes(request.kind))return;
    try{
      const scope=await context();if(!scope)return;
      const payload={...scope,runId:request.runId,requestId:request.requestId,operationId:request.operationId,kind:request.kind,baseVersion:request.baseVersion,baseHead:request.baseHead,destinationId:settings.destinationId,...(request.retryOf?{retryOf:request.retryOf}:{})};
      await call('notificationWatch',payload);schedule();
    }catch{problem='watch_unavailable';changed();}
  }
  async function enable(){
    const cap=capabilities();if(!cap.supported){problem='in_page_only';changed();return capabilities();}
    let permission=cap.permission;
    // Called only from the explicit product button, never refresh or watch.
    if(permission==='default')try{permission=await g.Notification.requestPermission();}catch{problem='permission_unavailable';}
    settings.backgroundEnabled=permission==='granted';save();if(permission==='denied')problem='permission_denied';changed();return capabilities();
  }
  async function stop(runId){
    const scope=await context();if(scope)await call('notificationStop',{...scope,destinationId:settings.destinationId,...(runId?{runId}:{})});
    for(const notice of shown.values())notice.close?.();shown.clear();
  }
  async function configure({enabled=settings.enabled,backgroundEnabled=settings.backgroundEnabled,runId}={}){
    if(typeof enabled!=='boolean'||typeof backgroundEnabled!=='boolean')throw Error('Invalid notification preference.');
    if(enabled&&!settings.enabled)settings.destinationId=g.crypto?.randomUUID?.()??settings.destinationId;
    settings.enabled=enabled;settings.backgroundEnabled=backgroundEnabled&&capabilities().permission==='granted';serial++;
    if(!enabled)settings.stopPending=true;save();
    if(!enabled||runId)try{await stop(runId);if(!enabled){settings.stopPending=false;save();}}catch{problem='stop_pending';}
    changed();if(enabled||settings.stopPending)void refresh();return capabilities();
  }
  function scopeChanged(){serial++;for(const notice of shown.values())notice.close?.();shown.clear();if(timer){g.clearTimeout(timer);timer=null;}void refresh();schedule();}
  const resume=()=>void refresh();for(const event of ['focus','online','pageshow'])g.addEventListener?.(event,resume);
  g.document?.addEventListener?.('visibilitychange',resume);
  function dispose(){disposed=true;serial++;if(timer)g.clearTimeout(timer);for(const notice of shown.values())notice.close?.();shown.clear();for(const event of ['focus','online','pageshow'])g.removeEventListener?.(event,resume);g.document?.removeEventListener?.('visibilitychange',resume);}
  return {watch,refresh,enable,configure,scopeChanged,capabilities,dispose,target:async eventId=>{const scope=await context();if(!scope)throw Error('Context unavailable');return exact(eventId,scope);}};
}

export function mountNotificationControls({request,parent=document.querySelector('#preferences-panel dialog')??document.getElementById('preferences-panel'),document:doc=document}={}){
  const group=doc.createElement('section'),heading=doc.createElement('h3'),status=doc.createElement('p'),enable=doc.createElement('button'),backgroundOff=doc.createElement('button'),toggle=doc.createElement('button'),mute=doc.createElement('button');
  heading.textContent='保存通知';status.className='hint';status.id='notification-status';status.setAttribute('role','status');
  enable.type=backgroundOff.type=toggle.type=mute.type='button';enable.textContent='開啟背景桌面通知';backgroundOff.textContent='關閉背景桌面通知';mute.textContent='停止觀察目前 Run';
  let value={enabled:true,backgroundEnabled:false};
  const render=next=>{value=next??value;toggle.textContent=value.enabled===false?'開啟頁內通知':'關閉全部保存通知';enable.disabled=!value.supported||value.permission==='denied'||value.backgroundEnabled===true;backgroundOff.disabled=value.backgroundEnabled!==true;status.textContent=value.backgroundEnabled?'背景桌面通知已開啟；只在頁面仍執行時嘗試顯示。':value.permission==='denied'?'通知權限已拒絕；保留頁內保存提示。':!value.supported?'目前僅支援頁內保存提示；此環境無可用的安全桌面通知介面。':'頁內保存提示已開啟；背景桌面通知預設關閉。';if(value.status==='confirm_in_parent')status.textContent='請在舞臺外層的保存提示按「啟用」，才會要求裝置通知權限。';if(value.enabled===false)status.textContent='保存通知已關閉；已登記的待發通知已停止。';};
  const perform=async(action,payload)=>{try{render(await request(action,payload));}catch{status.textContent='通知設定暫不可用；已保存結果不受影響。';}};
  enable.addEventListener('click',()=>void perform('enable'));
  backgroundOff.addEventListener('click',()=>void perform('configure',{backgroundEnabled:false}));
  toggle.addEventListener('click',()=>void perform('configure',{enabled:value.enabled===false}));
  mute.addEventListener('click',()=>void perform('mute'));
  group.append(heading,status,enable,backgroundOff,toggle,mute);parent?.append(group);void perform('capabilities');return {render,element:group};
}

export function showNotificationToast({message,open,openLabel='查看',error=false},{document:doc=document}={}){
  let region=doc.getElementById('scean-save-toast');if(!region){region=doc.createElement('aside');region.id='scean-save-toast';region.setAttribute('role','status');region.setAttribute('aria-live','polite');region.style.cssText='position:fixed;bottom:calc(var(--scean-composer-height,0px) + 20px + env(safe-area-inset-bottom,0px));right:20px;max-width:min(340px,calc(100vw - 40px));padding:14px;border:1px solid #687e77;border-radius:12px;background:#172b25;color:#fff;font:16px/1.5 system-ui;z-index:2147483000;box-shadow:0 4px 24px #0005';doc.body.append(region);}
  region.replaceChildren();const text=doc.createElement('span');text.textContent=message;region.append(text);
  const button=(label,handler)=>{const node=doc.createElement('button');node.type='button';node.textContent=label;node.style.cssText='margin-left:10px;padding:5px 9px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font:inherit';node.addEventListener('click',handler);region.append(node);};
  if(open&&!error)button(openLabel,()=>void open());button('關閉',()=>region.remove());
}
