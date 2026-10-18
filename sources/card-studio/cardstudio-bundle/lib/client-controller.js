/** View lifetime controller: no React/DOM, no inference, no session rebinding. */
export class WorkspaceClient {
  constructor({root,send,sendScope,sendReview,sendMethod,sendLibrary,sendScean,sendDownload,pageId,present=()=>{},show,hide,notify,setTimer=setInterval,clearTimer=clearInterval}) {
    this.root=root?.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'')??null;this.discoverySequence=0;this.send=send;this.sendScope=sendScope;this.authoringScope=null;this.pageId=pageId;
    this.present=present;this.show=show;this.hide=hide;this.notify=notify;this.sendReview=sendReview;
    this.sendScean=sendScean;this.sendLibrary=sendLibrary;this.librarySettings=null;this.librarySequence=0;this.sendMethod=sendMethod;this.characterMethod=null;
    this.sendDownload=sendDownload;this.selectionStatus=null;
    // Window timers reject a WorkspaceClient receiver. Keep both default and
    // injected timer functions as ordinary calls instead of object methods.
    this.setTimer=(...args)=>setTimer(...args);this.clearTimer=(...args)=>clearTimer(...args);
    this.heartbeatSequence=null;this.sequence=0;this.current=null;this.claim=null;this.phase='inactive';this.timer=null;this.disposed=false;this.pending=new Set();
  }
  task(p){this.pending.add(p);p.finally(()=>this.pending.delete(p)).catch(()=>{});return p;}
  matches(row){return row?.cwd?.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'')===this.root;}
  async transition(row){
    if(this.disposed)return;
    const discovery=++this.discoverySequence;
    if(!this.root && row?.id){
      try{
        const result=await this.send(row.id,{action:'workspace'});
        if(this.disposed || discovery!==this.discoverySequence)return;
        if(!result.ok)throw new Error(result.error.message);
        const root=result.value?.workspace;
        if(typeof root!=='string' || !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(root))throw new Error('Host returned an invalid Card Studio workspace.');
        this.root=root.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'');
      }catch(error){if(!this.disposed && discovery===this.discoverySequence)this.notify(error);return;}
    }
    const identity=this.matches(row)?row.id:null;
    if(this.current?.id===identity)return;
    const sequence=++this.sequence,old=this.current,claim=this.claim;
    this.current=identity?{id:identity}:null;this.claim=null;this.authoringScope=null;this.characterMethod=null;this.selectionStatus=null;this.phase='inactive';this.hide();this.clearTimer(this.timer);this.timer=null;
    if(old&&claim)this.task(this.send(old.id,{action:'release',claim}).catch(()=>{}));
    if(!identity)return;
    this.phase='connecting';
    try{
      this.present();
      const result=await this.send(identity,{action:'acquire',page_id:this.pageId});
      if(sequence!==this.sequence || this.disposed){if(result.ok)await this.send(identity,{action:'release',claim:result.value});return;}
      if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);
      this.claim=result.value;this.authoringScope=result.value.authoring_scope??null;
      this.characterMethod=result.value.character_method??null;
      this.updateSelection(result.value.selection_status,true);
      const capabilities=await this.send(identity,{action:'capabilities',claim:this.claim});
      if(sequence!==this.sequence || this.disposed)return;
      if(!capabilities.ok)throw new Error(`${capabilities.error.code}: ${capabilities.error.message}`);
      this.authoringScope=capabilities.value.authoring_scope??this.authoringScope;
      this.characterMethod=capabilities.value.character_method??this.characterMethod;
      this.updateLibrary(capabilities.value.library_settings,true);this.phase='ready';this.show(capabilities.value);
      this.timer=this.setTimer(()=>this.task(this.heartbeat(sequence)),20000);
    }catch(e){if(sequence===this.sequence && !this.disposed){
      const failedClaim=this.claim;this.claim=null;this.phase='error';
      if(failedClaim)this.task(this.send(identity,{action:'release',claim:failedClaim}).catch(()=>{}));
      this.notify(e);
    }}
  }
  async retry(){
    if(this.disposed || !this.current || this.phase!=='error')return;
    const row={...this.current,cwd:this.root};this.current=null;
    await this.transition(row);
  }
  async heartbeat(sequence){
    if(sequence!==this.sequence || !this.current || !this.claim || this.heartbeatSequence===sequence)return;
    this.heartbeatSequence=sequence;
    try{const r=await this.send(this.current.id,{action:'renew',claim:this.claim});if(sequence!==this.sequence||this.disposed)return;if(!r.ok)throw new Error(r.error.message);this.updateLibrary(r.value?.library_settings);this.updateSelection(r.value?.selection_status);this.authoringScope=r.value?.authoring_scope??this.authoringScope;this.scopeChanged?.(this.authoringScope);this.characterMethod=r.value?.character_method??this.characterMethod;this.methodChanged?.(this.characterMethod,r.value?.skills);}
    catch(e){if(sequence===this.sequence){const old=this.current;this.current=null;this.claim=null;this.hide();this.clearTimer(this.timer);this.timer=null;await this.transition({...old,cwd:this.root});if(this.sequence===sequence+1&&this.phase==='ready')this.notify(e);}}
    finally{if(this.heartbeatSequence===sequence)this.heartbeatSequence=null;}
  }
  bind(sequence=this.sequence){
    // A continuation from an old Panel must not start its next RPC in a newly
    // selected Session, even if the preceding await already returned.
    return (action,args={})=>this.call(action,args,sequence);
  }
  async call(action,args={},expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim,librarySequence=this.librarySequence;
    if(this.disposed||expectedSequence!==sequence)throw new Error('Discarded operation from previous workspace/session.');
    if(!session || !claim || this.phase!=='ready')throw new Error('Card Studio workspace is not ready.');
    const result=await this.send(session.id,{action,args,claim});
    if(this.disposed || sequence!==this.sequence)throw new Error('Discarded response from previous workspace/session.');
    this.updateSelection(result.selection_status);
    if(action.startsWith('library')){this.updateLibrary(result.value?.library_settings);if(librarySequence!==this.librarySequence)throw new Error('Discarded response from previous Library root.');}
    if(!result.ok)throw Object.assign(new Error(`${result.error.code}: ${result.error.message}`),{details:result.error.details});if(result.value?.authoring_scope){this.authoringScope=result.value.authoring_scope;this.scopeChanged?.(this.authoringScope);}if(result.value?.character_method){this.characterMethod=result.value.character_method;this.methodChanged?.(this.characterMethod,result.value.skills);}return result.value;
  }
  updateLibrary(value,fresh=false){
    if(!value)return;
    if(!fresh&&this.librarySettings&&value.revision<this.librarySettings.revision)return;
    if(JSON.stringify(value)!==JSON.stringify(this.librarySettings)){this.librarySettings=value;this.librarySequence++;this.libraryChanged?.(value);}
  }
  updateSelection(value,fresh=false){
    if(!value)return;
    const previous=this.selectionStatus;
    if(previous&&previous.agent_generation===value.agent_generation&&previous.workspace_generation===value.workspace_generation&&previous.document_id===value.document_id&&value.revision<previous.revision)return;
    this.selectionStatus=value;
    if(!fresh&&value.changed&&JSON.stringify(previous)!==JSON.stringify(value))this.selectionChanged?.(value);
  }
  async downloadExport(request,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(this.disposed||expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendDownload)throw new Error('Export download page is not ready.');
    const result=await this.sendDownload(session.id,{...request,claim});
    if(this.disposed||sequence!==this.sequence||this.claim!==claim)throw new Error('Discarded download response from previous Session or page lease.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);return result.value;
  }
  async sceanControl(request,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(this.disposed||expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendScean)throw new Error('SCEAN human page is not ready.');
    const result=await this.sendScean(session.id,{...request,claim});
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded SCEAN response from previous Session.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);
    return result.value;
  }
  async setLibraryRoot(path,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(this.disposed||expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendLibrary)throw new Error('Human Library control is not ready.');
    const result=await this.sendLibrary(session.id,{path,expected_revision:this.librarySettings?.revision??0,claim});
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded Library setting response from previous Session.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);
    this.updateLibrary(result.value);return result.value;
  }
  async setAuthoringScope(mode,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendScope||!this.authoringScope)throw new Error('Human scope control is not ready.');
    const result=await this.sendScope(session.id,{mode,expected_epoch:this.authoringScope.epoch,claim});
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded scope response from previous Session.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);
    this.authoringScope=result.value.authoring_scope;this.scopeChanged?.(this.authoringScope);return this.authoringScope;
  }
  async setCharacterMethod(name,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendMethod||!this.characterMethod)throw new Error('Human character method control is not ready.');
    const result=await this.sendMethod(session.id,{name,expected_epoch:this.characterMethod.epoch,claim});
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded method response from previous Session.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);
    this.characterMethod=result.value.character_method;this.methodChanged?.(this.characterMethod,result.value.skills);return this.characterMethod;
  }
  async close(){
    this.disposed=true;++this.sequence;++this.discoverySequence;this.phase='inactive';this.hide();this.clearTimer(this.timer);this.timer=null;
    const old=this.current,claim=this.claim;this.current=null;this.claim=null;
    if(old&&claim)await this.send(old.id,{action:'release',claim}).catch(()=>{});
    await Promise.allSettled([...this.pending]);
  }
  async reviewMaterials(request,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendReview||!this.authoringScope)throw new Error('Human review page is not ready.');
    const result=await this.sendReview(session.id,{...request,expected_epoch:this.authoringScope.epoch,claim});
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded review response from previous Session.');
    if(!result.ok)throw new Error(result.error.code+': '+result.error.message);return result.value;
  }
}
