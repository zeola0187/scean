// A display of Host operation timestamps, never a model-stage stopwatch.
const RUNNING=new Set(['accepted','running','cancel-requested']);
const LABELS={committed:'本輪用時',failed:'本次失敗',cancelled:'本次已取消',interrupted:'本次已中止',unknown:'結果待確認',retired:'本輪已退役'};
const stamp=value=>typeof value==='string'?Date.parse(value):NaN;
export function formatTurnDuration(ms){
  const seconds=Math.floor(Math.max(0,ms)/1000),s=String(seconds%60).padStart(2,'0'),m=String(Math.floor(seconds/60)%60).padStart(2,'0'),h=Math.floor(seconds/3600);
  return h?`${h}:${m}:${s}`:`${m}:${s}`;
}
export function turnDurationView(timing,{runId,now=0,receivedAt=now,disconnected=false}={}){
  if(!timing||timing.runId!==runId||timing.scope!=='host_operation'||!['turn','regenerate'].includes(timing.kind)||!timing.operationId||!timing.requestId)return {text:'',hidden:true};
  const start=stamp(timing.startedAt),end=stamp(timing.finishedAt),server=stamp(timing.serverNow),running=RUNNING.has(timing.status);
  if(!Number.isFinite(start)||!Number.isFinite(server)||server<start)return {text:'',hidden:true};
  const live=running&&!Number.isFinite(end),elapsed=(live?server+Math.max(0,now-receivedAt):end)-start;
  const label=running?(disconnected?'結果待確認':timing.status==='cancel-requested'?'正在取消':'生成中'):LABELS[timing.status];
  if(!label)return {text:'',hidden:true};
  // A canonical receipt may survive a crash without a recorded completion time.
  // Never substitute the restart/reconnect time or model completion time.
  const valid=Number.isFinite(elapsed)&&elapsed>=0;
  return {text:valid?`${label} ${formatTurnDuration(elapsed)}`:timing.status==='committed'?'本輪已保存 · 耗時未記錄':`${label} · 耗時未記錄`,hidden:false};
}
export function mountTurnDuration({element,now=()=>globalThis.performance.now(),interval=globalThis.setInterval,clear=globalThis.clearInterval}){
  let timing=null,runId=null,receivedAt=0,disconnected=false;
  element.setAttribute('role','timer');element.setAttribute('aria-live','off');
  element.title='從 Host 接受本次操作到完成提交確認，包含工具、驗證與結算；不含送達 Host 前的等待或提交後背景摘要。每次重試分開計時。';
  const render=()=>{const next=turnDurationView(timing,{runId,receivedAt,now:now(),disconnected});if(element.textContent!==next.text)element.textContent=next.text;element.hidden=next.hidden;};
  const timer=interval(render,1000);
  return {update(value,context){timing=value;runId=context.runId;disconnected=!!context.disconnected;receivedAt=now();render();},connection(value){disconnected=!value;render();},clear(){timing=null;runId=null;render();},dispose(){clear(timer);}};
}
