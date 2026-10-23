import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {canonical,sha,fail,strictJson,clone} from './codec.js';
import {contained,atomicReplace} from './card-service.js';

export const PRESET_MAX_BYTES=4*1024*1024;
const RECORD_MAX_BYTES=16*1024*1024,MAX_RECEIPTS=10000;
const queues=new Map(),digest=value=>sha(Buffer.from(canonical(value)));
const own=(value,key)=>Object.hasOwn(value,key);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)&&!['.','..'].includes(value);
const operationId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ticketName=/^[a-f0-9-]{36}\.[crx]\.json$/;

/** Preserve the complete JSON object. Payload id/revision and unknown fields
 * are authored data; they are never the storage identity or compare-and-swap. */
export function normalizePreset(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('PRESET_INVALID','Preset must be a complete JSON object.');
  let nodes=0;const active=new Set();
  const walk=(v,depth)=>{
    if(++nodes>200000||depth>128)fail('PRESET_LIMIT','Preset exceeds its structural limit.');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){if(/\p{Surrogate}/u.test(v))fail('PRESET_INVALID','Invalid Unicode in Preset.');return;}
    if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail('PRESET_INVALID','Preset numbers must round-trip exactly.');return;}
    if(typeof v!=='object'||active.has(v)||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('PRESET_INVALID','Preset must contain only JSON values.');
    if(Object.getOwnPropertySymbols(v).length)fail('PRESET_INVALID','Preset must contain only JSON values.');active.add(v);
    const descriptors=Object.getOwnPropertyDescriptors(v);
    for(const [key,d]of Object.entries(descriptors)){
      if(Array.isArray(v)&&key==='length')continue;
      if(!own(d,'value')||!d.enumerable||/\p{Surrogate}/u.test(key)||Array.isArray(v)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=v.length))fail('PRESET_INVALID','Preset must contain plain JSON data.');
      walk(d.value,depth+1);
    }
    if(Array.isArray(v)&&Object.keys(v).length!==v.length)fail('PRESET_INVALID','Sparse arrays are not JSON data.');active.delete(v);
  };
  walk(value,0);const text=JSON.stringify(value);
  if(Buffer.byteLength(text)>PRESET_MAX_BYTES)fail('PRESET_LIMIT','Preset exceeds 4 MiB.');
  return strictJson(text,{maxBytes:PRESET_MAX_BYTES});
}

/** Storage only, called by the existing human lease/authoring boundary.
 * `check` is required on EVERY call; it validates the current caller's exact
 * bound card, scope and lease, including immediately before publication.
 * No method grants a lease, selects a card, changes a Run or runs a model. */
