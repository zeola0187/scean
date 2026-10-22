// Browser-safe functions, embedded by the canonical Client builder. No global
// chat scan, model output parsing, filesystem access or additional model call.
export function validSavedPanelArtifact(value){
  const keys=['schemaVersion','kind','document_id','revision','card_sha256','frontend_hash','receipt_id'];
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key))&&value.schemaVersion===1&&value.kind==='cardstudio-saved-panel'&&/^[a-f0-9-]{36}$/i.test(value.document_id)&&Number.isSafeInteger(value.revision)&&value.revision>0&&/^[a-f0-9]{64}$/.test(value.card_sha256)&&/^[a-f0-9]{64}$/.test(value.frontend_hash)&&/^[a-f0-9-]{36}$/i.test(value.receipt_id);
}

export function savedPanelFromTool(block){
  if(block?.kind!=='tool-result'||block.isError||block.error||block.call?.name!=='cardstudio_scean_frontend'||!Array.isArray(block.content))return null;
  let args,result;
  try{args=JSON.parse(block.call.argsRaw);const texts=block.content.filter(part=>part.type==='text');if(texts.length!==1||texts[0].text.length>8192)return null;result=JSON.parse(texts[0].text);}catch{return null;}
  if(!['dynamic_save','dynamic_patch'].includes(args?.action)||result?.ok!==true)return null;
  const receipt=result.value,artifact=receipt?.panelPreview;
  if(!validSavedPanelArtifact(artifact)||receipt.id!==artifact.document_id||receipt.revision!==artifact.revision||receipt.sha256!==artifact.card_sha256||args.document_id!==artifact.document_id||args.expected_revision+1!==artifact.revision)return null;
  return artifact;
}

export function savedPanelResponseError(value,artifact){
  if(value?.source!=='authoring-initial-state-not-runtime')return 'PANEL_PREVIEW_SOURCE';
  if(!validSavedPanelArtifact(value.artifact))return 'PANEL_PREVIEW_ARTIFACT';
  if(Object.keys(artifact).some(key=>artifact[key]!==value.artifact[key]))return 'PANEL_PREVIEW_IDENTITY';
  if(typeof value.html!=='string'||value.html.length>262144)return 'PANEL_PREVIEW_CONTENT';
  return null;
}

// Native Typert wraps the Host's business Result in its RPC Result. Both must
// succeed: neither a transport error nor a business denial is preview content.
export function decodeSavedPanelResponse(result){
  const error=value=>Object.assign(new Error('Saved panel preview is unavailable.'),{code:/^[A-Z_]{1,64}$/.test(value?.code??'')?value.code:'PANEL_PREVIEW_RPC'});
  if(result?.ok!==true)throw error(result?.error);
  const business=result.value;if(business?.ok!==true)throw error(business?.error);
  return business.value;
}

const panelTurnCache=new WeakMap(),emptyPanelList=Object.freeze([]);
export function savedPanelsInTurn(snapshot,turn){
  if(!snapshot||!snapshot.locations?.getTurn||!snapshot.nodes?.get)return emptyPanelList;
  // The native tail passes the Turn location descriptor, whereas the Location
  // index is keyed by its numeric turn identity.
  const turnId=turn&&typeof turn==='object'?turn.turn:turn;
  if(!Number.isSafeInteger(turnId))return emptyPanelList;
  let cache=panelTurnCache.get(snapshot);if(!cache){cache=new Map();panelTurnCache.set(snapshot,cache);}if(cache.has(turnId))return cache.get(turnId);
  const result=[],seen=new Set();
  const visit=block=>{if(!block)return;const artifact=savedPanelFromTool(block);if(artifact&&!seen.has(artifact.receipt_id)&&result.length<8){seen.add(artifact.receipt_id);result.push(artifact);}for(const child of block.subCalls??[])visit(child);};
  // DSH's Location index contains this turn's nodes only; it also follows
  // compaction/replacement projection instead of replaying raw event history.
  for(const key of snapshot.locations.getTurn(turnId)??[]){const node=snapshot.nodes.get(key);if(node?.kind==='tool-call')visit(node.data?.root);}
  const value=result.length?Object.freeze(result):emptyPanelList;cache.set(turnId,value);return value;
}

