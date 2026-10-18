// Pure, bounded card state operations shared by the authoring validator and the
// self-contained TavernHelper card script. No CardStudio service is used in RP.
export function validateTargetState(definition, value, previous) {
  const plain = x => x && typeof x === 'object' && !Array.isArray(x);
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const bad = (message,path='/',code='STATE_INVALID') => { const error=new Error(message);error.code=code;error.path=path.slice(0,160);throw error; };
  if (!plain(value) || Object.keys(value).some(k => !['values','characters','scene'].includes(k))) bad('Invalid state envelope','/','STATE_ENVELOPE');
  const next = JSON.parse(JSON.stringify(previous ?? {values:{},characters:{},scene:{}}));
  for (const section of ['values','characters','scene']) if (value[section] !== undefined && !plain(value[section])) bad('Invalid state section','/'+section,'STATE_SECTION');
  for (const [key,v] of Object.entries(value.values ?? {})) {
    if (!own(definition.fields,key)) bad('Unknown state field','/values/'+key,'STATE_FIELD');
    const b=definition.fields[key];
    if (b.type==='number' && (!Number.isFinite(v) || v < (b.min ?? -1e9) || v > (b.max ?? 1e9))) bad('State number outside bounds','/values/'+key,'STATE_NUMBER');
    if (b.type==='string' && (typeof v!=='string' || v.length>(b.maxLength??256) || b.enum && !b.enum.includes(v))) bad('Invalid state string','/values/'+key,'STATE_STRING');
    if (b.type==='boolean' && typeof v!=='boolean') bad('Invalid state boolean','/values/'+key,'STATE_BOOLEAN');
    if (b.type==='array' && (!Array.isArray(v) || v.length>(b.maxItems??64) || v.some(x=>typeof x!=='string'||x.length>256))) bad('Invalid state list','/values/'+key,'STATE_LIST');
    next.values[key]=v;
  }
  for (const key of Object.keys(definition.fields)) if (!own(next.values,key)) bad('Missing initial state field');
  for (const [key,v] of Object.entries(value.characters??{})) {
    if (!own(definition.contract.characters,key) || !plain(v)) bad('Unknown character','/characters/'+key,'STATE_CHARACTER');
    const c=definition.contract.characters[key], out={...(next.characters[key]??{expression:'neutral'})};
    for (const [k,id] of Object.entries(v)) {
      if (k==='expression') { if (!c.expressions.includes(id)) bad('Unknown expression','/characters/'+key+'/'+k,'STATE_EXPRESSION'); }
      else if (!own(c.dimensions??{},k) || !c.dimensions[k].includes(id)) bad('Unknown visual ID','/characters/'+key+'/'+k,'STATE_VISUAL_ID');
      out[k]=id;
    }
    next.characters[key]=out;
  }
  for (const key of Object.keys(definition.contract.characters)) next.characters[key]??={expression:'neutral'};
  for (const [key,id] of Object.entries(value.scene??{})) {
    const values=definition.contract.scene?.[key==='location'?'locations':key==='lighting'?'lighting':''];
    if (!values?.includes(id)) bad('Unknown scene ID','/scene/'+key,'STATE_SCENE_ID'); next.scene[key]=id;
  }
  return next;
}

/** Data-only message reducer serialized beside the existing validator. */
export function reduceTargetUpdate(definition,input,previous,validate) {
  const retained=JSON.parse(JSON.stringify(previous));
  const base={status:'no_update',accepted:null,state:retained,error:null,diagnostic:null,appliedPaths:[],changedPaths:[],retained:'previous state'};
  if(input.role!=='assistant')return base;
  const reject=(message,code,path='/')=>({...base,status:'rejected',accepted:false,error:message,diagnostic:{code,path:path.slice(0,160)},retained:'entire previous state'});
  if(typeof input.message!=='string'||input.message.length>2*1024*1024)return reject('Message exceeds the bounded state input','STATE_MESSAGE_LIMIT');
  const blocks=[...input.message.matchAll(/<state-update>\s*([\s\S]*?)\s*<\/state-update>/g)];
  if(blocks.length>1)return reject('Only one state-update block is allowed','STATE_BLOCK_COUNT');
  if(!blocks.length)return base;
  if(blocks[0][1].length>16384)return reject('State update is too large','STATE_UPDATE_LIMIT');
  let payload;
  try{payload=JSON.parse(blocks[0][1]);}catch{return reject('Invalid state JSON','STATE_JSON');}
  let state;
  try{state=validate(definition,payload,retained);}catch(error){return reject(String(error.message),error.code??'STATE_INVALID',error.path??'/');}
  const appliedPaths=[],changedPaths=[];
  for(const section of ['values','characters','scene'])for(const key of Object.keys(payload[section]??{})){
    if(section==='characters')for(const field of Object.keys(payload.characters[key]))appliedPaths.push('/characters/'+key+'/'+field);
    else appliedPaths.push('/'+section+'/'+key);
  }
  for(const path of appliedPaths){
    const parts=path.slice(1).split('/');let a=retained,b=state;
    for(const part of parts){a=a?.[part];b=b?.[part];}
    if(JSON.stringify(a)!==JSON.stringify(b))changedPaths.push(path);
  }
  return {...base,status:'accepted',accepted:true,state,appliedPaths,changedPaths,retained:'omitted fields'};
}

