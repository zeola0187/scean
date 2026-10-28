// Explicit structured player confirmation only. Never parse story prose.
export function timeConfirmationValue(control,{mode,day,kind,period,hour,minute,confirmed}){
 if(!control||confirmed!==true||!['refine','advance_to'].includes(mode))throw Object.assign(new Error('請選擇時間並勾選確認；沒有確認不會改變故事時間。'),{code:'TIME_CONFIRMATION_INVALID'});
 const integer=(v,min,max)=>v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;
 if(!integer(day,1,1000000))throw Object.assign(new Error('請填寫故事日序（第幾日）。'),{code:'TIME_CONFIRMATION_INVALID'});
 const target={dayOrdinal:Number(day)},d=control.definition;
 if(kind==='period'){
  if(!Object.hasOwn(d.periods,period))throw Object.assign(new Error('請從這個世界的時間定義選擇時段。'),{code:'TIME_CONFIRMATION_INVALID'});
  target.periodId=period;
 }else if(kind==='day'){
  // A day remains a day; never silently choose midnight.
 }else if(kind==='minute'){
  if(!integer(hour,0,d.hoursPerDay-1)||!integer(minute,0,d.minutesPerHour-1))throw Object.assign(new Error('請填寫符合這個世界日長的時、分。'),{code:'TIME_CONFIRMATION_INVALID'});
  target.minuteOfDay=Number(hour)*d.minutesPerHour+Number(minute);
 }else throw Object.assign(new Error('請選擇時段或明確時刻。'),{code:'TIME_CONFIRMATION_INVALID'});
 return {schemaVersion:2,confirmed:true,role:mode==='refine'?'origin':'endpoint',mode,target,base:structuredClone(control.base)};
}
export function mountTimeConfirmation({parent,document=globalThis.document}){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const box=el('section'),button=el('button','補充／確認時間'),note=el('p'),form=el('fieldset'),legend=el('legend','由你確認本輪的故事時間');
 button.type='button';form.hidden=true;form.append(legend);box.append(note,button,form);parent.append(box);
 const labels=new Map();const field=(text,node)=>{const label=el('label',text);label.append(node);form.append(label);labels.set(node,label);return node;};
 const select=(entries)=>{const s=el('select');for(const [value,text] of entries){const o=el('option',text);o.value=value;s.append(o);}return s;};
 const mode=field('用途 ',select([['refine','確認本輪起點（模型仍可推進）'],['advance_to','指定本輪終點（模型可補足起點）']]));
 const day=field('故事第幾日 ',el('input'));day.type='number';day.min='1';day.max='1000000';
 const kind=field('精度 ',select([['day','日'],['period','時段'],['minute','明確時刻']]));
 const period=field('時段 ',select([])),hour=field('時 ',el('input')),minute=field('分 ',el('input'));
 hour.type=minute.type='number';hour.min=minute.min='0';
 const confirmed=field('我確認這份日期／時間用於下一次送出的輸入；不從正文推測。',el('input'));confirmed.type='checkbox';
 const explanation=el('p','這是可選覆寫；未填時由導演依合法來源處理未知時間。起點約束可接續推進，終點約束不可被模型取代。這不會立即修改存檔。確認與正文、State、Clock 一起成功提交才生效；資訊不足或來源變動會停止。開場文字不會自動設定權威時刻。');form.append(explanation);
 let control=null,key=null,enabled=false,stale=false;
 const toggle=()=>{enabled=!enabled;form.hidden=!enabled;confirmed.checked=false;};button.onclick=toggle;
 const precision=()=>{labels.get(period).hidden=kind.value!=='period';labels.get(hour).hidden=labels.get(minute).hidden=kind.value!=='minute';};kind.onchange=precision;precision();
 return {
  update(run,busy,error){
   const next=run?.timeControls??null,nextKey=next?JSON.stringify(next.base):null;
   if(nextKey!==key){stale=enabled;enabled=false;form.hidden=true;confirmed.checked=false;control=next;key=nextKey;
    period.replaceChildren();const blank=el('option','請選擇時段');blank.value='';period.append(blank);
    for(const [id,p] of Object.entries(next?.definition.periods??{})){const d=next.definition,at=n=>String(Math.floor(n/d.minutesPerHour)).padStart(2,'0')+':'+String(n%d.minutesPerHour).padStart(2,'0'),names={morning:'上午',afternoon:'下午',night:'夜間'};const o=el('option',`${names[id]??id}（${at(p.start)}–${at(p.end)}）`);o.value=id;period.append(o);}
    day.value='';hour.value=minute.value='';if(next){hour.max=String(next.definition.hoursPerDay-1);minute.max=String(next.definition.minutesPerHour-1);mode.value=next.uncertain?'refine':'advance_to';}
   }
   box.hidden=!next;button.disabled=!!busy;form.disabled=!!busy;
   note.textContent=error?.code==='NEEDS_TIME_PRECISION'?'本輪仍有時間衝突或機械限制，尚未提交。可用自然語言澄清後送出新輸入，或選用下方覆寫；不必一律指定分鐘。':stale?'故事來源已變更，先前時間確認已清除；請重新確認。':next?.initialDayPrecision?'目前只有日精度；導演可依合法來源補足未知時間。下方為可選的玩家起點／終點覆寫。':next?.uncertain?'目前時間保留範圍精度；導演可在已知限制內補足，不必每次填表。':'';
  },
  read(){return enabled?timeConfirmationValue(control,{mode:mode.value,day:day.value,kind:kind.value,period:period.value,hour:hour.value,minute:minute.value,confirmed:confirmed.checked}):null;},
  clear(){enabled=false;confirmed.checked=false;form.hidden=true;},
 };
}
