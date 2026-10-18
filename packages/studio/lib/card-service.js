import { bindCharacterSources } from './character-sources.js';
import { resolveRoster } from './scean-integration.js';
import { decodeDocument, stBook, rawEntries, validateStandaloneBook, entrySummary, projectDocument } from './document-projection.js';
import { tavernBookIssues, nextTavernEntryId, mirrorEditedLegacyAliases } from './tavern-compatibility.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertScopeOperation,assertScopeCandidate,assertManagedBodyGuard } from './authoring-scope.js';
import { ArchiveLifecycle } from './archive-lifecycle.js';
import { writeReceipt } from './write-receipt.js';
import { UploadBuffer } from './upload-buffer.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CardError, fail, clone, sha, canonical, strictJson, decodeCard, encodeCard, patchValue, validateBook, nullableBookSettings, compatibilityWarnings } from './codec.js';

const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(name) && !['.','..'].includes(name);
export function exportFolderName(value,limit=64) {
  let name=(typeof value==='string'?value:'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').trim().replace(/[. ]+$/g,'').slice(0,limit).replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'');
  if(!name||name==='.'||name==='..')name='Unnamed card';
  if(/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
const aborted = signal => signal?.throwIfAborted();
const sessionIdentity = id => typeof id === 'string' && id.trim() && id.length <= 1024;
function mergeMetadata(base,update){
  if(!base||!update||typeof base!=='object'||typeof update!=='object'||Array.isArray(base)||Array.isArray(update))return clone(update);
  const result=clone(base);
  for(const [key,value] of Object.entries(update)){
    if(['__proto__','constructor','prototype'].includes(key)){
      if(Object.hasOwn(base,key)&&canonical(base[key])===canonical(value))continue;fail('PATH','Unsafe metadata mutation key.');
    }
    result[key]=Object.hasOwn(base,key)?mergeMetadata(base[key],value):clone(value);
  }
  return result;
}
export function errorResult(e) { return { ok: false, error: { code: e.name === 'AbortError' ? 'CANCELLED' : e.code ?? 'FAILED', message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } }; }
export async function canonicalRoot(root) { return (await fs.realpath(root)).replace(/[\\/]+$/, '').toLowerCase(); }
export async function contained(root, relative, { existing = false } = {}) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[:\0]/.test(relative)) fail('PATH', 'Use a relative path in the Card Studio workspace.');
  if (relative.split(/[\\/]/).some(x => ['..','.'].includes(x))) fail('PATH', 'Traversal is refused.');
  const base = await fs.realpath(root), target = path.resolve(base,relative);
  const within = p => { const r = path.relative(base,p); return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
  if (!within(target)) fail('PATH', 'Path leaves workspace.');
  const real = await fs.realpath(existing ? target : path.dirname(target));
  if (!within(real)) fail('PATH', 'Symlink or junction leaves workspace.');
  return target;
}
export async function atomicReplace(filename, bytes, signal, beforeRename=()=>{}) {
  const temp = filename + '.' + randomUUID() + '.tmp'; let file;
  try {
    file = await fs.open(temp,'wx'); await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
    for(let attempt=0;;attempt++){
      aborted(signal);await beforeRename();aborted(signal);
      try{await fs.rename(temp,filename);break;}
      catch(error){if(process.platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=2)throw error;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));}
    }
  } finally { await file?.close(); await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
function requireTavernBook(book) {
  const issues=tavernBookIssues(book);
  if(issues.length)fail('ST_COMPATIBILITY','SillyTavern would overwrite or omit worldbook entries. No IDs or content were changed. Inspect the reported entry indices.',{issues});
}
export function requireTavernDocument(decoded,{exporting=false}={}) {
  requireTavernBook(decoded.card.data.character_book);
  if(exporting&&decoded.kind==='png') {
    const texts=decoded.chunks.filter(chunk=>chunk.type==='tEXt'&&chunk.text).map(chunk=>chunk.text);
    const selected=texts.find(text=>text.key==='ccv3')??texts.find(text=>text.key==='chara');
    if(!selected||selected.value.spec!==decoded.card.spec||canonical(selected.value.data)!==canonical(decoded.card.data))
      fail('ST_PNG_ENCODING','SillyTavern 1.19.0 needs matching chara/ccv3 tEXt metadata. Compressed-only metadata is preserved locally but cannot be exported as a verified SillyTavern card.');
  }
}
const documentWarnings=decoded=>[...compatibilityWarnings(decoded.card),...(decoded.warnings??[])];
function replaceEntries(book,entries){book.entries=stBook(book)?Object.fromEntries(entries.map(e=>[String(e.uid),e])):entries;}
function mapEntry(book,changes){
  if(!stBook(book))return clone(changes);
  const result=clone(changes);
  for(const [from,to] of [['keys','key'],['secondary_keys','keysecondary'],['enabled','disable'],['insertion_order','order'],['id','uid']]){
    if(!Object.hasOwn(result,from))continue;if(Object.hasOwn(result,to))fail('ENTRY_ALIAS',`Provide ${from} or ${to}, not both.`);
    result[to]=from==='enabled'?!result[from]:result[from];delete result[from];
  }
  return result;
}
const encodeDocument = (doc, card) => doc.kind === 'worldbook' ? Buffer.from(JSON.stringify(doc.envelope?{...doc.envelope,data:card.data.character_book}:card.data.character_book,null,2) + '\n') : encodeCard(doc,card);
function entryIds(book, previous) {
  if (!book) return [];
  return rawEntries(book).map((e,i) => stBook(book)?`uid:${e.uid}`:e.id !== undefined ? `${typeof e.id==='string'?'id-string':'id'}:${e.id}` : (previous?.[i] ?? `local:${randomUUID()}`));
}
function diff(a,b,prefix='') {
  if (canonical(a) === canonical(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return [{ path:prefix || '/', before:a ?? null, after:b ?? null }];
  return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k => diff(a[k],b[k],prefix + '/' + k.replace(/~/g,'~0').replace(/\//g,'~1')));
}
export class CardService {
  constructor(root, { beforeCommit,lifecycleHooks } = {}) {
    this.root = root; this.beforeCommit = beforeCommit; this.queues = new Map(); this.closing = false;
    this.scopeContext=new AsyncLocalStorage();
    this.uploads=new UploadBuffer();
    this.lifecycle=new ArchiveLifecycle({root,contained:(relative,options)=>contained(root,relative,options),atomicReplace,associations:()=>this.associations(),hooks:lifecycleHooks});
  }
  withAuthoringScope(policy,fn){return this.scopeContext.run(policy,fn);}
  scopePolicy(){return this.scopeContext.getStore();}
  assertScopeCurrent(){this.scopePolicy()?.assertCurrent?.();}
  async init() {
    for (const dir of ['imports','exports','.cardstudio-scean','.cardstudio-scean/documents']) await fs.mkdir(path.join(this.root,dir),{ recursive:true });
    for (const dir of ['imports','exports','.cardstudio-scean','.cardstudio-scean/documents']) await contained(this.root,dir,{existing:true});
  }
  async listImports() {
    const base = await contained(this.root,'imports',{existing:true});
    const files = await fs.readdir(base,{withFileTypes:true});
    return files.filter(x => x.isFile() && /\.(json|png)$/i.test(x.name)).slice(0,100).map(x => 'imports/' + x.name);
  }
  async load(id, revision) {
    if (!safeName(id)) fail('DOCUMENT', 'Invalid document id.');
    const directory = await contained(this.root,`.cardstudio-scean/documents/${id}`,{existing:true});
    let rev = revision;
    if (rev === undefined) rev = strictJson(await fs.readFile(path.join(directory,'current.json'),'utf8')).revision;
    if (!Number.isSafeInteger(rev) || rev < 0) fail('REVISION','Invalid revision.');
    const file = await contained(this.root,`.cardstudio-scean/documents/${id}/${rev}.json`,{existing:true});
    const record = strictJson(await fs.readFile(file,'utf8'),{maxBytes:48*1024*1024});
    if (record.id !== id || record.revision !== rev || sha(Buffer.from(record.bytes,'base64')) !== record.sha256) fail('VERIFY', 'Working snapshot identity/hash mismatch.');
    const decoded = decodeDocument(Buffer.from(record.bytes,'base64'),record.type);
    return { record, decoded };
  }
  async serial(id, fn) {
    if (this.closing) fail('CLOSING','Workspace is closing.');
    const prior = this.queues.get(id) ?? Promise.resolve(); const job = prior.catch(() => {}).then(fn); this.queues.set(id,job);
    try { return await job; } finally { if (this.queues.get(id) === job) this.queues.delete(id); }
  }
  async import(relative, type, signal, librarySource) {
    aborted(signal);
    if (!relative.startsWith('imports/')) fail('PATH','Copy the chosen card/worldbook into imports/ first.');
    const source = await contained(this.root,relative,{existing:true});
    const stat = await fs.stat(source); if (!stat.isFile() || stat.size > 32 * 1024 * 1024) fail('LIMIT','Import must be a file under 32 MiB.');
    const bytes = await fs.readFile(source,{signal}); const decoded = decodeDocument(bytes,type);
    this.assertScopeCurrent();
    const id = randomUUID(), directory = path.join(this.root,'.cardstudio-scean/documents',id); await fs.mkdir(directory);
    const record = { id,revision:0,type:type === 'worldbook' ? 'worldbook' : 'card', source:relative, sourceSha256:sha(bytes), sha256:sha(bytes),bytes:bytes.toString('base64'), entryIds:entryIds(decoded.card.data.character_book), time:new Date().toISOString(), reason:'import' };
    if(librarySource)record.librarySource=clone(librarySource);
    try {
      await fs.writeFile(path.join(directory,'0.json'),JSON.stringify(record),{flag:'wx'}); aborted(signal);
      await atomicReplace(path.join(directory,'current.json'),Buffer.from(JSON.stringify({revision:0})),signal);
    } catch (e) {
      await fs.unlink(path.join(directory,'0.json')).catch(()=>{}); await fs.rmdir(directory).catch(()=>{}); throw e;
    }
    return { id,revision:0,type:record.type,format:decoded.kind,sha256:record.sha256,entryCount:record.entryIds.length,compatibilityWarnings:documentWarnings(decoded),...(decoded.pngMetadata?{pngMetadata:decoded.pngMetadata}:{}) };
  }
  async importUpload(sessionId,uploadId,signal){
    return this.importBytes(this.uploads.finish(sessionId,uploadId),signal);
  }
  async importBytes(upload,signal){
    aborted(signal);
    decodeDocument(upload.bytes,upload.type); // Refuse invalid input before writing anything.
    const extension=path.extname(upload.name).toLowerCase();
    const name=exportFolderName(upload.name.slice(0,-extension.length),80)+extension;
    const relative='imports/'+randomUUID()+'-'+name;
    const destination=await contained(this.root,relative);
    let written=false,handle;
    try{
      this.assertScopeCurrent();
      handle=await fs.open(destination,'wx');written=true;
      await handle.writeFile(upload.bytes,{signal});await handle.sync();await handle.close();handle=null;
      return await this.import(relative,upload.type,signal,upload.librarySource);
    }catch(error){await handle?.close();if(written)await fs.unlink(destination);throw error;}
  }
  async selectedDocument(sessionId){
    const id=(await this.associations()).selections.find(row=>row.sessionId===sessionId)?.documentId;
    if(!id)return null;
    const {record}=await this.load(id);return {document_id:record.id,type:record.type};
  }
  async commit(id, expected, transform, reason, signal, { restoringSnapshot=false,restoredBytes,snapshotExtras } = {}) {
    return this.serial(id,async () => {
      aborted(signal); const {record,decoded} = await this.load(id);
      await this.scopePolicy()?.validateSelection?.();
      if (record.revision !== expected) fail('REVISION_CONFLICT',expected === undefined ? 'Provide expected_revision from a current read before editing.' : 'Refresh and make a local correction.',{...(expected === undefined ? {} : {expected}),actual:record.revision});
      const next = clone(decoded.card), ids = [...record.entryIds]; const mutation = await transform(next,ids,{record,decoded});
      for(const key of nullableBookSettings) if(!restoringSnapshot && next.data.character_book?.[key]===null && decoded.card.data.character_book?.[key]!==null)
        fail('BOOK_CONFIG',`${key}: only existing null values may be preserved; use a valid explicit setting.`);
      if(record.type==='card'&&!restoringSnapshot)mirrorEditedLegacyAliases(decoded.card,next);
      requireTavernBook(next.data.character_book);
      const bytes = restoringSnapshot&&restoredBytes?restoredBytes:canonical(next)===canonical(decoded.card)?Buffer.from(record.bytes,'base64'):encodeDocument(decoded,next), verified = decodeDocument(bytes,record.type);
      requireTavernDocument(verified);
      if (canonical(next) !== canonical(verified.card)) fail('VERIFY','Snapshot reread mismatch.');
      const revision = record.revision + 1;
      const verifiedIds=entryIds(verified.card.data.character_book,ids);
      const extras=await snapshotExtras?.({record,decoded,next,revision,bytes})??{};
      const policy=this.scopePolicy();
      assertScopeCandidate(policy,{before:decoded.card,after:next,beforeIds:record.entryIds,afterIds:verifiedIds,beforeAuthoring:record.authoring,afterAuthoring:extras.authoring??record.authoring});
      assertManagedBodyGuard({action:policy?.action,reason,before:decoded.card,after:next,beforeIds:record.entryIds,afterIds:verifiedIds,authoring:record.authoring});
      const snapshot = {...record,...extras, revision,sha256:sha(bytes),bytes:bytes.toString('base64'),entryIds:verifiedIds,time:new Date().toISOString(),reason};
      const receipt = writeReceipt({id,revision,sha256:snapshot.sha256,before:decoded.card,after:next,beforeIds:record.entryIds,afterIds:verifiedIds,entryId:mutation?.entry_id});
      const filename = await contained(this.root,`.cardstudio-scean/documents/${id}/${revision}.json`);
      this.assertScopeCurrent();
      await fs.writeFile(filename,JSON.stringify(snapshot),{flag:'wx'});
      try {
        await this.beforeCommit?.({id,revision,signal}); aborted(signal);await this.scopePolicy()?.validateSelection?.();this.assertScopeCurrent();
        await atomicReplace(path.join(path.dirname(filename),'current.json'),Buffer.from(JSON.stringify({revision})),signal);
      } catch(e) { await fs.unlink(filename); throw e; }
      return receipt;
    });
  }
  async read(id) {
    const {record,decoded} = await this.load(id);
    return {id,revision:record.revision,type:record.type,format:decoded.kind,sha256:record.sha256,card:decoded.card,readonlyDocument:projectDocument(decoded),entryIds:record.entryIds,compatibilityWarnings:documentWarnings(decoded),...(record.librarySource?{library_source:clone(record.librarySource)}:{}),...(decoded.pngMetadata?{pngMetadata:decoded.pngMetadata}:{})};
  }
  async associations() {
    const filename=await contained(this.root,'.cardstudio-scean/working-copy-sessions.json');
    try {
      const stat=await fs.lstat(filename);
      if(stat.isSymbolicLink()||!stat.isFile())fail('PATH','Invalid working-copy association file.');
      const value=strictJson(await fs.readFile(filename,'utf8'));
      if(value.schemaVersion!==1||!Array.isArray(value.documents)||!Array.isArray(value.selections))fail('ASSOCIATIONS','Invalid working-copy association index.');
      const ids=new Set(),sessions=new Set();
      for(const row of value.documents){
        if(!safeName(row.id)||ids.has(row.id)||!['import','legacy'].includes(row.origin)||!Array.isArray(row.sessions)||!row.sessions.length||row.sessions.some(id=>!sessionIdentity(id))||new Set(row.sessions).size!==row.sessions.length)fail('ASSOCIATIONS','Invalid working-copy association.');
        ids.add(row.id);
      }
      for(const row of value.selections){
        if(!sessionIdentity(row.sessionId)||sessions.has(row.sessionId)||!value.documents.some(d=>d.id===row.documentId&&d.sessions.includes(row.sessionId)))fail('ASSOCIATIONS','Invalid working-copy selection.');
        sessions.add(row.sessionId);
      }
      return value;
    } catch(error) {if(error.code==='ENOENT')return {schemaVersion:1,documents:[],selections:[]};throw error;}
  }
  async associate(sessionId,id,{selected=false,created=false,signal}={}) {
    if(!sessionIdentity(sessionId))fail('SESSION','A trusted DSH Session identity is required.');
    if(!safeName(id))fail('DOCUMENT','Invalid document id.');
    return this.serial('#working-copy-sessions',async()=>{
      aborted(signal);const value=await this.associations();let changed=false;
      let row=value.documents.find(d=>d.id===id);
      // An old unassociated copy remains legacy even after a user reuses it.
      // Neither export bindings nor snapshot contents establish ownership.
      if(!row){row={id,origin:created?'import':'legacy',sessions:[]};value.documents.push(row);changed=true;}
      if(!row.sessions.includes(sessionId)){row.sessions.push(sessionId);changed=true;}
      if(selected){
        let selection=value.selections.find(s=>s.sessionId===sessionId);
        if(!selection){selection={sessionId,documentId:id};value.selections.push(selection);changed=true;}
        else if(selection.documentId!==id){selection.documentId=id;changed=true;}
      }
      if(changed)await atomicReplace(await contained(this.root,'.cardstudio-scean/working-copy-sessions.json'),Buffer.from(JSON.stringify(value)+'\n'),signal);
      await this.lifecycle.usedSession(sessionId);
    });
  }
  async documents(sessionId,{scope='session',offset=0,limit=50}={}) {
    if(!sessionIdentity(sessionId))fail('SESSION','A trusted DSH Session identity is required.');
    if(!['session','all'].includes(scope)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('LIST','Invalid working-copy list scope or page.');
    const associations=await this.associations(),byId=new Map(associations.documents.map(d=>[d.id,d]));
    const dir=await contained(this.root,'.cardstudio-scean/documents',{existing:true});
    const rows=(await fs.readdir(dir,{withFileTypes:true})).filter(x=>x.isDirectory()&&(scope==='all'||byId.get(x.name)?.sessions.includes(sessionId))).sort((a,b)=>a.name.localeCompare(b.name));
    const items=[];
    for(const row of rows.slice(offset,offset+limit)){
      const {record}=await this.load(row.name),association=byId.get(row.name);
      items.push({id:record.id,revision:record.revision,type:record.type,source:record.source,legacy:!association||association.origin==='legacy',shared:(association?.sessions.length??0)>1});
    }
    const selected=associations.selections.find(s=>s.sessionId===sessionId)?.documentId??null;
    return {items,total:rows.length,scope,offset,limit,selectedId:rows.some(row=>row.name===selected)?selected:null};
  }
  async patch(id,expected,patches,signal) {
    return this.commit(id,expected,(card,ids)=>{
      if (patches.some(p=>p.op!=='test'&&(p.path==='/data/character_book'||p.path.startsWith('/data/character_book/entries')))) fail('ENTRY_TOOL','Use stable-ID lorebook tools for entry changes.');
      const next = patchValue(card,patches); Object.assign(card,next); ids.splice(0,ids.length,...entryIds(card.data.character_book,ids));
    },'local card patch',signal);
  }
  async bindSceanCharacter(args,signal) {
    if(!args || Object.keys(args).some(k=>!['document_id','expected_revision','character','sources'].includes(k)))fail('SCEAN_CHARACTER_ARGUMENT','Use character and explicit source selectors.');
    return this.commit(args.document_id,args.expected_revision,card=>{
      const roster=structuredClone(card.data.extensions?.scean?.characters??[]);
      const index=roster.findIndex(c=>c.id===args.character?.id);
      // Local revision edits preserve omitted owner metadata and private settings.
      const actor=bindCharacterSources({...roster[index],...args.character},args.sources,{card,worldbook:card.data.character_book});
      if(index<0)roster.push(actor);else roster[index]=actor;
      resolveRoster(card,roster);
      card.data.extensions??={};card.data.extensions.scean??={};
      card.data.extensions.scean.characters=roster;
    },'local card patch: SCEAN character sources',signal);
  }
  async patchText(id,expected,field,oldText,newText,signal) {
    return this.commit(id,expected,card=>{
      if (!['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions'].includes(field)) fail('FIELD','Unsupported text field.');
      const text = card.data[field]; if (typeof text !== 'string') fail('FIELD','Field is not text.');
      if (oldText === '') fail('PATCH','Use a full field JSON patch to replace an empty field.');
      if (text.split(oldText).length !== 2) fail('MATCH','old_text must occur exactly once; refresh and correct the local patch.');
      card.data[field] = text.replace(oldText,()=>newText);
    },`text patch: ${field}`,signal);
  }
  async book(id,action,args,signal) {
    const {record,decoded} = await this.load(id); const book = decoded.card.data.character_book;
    if (['list','search','read','config'].includes(action)) {
      if (!book) return {id,revision:record.revision,entries:[],config:null};
      if (action === 'config') return {id,revision:record.revision,config:Object.fromEntries(Object.entries(book).filter(([k])=>k!=='entries'))};
      const rows = rawEntries(book).map((entry,i)=>({entry_id:record.entryIds[i],entry}));
      if (action === 'read') { const row = rows.find(x=>x.entry_id===args.entry_id); if (!row) fail('ENTRY_NOT_FOUND','Unknown stable entry_id.'); return {id,revision:record.revision,...clone(row)}; }
      const query = String(args.query ?? '').toLowerCase();
      return {id,revision:record.revision,entries:rows.filter(x=>action==='list' || canonical(x.entry).toLowerCase().includes(query)).map(x=>entrySummary(book,x.entry,x.entry_id))};
    }
    return this.commit(id,args.expected_revision,(card,ids)=>{
      let wb = card.data.character_book;
      if (!wb) { if (action !== 'upsert') fail('BOOK','No embedded worldbook; upsert creates it explicitly.'); wb = card.data.character_book = {entries:[],extensions:{}}; }
      const index = ids.indexOf(args.entry_id),entries=rawEntries(wb),isST=stBook(wb),identity=isST?'uid':'id';
      if (action === 'delete') {
        if (index < 0) fail('ENTRY_NOT_FOUND','Unknown stable entry_id.');
        const refs = args.references ?? [];
        // Caller must identify any known cross-entry references; unknown metadata is left intact.
        if (refs.some(r=>r.target_entry_id===args.entry_id && r.source_entry_id!==args.entry_id)) fail('ENTRY_REFERENCED','Remove or update declared references before deletion.');
        entries.splice(index,1); ids.splice(index,1);
      } else if (action === 'patch') {
        if (index < 0) fail('ENTRY_NOT_FOUND','Unknown stable entry_id.');
        const rawChanges = args.changes;
        if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges) || Object.hasOwn(rawChanges,'id') || Object.hasOwn(rawChanges,'uid')) fail('ENTRY_PATCH','Patch an entry object without changing its ID.');
        const changes=mapEntry(wb,rawChanges),entry = entries[index];
        for (const [key,value] of Object.entries(changes)) {
          if (['__proto__','constructor','prototype'].includes(key)) fail('PATH','Unsafe entry key.');
          entry[key] = Object.hasOwn(entry,key)?mergeMetadata(entry[key],value):clone(value);
        }
      } else if (action === 'upsert') {
        if (args.entry_id && index < 0) fail('ENTRY_NOT_FOUND','Unknown stable entry_id; omit entry_id to create.');
        if (!args.entry || typeof args.entry !== 'object' || Array.isArray(args.entry)) fail('ENTRY','Provide entry object.');
        if (index >= 0) {
          const patch=mapEntry(wb,args.entry);if(patch[identity]!==undefined&&patch[identity]!==entries[index][identity])fail('ENTRY_ID','Existing ID cannot change.');
          // Upsert merges, so omitted unknown fields are retained.
          const previous=entries[index];entries[index]=mergeMetadata(previous,patch);
        } else {
          const e = mapEntry(wb,args.entry);
          if (e[identity] === undefined)e[identity]=nextTavernEntryId(entries,{dictionary:isST});
          entries.push(e); ids.push(`${typeof e[identity]==='string'?'id-string':identity}:${e[identity]}`);
        }
      } else if (action === 'patch_config') {
        if (!args.changes || Object.hasOwn(args.changes,'entries')) fail('BOOK_CONFIG','Config patch cannot replace entries.');
        for (const [k,v] of Object.entries(args.changes)) {
          if (['__proto__','constructor','prototype'].includes(k)) fail('PATH','Unsafe config key.');
          wb[k] = Object.hasOwn(wb,k)?mergeMetadata(wb[k],v):clone(v);
        }
      } else fail('ACTION','Unsupported worldbook action.');
      if(isST && new Set(entries.map(e=>e.uid)).size!==entries.length)fail('DUPLICATE_ID','Duplicate ST uid.');
      replaceEntries(wb,entries);validateStandaloneBook(wb);
      if (new Set(ids).size !== ids.length) fail('DUPLICATE_ID','Stable entry IDs collide.');
      for (const r of args.references ?? []) if (!ids.includes(r.source_entry_id) || !ids.includes(r.target_entry_id)) fail('REFERENCE','Declared reference points to missing entry.');
      if(action!=='patch_config')return {entry_id:action==='upsert'&&index<0?ids.at(-1):args.entry_id};
    },`worldbook ${action}`,signal);
  }
  async history(id) {
    const dir = await contained(this.root,`.cardstudio-scean/documents/${id}`,{existing:true});
    const files = (await fs.readdir(dir)).filter(x=>/^\d+\.json$/.test(x)).sort((a,b)=>parseInt(a)-parseInt(b));
    return { id, revisions:await Promise.all(files.map(async file=>{const r=strictJson(await fs.readFile(path.join(dir,file),'utf8'),{maxBytes:48*1024*1024});return {revision:r.revision,time:r.time,reason:r.reason,sha256:r.sha256};})) };
  }
  async compare(id,from,to) {const a=await this.load(id,from),b=await this.load(id,to);return {id,from,to,changes:diff(a.decoded.card,b.decoded.card)};}
  async rollback(id,expected,to,signal) {const target=await this.load(id,to);return this.commit(id,expected,(card,ids)=>{for(const k of Object.keys(card))delete card[k];Object.assign(card,clone(target.decoded.card));ids.splice(0,ids.length,...target.record.entryIds);},`rollback to ${to}`,signal,{restoringSnapshot:true,restoredBytes:Buffer.from(target.record.bytes,'base64')});}
  async existingExportFolder(sessionId,signal) {
    if(!sessionIdentity(sessionId))fail('SESSION','A trusted DSH Session identity is required.');
    aborted(signal);
    const directory=async relative=>{
      const target=await contained(this.root,relative,{existing:true}),info=await fs.lstat(target);
      if(info.isSymbolicLink()||!info.isDirectory())fail('PATH','Export directories cannot be symlinks or junctions.');
      return fs.realpath(target); // Preserve native spelling for DSH's verified Host-path round trip.
    };
    const parent=await directory('exports'),id=(await this.associations()).selections.find(row=>row.sessionId===sessionId)?.documentId??null;
    const fallback={path:parent,relative_path:'exports',scope:'workspace',document_id:id};
    if(!id)return fallback;
    const key=sha(Buffer.from(JSON.stringify([sessionId,id])));
    try{
      await directory('.cardstudio-scean/export-folders');
      const file=await contained(this.root,`.cardstudio-scean/export-folders/${key}.json`,{existing:true}),info=await fs.lstat(file);
      if(info.isSymbolicLink()||!info.isFile())fail('PATH','Invalid export folder binding.');
      const row=strictJson(await fs.readFile(file,'utf8'));
      if(row.schemaVersion!==1||row.key!==key||typeof row.directory!=='string'||exportFolderName(row.directory,80)!==row.directory)fail('EXPORT_FOLDER','Invalid saved export folder binding.');
      const relative='exports/'+row.directory,hostPath=await directory(relative);aborted(signal);
      return {path:hostPath,relative_path:relative,scope:'document',document_id:id};
    }catch(error){if(error.code==='ENOENT')return fallback;throw error;}
  }
  async exportDirectory(sessionId,documentId,cardName,signal) {
    if(typeof sessionId!=='string'||!sessionId.trim()||sessionId.length>1024)fail('EXPORT_SESSION','Export requires a trusted DSH Session identity.');
    const key=sha(Buffer.from(JSON.stringify([sessionId,documentId])));
    const state=await contained(this.root,'.cardstudio-scean/export-folders');await fs.mkdir(state,{recursive:true});
    for(const relative of ['exports','.cardstudio-scean/export-folders']){
      const dir=await contained(this.root,relative,{existing:true}),stat=await fs.lstat(dir);
      if(stat.isSymbolicLink()||!stat.isDirectory())fail('PATH','Export directories cannot be symlinks or junctions.');
    }
    const binding=await contained(this.root,`.cardstudio-scean/export-folders/${key}.json`);
    const readBinding=async()=>{
      const stat=await fs.lstat(binding);if(stat.isSymbolicLink()||!stat.isFile())fail('PATH','Invalid export folder binding.');
      const row=strictJson(await fs.readFile(binding,'utf8'));
      if(row.schemaVersion!==1||row.key!==key||typeof row.directory!=='string'||exportFolderName(row.directory,80)!==row.directory)fail('EXPORT_FOLDER','Invalid saved export folder binding.');
      const relative='exports/'+row.directory,target=await contained(this.root,relative,{existing:true}),folder=await fs.lstat(target);
      if(folder.isSymbolicLink()||!folder.isDirectory())fail('PATH','Export folder cannot be a symlink or junction.');
      return relative;
    };
    try{return await readBinding();}catch(e){if(e.code!=='ENOENT')throw e;}
    // An existing mapping with a missing folder is an error, never a reason to
    // silently regroup this conversation or overwrite the saved association.
    try{await fs.lstat(binding);fail('EXPORT_FOLDER','The saved export folder is missing. Restore it before exporting.');}catch(e){if(e.code!=='ENOENT')throw e;}
    const base=exportFolderName(cardName);let relative,target;
    for(let n=1;n<=10000;n++){
      aborted(signal);relative='exports/'+base+(n===1?'':` (${n})`);target=await contained(this.root,relative);
      try{await fs.mkdir(target);break;}catch(e){if(e.code!=='EEXIST')throw e;if(n===10000)fail('EXPORT_FOLDER','Too many existing folders with this name.');}
    }
    const temp=binding+'.'+randomUUID()+'.tmp';
    try{
      await fs.writeFile(temp,JSON.stringify({schemaVersion:1,key,directory:relative.slice(8)})+'\n',{flag:'wx'});aborted(signal);
      try{await fs.link(temp,binding);}catch(e){
        if(e.code!=='EEXIST')throw e;
        // Only our newly created, still-empty directory may be removed.
        await contained(this.root,relative,{existing:true});await fs.rmdir(target);return await readBinding();
      }
    }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    return relative;
  }
  async export(id,expected,name,signal,sessionId) {
    return this.serial(id,async()=>{
      aborted(signal);const {record,decoded}=await this.load(id);if(record.revision!==expected)fail('REVISION_CONFLICT','Refresh before export.');
      if(!safeName(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(name) || !(name.endsWith('.json')||(decoded.kind==='png'&&name.endsWith('.png'))))fail('EXPORT_NAME','Choose a non-reserved ASCII .json filename, or .png for an imported PNG.');
      const asJson=decoded.kind==='png'&&name.endsWith('.json');
      requireTavernDocument(decoded,{exporting:!asJson});
      const directory=await this.exportDirectory(sessionId,id,record.type==='worldbook'?decoded.card.data.character_book?.name:decoded.card.data.name,signal);
      const relative=directory+'/'+name,target=await contained(this.root,relative),bytes=asJson?Buffer.from(JSON.stringify(decoded.card,null,2)+'\n'):Buffer.from(record.bytes,'base64'),digest=sha(bytes),temp=target+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temp,bytes,{flag:'wx'});aborted(signal);await fs.link(temp,target);}finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      const saved=await fs.readFile(target);if(sha(saved)!==digest)fail('VERIFY','Export reread hash mismatch.');const verified=decodeDocument(saved,record.type);if(canonical(verified.card)!==canonical(decoded.card))fail('VERIFY','Export card mismatch.');
      return {id,revision:expected,path:relative,sha256:digest};
    });
  }
  async close() {this.closing=true;await Promise.allSettled([...this.queues.values()]);this.uploads.clear();}
  async synchronizeArchiveState(ids){return this.serial('#workspace-operations',()=>this.lifecycle.reconcile(ids));}
  async prepareRecycleRollback(){return this.serial('#workspace-operations',()=>this.lifecycle.prepareRollback());}
  async operation(action,args,signal,context={}) {
    try{assertScopeOperation(this.scopePolicy(),action,args);return await this.serial('#workspace-operations',async()=>{assertScopeOperation(this.scopePolicy(),action,args);await this.scopePolicy()?.validateSelection?.();return this.performOperation(action,args,signal,context);});}catch(error){return errorResult(error);}
  }
  async performOperation(action,args,signal,context={}) {
    try {
      aborted(signal);if(this.closing)fail('CLOSING','Workspace is closing.');let value;
      await this.lifecycle.assertReady(context.sessionId);
      if(!['imports','documents','import','export'].includes(action)&&!sessionIdentity(context.sessionId))fail('SESSION','A trusted DSH Session identity is required.');
      // Refuse an already corrupt index before changing any snapshot/export.
      if(!['imports','documents'].includes(action)&&!action.startsWith('upload_'))await this.associations();
      if(action==='imports')value=await this.listImports();
      else if(action==='documents')value=await this.documents(context.sessionId,args);
      else if(action==='export_folder')value=await this.existingExportFolder(context.sessionId,signal);
      else if(action==='upload_begin')value=this.uploads.begin(context.uploadOwner??context.sessionId,args);
      else if(action==='upload_chunk')value=this.uploads.append(context.uploadOwner??context.sessionId,args);
      else if(action==='upload_abort')value=this.uploads.abort(context.uploadOwner??context.sessionId,args.upload_id);
      else if(action==='upload_finish'){
        await this.associations();
        value=await this.importUpload(context.uploadOwner??context.sessionId,args.upload_id,signal);
        await this.associate(context.sessionId,value.id,{selected:true,created:true,signal});
      }
      else if(action==='import'){
        if(!sessionIdentity(context.sessionId))fail('SESSION','A trusted DSH Session identity is required.');
        value=await this.import(args.path,args.type,signal);
        await this.associate(context.sessionId,value.id,{selected:true,created:true,signal});
      }
      else if(action==='read'||action==='open'){
        value=await this.read(args.document_id);
        if(args.fields){if(!Array.isArray(args.fields)||args.fields.some(k=>typeof k!=='string'||!Object.hasOwn(value.card.data,k)))fail('FIELD','Unknown requested card field.');value={...value,card:{...value.card,data:Object.fromEntries(args.fields.map(k=>[k,value.card.data[k]]))}};}
      }
      else if(action==='scean_character')value=await this.bindSceanCharacter(args,signal);
      else if(action==='patch')value=await this.patch(args.document_id,args.expected_revision,args.patches,signal);
      else if(action==='patch_text')value=await this.patchText(args.document_id,args.expected_revision,args.field,args.old_text,args.new_text,signal);
      else if(action.startsWith('book_'))value=await this.book(args.document_id,action.slice(5),args,signal);
      else if(action==='history')value=await this.history(args.document_id);
      else if(action==='diff')value=await this.compare(args.document_id,args.from,args.to);
      else if(action==='rollback')value=await this.rollback(args.document_id,args.expected_revision,args.to,signal);
      else if(action==='export')value=await this.export(args.document_id,args.expected_revision,args.name,signal,context.sessionId);
      else fail('ACTION','Unknown Card Studio operation.');
      if(!['imports','documents','import','export_folder'].includes(action)&&!action.startsWith('upload_'))await this.associate(context.sessionId,args.document_id,{selected:action==='open',signal});
      return {ok:true,value};
    }catch(e){return errorResult(e);}
  }
}
