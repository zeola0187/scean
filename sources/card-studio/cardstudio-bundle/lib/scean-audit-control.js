import {fail} from './codec.js';
import {buildSavedSnapshot} from './scean-integration.js';
import {inspectFrontend} from './frontend-authoring.js';

function validateArgs(args){
  if(!args||Object.keys(args).some(k=>!['document_id','expected_revision','baseline_revision','cases'].includes(k))||typeof args.document_id!=='string'||!Number.isSafeInteger(args.expected_revision)||args.expected_revision<0)fail('AUDIT_ARGUMENT','Use the selected saved document ID and exact expected_revision; no paths or card JSON.');
  if(args.baseline_revision!==undefined&&(!Number.isSafeInteger(args.baseline_revision)||args.baseline_revision<0||args.baseline_revision>=args.expected_revision))fail('AUDIT_ARGUMENT','baseline_revision must be an earlier saved revision of the same document.');
  if(args.cases!==undefined&&(!Array.isArray(args.cases)||args.cases.length>64||Buffer.byteLength(JSON.stringify(args.cases))>65536))fail('AUDIT_CASES','At most 64 bounded scenarios / 64 KiB.');
  const ids=new Set();
  for(const c of args.cases??[]){
    if(!c||Object.keys(c).some(k=>!['id','playerInput','recentDialogue','expect'].includes(k))||typeof c.id!=='string'||!c.id.trim()||c.id.length>100||ids.has(c.id)||c.playerInput!==undefined&&typeof c.playerInput!=='string'||c.recentDialogue!==undefined&&!Array.isArray(c.recentDialogue)||!Array.isArray(c.expect)||c.expect.length>100||c.expect.some(e=>!e||Object.keys(e).some(k=>!['entry_id','selected'].includes(k))||typeof e.entry_id!=='string'||typeof e.selected!=='boolean'))fail('AUDIT_CASES','Each scenario needs a unique id, optional literal input/history, and stable entry_id/selected expectations.');
    ids.add(c.id);
  }
}
function payload(saved){
  let snapshot,snapshotError=null;
  try{snapshot=buildSavedSnapshot(saved);}catch(e){snapshotError=e.code??'SCEAN_SNAPSHOT';snapshot={schemaVersion:1,cardId:saved.id,revision:saved.revision,card:saved.card,characters:saved.card.data.extensions?.scean?.characters??[],worldbook:saved.card.data.character_book??{entries:[]}};}
  return {snapshot,snapshotError,saved:{id:saved.id,revision:saved.revision,sha256:saved.sha256,format:saved.format},entryIds:saved.entryIds,frontend:inspectFrontend(saved.card,[],saved.entryIds)};
}
/** Same Host authority path as selected-card context/handoff. Read-only public
 * service APIs only; never read workspace files, arbitrary paths or a private DB. */
export function createSceanAuditControl(loader,getService){
  return async(agent,r,args,signal)=>{
    validateArgs(args);await loader.validate(agent,r,null);signal?.throwIfAborted();
    const service=loader.workspace.service;
    const selected=await service.selectedDocument(agent.id);
    if(selected?.type!=='card'||selected.document_id!==args.document_id||r.selected?.document_id!==args.document_id)fail('AUDIT_SELECTION','Audit only the current Session-selected saved card.');
    const runtime=getService();
    if(typeof runtime?.auditSavedSnapshot!=='function')fail('AUDIT_RUNTIME_UNAVAILABLE','This SCEAN installation does not provide compatibility audit 0.1.0.');
    const combined=AbortSignal.any([r.controller.signal,r.scopeController.signal,...signal?[signal]:[]]);
    const job=(async()=>{
      const saved=await service.read(args.document_id);await loader.validate(agent,r,null);combined.throwIfAborted();
      if(saved.revision!==args.expected_revision)fail('AUDIT_REVISION','Saved revision changed; read the current selected revision.');
      const input=payload(saved);
      if(args.baseline_revision!==undefined){
        const {record,decoded}=await service.load(args.document_id,args.baseline_revision);
        input.baseline=payload({id:record.id,revision:record.revision,sha256:record.sha256,type:record.type,format:decoded.kind,card:decoded.card,entryIds:record.entryIds});
      }
      input.cases=args.cases??[];
      const result=await runtime.auditSavedSnapshot(input);
      await loader.validate(agent,r,null);combined.throwIfAborted();
      const current=await service.read(args.document_id),now=await service.selectedDocument(agent.id);
      if(current.revision!==saved.revision||current.sha256!==saved.sha256||now?.document_id!==saved.id)fail('AUDIT_REVISION','Selection/revision changed while auditing; discard this result.');
      await loader.validate(agent,r,null);combined.throwIfAborted();
      if(r.selected?.document_id!==saved.id)fail('AUDIT_SELECTION','Selection changed before the audit returned.');
      return {ok:true,value:result};
    })();r.jobs.add(job);try{return await job;}finally{r.jobs.delete(job);}
  };
}
