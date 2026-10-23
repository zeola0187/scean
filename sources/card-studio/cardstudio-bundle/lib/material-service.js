import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LibraryCardService } from './library-service.js';
import { errorResult,contained } from './card-service.js';
import { clone,canonical,sha,fail } from './codec.js';
import { assertScopeOperation } from './authoring-scope.js';
import { projectDocument,documentSegments,rawEntries,stBook } from './document-projection.js';
import { MaterialStore,content,digest,identity,hashOK,recordHash,text } from './material-store.js';

const sourceFields=['name','description','personality','scenario','mes_example','creator_notes'];
const sourceLocator=locator=>typeof locator==='string'&&(sourceFields.some(f=>locator==='/data/'+f)||/^\/data\/character_book\/entries\/[^/]+\/(?:name|comment|content|(?:keys|secondary_keys|key|keysecondary)\/\d+)$/.test(locator));
const batchHash=b=>digest({sources:b.sources,reads:b.reads,candidates:b.candidates,intent:b.intent,revision:b.revision});
const keys=(args,allowed)=>{if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!allowed.includes(k)))fail('MATERIAL_ARGUMENT','Unknown or unsafe material argument.');};
export class MaterialCardService extends LibraryCardService {
  constructor(root,options={}){super(root,options);this.materials=new MaterialStore(root,options.materialOptions);}
  async init(){await super.init();await this.materials.init();}
  async source(ref,sessionId,signal){
    if(ref?.type==='library'){
      keys(ref,['type','item_id','source_sha256']);await this.library.ensure(signal);const v=await this.library.verified(ref,signal);
      return {...v,identity:{type:'library',source_item_id:v.row.item_id,source_name:v.row.name,relative_path:'library/'+v.row.relative_path,source_sha256:v.source_sha256,snapshot_format:v.decoded.kind==='png'?'png':'json'}};
    }
    keys(ref,['type','document_id','revision','source_sha256']);if(ref.type!=='document'||!identity(ref.document_id)||!Number.isSafeInteger(ref.revision)||!hashOK(ref.source_sha256))fail('MATERIAL_SOURCE','Use a fixed document revision and byte hash.');
    await this.assertBoundDocument(sessionId,ref.document_id);
    if(!(await this.associations()).documents.some(r=>r.id===ref.document_id&&r.sessions.includes(sessionId)))fail('MATERIAL_SOURCE','Use a working copy associated with this Session.');
    const v=await this.load(ref.document_id,ref.revision),current=await this.load(ref.document_id);if(current.record.revision!==ref.revision||v.record.sha256!==ref.source_sha256)fail('SOURCE_CHANGED','Working copy revision changed. Begin a new extraction.');
    return {...v,bytes:Buffer.from(v.record.bytes,'base64'),identity:{type:'document',document_id:ref.document_id,revision:ref.revision,source_name:v.decoded.card.data.name??v.decoded.card.data.character_book?.name??'Worldbook',relative_path:v.record.source,source_sha256:ref.source_sha256,snapshot_format:v.decoded.kind==='png'?'png':'json',...v.record.librarySource?{library_source:clone(v.record.librarySource)}:{}}};
  }
  async batch(id,sessionId,{review=false}={}){
    if(!identity(id))fail('MATERIAL_ID','Invalid extraction ID.');const b=await this.materials.json('.cardstudio-scean/material-candidates/'+id+'.json',4*1024*1024);
    if(b.extraction_id!==id||b.session_id!==sessionId)fail('MATERIAL_SESSION','Candidate belongs to another Session.');
    for(const source of b.sources??[])if(source.ref?.type==='document')await this.assertBoundDocument(sessionId,source.ref.document_id);
    if(b.expires_at<=this.materials.now())fail('MATERIAL_EXPIRED','Candidate expired; begin a new extraction.');
    if(b.scope_epoch!==(this.scopePolicy()?.epoch??0))fail('AUTHORING_SCOPE_CHANGED','Candidate belongs to an older scope epoch. Begin again under the current scope.');
    if((b.session_generation??null)!==(this.scopePolicy()?.sessionGeneration??null))fail('MATERIAL_SESSION_EPOCH','Candidate belongs to an older Session generation. Begin a new extraction.');
    if(b.candidate_sha256!==batchHash(b))fail('MATERIAL_VERIFY','Candidate hash mismatch.');
    if(!review&&await this.materials.receipt(id))fail('MATERIAL_REVIEWED','Extraction already reviewed; re-extraction creates a new candidate.');return b;
  }
  async saveBatch(b,signal){b.candidate_sha256=batchHash(b);await this.materials.save('.cardstudio-scean/material-candidates/'+b.extraction_id+'.json',b,signal,()=>this.assertScopeCurrent());return this.batchView(b);}
  batchView(b){return {extraction_id:b.extraction_id,revision:b.revision,candidate_sha256:b.candidate_sha256,intent:b.intent,scope_epoch:b.scope_epoch,expires_at:b.expires_at,sources:b.sources,reads:b.reads,candidates:b.candidates,coverage:'read-ranges-only',review:'Only the human materials UI can approve or record zero acceptance.'};}
  async begin(args,sessionId,signal){
    keys(args,['action','sources','intent']);text(args.intent,'intent',2000);if(!Array.isArray(args.sources)||!args.sources.length||args.sources.length>8)fail('MATERIAL_SOURCE','Explicit extraction accepts 1..8 selected sources.');
    const sources=[];for(const ref of args.sources){const v=await this.source(ref,sessionId,signal);sources.push({ref:clone(ref),...v.identity});}
    this.assertScopeCurrent();const b={schema_version:1,extraction_id:randomUUID(),session_id:sessionId,session_generation:this.scopePolicy()?.sessionGeneration??null,scope_epoch:this.scopePolicy()?.epoch??0,revision:0,intent:args.intent,sources,reads:[],candidates:[],created_at:new Date(this.materials.now()).toISOString(),expires_at:this.materials.now()+this.materials.limits.expiryMs};return this.saveBatch(b,signal);
  }
  async sourceRead(args,sessionId,signal){
    keys(args,['action','extraction_id','source_index','fields','locators','offset','budget']);const b=await this.batch(args.extraction_id,sessionId);if(!Number.isSafeInteger(args.source_index)||!b.sources[args.source_index])fail('MATERIAL_SOURCE','Unknown source index.');
    const selected=b.sources[args.source_index],v=await this.source(selected.ref,sessionId,signal);const fields=args.fields??sourceFields.filter(f=>f!=='creator_notes');
    if(!Array.isArray(fields)||fields.some(f=>!sourceFields.includes(f))||args.locators?.some(l=>!sourceLocator(l)))fail('MATERIAL_OPENING','Opening, runtime, prompt fields and unknown metadata are excluded from extraction.');
    const projection=projectDocument(v.decoded,{fields,locators:args.locators,offset:args.offset,budget:args.budget}),context=[];
    for(const row of projection.evidence){
      const found=b.reads.find(r=>r.source_index===args.source_index&&r.locator===row.locator);if(found)found.ranges.push([row.raw_start,row.raw_end]);else b.reads.push({source_index:args.source_index,locator:row.locator,total_characters:row.total_characters,ranges:[[row.raw_start,row.raw_end]]});
      if(row.entry_locator&&!context.some(c=>c.index===row.entry_locator.index)){
        const entry=rawEntries(v.decoded.card.data.character_book)[row.entry_locator.index],known=['enabled','disable','constant','selective','probability','position','insertion_order','order','case_sensitive','scan_depth','use_regex'];
        const controls=Object.fromEntries(known.filter(k=>Object.hasOwn(entry,k)&&['string','number','boolean'].includes(typeof entry[k])).map(k=>[k,typeof entry[k]==='string'?entry[k].slice(0,160):entry[k]]));
        context.push({...row.entry_locator,controls,unknown_metadata_keys:Object.keys(entry).filter(k=>![...known,'id','uid','name','comment','content','keys','key','secondary_keys','keysecondary'].includes(k)).slice(0,32),runtime_warning:/<%|@@|<script|\{\{/.test(entry.content)?'Executable/conditional source present. Preserve understandable conditions as narrative; do not carry code.':null,condition_coverage:'Controls are context only; unknown extensions and runtime conditions remain unverified.'});
      }
    }
    if(b.reads.length>128||b.reads.some(r=>r.ranges.length>64))fail('MATERIAL_BUDGET','Extraction read ledger budget exceeded.');b.revision++;await this.saveBatch(b,signal);
    return {...projection,extraction_id:b.extraction_id,source_index:args.source_index,source:selected,entry_context:context,revision:b.revision,candidate_sha256:b.candidate_sha256,excluded_fields:['first_mes','alternate_greetings','group_only_greetings','system_prompt','post_history_instructions','extensions','regex','runtime']};
  }
  provenance(b,refs){
    if(!Array.isArray(refs)||!refs.length||refs.length>8)fail('MATERIAL_PROVENANCE','Each material requires selected source references.');return refs.map(ref=>{
      keys(ref,['source_index','locators','transform_note']);const s=b.sources[ref.source_index];if(!Number.isSafeInteger(ref.source_index)||!s||!Array.isArray(ref.locators)||!ref.locators.length||ref.locators.length>32)fail('MATERIAL_PROVENANCE','Use observed source indices and read locators.');
      const ranges=ref.locators.map(locator=>{if(!sourceLocator(locator))fail('MATERIAL_OPENING','Opening/runtime locators cannot enter materials.');const r=b.reads.find(r=>r.source_index===ref.source_index&&r.locator===locator);if(!r)fail('MATERIAL_UNREAD','Read each cited locator through source_read before proposing.');return clone(r);});
      const complete=r=>{let at=0;for(const [a,z] of [...r.ranges].sort((a,b)=>a[0]-b[0])){if(a>at)return false;at=Math.max(at,z);}return at>=r.total_characters;};
      const {ref:sourceRef,...identityFields}=s;return {...identityFields,snapshot:'materials/sources/'+s.source_sha256+'.'+s.snapshot_format,projection_version:'card-fields-v1',locators:clone(ref.locators),read_ranges:ranges,coverage:ranges.every(complete)?'selected-locators':'partial',transform_note:text(ref.transform_note,'transform_note',2000)};
    });
  }
  async propose(args,sessionId,signal){
    keys(args,['action','extraction_id','expected_revision','candidate_sha256','candidates']);const b=await this.batch(args.extraction_id,sessionId);this.expected(b,args);if(!Array.isArray(args.candidates)||args.candidates.length>20)fail('MATERIAL_LIMIT','At most 20 candidates per extraction; zero is valid.');
    b.candidates=args.candidates.map(input=>{const material=content(input),provenance=this.provenance(b,input.source_refs);const c={candidate_id:randomUUID(),...material,provenance};if(Buffer.byteLength(canonical(c))>this.materials.limits.recordBytes-2048)fail('MATERIAL_LIMIT','Candidate exceeds record budget.');return c;});b.revision++;return this.saveBatch(b,signal);
  }
  expected(b,args){if(args.expected_revision!==b.revision||args.candidate_sha256!==b.candidate_sha256)fail('MATERIAL_STALE','Candidate changed. Read the complete current candidate before human confirmation.');}
  async candidateList(args,sessionId){
    const offset=args.offset??0,limit=args.limit??20;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)fail('MATERIAL_BUDGET','Candidate page is at most 20.');
    const dir=await this.materials.boundary('.cardstudio-scean/material-candidates',true),items=[],files=(await fs.readdir(dir)).filter(f=>identity(f.slice(0,-5))&&f.endsWith('.json')).sort();
    for(const name of files){try{const b=await this.batch(name.slice(0,-5),sessionId,{review:true});if(!await this.materials.receipt(b.extraction_id))items.push({extraction_id:b.extraction_id,revision:b.revision,candidate_sha256:b.candidate_sha256,intent:b.intent,candidate_count:b.candidates.length,expires_at:b.expires_at});}catch(e){if(!['MATERIAL_SESSION','MATERIAL_SESSION_EPOCH','MATERIAL_EXPIRED','AUTHORING_SCOPE_CHANGED'].includes(e.code))throw e;}}
    return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,coverage:'session-candidates'};
  }
  async humanMaterials(request,signal,{sessionId}){
    if(!this.bindingContext.getStore())return this.withBindingOperation('material',request,{sessionId},()=>this.humanMaterials(request,signal,{sessionId}));
    if(['recycle','restore'].includes(request?.mode))return this.serial('#workspace-operations',async()=>{
      keys(request,['mode','material_id','record_sha256','expected_recycle_revision','operation_id']);
      if(typeof sessionId!=='string'||!sessionId.trim()||sessionId.length>1024)fail('SESSION','A trusted Session is required.');
      const fence=async()=>{signal?.throwIfAborted();this.assertScopeCurrent();await this.lifecycle.assertReady(sessionId);this.assertScopeCurrent();};
      await fence();
      try{return await this.materials.recycle(request,sessionId,signal,fence);}
      catch(error){if(error.code==='ENOENT')fail('MATERIAL_NOT_FOUND','Material is unavailable. Refresh the list.');if(error.name==='AbortError'||/^(MATERIAL_|AUTHORING_|SESSION_|RECYCLE_)/.test(error.code??''))throw error;fail('MATERIAL_RECYCLE_IO','Unable to update the recycle bin. Material files were retained; refresh and retry.');}
    });
    return this.serial('#workspace-operations',()=>this.materials.serial(async()=>{
      await this.lifecycle.assertReady(sessionId);this.assertScopeCurrent();keys(request,['mode','extraction_id','expected_revision','candidate_sha256','accepted_ids','edits']);
      if(!['edit','confirm'].includes(request.mode))fail('MATERIAL_REVIEW','Use the dedicated human review control.');
      const b=await this.batch(request.extraction_id,sessionId,{review:true});this.expected(b,request);const prior=await this.materials.receipt(b.extraction_id);
      if(prior){if(prior.candidate_sha256!==b.candidate_sha256)fail('MATERIAL_STALE','Reviewed candidate mismatch.');return {receipt:prior,idempotent:true};}
      if(request.mode==='edit'){
        if(!Array.isArray(request.edits)||!request.edits.length||request.edits.length>20)fail('MATERIAL_REVIEW','Provide bounded reviewed edits.');for(const edit of request.edits){keys(edit,['candidate_id','kind','title','summary','body','use_notes','aliases','tags']);const c=b.candidates.find(c=>c.candidate_id===edit.candidate_id);if(!c)fail('MATERIAL_STALE','Unknown candidate.');const {candidate_id,...update}=edit;Object.assign(c,content({...Object.fromEntries(Object.entries(c).filter(([k])=>['kind','title','summary','body','use_notes','aliases','tags','derived_from'].includes(k))),...update}));}b.revision++;return this.saveBatch(b,signal);
      }
      if(!Array.isArray(request.accepted_ids)||new Set(request.accepted_ids).size!==request.accepted_ids.length||request.accepted_ids.some(id=>!b.candidates.some(c=>c.candidate_id===id)))fail('MATERIAL_REVIEW','Choose only current candidates, including zero acceptance.');
      const sources=[];for(const selected of b.sources){const v=await this.source(selected.ref,sessionId,signal);if(canonical(v.identity)!==canonical(Object.fromEntries(Object.entries(selected).filter(([k])=>k!=='ref'))))fail('SOURCE_CHANGED','Source identity changed.');sources.push(v);}
      for(let i=0;i<sources.length;i++){const v=sources[i],s=b.sources[i],rel='materials/sources/'+s.source_sha256+'.'+s.snapshot_format,file=await this.materials.boundary(rel);try{const old=await fs.readFile(file);if(sha(old)!==s.source_sha256)fail('MATERIAL_VERIFY','Existing evidence snapshot differs.');}catch(e){if(e.code!=='ENOENT')throw e;this.assertScopeCurrent();await fs.writeFile(file,v.bytes,{flag:'wx',signal});}}
      const accepted=[];for(const id of request.accepted_ids){const c=b.candidates.find(c=>c.candidate_id===id),{candidate_id,...payload}=c,record={schema_version:1,material_id:randomUUID(),...payload,extraction_id:b.extraction_id,created_at:new Date(this.materials.now()).toISOString()};record.record_sha256=recordHash(record);await this.materials.save('materials/items/'+record.material_id+'.json',record,signal,()=>this.assertScopeCurrent());accepted.push({material_id:record.material_id,record_sha256:record.record_sha256,candidate_id});}
      const receipt={schema_version:1,extraction_id:b.extraction_id,session_id:sessionId,scope_epoch:b.scope_epoch,candidate_revision:b.revision,candidate_sha256:b.candidate_sha256,sources:b.sources.map(({ref,...s})=>({...s,snapshot:'materials/sources/'+s.source_sha256+'.'+s.snapshot_format})),accepted,reviewed_count:b.candidates.length,rejected_count:b.candidates.length-accepted.length,human_review:true,reviewed_at:new Date(this.materials.now()).toISOString()};receipt.receipt_sha256=digest(receipt);
      await this.materials.beforePublish?.({receipt,signal});signal?.throwIfAborted();this.assertScopeCurrent();await this.lifecycle.assertReady(sessionId);
      this.expected(await this.batch(b.extraction_id,sessionId,{review:true}),request);
      // Recheck source bytes after asynchronous work, immediately before the single publication marker.
      for(const s of b.sources)await this.source(s.ref,sessionId,signal);this.assertScopeCurrent();
      await this.materials.save('materials/receipts/'+b.extraction_id+'.json',receipt,signal,()=>this.assertScopeCurrent());this.materials.scanned=false;return {receipt,idempotent:false};
    }));
  }
  async sourceStates(args,signal){
    await this.library.ensure(signal);const offset=args.offset??0,limit=args.limit??20;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)fail('MATERIAL_BUDGET','Source status page is at most 20.');
    const rows=[...this.library.rows.values()].sort((a,b)=>a.relative_path.localeCompare(b.relative_path)),items=[];
    for(const row of rows.slice(offset,offset+limit)){let freshness='unverified';if(row.state==='ready')try{await this.library.verified(row,signal);freshness='verified';}catch(e){if(e.name==='AbortError')throw e;freshness=e.code??'SOURCE_UNAVAILABLE';}items.push({...this.library.summary(row),freshness});}
    const receipts=[],files=(await fs.readdir(await this.materials.boundary('materials/receipts',true))).filter(f=>f.endsWith('.json')),diagnostics=[];let receiptComplete=files.length<=2000;
    for(const f of files.slice(0,2000)){try{const r=await this.materials.receipt(f.slice(0,-5));if(r)receipts.push(r);}catch(e){receiptComplete=false;diagnostics.push({file:f,code:e.code??'RECEIPT_PARSE'});}}
    return {...this.library.status(),total:rows.length,offset,limit,coverage:this.library.complete&&receiptComplete?'indexed-sources':'partial',receipt_complete:receiptComplete,receipt_diagnostics:diagnostics,items:items.map(row=>{const reviewed=receipts.flatMap(r=>r.sources.filter(s=>s.source_item_id===row.item_id).map(s=>({receipt:r,source:s}))),exact=reviewed.filter(r=>r.source.source_sha256===row.source_sha256).at(-1),status=row.state!=='ready'||row.freshness!=='verified'||!exact&&!receiptComplete?'unverified':exact?'organized':reviewed.length?'source_changed':'unorganized';return {...row,extraction_status:status,extraction_label:{unverified:'未核實／整理紀錄不完整',organized:'已整理',source_changed:'來源變更需重整',unorganized:'未整理'}[status],extraction_receipt:exact?{extraction_id:exact.receipt.extraction_id,accepted_count:exact.receipt.accepted.length,reviewed_at:exact.receipt.reviewed_at}:null};}),receipt_coverage:'At most 2000 receipts; every source path/ID retains its own status, including exact-byte duplicates. Never automatic re-extraction.'};
  }
  async select(args,sessionId,signal){
    if(!Array.isArray(args.materials)||args.materials.length>20)fail('MATERIAL_SELECTION','Select at most 20 material ID/hash pairs.');const pins=[];for(const ref of args.materials){keys(ref,['material_id','record_sha256']);if(!hashOK(ref.record_sha256))fail('MATERIAL_HASH','Selection pins exact hashes.');pins.push(this.materials.summary(await this.materials.activeItem(ref.material_id,ref.record_sha256)));}if(new Set(pins.map(p=>p.material_id)).size!==pins.length)fail('MATERIAL_SELECTION','Duplicate material selection.');const selection={schema_version:1,session_id:sessionId,scope_epoch:this.scopePolicy()?.epoch??0,materials:pins.map(({material_id,record_sha256})=>({material_id,record_sha256})),selected_at:new Date().toISOString()};selection.selection_sha256=digest(selection);await this.materials.save('.cardstudio-scean/material-selections/'+sha(Buffer.from(sessionId))+'.json',selection,signal,()=>this.assertScopeCurrent());return {selection,items:pins,scope_notice:'Content cannot create worldbook entries. Human must choose Full for structural authoring. Recreate Opening after adapting all selected materials.'};
  }
  async selection(sessionId){try{const r=await this.materials.json('.cardstudio-scean/material-selections/'+sha(Buffer.from(sessionId))+'.json');if(r.session_id!==sessionId||r.selection_sha256!==digest(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='selection_sha256'))))fail('MATERIAL_VERIFY','Selection hash mismatch.');const recycled_materials=[];for(const ref of r.materials)if((await this.materials.recycleState(ref)).recycled)recycled_materials.push(ref.material_id);return recycled_materials.length?{...r,recycled_materials}:r;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async create(args,sessionId,signal){
    const {material_selection,adaptation_note,...narrative}=args;if(!material_selection){if(adaptation_note!==undefined)fail('MATERIAL_SELECTION','Adaptation note requires pinned materials.');return super.create(args,sessionId,signal);}
    if(!Array.isArray(material_selection)||!material_selection.length||material_selection.length>20)fail('MATERIAL_SELECTION','Use pinned material ID/hash pairs.');
    if(new Set(material_selection.map(r=>r.material_id)).size!==material_selection.length)fail('MATERIAL_SELECTION','Duplicate material pins.');
    for(const ref of material_selection){keys(ref,['material_id','record_sha256']);if(!hashOK(ref.record_sha256))fail('MATERIAL_HASH','Create requires exact material hash.');await this.materials.activeItem(ref.material_id,ref.record_sha256);}
    const composition={schema_version:1,materials:clone(material_selection),initial_revision:0,adaptation_note:text(adaptation_note,'adaptation_note',8000),opening_policy:'Regenerate after final character/world adaptation; never copy source Opening.'};
    return super.create(narrative,sessionId,signal,composition,async()=>{for(const ref of material_selection)await this.materials.activeItem(ref.material_id,ref.record_sha256);this.assertScopeCurrent();});
  }
  async operation(action,args,signal,context={}){
    if(!this.bindingContext.getStore())return this.withBindingOperation(action,args,context,()=>this.operation(action,args,signal,context));
    if(action!=='material')return super.operation(action,args,signal,context);
    try{assertScopeOperation(this.scopePolicy(),action,args);if(typeof context.sessionId!=='string'||!context.sessionId.trim())fail('SESSION','Trusted Session required.');await this.lifecycle.assertReady(context.sessionId);const admitted={begin:['sources','intent'],source_read:['extraction_id','source_index','fields','locators','offset','budget'],propose:['extraction_id','expected_revision','candidate_sha256','candidates'],candidates:['offset','limit'],candidate:['extraction_id'],catalog:['offset','limit','kind'],list:['offset','limit','kind'],browse:['offset','limit','kind'],recycle_bin:['offset','limit'],search:['query','query_terms','limit'],read:['material_id','record_sha256','field','offset','budget'],trace:['material_id','record_sha256'],refresh:[],rebuild:[],source_status:['offset','limit'],select:['materials'],selection:[]}[args?.action];if(!admitted)fail('MATERIAL_ACTION','Unknown operation. Agent cannot approve candidates or receipts.');keys(args,['action',...admitted]);
      return await this.serial('#workspace-operations',async()=>{signal?.throwIfAborted();this.assertScopeCurrent();let value;const sessionId=context.sessionId;
        if(args.action==='begin')value=await this.begin(args,sessionId,signal);
        else if(args.action==='source_read')value=await this.sourceRead(args,sessionId,signal);
        else if(args.action==='propose')value=await this.propose(args,sessionId,signal);
        else if(args.action==='candidates')value=await this.candidateList(args,sessionId);
        else if(args.action==='candidate')value=this.batchView(await this.batch(args.extraction_id,sessionId,{review:true}));
        else if(['catalog','list','browse'].includes(args.action))value=await this.materials.catalog(args,signal);
        else if(args.action==='recycle_bin')value=await this.materials.catalog(args,signal,{recycled:true});
        else if(args.action==='search')value=await this.materials.search(args,signal);
        else if(args.action==='read')value=await this.materials.read(args);
        else if(args.action==='trace')value=await this.materials.trace(args);
        else if(['refresh','rebuild'].includes(args.action))value=await this.materials.rebuild(signal);
        else if(args.action==='source_status')value=await this.sourceStates(args,signal);
        else if(args.action==='select')value=await this.select(args,sessionId,signal);
        else if(args.action==='selection')value=await this.selection(sessionId);
        this.assertScopeCurrent();return {ok:true,value};
      });
    }catch(e){return errorResult(e);}
  }
}
