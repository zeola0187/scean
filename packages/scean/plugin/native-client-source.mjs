// Build input: kept separate from generated client.js so shared UI has one source.
export function nativeClientFactory(React,sharedHTML,createNativeBridge,createNotificationClient,showNotificationToast){
  const h=React.createElement;
  const remote={package:'@local/dsh-scean',descriptors:[{id:'@local/dsh-scean#scean/request',service:'scean',namespace:'scean',method:'request',invocation:{kind:'direct'},parameters:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-scean#Request',create:()=>({parse(value){if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.action!=='string')throw new TypeError('Expected SCEAN action object.');return value;}})}}],cancellation:{parameter:'signal'},result:{mode:'src-json'}}]};
  return {name:'scean-client',apply(ctx){ctx.inject(['remote','typert'],async scope=>{
    await scope.remote.$mount(remote);
    scope.inject(['remote.scean','slots','layout','sessions'],child=>{
      let selected=null,sessionId=null;const selections=new Set(),panels=new Set(),viewers=new Map();
      const viewerKey='scean.page-viewers.v1';
      try{if(['reload','back_forward'].includes(performance.getEntriesByType('navigation')[0]?.type)){const raw=sessionStorage.getItem(viewerKey);if(raw&&raw.length<24000){const rows=JSON.parse(raw);if(Array.isArray(rows))for(const row of rows.slice(-64))if(Array.isArray(row)&&row.length===2&&row.every(v=>typeof v==='string'&&/^[\w-]{1,160}$/.test(v)))viewers.set(row[0],row[1]);}}}catch{}
      const getViewerId=id=>{if(!id)return null;if(!viewers.has(id)){viewers.set(id,crypto.randomUUID());while(viewers.size>64)viewers.delete(viewers.keys().next().value);try{sessionStorage.setItem(viewerKey,JSON.stringify([...viewers]));}catch{}}return viewers.get(id);};
      const currentSession=()=>Object.values(child.sessions.list.getSnapshot().byId).find(r=>(r.retainedBy?.mainView??0)>0)?.id??null;
      const call=async request=>{const response=await child.remote.scean.request(request);if(!response?.ok)throw Object.assign(new Error('無法確認 SCEAN 連線結果。'),{code:'RPC_TRANSPORT'});if(!response.value?.ok)throw Object.assign(new Error(response.value?.error?.message??'SCEAN request failed'),response.value?.lastFailure??response.value?.error);return response.value.value;};
      let notificationTarget=null;
      const notifications=createNotificationClient?.({call:(action,payload)=>call({action,...payload}),getScope:async()=>{const id=currentSession();if(!id)return null;const value=await call({action:'context',sessionId:id});if(currentSession()!==id||!value.cardScope)return null;return {sessionId:id,cardScope:value.cardScope};},showToast:value=>showNotificationToast?.(value),onTarget:async target=>{notificationTarget=target;reset(target.runId);child.layout.selectPanel('local-scean');}});
      const enableNotifications=()=>{showNotificationToast?.({message:'背景桌面通知預設關閉。請按啟用以要求此裝置的通知權限。',openLabel:'啟用',open:async()=>{const value=await notifications?.enable();showNotificationToast?.({message:value?.backgroundEnabled?'背景桌面通知已開啟；僅限頁面持續執行時。':'背景桌面通知未開啟；保留頁內保存提示。'});for(const panel of panels)panel.port.postMessage({kind:'notification-settings',value});}});return {...notifications?.capabilities(),status:'confirm_in_parent'};};
      const reset=runId=>{selected=runId??null;for(const notify of selections)notify(selected);};
      const sync=()=>{const next=currentSession();if(next!==sessionId){sessionId=next;notificationTarget=null;reset();notifications?.scopeChanged();}};
      const unsubscribe=child.sessions.list.subscribe(sync);sync();
      const context=event=>{if(event.detail?.authoringSessionId===sessionId){notificationTarget=null;reset();notifications?.scopeChanged();}};
      const open=event=>{sync();if(event.detail?.authoringSessionId!==sessionId||!sessionId)return;const runId=event.detail?.runId;reset(typeof runId==='string'&&runId.length<=160?runId:null);child.layout.selectPanel('local-scean');};
      window.addEventListener('scean:open',open);
      window.addEventListener('scean:context',context);
      function Panel(){
        const frame=React.useRef(null),session=React.useRef(null);
        const close=()=>{const old=session.current;session.current=null;if(old){selections.delete(old.notify);panels.delete(old);old.stopPresentation?.();old.port.onmessage=null;old.port.close();void old.bridge.dispose();}};
        React.useEffect(()=>close,[]);
        const connect=()=>{
          close();if(!frame.current?.contentWindow)return;
          const channel=new MessageChannel(),bridge=createNativeBridge({call,selectPanel:key=>child.layout.selectPanel(key),getSessionId:()=>sessionId,getViewerId,notifications,enableNotifications});
          const current={port:channel.port1,bridge,notify:runId=>{bridge.clearContext();channel.port1.postMessage({kind:'context',runId,...(notificationTarget?.runId===runId?{notificationTarget}:{})});}};session.current=current;panels.add(current);selections.add(current.notify);
          channel.port1.onmessage=async event=>{
            const message=event.data;if(session.current!==current||!message||message.kind!=='request'||typeof message.id!=='string'||message.id.length>100)return;
            try{const value=await bridge.request(message.action,message.payload??{});if(session.current===current)channel.port1.postMessage({kind:'response',id:message.id,ok:true,value});}
            catch(error){if(session.current===current)channel.port1.postMessage({kind:'response',id:message.id,ok:false,error:{code:error.code??'NATIVE_RPC_FAILED',message:error.message??'SCEAN request failed',category:error.category,stage:error.stage}});}
          };
          channel.port1.start();frame.current.contentWindow.postMessage({kind:'scean-native-connect'},'*',[channel.port2]);
          // Device preference comes from the top-level document; an iframe's
          // media query may instead inherit the manually selected DSH scheme.
          const media=window.matchMedia('(prefers-color-scheme: dark)'),present=()=>channel.port1.postMessage({kind:'presentation-environment',dark:media.matches===true});
          media.addEventListener('change',present);current.stopPresentation=()=>media.removeEventListener('change',present);present();
          current.notify(selected);
        };
        return h('iframe',{ref:frame,title:'SCEAN 玩家介面','data-scean-native-player':true,sandbox:'allow-scripts allow-downloads allow-forms',srcDoc:sharedHTML,onLoad:connect,style:{width:'100%',height:'100%',minHeight:0,border:0,display:'block',background:'transparent'}});
      }
      function Entry(){
        // Match Studio's dock and the host composer, including resized columns.
        return h('button',{type:'button','data-scean-stage-entry':true,style:{display:'block',boxSizing:'border-box',width:'calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px))',maxWidth:'var(--dsh-composer-card-max-width,952px)',margin:'0 auto',flex:'none',minWidth:0,minHeight:44,whiteSpace:'normal',overflowWrap:'anywhere'},onClick:()=>{sync();reset();child.layout.selectPanel('local-scean');}},'SCEAN 舞台');
      }
      const disposers=[child.slots.inject('main',()=>child.slots.register({name:'main',key:'local-scean'},Panel)),child.slots.inject('conversation.input.dock',()=>child.slots.register({name:'conversation.input.dock',id:'local-scean-entry',order:18},Entry))];
      child.effect(()=>()=>{notifications?.dispose();unsubscribe();window.removeEventListener('scean:open',open);window.removeEventListener('scean:context',context);for(const panel of panels){panel.stopPresentation?.();panel.port.onmessage=null;panel.port.close();void panel.bridge.dispose();}panels.clear();selections.clear();disposers.reverse().forEach(fn=>fn());},'scean shared player cleanup');
    });
  });}};
}
