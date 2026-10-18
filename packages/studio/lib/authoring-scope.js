import { canonical,clone,fail } from './codec.js';
import { rawEntries } from './document-projection.js';

export const CONTENT_FIELDS=['name','description','personality','scenario','first_mes','mes_example','alternate_greetings','group_only_greetings'];
const same=(a,b)=>canonical(a)===canonical(b);
const deny=(message,details={})=>fail('AUTHORING_SCOPE',message,{scope:'content',nextAction:'Use the human Authoring Scope control to choose Full mode.',...details});

// A deliberately narrow text contract, not an HTML/JavaScript sandbox. Mixed
// sources remain readable but require Full mode before changing any part.
export function assertNarrativeText(value,path) {
  const texts=Array.isArray(value)?value:[value];
  if(texts.some(text=>typeof text!=='string'))deny('Content mode accepts text or bounded greeting lists only.',{path});
  for(const text of texts){
    const plain=text.replaceAll('<START>','').replace(/\{\{(?:char|user)\}\}/g,'');
    if(/<%|(^|\n)\s*@@|<[a-z!/?][^>]*>|\{\{|\}\}|(?:javascript|vbscript|data)\s*:/im.test(plain))
      deny('Mixed or executable source is readonly in Content mode. Use plain text/Markdown and {{char}}/{{user}} placeholders.',{path});
  }
}

export function assertScopeOperation(policy,action,args={}) {
  policy?.assertCurrent?.();
  if(policy?.mode!=='content')return;
  const readonly=new Set(['imports','documents','open','read','history','diff','check','preview','export_folder','library_folder','library_image']);
  if(readonly.has(action)||['export','export_backup','export_bundle','export_target'].includes(action))return;
  if(action==='library')return; // Rebuild writes disposable indexes only.
  if(action==='material')return; // Narrative candidates/records only; no card or runtime mutation, no Agent approval action.
  if(['import','upload_begin','upload_chunk','upload_finish','upload_abort','library_copy'].includes(action))return; // Exact-byte acquisition, never a runtime rewrite.
  if(action==='create'){
    for(const [key,value] of Object.entries(args)){
      if(key==='format')continue;
      if(['material_selection','adaptation_note'].includes(key))continue; // Host validates fixed IDs/hashes and narrative note, never card/runtime fields.
      if(!CONTENT_FIELDS.includes(key))deny('Content-mode creation accepts narrative fields only.',{path:'/data/'+key});
      assertNarrativeText(value,'/data/'+key);
    }
    return;
  }
  if(action==='patch_text'){
    if(!CONTENT_FIELDS.includes(args.field))deny('This text field is protected.',{path:'/data/'+String(args.field)});
    assertNarrativeText(args.new_text,'/data/'+args.field);return;
  }
  if(action==='patch'){
    if(!Array.isArray(args.patches))deny('Provide local narrative JSON patches.');
    for(const patch of args.patches){
      if(patch.op==='test')continue;
      if(typeof patch.path!=='string'||/\~(?![01])/.test(patch.path))deny('Invalid narrative JSON Pointer.');
      const parts=patch.path.split('/').slice(1).map(part=>part.replaceAll('~1','/').replaceAll('~0','~'));
      if(parts.length===1&&parts[0]==='data')continue; // Full candidate comparison below rejects protected differences.
      if(parts[0]!=='data'||!CONTENT_FIELDS.includes(parts[1])||parts.length>3||parts.length===3&&!['alternate_greetings','group_only_greetings'].includes(parts[1]))deny('This JSON Pointer addresses protected structure.',{path:patch.path.slice(0,160)});
      if(patch.op!=='remove')assertNarrativeText(patch.value,patch.path);
    }
    return;
  }
  if(action==='book_patch'||action==='book_upsert'&&args.entry_id){
    const changes=action==='book_patch'?args.changes:args.entry;
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>key!=='content'))deny('Content mode only changes an existing ordinary worldbook body.');
    if(Object.hasOwn(changes,'content'))assertNarrativeText(changes.content,'worldbook/'+String(args.entry_id)+'/content');
    return;
  }
  if(action==='rollback')return; // Candidate and sidecar must still preserve all protected state.
  if(['book_list','book_search','book_read','book_config'].includes(action))return;
  const reads={frontend:['inspect','read','dynamic_read','dynamic_validate','dynamic_preview','derived_read','derived_validate'],fixture:['read'],visual_contract:['read','validate'],target:['read','check','dryrun'],target_source:['list','read'],gating:['inspect','read','evaluate'],asset:['list','generated_status','cancel_generated']};
  if(reads[action]?.includes(args.action))return;
  deny('This operation changes protected authoring/runtime structure.',{operation:action,action:args.action??null});
}

