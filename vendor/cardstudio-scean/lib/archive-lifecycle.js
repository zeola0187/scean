import fs from 'node:fs/promises';
import path from 'node:path';
import {fail,strictJson} from './codec.js';

const idOK=id=>typeof id==='string'&&id.trim().length>0&&id.length<=1024;
const documentOK=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function archiveIds(value){
  if(!Array.isArray(value)||value.some(id=>!idOK(id))||new Set(value).size!==value.length)fail('ARCHIVE_STATE','Invalid official archive-state snapshot.');
  return [...value];
}
const statePath='.cardstudio-scean/session-lifecycle.json';
const activeRoot='.cardstudio-scean/documents',recycleRoot='.cardstudio-scean/recycle/documents';

/** Called only on CardService's workspace operation queue. Never reads chat logs
 * or card bodies, deletes data, or infers ownership from directory enumeration. */
export class ArchiveLifecycle {
  constructor({root,contained,atomicReplace,associations,hooks={}}){
    Object.assign(this,{root,contained,atomicReplace,associations,hooks});this.snapshot=null;
  }
  isArchived(id){return this.snapshot?.has(id)===true;}
  async assertReady(id){
    if(this.snapshot===null)return;
    if(this.isArchived(id))fail('SESSION_ARCHIVED','This Session is archived. Restore it in DSH before editing.');
    const state=await this.read();if(!state)fail('RECYCLE_JOURNAL','Lifecycle journal disappeared after initialization.');
    if(state.copies.some(row=>row.pending))fail('RECYCLE_PENDING','A recorded move needs recovery before editing can continue.');
  }
  async read(){
    const file=await this.contained(statePath);
    try{
      const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('RECYCLE_PATH','Invalid lifecycle journal path.');
      const state=strictJson(await fs.readFile(file,'utf8'));
      if(state.schemaVersion!==1||!Array.isArray(state.sessions)||!Array.isArray(state.copies))fail('RECYCLE_JOURNAL','Invalid lifecycle journal.');
      const sessions=new Set(),copies=new Set();
      for(const row of state.sessions){
        if(!row||!idOK(row.id)||sessions.has(row.id)||typeof row.archived!=='boolean'||typeof row.armed!=='boolean')fail('RECYCLE_JOURNAL','Invalid tracked Session.');
        sessions.add(row.id);
      }
      for(const row of state.copies){
        if(!row||!documentOK(row.id)||copies.has(row.id)||!['active','recycled'].includes(row.location)||(row.protected!==undefined&&typeof row.protected!=='boolean'))fail('RECYCLE_JOURNAL','Invalid tracked working copy.');
        if(row.pending&&(!['active','recycled'].includes(row.pending.from)||!['active','recycled'].includes(row.pending.to)||row.pending.from===row.pending.to||row.pending.from!==row.location))fail('RECYCLE_JOURNAL','Invalid pending move.');
        copies.add(row.id);
      }
      return state;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async save(state){
    await this.safeDirectory('.cardstudio-scean');
    await this.atomicReplace(await this.contained(statePath),Buffer.from(JSON.stringify(state)+'\n'));
  }
  async safeDirectory(relative,{create=false}={}){
    const target=await this.contained(relative);
    if(create)await fs.mkdir(target).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const stat=await fs.lstat(target);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('RECYCLE_PATH','Recycle paths must be owned directories, without symlinks or junctions.');
    await this.contained(relative,{existing:true});return target;
  }
  async movePaths(id){
    if(!documentOK(id))fail('RECYCLE_PATH','Invalid managed working-copy identity.');
    await this.safeDirectory('.cardstudio-scean');await this.safeDirectory(activeRoot);
    await this.safeDirectory('.cardstudio-scean/recycle',{create:true});await this.safeDirectory(recycleRoot,{create:true});
    const result={};
    for(const [location,base] of [['active',activeRoot],['recycled',recycleRoot]]){
      const relative=base+'/'+id,target=await this.contained(relative);
      // Every resolved path is checked inside this exact managed parent before rename.
      const parent=await fs.realpath(path.join(this.root,base));
      if(path.relative(parent,target)!==id)fail('RECYCLE_PATH','Working-copy move leaves its managed directory.');
      let exists=false;
      try{await this.safeDirectory(relative);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      result[location]={target,exists};
    }
    return result;
  }
  async completeMove(state,row){
    const move=row.pending,paths=await this.movePaths(row.id),from=paths[move.from],to=paths[move.to];
    if(from.exists&&to.exists)fail('RECYCLE_CONFLICT','Both locations exist; neither copy was overwritten. Resolve the conflict before retrying.');
    if(!from.exists&&!to.exists)fail('RECYCLE_MISSING','Neither recorded location exists; the journal was retained.');
    if(from.exists){
      await this.hooks.beforeMove?.({id:row.id,...move});
      await fs.rename(from.target,to.target);
      await this.hooks.afterMove?.({id:row.id,...move});
    }
    // If source is absent and target exists, the recorded rename already finished.
    row.location=move.to;delete row.pending;
    await this.hooks.beforeSettle?.({id:row.id,...move});await this.save(state);
  }
  async move(state,row,to){
    row.pending={from:row.location,to};await this.save(state);
    await this.completeMove(state,row);
  }
  async firstBaseline(associations){
    // A missing journal with existing recycle data must not create new ownership.
    const directory=await this.contained('.cardstudio-scean/recycle');
    try{
      const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('RECYCLE_PATH','Invalid recycle directory.');
      if((await fs.readdir(directory)).length)fail('RECYCLE_JOURNAL','Recycle data exists without its journal. Restore the journal before continuing.');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const ids=new Set(associations.documents.filter(d=>d.origin==='import').flatMap(d=>d.sessions));
    const state={schemaVersion:1,sessions:[...ids].map(id=>({id,archived:this.snapshot.has(id),armed:!this.snapshot.has(id)})),copies:[]};
    await this.save(state);return state;
  }
  async usedSession(id){
    if(this.snapshot===null)return; // Official service has not provided a baseline.
    if(this.isArchived(id))fail('SESSION_ARCHIVED','This Session is archived. Restore it in DSH before editing.');
    const state=await this.read();if(!state)fail('RECYCLE_JOURNAL','Lifecycle journal disappeared after initialization.');
    if(!state.sessions.some(row=>row.id===id)){state.sessions.push({id,archived:false,armed:true});await this.save(state);}
  }
  async reconcile(ids){
    this.snapshot=new Set(archiveIds(ids));
    const associations=await this.associations();let state=await this.read();
    if(!state){await this.firstBaseline(associations);return {initialized:true,moved:0};}
    // Finish only already-recorded moves. Recovering an interrupted move is not a
    // scan of historic archived conversations, even when the latest state differs.
    for(const row of state.copies)if(row.pending)await this.completeMove(state,row);
    const before=JSON.stringify(state),sessions=new Map(state.sessions.map(row=>[row.id,row]));
    for(const doc of associations.documents.filter(d=>d.origin==='import'))for(const id of doc.sessions){
      const archived=this.snapshot.has(id);let row=sessions.get(id);
      if(!row){row={id,archived,armed:!archived};state.sessions.push(row);sessions.set(id,row);}
      else{row.archived=archived;if(!archived)row.armed=true;}
    }
    if(JSON.stringify(state)!==before)await this.save(state);
    const documents=new Map(associations.documents.map(doc=>[doc.id,doc]));
    for(const row of state.copies)if(documents.get(row.id)?.origin!=='import')fail('RECYCLE_ASSOCIATION','A managed copy lost its association metadata; the journal and data were retained.');
    let moved=0;
    for(const doc of associations.documents){
      if(doc.origin!=='import')continue; // Legacy data is never automatically moved.
      const to=doc.sessions.every(id=>sessions.get(id)?.armed&&sessions.get(id).archived)?'recycled':'active';
      let row=state.copies.find(row=>row.id===doc.id);
      if(row?.protected)continue; // Rollback exposed this copy to a version without reliable association tracking.
      if(!row&&to==='active')continue;
      if(!row){row={id:doc.id,location:'active'};state.copies.push(row);}
      if(row.location!==to){await this.move(state,row,to);moved++;}
    }
    return {initialized:true,moved};
  }
  async prepareRollback(){
    const associations=await this.associations(),state=await this.read();
    if(!state)fail('RECYCLE_JOURNAL','A valid lifecycle journal is required for recycle rollback.');
    for(const row of state.copies)if(row.pending)await this.completeMove(state,row);
    const docs=new Map(associations.documents.map(doc=>[doc.id,doc]));
    for(const row of state.copies)if(docs.get(row.id)?.origin!=='import')fail('RECYCLE_ASSOCIATION','Restore missing association metadata before rollback.');
    let restored=0;
    for(const doc of associations.documents){
      if(doc.origin!=='import')continue;
      let row=state.copies.find(row=>row.id===doc.id);
      if(!row){row={id:doc.id,location:'active'};state.copies.push(row);}
      row.protected=true;
      // Persist protection with the intent before moving. A partial rollback can
      // be retried, and already restored copies cannot be recycled on restart.
      if(row.location==='recycled'){await this.move(state,row,'active');restored++;}
      else await this.save(state);
    }
    return {restored,protected:state.copies.filter(row=>row.protected).length};
  }
}
