import {mountCollaborationReader} from './collaboration-reader-ui.mjs';
// Read-only player dialogs. Content is always text, never authored HTML.
export function mountPlayerReaders({document=globalThis.document,request,getContext=()=>null,onNavigate=()=>{},onDismiss=()=>null,preserveReading=()=>()=>{}}={}){
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const actions=el('nav',undefined,'player-readers-actions');actions.setAttribute('aria-label','故事閱讀');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;padding:4px 0';
  const bookButton=el('button','世界書（完整／含劇透）','quiet'),recapButton=el('button','章節摘要','quiet');bookButton.id='player-worldbook-open';recapButton.id='player-recap-open';
  for(const b of[bookButton,recapButton]){b.type='button';b.disabled=true;b.setAttribute('aria-haspopup','dialog');b.style.minHeight='44px';actions.append(b);}
  // Reuse the bookshelf; these read-only tools do not consume story/composer space.
  (document.getElementById('stage-readers')??document.querySelector('#library-pane')??document.querySelector('.library')??document.querySelector('main')??document.body).append(actions);
  const dialog=el('dialog',undefined,'tool-dialog player-reader-dialog');dialog.id='player-reader-dialog';dialog.setAttribute('aria-labelledby','player-reader-title');dialog.style.cssText='width:min(720px,calc(100vw - 20px));max-width:calc(100vw - 20px);max-height:calc(100dvh - 24px);box-sizing:border-box;overflow:auto;overscroll-behavior:contain';
  const header=el('header',undefined,'tool-heading'),heading=el('h2');heading.id='player-reader-title';const close=el('button','返回故事','quiet');close.type='button';close.style.minHeight='44px';header.append(heading,close);
  const note=el('p','此處只閱讀這段故事已保存的公開內容，不會啟動生成。','hint'),status=el('p',undefined,'hint');status.id='player-reader-status';status.setAttribute('role','status');
  const search=el('form'),searchLabel=el('label','搜尋世界設定'),input=el('input');input.id='player-worldbook-query';input.type='search';input.maxLength=200;searchLabel.setAttribute('for',input.id);const submit=el('button','搜尋','quiet');submit.type='submit';submit.style.minHeight='44px';search.append(searchLabel,input,submit);
  const modes=el('nav',undefined,'player-worldbook-modes'),ownerMode=el('button','完整／含劇透','quiet'),publicMode=el('button','公開版','quiet');ownerMode.id='player-worldbook-owner';publicMode.id='player-worldbook-public';for(const b of[ownerMode,publicMode]){b.type='button';b.style.minHeight='44px';modes.append(b);}modes.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  const list=el('section');list.id='player-reader-list';list.setAttribute('aria-label','閱讀目錄');const detail=el('section');detail.id='player-reader-detail';detail.style.cssText='white-space:normal;overflow-wrap:anywhere;min-width:0';detail.hidden=true;
  const retry=el('button','重新讀取','quiet');retry.type='button';retry.hidden=true;retry.style.minHeight='44px';dialog.append(header,note,modes,search,status,retry,list,detail);document.body.append(dialog);
  for(const b of[bookButton,recapButton])b.setAttribute('aria-controls',dialog.id);
  let run=null,kind=null,bookMode='owner',epoch=0,openedBy=null,restoreReading=null,query='',cursor=null,selected=null,detailValue=null,detailReadRevision=null,lastKey='',disposed=false;
  const context=()=>{const c=getContext()??{},snapshotHash=run?.snapshot?.hash??run?.snapshotHash??c.snapshotHash;return{runId:run?.runId??null,snapshotHash,head:run&&Object.hasOwn(run,'head')?run.head:c.head??null,version:run?.version??c.version,lifecycleRevision:run?.lifecycleRevision??c.lifecycleRevision??0,sessionId:c.sessionId??null,cardId:c.cardId??null,selectionEpoch:c.selectionEpoch??c.epoch??null};};
  const key=()=>{const c=context();return JSON.stringify(kind==='worldbook'?{...c,head:undefined,version:undefined,bookMode}:c);};
  const active=(serial,stamp)=>!disposed&&dialog.open&&serial===epoch&&stamp===key();
  const valid=(value,c)=>value?.runId===c.runId&&value.snapshotHash===c.snapshotHash&&(kind==='worldbook'&&bookMode==='owner'?value.kind==='owner_worldbook'&&value.source?.kind==='fixed_run_snapshot':value.head===c.head&&(c.version===undefined||value.version===c.version));
  const args=c=>({runId:c.runId,...(c.snapshotHash?{expectedSnapshotHash:c.snapshotHash}:{}),...(kind==='worldbook'&&bookMode==='owner'?{}:{expectedHead:c.head})});
  const action=()=>kind==='worldbook'?(bookMode==='owner'?'ownerWorldbook':'playerWorldbook'):'playerRecap';
  const errorText=error=>{const code=String(error?.code??'').toLowerCase();if(/auth|denied|permission|lease|session|scope|lifecycle|context|run_trashed|run_not_found/.test(code)){clear();list.hidden=false;return '此內容未獲閱覽授權，或本局已不可讀。請恢復正常連線後重新開啟。';}return ({reader_source_changed:'固定來源已改變，請重新開啟。',reader_page_changed:'來源分頁已更新，請重新讀取。',reader_entry_not_found:'這個固定來源找不到此條目。'}[code]??'暫時無法讀取，故事與草稿仍保留。可以重新讀取。');};
  function begin(){const serial=++epoch,stamp=key(),c=context();status.textContent='正在讀取…';retry.hidden=true;return{serial,stamp,c};}
  function error(serial,stamp,message){if(!active(serial,stamp))return;status.textContent=message;retry.hidden=false;}
  function setMode(){search.hidden=modes.hidden=kind!=='worldbook';ownerMode.setAttribute('aria-pressed',String(bookMode==='owner'));publicMode.setAttribute('aria-pressed',String(bookMode==='public'));heading.textContent=kind==='worldbook'?(bookMode==='owner'?'完整世界書（含劇透）':'世界書（公開版）'):'章節摘要';note.textContent=kind==='worldbook'?(bookMode==='owner'?'本人閱讀本局固定 Snapshot 的完整世界書，包括隱藏、停用與未觸發設定。這不會改變角色知識或 Agent 可讀範圍，也不會套用工作卡新版。':'這是本故事固定版本中明確公開的設定；未標示公開的內容不會顯示。'):'點章名定位原文；可另看已保存摘要，未歸檔與無摘要原文也會保留。閱讀不會產生摘要。';}
  function bookStatus(value){const complete=bookMode==='owner',coverage=value.coverage??{};if(complete){const revision=value.source?.revision??run?.snapshot?.revision;note.textContent=`本局固定版本${revision!==undefined?' r'+revision:''} · 含劇透。本人閱讀不改變角色知識、觸發設定或 Agent 可讀範圍。`;if(value.status==='source_missing')return '此局固定 Snapshot 缺少可讀世界書來源；不會改讀工作卡。';if(value.status==='unsupported_source')return '此局世界書來源格式尚不支援；未冒充完整內容。';if(coverage.status==='partial'||value.status==='partial')return '部分來源可讀；另有無法解析或敏感片段未提供，並非完整還原。';if(value.status==='empty')return '這份固定世界書沒有條目。';}return value.status==='empty'?'這段故事目前沒有標示為可公開閱讀的世界設定。':value.total===0?'找不到符合的設定。':'選擇一項閱讀完整設定。';}
  function entryMetadata(row){const visibility={public:'公開',private:'私密',restricted:'受限',characters:'角色範圍',unmarked:'未標記'}[row.visibility];const enabled=row.enabled===true?'啟用':row.enabled===false?'停用':null;return[visibility,enabled,bookMode==='owner'?'未查本輪觸發':null,row.status==='source_corrupt'?'條目無法解析':row.status==='empty'?'空條目':null,row.sensitiveOmissions?'有敏感片段未提供':null].filter(Boolean).join(' · ');}
  function clear(){list.replaceChildren();detail.replaceChildren();detail.hidden=true;selected=null;detailValue=null;detailReadRevision=null;cursor=null;retry.hidden=true;}
  function button(text,handler,cls='quiet'){const b=el('button',text,cls);b.type='button';b.style.cssText='min-height:44px;white-space:normal;text-align:left;overflow-wrap:anywhere';b.addEventListener('click',handler);return b;}
  async function loadList({append=false}={}){
    if(!context().runId||!dialog.open)return;const{serial,stamp,c}=begin();setMode();
    try{
      const value=await request(action(),{...args(c),cursor:append?cursor??0:0,limit:30,...(kind==='worldbook'?{query}:{})});
      if(!active(serial,stamp))return;if(!valid(value,c)){error(serial,stamp,'故事已更新，請重新讀取。');return;}
      if(!append){clear();list.hidden=false;}else list.querySelector('[data-reader-more]')?.remove();
      if(kind==='worldbook'){
        for(const row of value.entries??[]){const section=el('div',undefined,'player-worldbook-row'),b=button(row.title,()=>void loadDetail(row.id));b.dataset.entryId=row.id;section.append(b,el('p',row.bookTitle,'hint'));if(bookMode==='owner')section.append(el('p',entryMetadata(row),'hint'));list.append(section);}
        cursor=value.nextCursor??null;if(cursor!==null){const more=button('更多設定',()=>void loadList({append:true}));more.dataset.readerMore='true';list.append(more);}
        status.textContent=bookStatus(value);
      }else{
        list.querySelector('[data-reader-unarchived]')?.remove();
        for(const row of value.chapters??[]){
          const section=el('section',undefined,'player-recap-row'),b=button(`${row.order}. ${row.title}`,()=>navigate(row,c,stamp));b.dataset.chapterId=row.id;
          section.append(b,el('p',`第 ${row.startTurn}–${row.endTurn} 回合${row.summaryAvailable?'':' · 尚無摘要'}`,'hint'),el('p',row.summaryPreview?row.summaryPreview+(row.summaryTruncated?'…':''):'尚無摘要；仍可直接閱讀原文。','player-recap-preview'),button(row.summaryAvailable?'查看完整摘要':'查看章節資訊',()=>void loadDetail(row.id)));list.append(section);
        }
        cursor=value.nextCursor??null;if(cursor!==null){const more=button('更多章節',()=>void loadList({append:true}));more.dataset.readerMore='true';list.append(more);}
        if(value.unarchived?.source?.startCommitId){const row=value.unarchived,section=el('section',undefined,'player-recap-row');section.dataset.readerUnarchived='true';section.append(button(row.title??'尚未歸檔的原文',()=>navigate(row,c,stamp)),el('p',`第 ${row.startTurn}–${row.endTurn} 回合 · 尚無摘要；不會自動生成。`,'hint'));list.append(section);}
        status.textContent=value.chapters?.length||value.unarchived?'點章名定位原文，或查看完整摘要。':'尚無章節與原文；開始演出後可在此閱讀。';
      }
    }catch(cause){if(active(serial,stamp))error(serial,stamp,errorText(cause));}
  }
  function navigate(row,c,stamp){const current=context();if(current.runId!==c.runId||key()!==stamp||!row.source?.startCommitId)return;const target={runId:c.runId,commitId:row.source.startCommitId,anchorPosition:'start'};closeDialog('navigate');onNavigate(target);}
  async function loadDetail(id,{more=false}={}){
    if(!context().runId||!dialog.open)return;const{serial,stamp,c}=begin();selected=id;
    try{
      const value=await request(action(),{...args(c),...(kind==='worldbook'?{entryId:id,...(more?{contentOffset:detailValue?.nextContentOffset??0}:{})}:{chapterId:id})});
      if(!active(serial,stamp))return;if(!valid(value,c)){error(serial,stamp,'故事已更新，請重新讀取。');return;}
      if(kind==='worldbook'&&bookMode==='owner'&&more&&value.readRevision!==detailReadRevision){error(serial,stamp,'固定來源內容已更新，請重新讀取；未混用不同版本片段。');return;}
      if(!more)detailReadRevision=value.readRevision??null;
      list.hidden=true;detail.hidden=false;
      if(!more)detail.replaceChildren(button('返回目錄',()=>{epoch++;selected=null;detail.hidden=true;list.hidden=false;status.textContent=kind==='worldbook'?'選擇一項閱讀完整設定。':'選擇一章閱讀回顧。';}));
      if(kind==='worldbook'){
        const row=value.entry;detailValue=row;
        if(!more){detail.append(el('h3',row.title),el('p',row.bookTitle,'hint'));if(bookMode==='owner'){detail.append(el('p',entryMetadata(row),'hint'));if(row.metadata){const meta=el('details'),summary=el('summary','條目設定'),text=el('pre',JSON.stringify(row.metadata,null,2));text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;overflow:auto';meta.append(summary,text);detail.append(meta);}}}
        else detail.querySelector('[data-reader-content-more]')?.remove();
        const p=el('p',row.content,'player-reader-text');p.style.whiteSpace='pre-wrap';detail.append(p);
        if(row.nextContentOffset!==null){const b=button('繼續閱讀',()=>void loadDetail(id,{more:true}));b.dataset.readerContentMore='true';detail.append(b);}
        status.textContent=bookMode==='owner'?bookStatus(value):'這是故事固定版本的設定。';
      }else{
        const row=value.chapter;detailValue=row;detail.append(el('h3',`${row.order}. ${row.summary?.title??row.title}`),el('p',`第 ${row.startTurn}–${row.endTurn} 回合`,'hint'));
        if(row.summary){const p=el('p',row.summary.summary,'player-reader-text');p.style.whiteSpace='pre-wrap';detail.append(p);const facts=el('details'),label=el('summary','相關線索');facts.append(label);for(const[field,title]of[['keywords','關鍵詞'],['characters','角色'],['locations','地點'],['plotThreads','未決情節'],['emotionalTone','情緒基調']]){const value=row.summary[field],text=Array.isArray(value)?value.join('、'):value;if(text)facts.append(el('h4',title),el('p',text));}detail.append(facts);status.textContent=row.summaryStatus==='failed'||row.summaryStatus==='pending'?'顯示先前已完成且來源仍有效的摘要。':'這是已保存的逐章摘要。';}
        else{detail.append(el('p','這一章尚無摘要。閱讀不會自動啟動生成。'));status.textContent='尚無摘要。';}
        if(row.source?.startCommitId)detail.append(button('回到這一章',()=>{const current=context();if(current.runId!==c.runId||key()!==stamp)return;const target={runId:c.runId,commitId:row.source.startCommitId,anchorPosition:'start'};closeDialog('navigate');onNavigate(target);}));
      }
    }catch(cause){if(active(serial,stamp))error(serial,stamp,errorText(cause));}
  }
  function open(next,b){if(disposed||!context().runId)return;if(document.querySelector('dialog[open]')&&!dialog.open)return;kind=next;if(kind==='worldbook')bookMode='owner';lastKey=key();openedBy=b;query='';input.value='';clear();list.hidden=false;restoreReading=preserveReading();if(!dialog.open)dialog.showModal();setMode();close.focus({preventScroll:true});void loadList();}
  function closeDialog(reason='dismiss'){epoch++;if(dialog.open)dialog.close(reason);}
  const onClose=()=>{epoch++;if(dialog.returnValue!=='navigate'){restoreReading?.();(onDismiss()??openedBy)?.focus({preventScroll:true});}restoreReading=null;};
  const onCancel=event=>{event.preventDefault();closeDialog();};
  const onSearch=event=>{event.preventDefault();query=input.value;list.hidden=false;void loadList();};
  const chooseMode=next=>{if(bookMode===next)return;epoch++;bookMode=next;query='';input.value='';clear();lastKey=key();list.hidden=false;void loadList();};ownerMode.addEventListener('click',()=>chooseMode('owner'));publicMode.addEventListener('click',()=>chooseMode('public'));
  bookButton.addEventListener('click',()=>open('worldbook',bookButton));recapButton.addEventListener('click',()=>open('recap',recapButton));close.addEventListener('click',()=>closeDialog());search.addEventListener('submit',onSearch);dialog.addEventListener('close',onClose);dialog.addEventListener('cancel',onCancel);retry.addEventListener('click',()=>selected?void loadDetail(selected):void loadList());
  const collaboration=mountCollaborationReader({document,request,getContext:context,actions,preserveReading,onNavigate});
  // Keep all three entries in one existing bookshelf navigation.
  actions.insertBefore?.(recapButton,bookButton);
  return{update(value){run=value??null;collaboration.update(value);const next=key();bookButton.disabled=recapButton.disabled=!context().runId;if(next!==lastKey){lastKey=next;epoch++;clear();list.hidden=false;if(dialog.open){if(context().runId)void loadList();else{status.textContent='請先開啟一段故事。';closeDialog();}}}},reset(){epoch++;run=null;lastKey='';clear();bookButton.disabled=recapButton.disabled=true;closeDialog();collaboration.reset();},dispose(){disposed=true;epoch++;closeDialog();restoreReading?.();restoreReading=null;collaboration.dispose();actions.remove();dialog.remove();}};
}
