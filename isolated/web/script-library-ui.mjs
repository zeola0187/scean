// Saved scripts are immutable sources; each performance retains its own Run.
// Unknown preparation outcomes are looked up by the original operation ID.
export function mountScriptLibrary({document:doc=globalThis.document,request,getScopeKey=()=>'',onOffer=async()=>{},onCreated=async()=>{},onReturn=async()=>{},makeId=()=>globalThis.crypto.randomUUID()}={}){
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const root=doc.getElementById('runs'),status=el('p',undefined,'hint'),lookup=el('button','查回開場準備結果','quiet');status.id='script-library-status';status.setAttribute('role','status');lookup.id='script-library-recheck';lookup.type='button';lookup.hidden=true;root.before(status,lookup);
 let busy=false,serial=0,pending=null,storage;try{storage=doc.defaultView?.sessionStorage;}catch{}
 const storageKey='scean-script-start-pending-v1';
 try{const value=JSON.parse(storage?.getItem(storageKey)??'null');if(value&&typeof value.scope==='string'&&typeof value.scriptId==='string'&&typeof value.scriptHash==='string'&&typeof value.operationId==='string')pending=value;}catch{}
 const persist=()=>{try{if(pending)storage?.setItem(storageKey,JSON.stringify(pending));else storage?.removeItem(storageKey);}catch{}};
 const sync=()=>{lookup.hidden=!pending||pending.scope!==getScopeKey();lookup.disabled=busy;for(const b of root.querySelectorAll('[data-script-start]'))b.disabled=busy||!!pending&&pending.scope===getScopeKey();};
 async function finish(value){
   if(value.runId){pending=null;persist();await onCreated(value);status.textContent='演出已建立。';}
   else if(value.openingRequired||value.status==='prepared'){pending=null;persist();await onOffer(value);status.textContent='請確認開場與主角名稱，再開始這場演出。';}
   else if(value.status==='not_committed'){pending=null;persist();status.textContent='尚未建立演出；可明確重新準備開場。';}
   else status.textContent='結果仍未確認，請稍後查回。';
 }
 async function recheck(){if(busy||!pending||pending.scope!==getScopeKey())return;const token=serial,scope=getScopeKey();busy=true;sync();try{const value=await request('scriptStatus',{operationId:pending.operationId});if(token!==serial||scope!==getScopeKey())return;await finish(value);}catch(error){if(token===serial)status.textContent=error.message??'結果仍無法確認；可再查回。';}finally{if(token===serial){busy=false;sync();}}}
 async function start(script){
   if(busy||pending&&pending.scope===getScopeKey())return;const token=serial,scope=getScopeKey();busy=true;status.textContent='正在準備已保存劇本的開場…';sync();
   try{const saved=await request('scriptGet',{scriptId:script.scriptId});if(token!==serial||scope!==getScopeKey())return;if(saved.scriptHash!==script.scriptHash)throw Error('劇本版本已改變，請重新整理書架。');
     pending={scope,scriptId:saved.scriptId,scriptHash:saved.scriptHash,expectedRevision:saved.revision,operationId:makeId()};persist();
     const {scope:ignored,...payload}=pending,value=await request('scriptStart',payload);if(token!==serial||scope!==getScopeKey())return;await finish(value);
   }catch(error){if(token===serial)status.textContent=(error.message??'開場準備未完成。')+(pending?' 請查回同一次操作；不會自動重送。':'');}
   finally{if(token===serial){busy=false;sync();}}
 }
 lookup.addEventListener('click',()=>void recheck());
 return {reset(){serial++;busy=false;status.textContent='';sync();},render({scripts=[],runs=[],renderRun,error}={}){
   root.replaceChildren();const assigned=new Set();
   for(const script of scripts){const section=el('section',undefined,'script-entry');section.dataset.scriptId=script.scriptId;const title=el('h3',script.title??'已保存劇本'),meta=el('p',`固定版本 ${script.revision??'—'} · ${runs.filter(r=>r.scriptId===script.scriptId).length} 場演出`,'hint');
     const startButton=el('button','以此劇本開始新演出','quiet');startButton.type='button';startButton.dataset.scriptStart=script.scriptId;startButton.addEventListener('click',()=>void start(script));section.append(title,meta,startButton);
     if(script.sourceSessionId){const back=el('button','返回劇本創作對話','quiet');back.type='button';back.addEventListener('click',()=>void onReturn({scriptId:script.scriptId}).catch(error=>{status.textContent=error.message??'無法返回來源對話。';}));section.append(back);}
     const performances=el('div',undefined,'script-performances');for(const row of [...runs].reverse())if(row.scriptId===script.scriptId){assigned.add(row.runId);renderRun(performances,row);}if(!performances.children.length)performances.append(el('p','尚無演出；確認開場後才建立。','hint'));section.append(performances);root.append(section);
   }
   const legacy=runs.filter(r=>!assigned.has(r.runId));if(legacy.length){const section=el('section',undefined,'script-entry legacy-performances');section.append(el('h3','既有演出'));for(const row of [...legacy].reverse())renderRun(section,row);root.append(section);}
   if(!scripts.length&&!runs.length)root.append(el('p','此卡尚無劇本或演出。請從創作對話保存並交接劇本。','hint'));
   if(error)status.textContent='劇本清單暫不可用；既有演出仍可閱讀。'+(error.message??'');sync();
 },recheck};
}
