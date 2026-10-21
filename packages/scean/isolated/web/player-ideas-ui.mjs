const categories=['玩家行動','角色自主','場景展開','世界自然運轉','意外與轉折'];
const key=context=>context?.runId?JSON.stringify([context.runId,context.version,context.head??null,context.snapshot?.hash??context.snapshotHash??null,context.selectionStamp??context.selectionEpoch??null]):null;

/** One optional request. Results only become editable draft text, never a turn. */
export function mountPlayerIdeas({document:doc=globalThis.document,request,getContext,preserveReading=()=>()=>{}}={}){
  const input=doc.getElementById('input'),form=doc.getElementById('turn-form');
  const region=doc.createElement('section');region.id='player-ideas';region.setAttribute('aria-label','敘事靈感');
  const button=doc.createElement('button');button.type='button';button.id='player-ideas-generate';button.className='quiet';button.textContent='給我一點想法';
  const status=doc.createElement('p');status.id='player-ideas-status';status.className='hint';status.setAttribute('role','status');
  const list=doc.createElement('div');list.id='player-ideas-list';list.style.cssText='display:grid;gap:8px;max-width:100%;max-height:min(40vh,320px);max-height:min(40dvh,320px);overflow:auto;overscroll-behavior:contain;';
  const collapse=doc.createElement('button');collapse.type='button';collapse.id='player-ideas-toggle';collapse.className='quiet';collapse.textContent='收起想法';collapse.hidden=true;collapse.setAttribute('aria-controls',list.id);collapse.setAttribute('aria-expanded','true');
  region.append(button,status,collapse,list);form.before(region);
  let serial=0,contextKey=null,busy=false,controller=null,composing=false,disposed=false;
  const listen=(node,name,fn)=>{node.addEventListener(name,fn);return()=>node.removeEventListener(name,fn);};
  const controls=()=>{const context=getContext();button.disabled=disposed||!context?.runId||context.disabled===true||busy;};
  function clear(){list.replaceChildren();list.hidden=false;collapse.hidden=true;collapse.textContent='收起想法';collapse.setAttribute('aria-expanded','true');}
  function reset(){serial++;controller?.abort();controller=null;busy=false;contextKey=null;clear();status.textContent='';controls();}
  function update(run){const next=key(run);if(next!==contextKey){serial++;controller?.abort();controller=null;busy=false;contextKey=next;const restore=preserveReading();clear();status.textContent='';restore?.();}controls();}
  function choose(idea,expected){
    if(disposed||busy||composing||input.disabled||key(getContext())!==expected){if(composing)status.textContent='請先完成目前的輸入，再選擇想法。';return;}
    const restore=preserveReading(),text=input.value??'',position=Number.isSafeInteger(input.selectionStart)?Math.min(text.length,Math.max(0,input.selectionStart)):text.length;
    const prefix=text.slice(0,position),suffix=text.slice(position),insert=(prefix&&!/\s$/.test(prefix)?'\n':'')+idea+(suffix&&!/^\s/.test(suffix)?'\n':'');
    if(Number.isSafeInteger(input.maxLength)&&input.maxLength>=0&&text.length+insert.length>input.maxLength){status.textContent='草稿已接近長度上限，請先整理文字再插入。';return;}
    // Insert at the cursor without replacing a selection or existing draft.
    if(typeof input.setRangeText==='function')input.setRangeText(insert,position,position,'end');
    else{input.value=prefix+insert+suffix;input.selectionStart=input.selectionEnd=position+insert.length;}
    input.focus({preventScroll:true});
    const EventType=doc.defaultView?.Event??globalThis.Event;
    input.dispatchEvent(new EventType('input',{bubbles:true}));status.textContent='已放入草稿；可以改寫，再自行送出。';restore?.();
  }
  async function generate(){
    controls();if(button.disabled)return;const context=getContext(),expected=key(context),epoch=++serial;controller?.abort();controller=new AbortController();const own=controller;
    busy=true;clear();status.textContent='正在想五個不同的方向…';controls();
    try{
      const requestId=globalThis.crypto.randomUUID();
      const value=await request('playerIdeas',{runId:context.runId,expectedHead:context.head??null,expectedVersion:context.version,requestId},own.signal);
      if(disposed||epoch!==serial||expected!==key(getContext()))return;
      if(value?.runId!==context.runId||value.head!==(context.head??null)||value.version!==context.version||value.snapshotHash!==(context.snapshot?.hash??context.snapshotHash)||!Array.isArray(value.ideas)||value.ideas.length!==5||value.ideas.some((row,index)=>row.category!==categories[index]||typeof row.text!=='string'||!row.text.trim()))throw Object.assign(Error('想法已過期或格式不完整。'),{code:'IDEAS_INVALID_RESPONSE'});
      const restore=preserveReading();
      for(const idea of value.ideas){const option=doc.createElement('button');option.type='button';option.className='quiet player-idea';option.style.cssText='text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;';const title=doc.createElement('strong'),text=doc.createElement('span');title.textContent=idea.category;text.textContent='\n'+idea.text;option.append(title,text);option.addEventListener('click',()=>choose(idea.text,expected));list.append(option);}
      collapse.hidden=false;
      status.textContent='只是靈感，尚未發生。選一項放入草稿，或再想一組。';restore?.();
    }catch(error){if(disposed||epoch!==serial)return;status.textContent=error.code==='IDEAS_STALE'?'故事已更新，舊想法已失效；可重新取得。':error.code==='IDEAS_NO_STORY'?'先保存一輪故事，再來找靈感。':'這次未取得完整想法；不會自動重試，故事與草稿都保留。';}
    finally{if(epoch===serial){busy=false;controller=null;controls();}}
  }
  const cleanups=[listen(button,'click',()=>void generate()),listen(collapse,'click',()=>{if(collapse.hidden)return;const restore=preserveReading();list.hidden=!list.hidden;collapse.textContent=list.hidden?'展開想法':'收起想法';collapse.setAttribute('aria-expanded',String(!list.hidden));restore?.();}),listen(input,'compositionstart',()=>{composing=true;}),listen(input,'compositionend',()=>{composing=false;})];
  controls();return {update,reset,dispose(){if(disposed)return;reset();disposed=true;for(const clean of cleanups)clean();region.remove();}};
}
