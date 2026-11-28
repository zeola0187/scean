// Run-only recoverable lifecycle UI. A receipt, never a timeout, decides success.
export function createRunRecycle({h,call,store,onChanged,scopeKey}){
  const dialog=h('dialog',{class:'recycle-dialog','aria-labelledby':'recycle-heading'}),heading=h('h2',{id:'recycle-heading'}),content=h('div'),message=h('p',{role:'status'}),buttons=h('div',{class:'row'});
  dialog.append(heading,content,message,buttons);document.body.append(dialog);
  let pending=null,busy=false,serial=0;
  const scope=()=>scopeKey(),persist=()=>call('native.lifecyclePending',{pending}).catch(()=>{});
  const close=h('button',{class:'ghost',type:'button',onclick:()=>{if(!busy)dialog.close();}},'取消');
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  function reset(){serial++;if(dialog.open)dialog.close();busy=false;}
  function open(title){heading.textContent=title;content.replaceChildren();message.textContent='';buttons.replaceChildren(close);if(!dialog.open)dialog.showModal();close.focus();}
  async function lookup(){if(!pending||pending.scope!==scope()||busy)return;busy=true;const token=serial;
    try{const value=await call('runLifecycleStatus',{runId:pending.runId,operationId:pending.operationId});if(token!==serial)return;if(value.operationStatus==='committed')await finish(value);else message.textContent='尚未查到完成回執。請稍後再查；不會自動重送。';}
    catch{if(token===serial)message.textContent='結果仍無法確認，請稍後查回。';}finally{if(token===serial)busy=false;}
  }
  async function finish(value){pending=null;await persist();if(dialog.open)dialog.close();await onChanged(value);}
  async function confirm(row,action){
    if(busy)return;const token=++serial,owner=scope();
    open(action==='runTrash'?'將這場演出移入回收區？':'恢復這場演出？');
    content.append(h('p',null,row.title??row.cardId??'演出'),h('p',{class:'meta'},[row.playerName?`主角：${row.playerName}`:null,`劇本版本 ${row.revision??'—'}`,`已保存 ${row.turnCount??0} 回合`,row.createdAt?new Date(row.createdAt).toLocaleString():null,`識別：${row.runId.slice(-12)}`].filter(Boolean).join(' · ')),h('p',null,action==='runTrash'?'這場演出的進度與筆記會保留，可從回收區恢復。劇本、來源工作卡與其他演出都會保留。':'恢復原來的進度，不會自動開局或送出行動。'));
    const commit=h('button',{class:'primary',type:'button'},action==='runTrash'?'移入回收區':'恢復演出');buttons.append(commit);
    if(pending?.scope===owner)buttons.append(h('button',{class:'ghost',type:'button',onclick:lookup},'查回上次結果'));
    commit.onclick=async()=>{
      if(busy||token!==serial||owner!==scope())return;
      if(pending&&pending.scope===owner&&(pending.runId!==row.runId||pending.action!==action)){message.textContent='請先查回上一次操作的結果。';return;}
      busy=true;commit.disabled=true;close.disabled=true;
      try{
        const state=store.get();if(state.runId===row.runId&&state.op)throw Object.assign(Error('請等生成、保存及提交結果確認完成。'),{code:'RUN_BUSY'});
        if(state.runId===row.runId&&state.draft)await call('draftSave',{runId:row.runId,input:state.draft,requestId:crypto.randomUUID(),...(state.viewerId?{viewerId:state.viewerId}:{})});
        pending=pending?.scope===owner?pending:{scope:owner,action,runId:row.runId,operationId:crypto.randomUUID(),expectedLifecycleRevision:row.lifecycleRevision??0,expectedVersion:row.version,expectedHead:row.head??null,confirmed:true};await persist();
        const {scope:ignored,action:ignoredAction,...payload}=pending,value=await call(action,payload);
        if(token===serial&&owner===scope())await finish(value);
      }catch(error){
        if(token===serial){if(['RUN_BUSY','RUN_LIFECYCLE_CHANGED','VERSION_CONFLICT','HISTORY_HEAD_CONFLICT','RUN_LIFECYCLE_UNRESOLVED','RUN_LIFECYCLE_CONFIRM_REQUIRED','RUN_LIFECYCLE_DENIED'].includes(error.code)){pending=null;await persist();}
          message.textContent=(error.message??'操作結果無法確認。')+(pending?' 請查回結果；不會自動重送。':' 請重新讀取並確認。');
          if(pending)buttons.append(h('button',{class:'ghost',type:'button',onclick:lookup},'查回結果'));}
      }finally{if(token===serial){busy=false;commit.disabled=false;close.disabled=false;}}
    };
  }
  async function show(){const token=++serial,owner=scope();open('演出回收區');message.textContent='讀取中…';
    try{const stored=await call('native.lifecyclePending',{});if(stored)pending=stored;const rows=await call('runRecycleList');if(token!==serial||owner!==scope())return;
      message.textContent=rows.length?'進度仍保留，可逐場恢復。':'回收區是空的。';
      for(const row of rows)content.append(h('section',{class:'recycle-row'},h('p',null,`${row.title??row.cardId} · ${row.playerName??''} · ${row.turnCount??0} 回合 · ${row.runId.slice(-12)}`),h('button',{class:'ghost',type:'button',onclick:()=>confirm(row,'runRestore')},'恢復演出')));
      if(pending?.scope===owner)buttons.append(h('button',{class:'primary',type:'button',onclick:lookup},'查回上次結果'));
    }catch{if(token===serial)message.textContent='目前無法讀取回收區，請稍後再試。';}
  }
  return {confirm,show,reset};
}