export function targetAssetFor(definition, character, state) {
  const c=definition.contract.characters[character]; if (!c) return null;
  const v=state.characters[character]??{expression:'neutral'};
  const same=x=>['outfit','pose','location','lighting'].every(k=>(x.dimensions?.[k]??null)===(v[k]??null));
  const exact=c.variants.find(x=>x.expression===v.expression&&same(x)&&definition.assets[x.assetId]);
  const neutral=c.variants.find(x=>x.expression==='neutral'&&!Object.keys(x.dimensions??{}).length&&definition.assets[x.assetId]);
  return definition.assets[(exact??neutral)?.assetId]??null;
}

export function targetLabel(binding, value, mode) {
  if (binding.display==='hidden') return '';
  let label=binding.label;
  if (binding.bands && typeof value==='number') for (const band of [...binding.bands].sort((a,b)=>a.min-b.min)) if(value>=band.min)label=band.label;
  return (mode==='label'||binding.display==='label')&&label!==undefined ? label : Array.isArray(value)?value.join(mode==='label'||binding.display==='label'?'、':' · '):String(value??'');
}

// Change detector, not a security signature. It binds a completed snapshot to
// the exact current message input without storing another copy of the message.
export function targetInputStamp(text) {
  if(typeof text!=='string'||text.length>2*1024*1024)return null;
  let hash=2166136261;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return text.length+':'+(hash>>>0).toString(16);
}

