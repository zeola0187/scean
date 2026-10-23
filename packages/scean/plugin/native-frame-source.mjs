// Executes inside the opaque-origin sandbox. No network fallback is provided.
export function nativeFrameBootstrap(){
  let port,sequence=0,selection=null,presentation=null;const pending=new Map(),handlers=new Set(),presentationHandlers=new Set(),notificationHandlers=new Set();
  let connected;const ready=new Promise(resolve=>connected=resolve);
  const connect=event=>{
    if(event.source!==parent||event.data?.kind!=='scean-native-connect'||!event.ports?.[0]||port)return;
    port=event.ports[0];window.removeEventListener('message',connect);
    port.onmessage=event=>{
      const m=event.data;
      if(m?.kind==='context'){selection={runId:m.runId??null,notificationTarget:m.notificationTarget??null};for(const handler of handlers)handler(selection);return;}
      if(m?.kind==='notification-settings'){for(const handler of notificationHandlers)handler(m.value);return;}
      if(m?.kind==='presentation-environment'){
        if(typeof m.dark!=='boolean')return;
        presentation=Object.freeze({dark:m.dark,...(m.preferences?.schemaVersion===1?{preferences:m.preferences}:{})});for(const handler of presentationHandlers)handler(presentation);return;
      }
      if(m?.kind!=='response')return;const item=pending.get(m.id);if(!item)return;pending.delete(m.id);item.cleanup();m.ok?item.resolve(m.value):item.reject(Object.assign(new Error(m.error?.message??'Native RPC failed'),m.error));
    };
    port.start();connected();
  };
  window.addEventListener('message',connect);
  async function request(action,payload={},signal){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');await ready;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    return new Promise((resolve,reject)=>{
      const id=String(++sequence),abort=()=>{pending.delete(id);reject(new DOMException('Aborted','AbortError'));};
      pending.set(id,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});signal?.addEventListener('abort',abort,{once:true});port.postMessage({kind:'request',id,action,payload});
    });
  }
  globalThis.__SCEAN_NATIVE__=Object.freeze({request,bootstrap:()=>request('native.bootstrap'),openStudio:()=>request('native.openStudio'),onSelect(handler){handlers.add(handler);if(selection)handler(selection);return()=>handlers.delete(handler);},onNotificationSettings(handler){notificationHandlers.add(handler);return()=>notificationHandlers.delete(handler);},onPresentation(handler){presentationHandlers.add(handler);if(presentation)handler(presentation);return()=>presentationHandlers.delete(handler);}});
}