function stripNarrative(card,other,ids,otherIds,authoring) {
  const projection=clone(card);
  for(const field of CONTENT_FIELDS){
    if(!same(card.data[field],other.data[field])){
      if(card.data[field]!==undefined)assertNarrativeText(card.data[field],'/data/'+field);
      if(other.data[field]!==undefined)assertNarrativeText(other.data[field],'/data/'+field);
    }
    delete projection.data[field];
    // Known V1 mirrors are generated by the existing codec, never arbitrary
    // root authority. Preserve their existence/type and all unknown root keys.
    if(typeof card[field]==='string'&&typeof other[field]==='string'){
      delete projection[field];
    }
  }
  const entries=rawEntries(card.data.character_book??{entries:[]}),otherEntries=rawEntries(other.data.character_book??{entries:[]});
  const projected=rawEntries(projection.data.character_book??{entries:[]});
  for(let i=0;i<entries.length;i++){
    const id=ids[i],at=otherIds.indexOf(id),entry=entries[i],next=otherEntries[at];
    if(!next)continue; // Structural deletion stays in the protected projection.
    const managed=(authoring?.gating?.entries??[]).some(g=>g.entryId===id)||!!authoring?.target&&entry.id===authoring.target.bookId;
    if(managed)continue;
    if(!same(entry.content,next.content)){
      assertNarrativeText(entry.content,'worldbook/'+id+'/content');
      assertNarrativeText(next.content,'worldbook/'+id+'/content');
    }
    delete projected[i].content;
  }
  return projection;
}

export function assertScopeCandidate(policy,{before,after,beforeIds,afterIds,beforeAuthoring,afterAuthoring}) {
  policy?.assertCurrent?.();
  if(policy?.mode!=='content')return;
  if(!same(beforeAuthoring,afterAuthoring))deny('Authoring sidecar, fixture, target, Gate, visual contract and asset bindings are protected.',{path:'/authoring'});
  for(const field of CONTENT_FIELDS)if(typeof before[field]==='string'&&typeof after[field]==='string'&&!same(before[field],after[field])&&after[field]!==after.data[field])deny('A legacy mirror may only follow its canonical narrative field.',{path:'/'+field});
  if(!same(beforeIds,afterIds))deny('Worldbook entry creation, deletion and identity changes require Full mode.',{path:'/data/character_book/entries'});
  const a=stripNarrative(before,after,beforeIds,afterIds,beforeAuthoring);
  const b=stripNarrative(after,before,afterIds,beforeIds,beforeAuthoring);
  if(!same(a,b))deny('Only narrative fields and existing ordinary worldbook body text may change. All other fields remain protected.',{path:'/protected-projection'});
}

// The generic patch paths must never silently remove/replace a managed Gate
// decorator. Dedicated Gate edits and explicit rollback have their own guards.
export function assertManagedBodyGuard({action,reason,before,after,beforeIds,afterIds,authoring}) {
  const generic=['patch','patch_text','book_patch','book_upsert','book_delete','book_patch_config','frontend','target_source'];
  const localGeneric=/^(local card patch|text patch:|worldbook (?:patch|upsert|delete)|frontend |target source )/.test(reason??'');
  if(!generic.includes(action)&&!localGeneric)return;
  const oldRows=rawEntries(before.data.character_book??{entries:[]}),newRows=rawEntries(after.data.character_book??{entries:[]});
  for(const gate of authoring?.gating?.entries??[]){
    const old=oldRows[beforeIds.indexOf(gate.entryId)],next=newRows[afterIds.indexOf(gate.entryId)];
    if(!old||!next||old.content!==next.content)fail('GATE_MANAGED_BODY','Generic edits cannot replace or remove a managed Gate body. Read the Gate and use edit_body in Full mode.',{entry_id:gate.entryId,nextAction:{tool:'cardstudio_scean_worldbook_gate',action:'edit_body'}});
  }
}