export function createChatPanelPreviewComponents({React,h,controller,useConnection,resolve}){
  function SavedPanelPreview({artifact,panelSessionId}){
    useConnection();
    const box=React.useRef(null),[expanded,setExpanded]=React.useState(false),[visible,setVisible]=React.useState(false),[retry,setRetry]=React.useState(0),[view,setView]=React.useState({phase:'idle'});
    const sessionId=controller.current?.id,lease=controller.claim?.lease_id,scopeEpoch=controller.authoringScope?.epoch,ready=controller.phase==='ready'&&!!controller.claim&&sessionId===panelSessionId;
    React.useEffect(()=>{const element=box.current;if(!element)return;const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(rows=>setVisible(rows.some(row=>row.isIntersecting)),{rootMargin:'80px'}):null;if(observer)observer.observe(element);else setVisible(true);return()=>observer?.disconnect();},[]);
    React.useEffect(()=>{
      if(!expanded||!visible||!ready){setView({phase:'idle'});return;}
      const abort=new AbortController();let active=true;const claim=controller.claim,sequence=controller.sequence;
      setView({phase:'loading'});
      resolve(sessionId,{artifact,claim},abort.signal).then(value=>{
        if(!active||abort.signal.aborted||controller.current?.id!==sessionId||controller.claim?.lease_id!==claim.lease_id||controller.sequence!==sequence)return;
        const problem=savedPanelResponseError(value,artifact);if(problem)throw Object.assign(new Error('Invalid preview response.'),{code:problem});
        setView({phase:'ready',html:value.html});
      }).catch(error=>{if(active&&!abort.signal.aborted)setView({phase:'error',code:/^[A-Z_]{1,64}$/.test(error?.code??'')?error.code:'PANEL_PREVIEW_UNAVAILABLE'});});
      return()=>{active=false;abort.abort();};
    },[expanded,visible,ready,sessionId,lease,scopeEpoch,artifact.receipt_id,retry]);
    return h('details',{ref:box,'data-cardstudio-saved-panel':true,open:expanded,onToggle:event=>setExpanded(event.currentTarget.open),style:{margin:'8px 0',border:'1px solid var(--dsw-alias-border-primary,#687385)',borderRadius:8,padding:'8px 10px',maxWidth:'100%',overflow:'hidden'}},
      h('summary',{style:{cursor:'pointer'}},'已保存的面板 · r'+artifact.revision),
      expanded&&h('div',null,h('p',{style:{fontSize:12,margin:'8px 0'}},'作者設定初值（非遊玩狀態） · 固定此訊息保存的版本'),
        !ready?h('p',{role:'status'},'編輯室連線恢復後，即可讀取這份預覽。'):view.phase==='error'?h('div',{role:'status'},h('p',null,'卡片已保存；此預覽暫時不可用。 ('+view.code+')'),h('button',{type:'button',onClick:()=>setRetry(value=>value+1)},'重新讀取預覽')):view.phase==='ready'?h('iframe',{title:'已保存的面板 r'+artifact.revision,sandbox:'',referrerPolicy:'no-referrer',srcDoc:view.html,style:{width:'100%',height:320,maxHeight:'55vh',border:0,display:'block',background:'#10151d'}}):h('p',{role:'status'},visible?'正在讀取已保存版本…':'展開並移至此處後讀取預覽。')));
  }
  function ToolPreview(props){
    const artifact=props.phase==='result'?savedPanelFromTool(props.block):null;
    const text=props.phase==='result'?(props.block?.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n'):null;
    // The turn tail is the sole iframe owner, including Compact mode. The keyed
    // tool card preserves its receipt/Inspect without duplicating the preview
    // when the user expands the process in Detailed mode.
    return h('div',{'data-cardstudio-panel-tool':true},artifact&&h('p',{'data-cardstudio-panel-saved':true},'面板已保存 · r'+artifact.revision+'；可在本輪對話下方展開預覽。'),
      h('details',null,h('summary',null,props.phase==='result'?(props.block?.isError?'面板工具未完成':'面板工具回執'):'面板工具處理中…'),text&&h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto'}},text),props.inspect&&h('button',{type:'button',onClick:props.inspect},'查看工具紀錄')));
  }
  function TurnPreview({turn,useChat,panelSessionId}){
    const select=React.useCallback(snapshot=>savedPanelsInTurn(snapshot,turn),[turn]);
    const panels=useChat(select);return panels.length?h('div',{'data-cardstudio-panel-turn':true},...panels.map(artifact=>h(SavedPanelPreview,{key:artifact.receipt_id,artifact,panelSessionId}))):null;
  }
  return {SavedPanelPreview,ToolPreview,TurnPreview};
}
