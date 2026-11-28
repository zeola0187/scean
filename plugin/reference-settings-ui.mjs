// Build input used by the Stage v2 native frame.
export function openSceanReferenceSettings(run){
 const rpc=globalThis.__SCEAN_NATIVE__?.request;
 if(!run?.runId||!rpc||document.querySelector('[data-stage-reference-settings]'))return;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const dialog=make('dialog'),form=make('form'),mode=make('select'),interval=make('input'),lore=make('input'),message=make('p'),history=make('div'),save=make('button','儲存設定'),close=make('button','關閉');
 dialog.dataset.stageReferenceSettings='';dialog.setAttribute('aria-label','查書與靈感');
 Object.assign(dialog.style,{maxWidth:'min(94vw,36rem)',width:'100%',boxSizing:'border-box',color:'CanvasText',background:'Canvas',padding:'1rem',border:'1px solid GrayText',borderRadius:'12px',maxHeight:'85dvh',overflow:'auto'});
 Object.assign(form.style,{display:'grid',gap:'.55rem'});
 interval.type='number';interval.min='1';interval.max='1000';interval.step='1';interval.required=true;
 lore.type='checkbox';save.type='submit';save.disabled=true;close.type='button';
 message.setAttribute('role','status');history.setAttribute('aria-label','靈感批次');
 const addLabel=(text,input)=>{const l=make('label',text+' ');l.append(input);form.append(l);};
 form.append(make('h2','查書與靈感'));
 addLabel('允許導演按需查世界書（單 Writer 模式）',lore);
 addLabel('靈感來源',mode);
 addLabel('每幾個有效回合準備一批',interval);
 form.append(make('small','兩項各自開關。更改靈感模式或間隔後從現在計數；啟用聯想或搜尋可能產生用量。'),save,close,message,history);
 dialog.append(form);document.body.append(dialog);
 close.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.showModal();
 const common={runId:run.runId,expectedLifecycleRevision:run.lifecycleRevision??0};
 const labels={off:'關閉',model:'模型聯想',search:'外部搜尋（DeepSeek）'};
 const states={ready:'已備妥',injected:'已送入 Writer',running:'背景準備中',expired:'已過期',failed:'未取得素材（舊紀錄）',missed:'本次略過',interrupted:'重啟中斷'};
 let current;
 const show=value=>{
  current=value;mode.replaceChildren(...[...new Set([...value.availableModes,value.mode])].map(key=>{const o=make('option',labels[key]);o.value=key;if(!value.availableModes.includes(key))o.disabled=true;return o;}));
  mode.value=value.mode;interval.value=value.interval;lore.checked=value.loreEnabled===true;save.disabled=false;
  const open=new Set([...history.querySelectorAll('details[open]')].map(d=>d.dataset.id));
  history.replaceChildren(make('h3','最近批次'),...value.batches.slice(0,10).map(b=>{
   const d=make('details');d.dataset.id=b.id;d.open=open.has(b.id);
   const failures={search_empty:'搜尋沒找到可用素材',search_failed:'外部搜尋失敗',compose_timeout:'搜尋成功，整理逾時',compose_limit:'搜尋成功，整理輸出遭截斷',compose_failed:'搜尋成功，整理失敗',model_timeout:'模型聯想逾時',model_limit:'模型聯想輸出遭截斷',model_failed:'模型聯想失敗',provider_unavailable:'素材來源未設定'};
   d.append(make('summary',String(b.turn)+' 輪 · '+(failures[b.failure]??states[b.state]??b.state)+(b.injectedTurn?' → 第 '+b.injectedTurn+' 輪':'')));
   if(b.reference)d.append(make('p',b.reference));if(b.query)d.append(make('p','查詢：'+b.query));for(const s of b.sources??[])d.append(make('p',s));return d;
  }));
 };
 const refresh=async()=>{try{const value=await rpc('inspirationSettings',common);if(dialog.open)show(value);}catch{message.textContent='目前無法載入這場演出的設定。';}};
 form.onsubmit=async e=>{
  e.preventDefault();if(!current||save.disabled)return;
  if(!Number.isInteger(interval.valueAsNumber)||interval.valueAsNumber<1||interval.valueAsNumber>1000){message.textContent='回合數必須是 1～1000 的整數。';return;}
  save.disabled=true;
  try{const v=await rpc('inspirationSettingsSave',{...common,mode:mode.value,interval:interval.valueAsNumber,loreEnabled:lore.checked,expectedRevision:current.revision,expectedLookupRevision:current.lookupRevision});if(dialog.open){show(v);message.textContent='已儲存。';}}
  catch(e){message.textContent=e.code==='INSPIRATION_SETTINGS_CHANGED'?'設定已變動，請關閉視窗再開一次。':'尚未儲存。若正在生成，請等本輪結束再試。';}
  finally{save.disabled=false;}
 };
 void refresh();
}
