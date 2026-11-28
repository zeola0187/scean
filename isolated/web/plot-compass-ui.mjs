const presets=['情感拉扯','修羅場','權謀博弈','懸疑調查','奇幻冒險','副本闖關','經營養成','群像勢力','高自由沙盒','日常療癒','禁忌共犯','同人 IF 破局'];
const identity=c=>c?.runId?JSON.stringify([c.runId,c.version,c.head??null,c.selectionStamp??null]):null;

export function mountCompass({document:d,request,getContext,preserveReading=()=>()=>{},composerElement,actionsElement,triggerClass,topSelector='.topbar'}){
  const make=(tag,label,klass)=>{const node=d.createElement(tag);if(label)node.textContent=label;if(klass)node.className=klass;return node;};
  const button=(label,onclick)=>{const el=make('button',label,'quiet');el.type='button';el.addEventListener('click',onclick);return el;};
  const panel=make('section');panel.id='plot-compass-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','plot-compass-title');
  const trigger=button('羅盤',()=>panel.hidden?open():close());trigger.id='plot-compass-toggle';trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-haspopup','dialog');
  const form=d.getElementById('turn-form'),input=d.getElementById('input'),composer=composerElement??d.querySelector('.composer');if(triggerClass)trigger.className=triggerClass;
  const actions=actionsElement??d.querySelector('.composer-actions');if(actions)actions.prepend(trigger);else form.before(trigger);d.body.append(panel);
  const title=make('h2','劇情羅盤');title.id='plot-compass-title';
  const closing=button('收起',()=>close(true)),header=make('header');header.append(title,closing);
  const notes=make('p','只在你按下推演時使用模型。點亮的路線僅供導演參考。','hint');
  const direction=make('textarea');direction.rows=2;direction.maxLength=1000;direction.placeholder='例如：多相處幾輪，先不揭開秘密';
  const dirLabel=make('label','這次想往哪走（選填）');dirLabel.append(direction);
  const tags=make('div',null,'compass-row'),custom=make('input');custom.maxLength=24;custom.placeholder='自訂風格標籤';
  custom.setAttribute('aria-label','自訂風格標籤');const customRow=make('div',null,'compass-row');customRow.append(custom,button('加入',()=>{const tag=custom.value.trim();if(tag&&picked.size<5){picked.add(tag);custom.value='';paintTags();}else if(picked.size>=5)status.textContent='最多選五個風格標籤。';}));
  const generate=button('推演路線',()=>act('compassGenerate',{direction:direction.value,tags:[...picked],requestId:crypto.randomUUID()}));
  const cancel=button('停止等候',()=>{controller?.abort();});cancel.hidden=true;
  const blind=button('關閉盲盒',()=>act('compassBlind',{blind:!state?.blind}));
  const tools=make('div',null,'compass-row');tools.append(generate,cancel,blind);
  const status=make('p',null,'hint');status.setAttribute('role','status');
  const list=make('div');list.id='plot-compass-routes';
  panel.append(header,notes,dirLabel,make('p','風格標籤（選填，最多五個）','hint'),tags,customRow,tools,status,list);
  let last=null,lastRun=null,serial=0,state=null,busy=null,controller=null;const picked=new Set();
  function paintTags(){
    tags.replaceChildren();
    for(const tag of new Set([...presets,...picked])){const chip=button(tag,()=>{if(picked.has(tag))picked.delete(tag);else if(picked.size<5)picked.add(tag);else{status.textContent='最多選五個風格標籤。';return;}paintTags();});
      chip.setAttribute('aria-pressed',String(picked.has(tag)));tags.append(chip);}
  }
  function position(){
    if(panel.hidden)return;const box=(composer??input).getBoundingClientRect(),top=d.querySelector(topSelector)?.getBoundingClientRect().bottom??0,w=d.defaultView.innerWidth,h=d.defaultView.innerHeight;
    const bottom=Math.max(8,h-box.top+8),width=Math.max(0,Math.min(460,box.width,w-16));
    panel.style.width=width+'px';panel.style.left=Math.max(8,Math.min(box.left,w-width-8))+'px';panel.style.bottom=bottom+'px';panel.style.maxHeight=Math.max(60,h-bottom-top-8)+'px';
  }
  function close(focus=false){const restore=preserveReading();panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});restore?.();}
  function open(){const restore=preserveReading();panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();restore?.();void act('compassView');}
  function controls(){const disabled=!getContext()?.runId||getContext().disabled===true; trigger.disabled=disabled&&panel.hidden;generate.disabled=disabled||!!busy||!state;blind.disabled=disabled||!!busy||!state;cancel.hidden=busy!=='compassGenerate';}
  function paint(){
    list.replaceChildren();
    if(!state){controls();return;}
    blind.textContent=state.blind?'關閉盲盒':'開啟盲盒';
    const addCard=(route,active)=>{const card=make('article',null,'compass-route');
      card.append(make('strong',(active?(route.stale?'路線已失效 · ':'已點亮 · '):'')+route.span+' · '+route.tag),make('p',route.preview));
      if(route.detail)card.append(make('p',route.detail,'hint'));
      else if(state.blind)card.append(button('查看細節（有劇透）',()=>act('compassReveal',{routeId:route.id})));
      if(active)card.append(button('取消點亮',()=>act('compassClear')));
      else if(!state.batchStale&&route.id!==state.active?.id)card.append(button('點亮路線',()=>act('compassAdopt',{routeId:route.id,batchId:state.batchId})));
      list.append(card);
    };
    if(state.active)addCard(state.active,true);
    if(state.batchStale)list.append(make('p','故事已更新，舊候選可看，但要重新推演才能點亮。','hint'));
    for(const route of state.routes??[])if(route.id!==state.active?.id)addCard(route,false);
    controls();position();
  }
  async function act(action,extra={}){
    const c=getContext(),stamp=identity(c);if(!stamp||busy||(c.disabled&&action!=='compassView'))return;
    const n=++serial;controller=new AbortController();busy=action;controls();
    if(action==='compassGenerate')status.textContent='正在規劃路線…';
    try{
      const next=await request(action,{runId:c.runId,expectedHead:c.head??null,expectedVersion:c.version,expectedRevision:state?.revision,...extra},controller.signal);
      if(n!==serial||stamp!==identity(getContext()))return;
      state=next;status.textContent=action==='compassAdopt'?'已點亮。導演可以從下個新回合開始參考。':action==='compassGenerate'?'規劃完成。還沒有套用任何路線。':'';
      paint();
    }catch(e){
      if(n!==serial)return;
      if(e.code==='COMPASS_STALE'){state=null;status.textContent='故事或羅盤已更新，請重新開啟面板。';paint();}
      else status.textContent=controller.signal.aborted?'已停止等候。重新開啟羅盤可查看狀態。':'這次未完成，原本的故事與路線保留。';
    }finally{if(n===serial){busy=null;controller=null;controls();}}
  }
  function reset(){serial++;controller?.abort();controller=null;busy=null;state=null;last=null;lastRun=null;direction.value='';custom.value='';picked.clear();status.textContent='';paintTags();paint();close();}
  function update(){
    const c=getContext(),next=identity(c),run=c?.runId??null;
    if(next!==last){serial++;controller?.abort();controller=null;busy=null;state=null;last=next;status.textContent='';
      if(run!==lastRun){direction.value='';custom.value='';picked.clear();paintTags();close();}lastRun=run;paint();if(!panel.hidden)void act('compassView');}
    controls();
  }
  d.defaultView.addEventListener('resize',position);d.defaultView.visualViewport?.addEventListener('resize',position);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();close(true);}});
  const outside=e=>{if(!panel.hidden&&!panel.contains(e.target)&&!trigger.contains(e.target))close();};
  d.addEventListener('pointerdown',outside);
  paintTags();controls();return {reset,update,close,dispose(){reset();d.defaultView.removeEventListener('resize',position);d.defaultView.visualViewport?.removeEventListener('resize',position);d.removeEventListener('pointerdown',outside);trigger.remove();panel.remove();}};
}
