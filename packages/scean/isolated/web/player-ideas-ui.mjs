const categories=['玩家行動','角色自主','場景展開','世界自然運轉','意外與轉折'];
const key=context=>context?.runId?JSON.stringify([context.runId,context.version,context.head??null,context.snapshot?.hash??context.snapshotHash??null,context.selectionStamp??context.selectionEpoch??null]):null;

/** One optional request. Results only become editable draft text, never a turn. */
export function mountPlayerIdeas({document:doc=globalThis.document,request,getContext,preserveReading=()=>()=>{}}={}){
  const input=doc.getElementById('input'),form=doc.getElementById('turn-form');
  const region=doc.createElement('section');region.id='player-ideas';region.setAttribute('aria-label','敘事靈感');
  const button=doc.createElement('button');button.type='button';button.id='player-ideas-generate';button.className='quiet';button.textContent='給我一點想法';
  const status=doc.createElement('p');status.id='player-ideas-status';status.className='hint';status.setAttribute('role','status');
  const list=doc.createElement('div');list.id='player-ideas-list';
  const collapse=doc.createElement('button');collapse.type='button';collapse.id='player-ideas-toggle';collapse.className='quiet';collapse.textContent='想法';collapse.setAttribute('aria-controls','player-ideas-panel');collapse.setAttribute('aria-expanded','false');collapse.setAttribute('aria-haspopup','dialog');
  const panel=doc.createElement('section');panel.id='player-ideas-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','player-ideas-title');
  const title=doc.createElement('h2');title.id='player-ideas-title';title.textContent='劇情想法';
  const close=doc.createElement('button');close.type='button';close.id='player-ideas-close';close.className='quiet';close.textContent='收起';
  const cancel=doc.createElement('button');cancel.type='button';cancel.id='player-ideas-cancel';cancel.className='quiet';cancel.textContent='取消取得';cancel.hidden=true;
  const heading=doc.createElement('header');heading.append(title,close);panel.append(heading,button,cancel,status,list);region.append(collapse);
  const actions=doc.querySelector?.('.composer-actions');if(actions)actions.prepend(region);else form.before(region);
  (doc.body??region).append(panel);
  let serial=0,contextKey=null,busy=false,controller=null,composing=false,disposed=false;
  const view=doc.defaultView;
  const listen=(node,name,fn)=>{node?.addEventListener?.(name,fn);return()=>node?.removeEventListener?.(name,fn);};
  const controls=()=>{const context=getContext(),disabled=disposed||!context?.runId||context.disabled===true;button.disabled=disabled||busy;collapse.disabled=disabled;cancel.hidden=!busy;};
  function position(){
    if(panel.hidden||!input.getBoundingClientRect)return;
    const composer=doc.querySelector('.composer'),box=(composer??input).getBoundingClientRect(),field=input.getBoundingClientRect(),top=doc.querySelector('.topbar')?.getBoundingClientRect().bottom??0;
    const height=view?.innerHeight??globalThis.innerHeight,width=view?.innerWidth??globalThis.innerWidth;
    // Above the input, in viewport coordinates. Neither panel nor results take layout space.
    const bottom=Math.max(8,height-Math.min(box.top,field.top)+8),available=Math.max(0,height-bottom-top-8);
    panel.style.left=Math.max(8,Math.min(box.left,width-Math.min(420,box.width,width-16)-8))+'px';panel.style.bottom=bottom+'px';panel.style.width=Math.max(0,Math.min(420,box.width,width-16))+'px';panel.style.maxHeight=Math.min(360,available)+'px';
  }
  function setOpen(open,{returnFocus=false}={}){const restore=preserveReading();panel.hidden=!open;collapse.setAttribute('aria-expanded',String(open));if(open){panel.scrollTop=0;position();}if(returnFocus)collapse.focus({preventScroll:true});restore?.();}
  function clear(){list.replaceChildren();}
  function reset(){serial++;controller?.abort();controller=null;busy=false;contextKey=null;clear();status.textContent='';setOpen(false);controls();}
  function update(run){const next=key(run);if(next!==contextKey){serial++;controller?.abort();controller=null;busy=false;contextKey=next;const restore=preserveReading();clear();status.textContent='';setOpen(false);restore?.();}controls();}
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
    input.dispatchEvent(new EventType('input',{bubbles:true}));setOpen(false);status.textContent='已放入草稿；可以改寫，再自行送出。';restore?.();
  }
  async function generate(){
    controls();if(button.disabled)return;const context=getContext(),expected=key(context),epoch=++serial;controller?.abort();controller=new AbortController();const own=controller;
    busy=true;setOpen(true);clear();status.textContent='正在想五個不同的方向…';controls();
    try{
      const requestId=globalThis.crypto.randomUUID();
      const value=await request('playerIdeas',{runId:context.runId,expectedHead:context.head??null,expectedVersion:context.version,requestId},own.signal);
      if(disposed||epoch!==serial||expected!==key(getContext()))return;
      if(value?.runId!==context.runId||value.head!==(context.head??null)||value.version!==context.version||value.snapshotHash!==(context.snapshot?.hash??context.snapshotHash)||!Array.isArray(value.ideas)||value.ideas.length!==5||value.ideas.some((row,index)=>row.category!==categories[index]||typeof row.text!=='string'||!row.text.trim()))throw Object.assign(Error('想法已過期或格式不完整。'),{code:'IDEAS_INVALID_RESPONSE'});
      const restore=preserveReading();
      for(const idea of value.ideas){const option=doc.createElement('button');option.type='button';option.className='quiet player-idea';option.style.cssText='text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;';const title=doc.createElement('strong'),text=doc.createElement('span');title.textContent=idea.category;text.textContent='\n'+idea.text;option.append(title,text);option.addEventListener('click',()=>choose(idea.text,expected));list.append(option);}
      position();
      status.textContent='只是靈感，尚未發生。選一項放入草稿，或再想一組。';restore?.();
    }catch(error){if(disposed||epoch!==serial)return;status.textContent=error.code==='IDEAS_STALE'?'故事已更新，舊想法已失效；可重新取得。':error.code==='IDEAS_NO_STORY'?'先保存一輪故事，再來找靈感。':'這次未取得完整想法；不會自動重試，故事與草稿都保留。';}
    finally{if(epoch===serial){busy=false;controller=null;controls();}}
  }
  const keepDraftFocus=event=>{if(doc.activeElement===input)event.preventDefault();};
  const onEscape=event=>{if(event.key==='Escape'&&!event.isComposing&&!panel.hidden){event.preventDefault();event.stopPropagation?.();setOpen(false,{returnFocus:true});}};
  const cleanups=[listen(button,'click',()=>void generate()),listen(collapse,'click',()=>setOpen(panel.hidden)),listen(close,'click',()=>setOpen(false)),listen(cancel,'click',()=>{serial++;controller?.abort();controller=null;busy=false;status.textContent='已取消取得想法；故事與草稿都保留。';controls();}),listen(panel,'keydown',onEscape),listen(collapse,'keydown',event=>{if(event.key==='Escape')onEscape(event);else if(!panel.hidden&&(event.key==='ArrowDown'||(event.key==='Tab'&&!event.shiftKey))){event.preventDefault();button.focus({preventScroll:true});}}),listen(input,'compositionstart',()=>{composing=true;}),listen(input,'compositionend',()=>{composing=false;}),listen(view,'resize',position),listen(view?.visualViewport,'resize',position),listen(view?.visualViewport,'scroll',position)];
  for(const node of [collapse,close,button,cancel]){cleanups.push(listen(node,'pointerdown',keepDraftFocus),listen(node,'mousedown',keepDraftFocus));}
  cleanups.push(listen(doc,'pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!region.contains(event.target))setOpen(false);}));
  const Observer=view?.ResizeObserver,observer=Observer?new Observer(position):null;observer?.observe(doc.querySelector('.composer')??input);
  controls();return {update,reset,dispose(){if(disposed)return;reset();disposed=true;observer?.disconnect();for(const clean of cleanups)clean();panel.remove();region.remove();}};
}
