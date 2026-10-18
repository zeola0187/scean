import {renderFrontendDocument} from './frontend-runtime.mjs';
// Trusted platform owns lifetime, canonical sequencing and freshness. No messages
// from card content are accepted. The opaque card frame has zero script grants.
export function mountCardFrontend({document:doc=globalThis.document,now=()=>Date.now(),staleMs=15000,setTimer=setInterval,clearTimer=clearInterval}={}){
  const box=doc.createElement('section');box.id='card-frontend';box.setAttribute('aria-label','卡片專屬動態前端');
  const heading=doc.createElement('h2');heading.textContent='卡片畫面';
  const status=doc.createElement('p');status.id='card-frontend-status';status.setAttribute('role','status');
  const toggle=doc.createElement('button');toggle.type='button';toggle.id='card-frontend-toggle';toggle.textContent='使用官方顯示';
  const frame=doc.createElement('iframe');frame.title='卡片專屬動態前端';frame.id='card-frontend-frame';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='width:100%;height:460px;border:1px solid;display:block;background:white;color:black';
  box.append(heading,status,toggle,frame);box.hidden=true;doc.getElementById('chat').before(box);
  let packet=null,runKey=null,lastVersion=-1,lastHead=null,lastAt=0,disabled=false,fresh=false;
  const fallback=message=>{frame.hidden=true;frame.removeAttribute('srcdoc');status.textContent=message;};
  function paint(){
    if(!packet)return;
    if(disabled){fallback('已停用卡片畫面；文字與官方狀態顯示繼續可用。');return;}
    try{frame.srcdoc=renderFrontendDocument(packet.frontend,{...packet.projection,freshness:fresh?'current':'stale'});frame.hidden=false;status.textContent=fresh?'唯讀 · 已提交 v'+lastVersion+' · '+packet.frontend.hash.slice(0,12):'資料過期／同步中；不顯示目前安全。';}
    catch{fallback('FRONTEND_RENDER_FAILED：卡片畫面不可用，請使用官方顯示。');}
  }
  toggle.addEventListener('click',()=>{disabled=!disabled;toggle.textContent=disabled?'顯示卡片畫面':'使用官方顯示';paint();});
  frame.addEventListener('error',()=>fallback('FRONTEND_LOAD_FAILED：請使用官方顯示。'));
  function clear(){packet=null;runKey=null;lastVersion=-1;lastHead=null;lastAt=0;fresh=false;box.hidden=true;frame.removeAttribute('srcdoc');}
  function update(run){
    const nextKey=run?run.runId+':'+run.snapshot?.hash:null;if(nextKey!==runKey){clear();runKey=nextKey;disabled=false;toggle.textContent='使用官方顯示';}
    const p=run?.cardFrontend;if(!p){clear();return;}
    box.hidden=false;
    if(p.status!=='ready'){packet=null;fallback((p.code??'FRONTEND_UNAVAILABLE')+'：使用官方狀態顯示。');return;}
    const v=p.projection;
    if(v.runId!==run.runId||v.cardId!==run.snapshot.cardId||v.snapshotHash!==run.snapshot.hash||v.frontendHash!==p.frontend.hash||v.canonical.version!==run.version||v.canonical.head!==(run.head??null)||v.canonical.version<lastVersion||v.canonical.version===lastVersion&&lastHead!==v.canonical.head){fresh=false;fallback('FRONTEND_PROJECTION_MISMATCH：等待正確狀態。');return;}
    const changed=lastVersion!==v.canonical.version||!fresh||packet?.frontend.hash!==p.frontend.hash;
    packet=p;lastVersion=v.canonical.version;lastHead=v.canonical.head;lastAt=now();fresh=true;if(changed)paint();
  }
  function heartbeat(ok=true){if(!packet)return;if(ok){lastAt=now();if(!fresh){fresh=true;paint();}}else if(fresh){fresh=false;paint();}}
  const timer=setTimer(()=>{if(packet&&fresh&&now()-lastAt>staleMs){fresh=false;paint();}},1000);
  return {update,clear,heartbeat,dispose(){clear();clearTimer(timer);box.remove();}};
}
