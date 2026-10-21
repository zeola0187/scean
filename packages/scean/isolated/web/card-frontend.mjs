import {renderFrontendDocument} from './frontend-runtime.mjs';
// Trusted platform owns lifetime, canonical sequencing and freshness. No messages
// from card content are accepted. The opaque card frame has zero script grants.
export function mountCardFrontend({document:doc=globalThis.document,now=()=>Date.now(),staleMs=15000,setTimer=setInterval,clearTimer=clearInterval,preserveReading=()=>()=>{}}={}){
  const box=doc.createElement('section');box.id='card-frontend';box.setAttribute('aria-label','卡片專屬動態前端');
  const heading=doc.createElement('h2');heading.textContent='卡片畫面';
  const status=doc.createElement('p');status.id='card-frontend-status';status.setAttribute('role','status');
  const toggle=doc.createElement('button');toggle.type='button';toggle.id='card-frontend-toggle';toggle.textContent='使用官方顯示';
  const frame=doc.createElement('iframe');frame.title='卡片專屬動態前端';frame.id='card-frontend-frame';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='width:100%;height:460px;border:1px solid;display:block;background:white;color:black';
  // Mount once. Committed messages extend chat without reparenting this iframe.
  box.append(heading,status,toggle,frame);box.hidden=true;doc.getElementById('chat').after(box);
  let packet=null,runKey=null,lastVersion=-1,lastHead=null,lastPresentation=-1,lastAt=0,disabled=false,fresh=false,canonical=null,history=null;
  function syncVisibility(){
    const visible=canonical&&history&&history.runId===canonical.runId&&history.snapshotHash===canonical.snapshotHash&&history.head===canonical.head;
    if(box.hidden===!visible)return;
    const restore=preserveReading();box.hidden=!visible;restore?.();
  }
  const fallback=message=>{frame.hidden=true;frame.removeAttribute('srcdoc');status.textContent=message;};
  function paint(){
    if(!packet)return;
    if(disabled){fallback('已停用卡片畫面；文字與官方狀態顯示繼續可用。');return;}
    try{const restore=preserveReading();frame.srcdoc=renderFrontendDocument(packet.frontend,{...packet.projection,freshness:fresh?'current':'stale'});frame.hidden=false;status.textContent=fresh?'目前已保存的狀態 · 唯讀面板':'資料過期／同步中；不顯示目前安全。';restore?.();}
    catch{fallback('FRONTEND_RENDER_FAILED：卡片畫面不可用，請使用官方顯示。');}
  }
  toggle.addEventListener('click',()=>{disabled=!disabled;toggle.textContent=disabled?'顯示卡片畫面':'使用官方顯示';paint();});
  frame.addEventListener('error',()=>fallback('FRONTEND_LOAD_FAILED：請使用官方顯示。'));
  function clear(){packet=null;runKey=null;lastVersion=-1;lastHead=null;lastPresentation=-1;lastAt=0;fresh=false;canonical=null;history=null;box.hidden=true;frame.removeAttribute('srcdoc');for(const key of ['run-id','version','head','presentation-revision'])box.removeAttribute('data-'+key);}
  function update(run){
    const nextKey=run?run.runId+':'+run.snapshot?.hash:null;if(nextKey!==runKey){clear();runKey=nextKey;disabled=false;toggle.textContent='使用官方顯示';}
    const p=run?.cardFrontend;if(!p){
      if(!run){clear();return;}
      const revision=run.presentationRevision??0;if(revision<lastPresentation)return;
      packet=null;lastPresentation=revision;lastVersion=run.version;lastHead=run.head??null;canonical={runId:run.runId,snapshotHash:run.snapshot.hash,head:lastHead};box.hidden=true;frame.removeAttribute('srcdoc');return;
    }
    const presentation=p.projection?.presentationRevision??p.presentationRevision??run.presentationRevision??0;
    if(!Number.isSafeInteger(presentation)||presentation<0||presentation<lastPresentation)return;
    if(run.presentationRevision!==undefined&&run.presentationRevision!==presentation){packet=null;fresh=false;fallback('面板同步中，請暫用官方狀態顯示。');return;}
    canonical={runId:run.runId,snapshotHash:run.snapshot.hash,head:run.head??null};syncVisibility();
    if(p.status!=='ready'){packet=null;lastPresentation=presentation;fallback((p.code??'FRONTEND_UNAVAILABLE')+'：使用官方狀態顯示。');return;}
    const v=p.projection;
    if(presentation===lastPresentation&&packet&&packet.frontend.hash!==p.frontend.hash){fallback('面板版本不一致，正在等待同步。');return;}
    if(v.runId!==run.runId||v.cardId!==run.snapshot.cardId||v.snapshotHash!==run.snapshot.hash||v.frontendHash!==p.frontend.hash||v.canonical.version!==run.version||v.canonical.head!==(run.head??null)||v.canonical.version<lastVersion||v.canonical.version===lastVersion&&lastHead!==v.canonical.head){packet=null;fresh=false;fallback('FRONTEND_PROJECTION_MISMATCH：等待正確狀態。');return;}
    const changed=lastVersion!==v.canonical.version||lastPresentation!==presentation||!fresh||packet?.frontend.hash!==p.frontend.hash;
    packet=p;lastVersion=v.canonical.version;lastHead=v.canonical.head;lastPresentation=presentation;lastAt=now();fresh=true;box.setAttribute('data-run-id',run.runId);box.setAttribute('data-version',String(lastVersion));box.setAttribute('data-head',lastHead??'');box.setAttribute('data-presentation-revision',String(presentation));if(changed)paint();
  }
  function heartbeat(ok=true){if(!packet)return;if(ok){lastAt=now();if(!fresh){fresh=true;paint();}}else if(fresh){fresh=false;paint();}}
  const timer=setTimer(()=>{if(packet&&fresh&&now()-lastAt>staleMs){fresh=false;paint();}},1000);
  return {update,clear,heartbeat,history(value){history=value;syncVisibility();},dispose(){clear();clearTimer(timer);box.remove();}};
}