/** Installed as an ordinary character-scoped TavernHelper script, not a plugin. */
export function startTargetWriter(definition, validate, stamp, reduce) {
  const ns=definition.namespace, changedEvent='roleplay-state:'+ns;
  const chatId=()=>SillyTavern.getCurrentChatId();
  let tail=Promise.resolve(), stopped=false;
  const initial=()=>validate(definition,definition.initialState);
  async function updateFrom(start, initializing=false, identity) {
    const last=getLastMessageId();
    if(stopped||identity===undefined||identity===null||chatId()!==identity||last<0)return;
    start=Number.isSafeInteger(start)?Math.max(0,start):last;
    if(start>last)return;
    // Bounded repair of following snapshots after an edit/swipe. Never silently
    // invent state when a windowed history did not provide the preceding floor.
    if(last-start>250)throw Error('State repair exceeds 250 floors; use a recent checkpoint.');
    const saved=getVariables({type:'message',message_id:start})[ns];
    const current=getChatMessages(start)[0];
    if(initializing&&saved?.health?.schemaVersion===1&&saved?.profile===definition.profile&&saved.definition===definition.digest&&saved.input?.schemaVersion===1&&saved.input.messageId===start&&saved.input.stamp===stamp(current?.message)&&saved.input.swipeId===(current?.swipe_id??0))return;
    let state,health={schemaVersion:1,lastAccepted:null,lastRejected:null,rejectedAttempts:0,latest:null};
    if(start===0)state=initial();
    else {
      const prior=getVariables({type:'message',message_id:start-1})[ns];
      if(prior?.profile!==definition.profile||prior.definition!==definition.digest)throw Error('Previous floor state is unavailable; do not substitute preview samples.');
      state=validate(definition,prior.state);
      if(prior.health?.schemaVersion===1)health=JSON.parse(JSON.stringify(prior.health));
    }
    const writes=[];
    for(let id=start;id<=last;id++) {
      const message=getChatMessages(id)[0]; if(!message)throw Error('Message is outside the loaded history.');
      const outcome=reduce(definition,message,state,validate);state=outcome.state;
      const processed={messageId:id,swipeId:message.swipe_id??0,status:outcome.status};
      health.latest=processed;
      if(outcome.accepted===true){health.lastAccepted={...processed,noOp:outcome.changedPaths.length===0};health.rejectedAttempts=0;}
      else if(outcome.accepted===false){health.lastRejected={...processed,reason:outcome.error,diagnostic:outcome.diagnostic};health.rejectedAttempts++;}
      const variables=getVariables({type:'message',message_id:id});
      const next={profile:definition.profile,definition:definition.digest,state:JSON.parse(JSON.stringify(state)),error:outcome.error,health:JSON.parse(JSON.stringify(health)),input:{schemaVersion:1,messageId:id,swipeId:message.swipe_id??0,stamp:stamp(message.message)}};
      if(JSON.stringify(variables[ns])!==JSON.stringify(next))writes.push({message_id:id,data:{...variables,[ns]:next}});
    }
    if(stopped||chatId()!==identity)return;
    if(writes.length){
      await setChatMessages(writes,{refresh:'none'});
      // Helper refresh:none schedules a debounced save. Explicit native save
      // gives the caller a durability boundary before notifying display frames.
      if(!stopped&&chatId()===identity)await SillyTavern.saveChat();
    }
    if(!stopped&&chatId()===identity)await eventEmit(changedEvent);
  }
  const queue=(start,initializing=false)=>{const identity=chatId();tail=tail.catch(()=>{}).then(()=>updateFrom(start,initializing,identity)).catch(e=>{console.error('[Roleplay state]',e.message);});return tail;};
  const subscriptions=[];
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED'])
    if(tavern_events[name])subscriptions.push(eventOn(tavern_events[name],id=>queue(Number.isSafeInteger(id)?id:getLastMessageId())));
  subscriptions.push(eventOn(tavern_events.CHAT_CHANGED,()=>queue(getLastMessageId(),true)));
  window.addEventListener('pagehide',()=>{stopped=true;subscriptions.forEach(s=>s.stop());},{once:true});
  queue(getLastMessageId(),true);
}

/** Read-only UI; mount/remount never initializes or advances roleplay state. */
export function startTargetView(definition, label, assetFor, stamp) {
  const paint=()=>{
    const id=getCurrentMessageId(),message=getChatMessages(id)[0];
    const snapshot=getVariables({type:'message',message_id:id})[definition.namespace];
    const valid=snapshot?.profile===definition.profile&&snapshot.definition===definition.digest&&snapshot.input?.messageId===id&&snapshot.input.swipeId===(message?.swipe_id??0)&&snapshot.input.stamp===stamp(message?.message);
    const health=snapshot?.health,accepted=health?.lastAccepted,rejected=health?.lastRejected;
    const history=(accepted?'最後接受：樓 '+accepted.messageId+(accepted.noOp?'（合法 no-op）':'')+'。':'')+(rejected?' 最後拒絕：樓 '+rejected.messageId+' '+rejected.reason+'。':'');
    document.querySelector('[data-state-notice]').textContent=valid?((snapshot.error?'狀態更新遭拒：'+snapshot.error+'。 ':'')+history+(health?.latest?.status==='no_update'?' 本樓沒有狀態更新嘗試。':'')):'狀態未初始化或快照過期；請檢查這張卡的助手腳本與目前訊息。';
    for(const el of document.querySelectorAll('[data-state-field]')) {
      const key=el.getAttribute('data-state-field');el.textContent=valid?label(definition.fields[key],snapshot.state.values[key],el.getAttribute('data-state-display')):'—';
    }
    for(const el of document.querySelectorAll('img[data-character-id]')) {
      const url=valid?assetFor(definition,el.getAttribute('data-character-id'),snapshot.state):null;
      if(url){el.hidden=false;if(el.getAttribute('src')!==url)el.setAttribute('src',url);}
      else {el.hidden=true;el.removeAttribute('src');}
      el.onerror=()=>{el.hidden=true;document.querySelector('[data-state-notice]').textContent='圖片尚未匯入或無法讀取。';};
    }
  };
  const subscription=eventOn('roleplay-state:'+definition.namespace,paint);
  window.addEventListener('pagehide',()=>subscription.stop(),{once:true});paint();
}
