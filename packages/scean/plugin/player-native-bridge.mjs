// Authenticated RPC adapter only. No file access, HTTP proxy, or Studio database access.
export function createNativeBridge({call,selectPanel,openSession,getSessionId=()=>null,getViewerId=()=>null,notifications,enableNotifications,onOpeningStarted,onDiagnose,onRunRecycled}){
  const allowed=new Set(['scriptList','scriptGet','scriptStart','scriptStatus','runRecycleList','runLifecycleStatus','runTrash','runRestore','playerBind','capabilities','list','openingPrepare','openingOffer','openingStart','openingCancel','progress','draftSave','draftGet','turn','rollback','regenerate','operationSubmit','operationStatus','exportRun','importRun','cancel','runView','historySearch','historyRead','historyPage','summaryStatus','summaryStart','summaryCancel','chapterStatus','chapterSettings','chapterSummarize','chapterAuto','chapterCancel','chapterClose','inspect','diagnosticsGrant','diagnosticsRead','diagnosticsRevoke','banList','writingMode','writingModeSave','proseStyle','proseStyleSave','writingStylesImport','playerIdeas','playerWorldbook','playerRecap','playerCollaboration','ownerWorldbook','presentation','presentationSource','presentationPreview','presentationApply','presentationRestore','models']);
  const grants=new Map();let disposed=false,privacyEpoch=0,contextEpoch=0,cardScope=null;
  const denied=code=>Object.assign(new Error(code),{code});
  const revoke=grant=>call({action:'diagnosticsRevoke',...grant}).catch(()=>{});
  const grantKey=r=>`${r.runId}:${r.viewerId}`;
  const scoped=request=>({...request,sessionId:getSessionId(),cardScope});
  const viewer=()=>{const value=getViewerId(getSessionId());return typeof value==='string'&&/^[\w-]{1,160}$/.test(value)?{viewerId:value}:{};};
  async function context(){const epoch=contextEpoch,sessionId=getSessionId();const value=await call({action:'context',sessionId});if(epoch!==contextEpoch||sessionId!==getSessionId())throw denied('NATIVE_CONTEXT_STALE');cardScope=value.cardScope??null;const status=value.playbackStatus;return {cardScope,...(['available','unselected','source_missing','source_recycled','source_pending','session_archived','unavailable'].includes(status?.status)?{playbackStatus:{status:status.status,...(typeof status.authoringBindingRequired==='boolean'?{authoringBindingRequired:status.authoringBindingRequired}:{})}}:{}),...viewer()};}
  async function request(action,payload={}){
    if(disposed)throw denied('NATIVE_PANEL_CLOSED');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.hasOwn(payload,'action'))throw denied('NATIVE_REQUEST_INVALID');
    // The iframe has an opaque origin. Presentation settings alone live in
    // parent-origin storage; they never become a Host RPC or Run metadata.
    if(action==='native.presentationEnvironment')return {dark:globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches===true};
    if(action==='native.presentationGet'){
      const defaults={schemaVersion:1,theme:'system',readingSize:'normal',darkPalette:'forest',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false};
      try{
        const raw=globalThis.localStorage.getItem('scean.presentation.v1');
        if(typeof raw!=='string'||!raw||raw.length>1024||new TextEncoder().encode(raw).length>1024)return {...defaults,persistence:'default'};
        let value;try{value=JSON.parse(raw);}catch{return {...defaults,persistence:'default'};}
        if(value?.schemaVersion!==1)return {...defaults,persistence:'default'};
        return {...defaults,theme:['light','dark','system'].includes(value.theme)?value.theme:'system',readingSize:['normal','large'].includes(value.readingSize)?value.readingSize:'normal',darkPalette:['forest','black','wine'].includes(value.darkPalette)?value.darkPalette:'forest',readingWidth:['comfortable','wide'].includes(value.readingWidth)?value.readingWidth:'wide',leftCollapsed:value.leftCollapsed===true,rightCollapsed:value.rightCollapsed===true,persistence:'saved'};
      }catch{return {...defaults,persistence:'unavailable'};}
    }
    if(action==='native.presentationSave'){
      if(payload.schemaVersion!==1||!['light','dark','system'].includes(payload.theme)||!['normal','large'].includes(payload.readingSize))throw denied('NATIVE_PRESENTATION_INVALID');
      if(payload.darkPalette!==undefined&&!['forest','black','wine'].includes(payload.darkPalette)||payload.readingWidth!==undefined&&!['comfortable','wide'].includes(payload.readingWidth)||['leftCollapsed','rightCollapsed'].some(key=>payload[key]!==undefined&&typeof payload[key]!=='boolean'))throw denied('NATIVE_PRESENTATION_INVALID');
      const value={schemaVersion:1,theme:payload.theme,readingSize:payload.readingSize,darkPalette:payload.darkPalette??'forest',readingWidth:payload.readingWidth??'wide',leftCollapsed:payload.leftCollapsed===true,rightCollapsed:payload.rightCollapsed===true};
      try{globalThis.localStorage.setItem('scean.presentation.v1',JSON.stringify(value));globalThis.dispatchEvent?.(new CustomEvent('scean:presentation',{detail:value}));return {...value,persistence:'saved'};}
      catch{return {...value,persistence:'unavailable'};}
    }
    if(action==='native.notificationCapabilities')return notifications?.capabilities()??{supported:false,permission:'unsupported',enabled:false,backgroundEnabled:false};
    if(action==='native.notificationEnable')return enableNotifications?enableNotifications():notifications?.enable();
    if(action==='native.notificationTarget')return notifications?.target(payload.eventId);
    if(action==='native.notificationConfigure')return notifications?.configure({enabled:payload.enabled,backgroundEnabled:payload.backgroundEnabled,runId:payload.runId});
    if(action==='catalog')return {cards:[],source:'studio-handoff-only'};
    if(action==='native.context')return context();
    if(action==='native.navigate'){
      // Product navigation stays within the current Session. Only source-return
      // may resolve a different Session, through the authenticated Host read.
      const panels={home:'local-scean-home',studio:'local-scean-studio',stage:'local-scean'};
      if(Object.keys(payload).length!==1||typeof payload.screen!=='string'||!Object.hasOwn(panels,payload.screen))throw denied('NATIVE_NAVIGATION_INVALID');
      if(typeof selectPanel!=='function')throw denied('NATIVE_NAVIGATION_UNAVAILABLE');
      await selectPanel(panels[payload.screen]);return {opened:true,screen:payload.screen};
    }
    if(action==='native.returnToAuthoring'){
      // Only an authorized saved source may choose the destination. The opaque
      // iframe cannot pass a session ID, URL, arbitrary panel or Host action.
      const run=typeof payload.runId==='string'&&/^[\w-]{1,160}$/.test(payload.runId),script=typeof payload.scriptId==='string'&&/^[\w-]{1,160}$/.test(payload.scriptId);
      if(!cardScope||run===script||Object.keys(payload).some(key=>key!==(run?'runId':'scriptId')))throw denied('NATIVE_RETURN_TARGET_INVALID');
      if(typeof openSession!=='function')throw denied('NATIVE_RETURN_UNAVAILABLE');
      const epoch=contextEpoch,sessionId=getSessionId(),source=await call(scoped({action:run?'runView':'scriptGet',...(run?{runId:payload.runId}:{scriptId:payload.scriptId})}));
      if(disposed||epoch!==contextEpoch||sessionId!==getSessionId())throw denied('NATIVE_CONTEXT_STALE');
      const target=source?.sourceSessionId;if(typeof target!=='string'||!/^[\w-]{1,160}$/.test(target))throw Object.assign(denied('NATIVE_SOURCE_SESSION_UNKNOWN'),{message:'此演出尚無可確認的來源創作對話；未改開其他對話。'});
      if(source.sourceSessionAvailable!==true)throw Object.assign(denied('NATIVE_SOURCE_SESSION_UNAVAILABLE'),{message:'來源創作對話目前不可讀或卡片已變更；請恢復原對話後再返回。'});
      await openSession(target);await selectPanel('local-scean-studio');return{opened:true,sourceSessionId:target};
    }
    if(action==='native.diagnose'){if(!cardScope||typeof payload.runId!=='string')throw denied('CARD_CONTEXT_REQUIRED');onDiagnose?.({runId:payload.runId,authoringSessionId:getSessionId()});selectPanel('local-cardstudio-scean');return {opened:true,authorization:'human_confirmation_required'};}
    if(action==='native.openStudio'){selectPanel('local-cardstudio-scean');return {opened:true};}
    if(action==='native.bootstrap'){
      let models;try{models=await call({action:'models'});}catch{models={mode:'native',source:'DSH authenticated host',status:'unavailable'};}
      return {mode:'native',dataRootLabel:'SCEAN 插件獨立資料目錄',models,studio:{available:false},native:true,...viewer()};
    }
    if(['playerDefaults','playerDefaultsSave','chapterProviderSettings','chapterProviderSave','chapterProviderClear'].includes(action)){
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
      if(['runTrash','runLifecycleStatus'].includes(action)&&value?.status==='trashed'&&value?.runId===payload.runId)onRunRecycled?.(value);
      if(contextToken!==contextEpoch)throw denied('NATIVE_CONTEXT_STALE');
      if(action==='openingStart'&&value?.runId&&value?.binding)onOpeningStarted?.({request,value});
      return value;
  }
  async function clearPrivate(){privacyEpoch++;const prior=[...grants.values()];grants.clear();await Promise.allSettled(prior.map(revoke));}
  function clearContext(){contextEpoch++;cardScope=null;void clearPrivate();}
  // Panel navigation is not a user cancellation. Host owns ongoing Run lifetime.
  async function dispose(){if(disposed)return;disposed=true;await clearPrivate();}
  return {request,clearPrivate,clearContext,dispose};
}
