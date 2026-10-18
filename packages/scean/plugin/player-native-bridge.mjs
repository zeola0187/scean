// Authenticated RPC adapter only. No file access, HTTP proxy, or Studio database access.
export function createNativeBridge({call,selectPanel,getSessionId=()=>null,getViewerId=()=>null,notifications,enableNotifications}){
  const allowed=new Set(['capabilities','list','openingPrepare','openingOffer','openingStart','openingCancel','progress','draftSave','draftGet','turn','rollback','regenerate','operationSubmit','operationStatus','exportRun','importRun','cancel','runView','historySearch','historyRead','historyPage','summaryStatus','summaryStart','summaryCancel','chapterStatus','chapterSettings','chapterSummarize','chapterAuto','chapterCancel','chapterClose','inspect','diagnosticsGrant','diagnosticsRead','diagnosticsRevoke','banList','models']);
  const grants=new Map();let disposed=false,privacyEpoch=0,contextEpoch=0,cardScope=null;
  const denied=code=>Object.assign(new Error(code),{code});
  const revoke=grant=>call({action:'diagnosticsRevoke',...grant}).catch(()=>{});
  const grantKey=r=>`${r.runId}:${r.viewerId}`;
  const scoped=request=>({...request,sessionId:getSessionId(),cardScope});
  const viewer=()=>{const value=getViewerId(getSessionId());return typeof value==='string'&&/^[\w-]{1,160}$/.test(value)?{viewerId:value}:{};};
  async function context(){const epoch=contextEpoch,sessionId=getSessionId();const value=await call({action:'context',sessionId});if(epoch!==contextEpoch||sessionId!==getSessionId())throw denied('NATIVE_CONTEXT_STALE');cardScope=value.cardScope??null;return {cardScope,...viewer()};}
  async function request(action,payload={}){
    if(disposed)throw denied('NATIVE_PANEL_CLOSED');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.hasOwn(payload,'action'))throw denied('NATIVE_REQUEST_INVALID');
    // The iframe has an opaque origin. Presentation settings alone live in
    // parent-origin storage; they never become a Host RPC or Run metadata.
    if(action==='native.presentationEnvironment')return {dark:globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches===true};
    if(action==='native.presentationGet'){
      const defaults={schemaVersion:1,theme:'system',readingSize:'large',darkPalette:'forest',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false};
      try{
        const raw=globalThis.localStorage.getItem('scean.presentation.v1');
        if(typeof raw!=='string'||!raw||raw.length>1024||new TextEncoder().encode(raw).length>1024)return {...defaults,persistence:'default'};
        let value;try{value=JSON.parse(raw);}catch{return {...defaults,persistence:'default'};}
        if(value?.schemaVersion!==1)return {...defaults,persistence:'default'};
        return {...defaults,theme:['light','dark','system'].includes(value.theme)?value.theme:'system',readingSize:['normal','large'].includes(value.readingSize)?value.readingSize:'large',darkPalette:['forest','black','wine'].includes(value.darkPalette)?value.darkPalette:'forest',readingWidth:['comfortable','wide'].includes(value.readingWidth)?value.readingWidth:'wide',leftCollapsed:value.leftCollapsed===true,rightCollapsed:value.rightCollapsed===true,persistence:'saved'};
      }catch{return {...defaults,persistence:'unavailable'};}
    }
    if(action==='native.presentationSave'){
      if(payload.schemaVersion!==1||!['light','dark','system'].includes(payload.theme)||!['normal','large'].includes(payload.readingSize))throw denied('NATIVE_PRESENTATION_INVALID');
      if(payload.darkPalette!==undefined&&!['forest','black','wine'].includes(payload.darkPalette)||payload.readingWidth!==undefined&&!['comfortable','wide'].includes(payload.readingWidth)||['leftCollapsed','rightCollapsed'].some(key=>payload[key]!==undefined&&typeof payload[key]!=='boolean'))throw denied('NATIVE_PRESENTATION_INVALID');
      const value={schemaVersion:1,theme:payload.theme,readingSize:payload.readingSize,darkPalette:payload.darkPalette??'forest',readingWidth:payload.readingWidth??'wide',leftCollapsed:payload.leftCollapsed===true,rightCollapsed:payload.rightCollapsed===true};
      try{globalThis.localStorage.setItem('scean.presentation.v1',JSON.stringify(value));return {...value,persistence:'saved'};}
      catch{return {...value,persistence:'unavailable'};}
    }
    if(action==='native.notificationCapabilities')return notifications?.capabilities()??{supported:false,permission:'unsupported',enabled:false,backgroundEnabled:false};
    if(action==='native.notificationEnable')return enableNotifications?enableNotifications():notifications?.enable();
    if(action==='native.notificationTarget')return notifications?.target(payload.eventId);
    if(action==='native.notificationConfigure')return notifications?.configure({enabled:payload.enabled,backgroundEnabled:payload.backgroundEnabled,runId:payload.runId});
    if(action==='catalog')return {cards:[],source:'studio-handoff-only'};
    if(action==='native.context')return context();
    if(action==='native.openStudio'){selectPanel('local-cardstudio-scean');return {opened:true};}
    if(action==='native.bootstrap'){
      let models;try{models=await call({action:'models'});}catch{models={mode:'native',source:'DSH authenticated host',status:'unavailable'};}
      return {mode:'native',dataRootLabel:'SCEAN 插件獨立資料目錄',models,studio:{available:false},native:true,...viewer()};
    }
    if(['chapterProviderSettings','chapterProviderSave','chapterProviderClear'].includes(action)){
      const value=await call({...payload,action});if(disposed)throw denied('NATIVE_PANEL_CLOSED');return value;
    }
    if(!allowed.has(action))throw denied('NATIVE_ACTION_DENIED');
    const request=scoped({...payload,action}),epoch=privacyEpoch,contextToken=contextEpoch;
      if(action==='operationSubmit'){await notifications?.watch(request);if(contextToken!==contextEpoch)throw denied('NATIVE_CONTEXT_STALE');}
      let value;try{value=await call(request);if(action==='operationSubmit')void notifications?.refresh();}catch(error){if(contextToken!==contextEpoch)throw denied('NATIVE_CONTEXT_STALE');throw error;}
      if(action==='diagnosticsGrant'&&value?.grantToken){
        const grant={runId:payload.runId,viewerId:payload.viewerId,grantToken:value.grantToken};
        if(disposed||epoch!==privacyEpoch||value.runId!==payload.runId||value.scope!=='operator-private'||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()){await revoke(grant);throw denied('NATIVE_DIAGNOSTICS_STALE');}
        const previous=grants.get(grantKey(payload));if(previous&&previous.grantToken!==grant.grantToken)await revoke(previous);
        if(disposed||epoch!==privacyEpoch){await revoke(grant);throw denied('NATIVE_DIAGNOSTICS_STALE');}
        grants.set(grantKey(payload),grant);
      }
      if(action==='diagnosticsRevoke'&&grants.get(grantKey(payload))?.grantToken===payload.grantToken)grants.delete(grantKey(payload));
      if(action==='diagnosticsRead'&&(epoch!==privacyEpoch||value?.runId!==payload.runId))throw denied('NATIVE_DIAGNOSTICS_STALE');
      if(disposed)throw denied('NATIVE_PANEL_CLOSED');
      if(contextToken!==contextEpoch)throw denied('NATIVE_CONTEXT_STALE');
      return value;
  }
  async function clearPrivate(){privacyEpoch++;const prior=[...grants.values()];grants.clear();await Promise.allSettled(prior.map(revoke));}
  function clearContext(){contextEpoch++;cardScope=null;void clearPrivate();}
  // Panel navigation is not a user cancellation. Host owns ongoing Run lifetime.
  async function dispose(){if(disposed)return;disposed=true;await clearPrivate();}
  return {request,clearPrivate,clearContext,dispose};
}