export function createPresetStore({root,defaultPreset,fault}={}){
  if(typeof root!=='string'||!root)fail('PRESET_STORE','Workspace root is required.');
  const fallback=normalizePreset(defaultPreset),fallbackHash=digest(fallback);
  const validateArgs=({documentId,check})=>{if(!id(documentId))fail('PRESET_DOCUMENT','Use the fixed working-card identity.');if(typeof check!=='function')fail('PRESET_AUTHORITY_REQUIRED','A current card authorization check is required.');};
  const guard=async args=>{args.signal?.throwIfAborted();await args.check();args.signal?.throwIfAborted();};
  const initial=documentId=>({schemaVersion:1,documentId,revision:0,preset:clone(fallback),presetHash:fallbackHash,receipts:[]});
  async function directory(relative,create){
    const target=await contained(root,relative);
    if(create)await fs.mkdir(target).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const stat=await fs.lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())fail('PRESET_PATH','Preset storage must use owned directories without links.');
    await contained(root,relative,{existing:true});return target;
  }
  async function paths(documentId,{create=false,tickets=false}={}){
    const relative='.cardstudio-scean/presets/'+sha(Buffer.from(documentId));
    for(const part of ['.cardstudio-scean','.cardstudio-scean/presets',relative])await directory(part,create);
    if(tickets)await directory(relative+'/tickets',create);
    return {relative,file:await contained(root,relative+'/current.json'),tickets:await contained(root,relative+'/tickets')};
  }
  async function regular(file,{maxBytes=RECORD_MAX_BYTES}={}){
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('PRESET_STORE','Preset data must be a bounded regular file.');
    return strictJson(await fs.readFile(file,'utf8'),{maxBytes});
  }
  function validateRecord(row,documentId){
    if(!row||row.schemaVersion!==1||row.documentId!==documentId||!Number.isSafeInteger(row.revision)||row.revision<1||!Array.isArray(row.receipts)||row.receipts.length!==row.revision||row.receipts.length>MAX_RECEIPTS||Object.keys(row).some(k=>!['schemaVersion','documentId','revision','preset','presetHash','receipts'].includes(k)))fail('PRESET_CORRUPT','Invalid Preset record.');
    const preset=normalizePreset(row.preset);if(row.presetHash!==digest(preset))fail('PRESET_CORRUPT','Preset hash mismatch.');
    const seen=new Set();for(const [index,receipt]of row.receipts.entries()){
      if(!receipt||receipt.status!=='committed'||receipt.revision!==index+1||!operationId(receipt.operationId)||seen.has(receipt.operationId)||!hash(receipt.presetHash)||typeof receipt.savedAt!=='string'||!Number.isFinite(Date.parse(receipt.savedAt))||receipt.fingerprint!==digest({documentId,expectedRevision:index,operationId:receipt.operationId,presetHash:receipt.presetHash})||Object.keys(receipt).some(k=>!['status','operationId','revision','presetHash','savedAt','fingerprint'].includes(k)))fail('PRESET_CORRUPT','Invalid Preset receipt.');
      seen.add(receipt.operationId);
    }
    if(row.receipts.at(-1).presetHash!==row.presetHash)fail('PRESET_CORRUPT','Current Preset does not match its receipt.');return row;
  }
  async function load(documentId){
    await fault?.('read',{documentId});let location;
    try{location=await paths(documentId);return validateRecord(await regular(location.file),documentId);}
    catch(error){if(error.code==='ENOENT')return initial(documentId);throw error;}
  }
  const receiptView=receipt=>{const {fingerprint,...value}=receipt;return clone(value);};
  const view=(row,receipt=row.receipts.at(-1))=>({schemaVersion:1,scope:'working-card',documentId:row.documentId,revision:row.revision,presetHash:row.presetHash,preset:clone(row.preset),saved:row.revision>0,...(row.receipts.length?{savedAt:row.receipts.at(-1).savedAt}:{}),...(receipt?{receipt:receiptView(receipt)}:{})});
  async function syncDir(dir){let handle;try{handle=await fs.open(dir,'r');await handle.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','EACCES','ENOTSUP','EBADF'].includes(error.code))throw error;}finally{await handle?.close();}}
  async function write(file,value,signal,check=async()=>{}){await atomicReplace(file,Buffer.from(JSON.stringify(value)+'\n'),signal,check);}

  // Same nonblocking immutable-ticket (Lamport bakery) algorithm as the Runtime
  // DurableStore. Per-process queues avoid needless same-Host contention; the
  // tickets additionally fence independent service instances/processes.
  async function clearTickets(dir,token){
    for(const phase of ['c','r','x'])try{await fs.unlink(dir+'/'+token+'.'+phase+'.json');}catch(error){if(error.code==='ENOENT')continue;if(['EPERM','EACCES','EBUSY'].includes(error.code))return;throw error;}
  }
  async function activeTickets(dir){
    const owners=new Map(),priority={choosing:0,ready:1,released:2};
    for(const name of (await fs.readdir(dir)).filter(n=>ticketName.test(n))){
      let owner;try{owner=await regular(dir+'/'+name,{maxBytes:4096});}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||!/^[a-f0-9-]{36}$/.test(owner.token)||!name.startsWith(owner.token+'.')||!own(priority,owner.phase)||(owner.ticket!==null&&(!Number.isSafeInteger(owner.ticket)||owner.ticket<1)))fail('PRESET_LOCK','Invalid Preset lock ticket.');
      const prior=owners.get(owner.token);if(!prior||priority[owner.phase]>priority[prior.phase])owners.set(owner.token,owner);
    }
    const active=[];for(const owner of owners.values()){
      if(owner.phase==='released')continue;
      try{process.kill(owner.pid,0);active.push(owner);}catch(error){if(error.code==='ESRCH')await clearTickets(dir,owner.token);else active.push(owner);}
    }return active;
  }
  async function withLock(args,work){
    await guard(args);
    const location=await paths(args.documentId,{create:true,tickets:true}),dir=location.tickets,token=randomUUID(),owner={pid:process.pid,token,ticket:null,phase:'choosing'};
    try{
      await guard(args);await write(dir+'/'+token+'.c.json',owner);
      const tickets=await activeTickets(dir);owner.ticket=Math.max(0,...tickets.map(t=>t.ticket??0))+1;owner.phase='ready';await write(dir+'/'+token+'.r.json',owner);
      const competitors=(await activeTickets(dir)).filter(t=>t.token!==token);
      if(competitors.some(t=>t.ticket===null||t.ticket<owner.ticket||t.ticket===owner.ticket&&t.token<token))fail('PRESET_BUSY','Another Preset save is active; check the same operation before retrying.');
      await guard(args);return await work(location);
    }finally{await write(dir+'/'+token+'.x.json',{...owner,phase:'released'});await clearTickets(dir,token);}
  }
  async function serial(documentId,work){
    const key=(await fs.realpath(root)).toLowerCase()+':preset:'+documentId,prior=queues.get(key)??Promise.resolve(),job=prior.catch(()=>{}).then(work);queues.set(key,job);
    try{return await job;}finally{if(queues.get(key)===job)queues.delete(key);}
  }
  async function read(args){validateArgs(args);await guard(args);const row=await load(args.documentId);await guard(args);return view(row);}
  async function status(args){
    validateArgs(args);if(!operationId(args.operationId))fail('PRESET_OPERATION','A stable operationId is required.');await guard(args);const row=await load(args.documentId),receipt=row.receipts.find(r=>r.operationId===args.operationId);await guard(args);
    return {status:receipt?'committed':'not_committed',documentId:args.documentId,operationId:args.operationId,currentRevision:row.revision,currentPresetHash:row.presetHash,...(receipt?{receipt:receiptView(receipt)}:{})};
  }
  async function save(args){
    validateArgs(args);if(!operationId(args.operationId))fail('PRESET_OPERATION','A stable operationId is required.');
    if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0||args.expectedRevision>=Number.MAX_SAFE_INTEGER)fail('PRESET_REVISION_REQUIRED','Use the storage revision returned by Preset read.');
    const preset=normalizePreset(args.preset),presetHash=digest(preset),fingerprint=digest({documentId:args.documentId,expectedRevision:args.expectedRevision,operationId:args.operationId,presetHash});
    await guard(args);
    return serial(args.documentId,async()=>{
      let publicationAttempted=false;
      try{return await withLock(args,async location=>{
        const current=await load(args.documentId),prior=current.receipts.find(r=>r.operationId===args.operationId);
        if(prior){if(prior.fingerprint!==fingerprint)fail('PRESET_OPERATION_CONFLICT','This operationId belongs to a different Preset save.');await guard(args);return {...view(current,prior),replayed:true};}
        if(current.revision!==args.expectedRevision)fail('PRESET_REVISION_CONFLICT','Preset changed. Read the saved version before saving your draft.',{expected:args.expectedRevision,actual:current.revision});
        if(current.receipts.length>=MAX_RECEIPTS)fail('PRESET_RECEIPTS_FULL','Preset receipt capacity reached; existing saves remain readable.');
        const receipt={status:'committed',operationId:args.operationId,revision:current.revision+1,presetHash,savedAt:new Date().toISOString(),fingerprint};
        const next={schemaVersion:1,documentId:args.documentId,revision:receipt.revision,preset,presetHash,receipts:[...current.receipts,receipt]};
        if(Buffer.byteLength(JSON.stringify(next))>RECORD_MAX_BYTES)fail('PRESET_LIMIT','Preset record exceeds its storage limit.');
        publicationAttempted=true;
        await write(location.file,next,args.signal,async()=>{await guard(args);const actual=await paths(args.documentId);try{await regular(actual.file);}catch(error){if(error.code!=='ENOENT')throw error;}await fault?.('beforeRename',{documentId:args.documentId,operationId:args.operationId});});
        await syncDir(await directory(location.relative,false));await fault?.('afterRename',{documentId:args.documentId,operationId:args.operationId});
        await guard(args);return view(next,receipt);
      });}catch(error){
        if(!publicationAttempted)throw error;
        // Do not turn post-publication cancellation, access changes or a lost
        // acknowledgement into a false "not saved" result. The canonical
        // aggregate contains the preset and its receipt in the same rename.
        let actual;try{actual=await load(args.documentId);}catch{fail('PRESET_SAVE_UNKNOWN','Save outcome is unknown. Check this operationId after access is restored.',{operationId:args.operationId});}
        const receipt=actual.receipts.find(r=>r.operationId===args.operationId);
        if(receipt?.fingerprint===fingerprint){try{await guard(args);}catch{fail('PRESET_SAVE_UNKNOWN','The request ended after publication may have completed. Check this operationId.',{operationId:args.operationId});}return {...view(actual,receipt),recovered:true};}
        throw error;
      }
    });
  }
  return {read,save,status};
}
