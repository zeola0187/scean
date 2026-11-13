import {dialoguePalette} from './dialogue.mjs';
export function calendarPlanningText(planning){
 if(!planning)return '';
 const messages={not_enabled:'此故事未啟用自動七日規劃；閱讀不會建立設定。',waiting:'七日規劃尚待背景排程。閱讀不會啟動生成。',queued:'七日規劃已排入等待。',running:'七日規劃生成中。',planned:'七日規劃已完成；只列出已公告的公共事件。',failed:'七日規劃失敗，沒有發布新計畫；不會自動重試。',interrupted:'七日規劃已中斷；派送結果未確認，不會自動重試。',stale:'先前規劃來源已過期；舊結果不會發布。後續有效回合可在剩餘名額內重新排程。',daily_limit:'今天的七日規劃派送已達上限；留在同一故事日不會再自動生成。權威故事時間前進到新一天後，才有新窗口的排程機會。'};
 const reasons={json:'回覆無法完整解析',fields:'欄位結構不符合契約',version:'契約版本不符',kind:'工作種類不符',window:'七日窗口不符',event_limit:'事件數量或清單格式不符',key:'事件識別不合法',duplicate_key:'事件識別重複',label:'事件標籤不合法',scope:'事件不是公共世界計畫',announcement:'公告種類不合法',position:'事件時間格式不合法',start_day:'事件開始日不在待規劃日期內',not_future:'事件開始時間未晚於目前時間範圍的最晚邊界',horizon:'事件結束超過七日窗口',interval:'事件結束未晚於開始',required_for_scene:'場景條件欄位格式不符',condition:'事件條件格式不符'};
 let text=messages[planning.state]??'七日規劃狀態待確認。';
 if(Number.isInteger(planning.attemptsUsed)&&Number.isInteger(planning.attemptLimit))text+=` 本故事日已用 ${planning.attemptsUsed}／${planning.attemptLimit} 次派送名額。`;
 const d=planning.failureDiagnostic;
 if(d&&Object.hasOwn(reasons,d.reason)&&typeof d.path==='string'&&d.path.length<=64&&/^[A-Za-z0-9_$.[\]]+$/.test(d.path))text+=` 原因：${reasons[d.reason]}。`;
 else if(planning.error==='CALENDAR_CONTRACT')text+=' 舊記錄只保存契約拒絕，未記錄具體欄位。';
 return text;
}
export function calendarDiagnosticText(planning){const d=planning?.failureDiagnostic;if(!d||!['json','fields','version','kind','window','event_limit','key','duplicate_key','label','scope','announcement','position','start_day','not_future','horizon','interval','required_for_scene','condition'].includes(d.reason)||typeof d.path!=='string'||d.path.length>64||!/^[A-Za-z0-9_$.[\]]+$/.test(d.path))return '';return `原因代碼：${d.reason}\n欄位：${d.path}`;}
// Presentation only: dates, statuses and cursors come from worldRoutineRead.
export function mountWorldRoutineReaders({document=globalThis.document,request,getContext=()=>null,onDismiss=()=>null,preserveReading=()=>()=>{}}={}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn)=>{const b=el('button',text,'quiet');b.type='button';b.style.minHeight='44px';b.addEventListener('click',fn);return b;};
 const nav=el('nav',undefined,'player-readers-actions');nav.setAttribute('aria-label','日曆與論壇');nav.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 const calendar=button('日曆',()=>open('calendar')),forum=button('論壇',()=>open('forum'));calendar.id='player-calendar-open';forum.id='player-forum-open';calendar.disabled=forum.disabled=true;nav.append(calendar,forum);document.getElementById('stage-readers')?.append(nav);
 const dialog=el('dialog',undefined,'tool-dialog world-routine-dialog');dialog.id='world-routine-dialog';dialog.style.cssText='width:min(760px,calc(100vw - 20px));max-width:calc(100vw - 20px);max-height:calc(100dvh - 24px);box-sizing:border-box;overflow:auto;overflow-wrap:anywhere;overscroll-behavior:contain';
 const header=el('header',undefined,'tool-heading'),title=el('h2'),close=button('返回故事',()=>dialog.close());title.id='world-routine-title';dialog.setAttribute('aria-labelledby',title.id);header.append(title,close);
 const clock=el('p',undefined,'hint'),note=el('p',undefined,'hint'),status=el('p',undefined,'hint'),body=el('section'),retry=button('重新讀取',()=>void load());status.setAttribute('role','status');dialog.append(header,clock,note,status,retry,body);document.body.append(dialog);
 let run=null,kind='calendar',serial=0,disposed=false,restore=null,lastKey='',params={},authors=[],palette={};
 const key=()=>JSON.stringify([run?.runId,run?.snapshot?.hash??run?.snapshotHash,run?.head??null,run?.lifecycleRevision??0,getContext()?.selectionEpoch??getContext()?.epoch,getContext()?.sessionId]);
 const statuses={planned_not_occurred:'計畫・尚未發生',active:'進行中',completed:'已結束',pending_resolution:'條件未知・待結算',did_not_occur:'條件未成立・未發生'};
 const name=id=>authors.find(a=>a.id===id)?.name??id;
 const characterId=row=>row?.author?.kind==='character'?row.author.characterId:row?.authorId;
 const authorLabel=row=>row?.author?.kind==='ambient'?'路人 · '+row.author.displayName:name(characterId(row));
 function byline(row){const ambient=row.author?.kind==='ambient',p=el('p',undefined,'hint'),author=el('span',authorLabel(row),ambient?'scean-ambient-author':'scean-dialogue-color-'+(palette[characterId(row)]??0));p.append(author,document.createTextNode(' · '+row.timeLabel));return p;}
 function source(row){const d=el('details'),s=el('summary','來源與原始時間');d.append(s,el('p',row.timeLabel??`${row.startLabel} ～ ${row.endLabel}`),el('p',JSON.stringify(row.sourceRef)));return d;}
 function article(row){const a=el('article');a.dataset.artifactId=row.id;if(row.title)a.append(el('h3',row.title));a.append(byline(row));const text=el('p',row.text);text.style.whiteSpace='pre-wrap';a.append(text,source(row));return a;}
 async function load(next=params,{append=false}={}){
  if(!run?.runId||!dialog.open)return;params=next;const id=++serial,stamp=key();status.textContent='正在讀取…';retry.hidden=true;
  try{const value=await request('worldRoutineRead',{runId:run.runId,expectedSnapshotHash:run.snapshot?.hash??run.snapshotHash,view:'player',kind,limit:12,...next});
   if(disposed||id!==serial||stamp!==key()||!dialog.open)return;
   if(value.runId!==run.runId||value.snapshotHash!==(run.snapshot?.hash??run.snapshotHash)||value.head!==(run.head??null))throw Error('Source changed');
   if(!append)body.replaceChildren();else body.querySelector('[data-routine-more]')?.remove();clock.textContent=value.clockLabel?'故事時間 · '+value.clockLabel:'故事時間尚未啟用';authors=value.authors??[];palette=dialoguePalette(authors);
   if(value.status==='not_enabled'){status.textContent='此故事尚未啟用'+(kind==='calendar'?'日曆':'論壇媒介')+'。閱讀不會替故事建立設定。';return;}
   status.textContent='';
   if(kind==='calendar'){
    status.textContent=calendarPlanningText(value.planning);
    const diagnostic=calendarDiagnosticText(value.planning);if(diagnostic){const detail=el('details');detail.append(el('summary','診斷細節'),el('p',diagnostic));body.append(detail);}
    const windows=el('nav');windows.style.cssText='display:flex;gap:8px;flex-wrap:wrap';if(value.previousWindow!==null)windows.append(button('較早七日',()=>void load({windowStart:value.previousWindow})));if(value.nextWindow!==null)windows.append(button('較後七日',()=>void load({windowStart:value.nextWindow})));windows.append(button('回到今日',()=>void load({})));body.append(windows);
    const days=el('nav');days.setAttribute('aria-label','故事日期');days.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin:12px 0';for(const d of value.days){const b=button(`${d.label}（${d.count}）`,()=>void load({windowStart:value.windowStart,day:d.day}));b.setAttribute('aria-pressed',String(d.day===value.selectedDay));days.append(b);}body.append(days);
    for(const row of value.entries){const a=el('article');a.append(el('h3',row.label),el('p',statuses[row.status]??row.status),el('p',`${row.startLabel} ～ ${row.endLabel}`,'hint'),source(row));body.append(a);}if(!value.entries.length)body.append(el('p','這一天沒有已公告的公共事件。'));
    if(value.nextOffset!==null)body.append(button('更多事件',()=>void load({...next,eventOffset:value.nextOffset})));
   }else if(kind==='thread'){
    if(!append){body.append(button('返回文章列表',()=>{kind='forum';void load({});}));if(value.parent)body.append(article(value.parent),el('h3','留言'));else body.append(el('p','文章目前不可讀。'));}
     for(const row of value.entries){const a=article(row);a.append(el('p',`回覆 ${authorLabel(value.parent)} 的主文`,'hint'));body.append(a);}if(value.nextCursor!==null){const more=button('更多留言',()=>void load({...next,afterSequence:value.nextCursor},{append:true}));more.dataset.routineMore='true';body.append(more);}
   }else{
    for(const row of value.entries){const a=el('article');a.append(button(row.title,()=>{kind='thread';void load({threadId:row.id});}),byline(row));body.append(a);}if(!body.children.length)body.append(el('p','目前沒有可讀主文。'));
    if(value.nextCursor!==null){const more=button('更早文章',()=>void load({beforeSequence:value.nextCursor},{append:true}));more.dataset.routineMore='true';body.append(more);}
    if(value.publicStatus?.forumState==='medium_unconfigured')body.append(el('p','論壇媒介尚未設定。','hint'));
    if(value.publicStatus?.forumState==='no_eligible_author')body.append(el('p','目前沒有符合條件的發文角色。','hint'));const jobs=value.publicStatus?.jobs??[];if(jobs.some(j=>j.status==='declined'))body.append(el('p','有角色選擇不發文；此處只顯示已發布的文章。','hint'));if(value.publicStatus?.forumState==='medium_unavailable')body.append(el('p','論壇媒介目前不可用。','hint'));
   }
  }catch{if(id===serial&&stamp===key()&&dialog.open){body.replaceChildren();status.textContent='暫時無法讀取，請重新開啟或重試。';retry.hidden=false;}}
 }
 function open(next){if(!run?.runId||document.querySelector('dialog[open]'))return;kind=next;params={};title.textContent=next==='calendar'?'公共日曆':'角色論壇';note.textContent=next==='calendar'?'只顯示已公告的公共計畫與已結算狀態。閱讀不會推進故事時間。':'發言代表作者當時的看法，並非世界事實。玩家閱讀不代表角色已讀；不閱讀也不影響正文資訊回流。';restore=preserveReading();dialog.showModal();close.focus({preventScroll:true});void load({});}
 dialog.addEventListener('close',()=>{serial++;restore?.();restore=null;onDismiss()?.focus({preventScroll:true});});
 return {update(value){run=value??null;calendar.disabled=forum.disabled=!run?.runId;const next=key();if(next!==lastKey){lastKey=next;serial++;body.replaceChildren();if(dialog.open){restore=null;dialog.close();}}},reset(){run=null;serial++;body.replaceChildren();calendar.disabled=forum.disabled=true;if(dialog.open)dialog.close();},dispose(){disposed=true;serial++;nav.remove();dialog.remove();}};
}
