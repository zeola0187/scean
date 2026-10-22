/** Session views outlive their bounded connection leases. Never replay a write. */
export class WorkspaceClient {
  constructor({root,send,sendScope,sendReview,sendMethod,sendLibrary,sendScean,sendDownload,pageId,present=()=>{},show,hide,notify,connectionChanged=()=>{},setTimer=setInterval,clearTimer=clearInterval,setDelay=setTimeout,clearDelay=clearTimeout,now=Date.now,isVisible=()=>true,rpcTimeoutMs=15000}) {
    this.root=root?.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'')??null;this.discoverySequence=0;this.send=send;this.sendScope=sendScope;this.authoringScope=null;this.pageId=pageId;
    this.present=present;this.show=show;this.hide=hide;this.notify=notify;this.sendReview=sendReview;this.connectionChanged=connectionChanged;
    this.sendScean=sendScean;this.sendLibrary=sendLibrary;this.librarySettings=null;this.librarySequence=0;this.sendMethod=sendMethod;this.characterMethod=null;
    this.sendDownload=sendDownload;this.selectionStatus=null;
    this.setTimer=(...args)=>setTimer(...args);this.clearTimer=(...args)=>clearTimer(...args);this.setDelay=(...args)=>setDelay(...args);this.clearDelay=(...args)=>clearDelay(...args);
    this.now=now;this.isVisible=isVisible;this.rpcTimeoutMs=rpcTimeoutMs;
    this.sequence=0;this.current=null;this.claim=null;this.phase='inactive';this.timer=null;this.retryTimer=null;this.disposed=false;this.pending=new Set();
    this.connectionEpoch=0;this.flight=null;this.discovery=null;this.observedRow=null;this.presented=false;this.failures=0;this.retryAt=0;this.blocked=false;this.lastError=null;this.validUntil=0;
  }
  task(p){this.pending.add(p);p.finally(()=>this.pending.delete(p)).catch(()=>{});return p;}
  matches(row){return row?.cwd?.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'')===this.root;}
  error(value){return Object.assign(new Error(`${value?.code??'CONNECTION'}: ${value?.message??'Card Studio connection failed.'}`),{code:value?.code??'CONNECTION',details:value?.details});}
  changed(){this.connectionChanged({phase:this.phase,blocked:this.blocked,errorCode:this.lastError?.code??null});}
  currentFlight(f){return !this.disposed&&f.sequence===this.sequence&&f.epoch===this.connectionEpoch&&this.flight===f;}
  cancelFlight(){const f=this.flight;this.flight=null;++this.connectionEpoch;f?.controller.abort(Object.assign(new Error('Connection superseded.'),{code:'CONNECTION_SUPERSEDED'}));}
  clearRetry(){this.clearDelay(this.retryTimer);this.retryTimer=null;}
  // Only lifecycle RPCs have an automatic deadline. Story/card writes never replay.
  bounded(session,request,signal,timeout=this.rpcTimeoutMs){
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason),at=this.now();
    if(signal?.aborted)controller.abort(signal.reason);else signal?.addEventListener('abort',abort,{once:true});
    const timer=this.setDelay(()=>controller.abort(Object.assign(new Error('Card Studio connection timed out.'),{code:'CONNECTION_TIMEOUT'})),timeout);timer?.unref?.();
    let raw;try{controller.signal.throwIfAborted();raw=Promise.resolve(this.send(session,request,controller.signal));}catch(error){raw=Promise.reject(error);}
    // A carrier can ignore cancellation. Retire only the exact late lease it returned.
    if(request.action==='acquire')raw.then(result=>{if(controller.signal.aborted&&result?.ok&&result.value)this.releaseClaim(session,result.value);},()=>{});
    let off;
    const aborted=new Promise((_,reject)=>{off=()=>reject(controller.signal.reason);if(controller.signal.aborted)off();else controller.signal.addEventListener('abort',off,{once:true});});
    return Promise.race([raw,aborted]).finally(()=>{this.clearDelay(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',off);}).then(result=>({result,at}));
  }
  releaseClaim(session,claim){if(!claim)return Promise.resolve();return this.task(this.bounded(session,{action:'release',claim},undefined,3000).catch(()=>{}));}
  scheduleRetry(){
    this.clearRetry();if(this.disposed||!this.current&&!this.observedRow||this.blocked)return;
    const sequence=this.sequence,delay=Math.max(1,this.retryAt-this.now());
    this.retryTimer=this.setDelay(()=>{this.retryTimer=null;if(sequence!==this.sequence||this.disposed)return;if(!this.isVisible()){this.retryAt=this.now()+30000;this.scheduleRetry();return;}return this.task(!this.root?this.transition(this.observedRow):this.heartbeat(sequence));},delay);this.retryTimer?.unref?.();
  }
  connectionFailure(error,claim=this.claim){
    if(claim&&claim!==this.claim)return;
    const first=this.phase==='ready'||this.failures===0;this.claim=null;this.validUntil=0;this.phase='error';this.lastError=error;
    this.blocked=['SESSION_ARCHIVED','WORKSPACE','SESSION','AUTHORING_SCOPE_STORE'].includes(error.code);
    this.failures++;this.retryAt=this.now()+Math.min(30000,1000*2**Math.min(5,this.failures-1));this.changed();this.scheduleRetry();
    if(first)this.notify(error);
  }
  connectionError(error){return !error?.code||['CONNECTION','CONNECTION_TIMEOUT','STALE_LEASE','STALE_WORKSPACE','LEASE','CLOSING','SESSION_ARCHIVED','WORKSPACE','SESSION'].includes(error.code)||/^(?:gateway|remote)\//.test(error.code);}
  lost(error,claim){if(!this.disposed&&claim===this.claim&&this.connectionError(error)){this.cancelFlight();this.connectionFailure(error,claim);}}
  async transition(row){
    if(this.disposed)return;this.observedRow=row?.id?{id:row.id,cwd:row.cwd}:null;
    if(!this.root&&row?.id){
      if(this.discovery?.id===row.id)return this.discovery.promise;
      this.discovery?.controller.abort();const d={id:row.id,controller:new AbortController(),sequence:++this.discoverySequence,promise:null};this.discovery=d;this.clearRetry();
      d.promise=(async()=>{try{const {result}=await this.bounded(row.id,{action:'workspace'},d.controller.signal);if(this.disposed||this.discovery!==d||this.observedRow?.id!==row.id)return;if(!result.ok)throw this.error(result.error);const root=result.value?.workspace;if(typeof root!=='string'||!/^(?:[A-Za-z]:[\\/]|[\\/])/.test(root))throw Error('Host returned an invalid Card Studio workspace.');this.root=root.toLowerCase().replace(/\\/g,'/').replace(/\/+$/,'');await this.transition(row);}
        catch(error){if(!this.disposed&&this.discovery===d&&this.observedRow?.id===row.id)this.connectionFailure(error);}
        finally{if(this.discovery===d)this.discovery=null;}})();return d.promise;
    }
    this.discovery?.controller.abort();this.discovery=null;++this.discoverySequence;
    const identity=this.matches(row)?row.id:null;if(this.current?.id===identity)return;
    const old=this.current,claim=this.claim;this.cancelFlight();++this.sequence;this.clearRetry();this.clearTimer(this.timer);this.timer=null;
    this.current=identity?{id:identity}:null;this.claim=null;this.authoringScope=null;this.characterMethod=null;this.selectionStatus=null;this.phase='inactive';this.validUntil=0;this.presented=false;this.failures=0;this.retryAt=0;this.blocked=false;this.lastError=null;this.hide();
    if(old&&claim)this.releaseClaim(old.id,claim);if(!identity)return;
    const sequence=this.sequence;this.timer=this.setTimer(()=>this.task(this.heartbeat(sequence)),20000);this.timer?.unref?.();await this.connect(sequence);
  }
  async connect(sequence){
    if(this.disposed||sequence!==this.sequence||!this.current||!this.isVisible()||this.blocked)return;
    if(this.flight)return this.flight.promise;this.clearRetry();
    const session=this.current.id,claim=this.claim,f={sequence,epoch:++this.connectionEpoch,controller:new AbortController(),kind:claim?'renew':'acquire',promise:null};this.flight=f;
    f.promise=(async()=>{
      let acquired;
      try{
        if(!claim){
          this.phase='connecting';this.changed();if(!this.presented){this.present();this.presented=true;}
          // Distinct page identities ensure a delayed old acquire cannot replace the new lease.
          const pageId=String(this.pageId).slice(0,72)+'-'+f.epoch;
          const opening=await this.bounded(session,{action:'acquire',page_id:pageId},f.controller.signal);if(!opening.result.ok)throw this.error(opening.result.error);acquired=opening.result.value;
          if(!this.currentFlight(f)){this.releaseClaim(session,acquired);return;}
          const {result}=await this.bounded(session,{action:'capabilities',claim:acquired},f.controller.signal);if(!result.ok)throw this.error(result.error);
          if(!this.currentFlight(f)){this.releaseClaim(session,acquired);return;}
          this.claim=acquired;this.authoringScope=result.value.authoring_scope??acquired.authoring_scope??null;this.characterMethod=result.value.character_method??acquired.character_method??null;
          this.updateSelection(acquired.selection_status,true);this.updateLibrary(result.value.library_settings,true);this.validUntil=opening.at+(acquired.lease_ms??90000);this.phase='ready';this.failures=0;this.retryAt=0;this.lastError=null;this.show(result.value);this.changed();
        }else{
          const {result,at}=await this.bounded(session,{action:'renew',claim},f.controller.signal);if(!result.ok)throw this.error(result.error);if(result.value?.active===false)throw this.error({code:'STALE_WORKSPACE',message:'Card Studio capability is no longer active.'});if(!this.currentFlight(f)||this.claim!==claim)return;
          this.validUntil=at+(result.value?.lease_ms??claim.lease_ms??90000);this.updateLibrary(result.value?.library_settings);this.updateSelection(result.value?.selection_status);this.authoringScope=result.value?.authoring_scope??this.authoringScope;this.scopeChanged?.(this.authoringScope);this.characterMethod=result.value?.character_method??this.characterMethod;this.methodChanged?.(this.characterMethod,result.value?.skills);
        }
      }catch(error){if(acquired)this.releaseClaim(session,acquired);if(this.currentFlight(f))this.connectionFailure(error,claim);}
      finally{if(this.flight===f)this.flight=null;}
    })();
    return f.promise;
  }
  async heartbeat(sequence=this.sequence,{force=false}={}){
    if(this.disposed||sequence!==this.sequence||!this.current||!this.isVisible()||this.blocked)return;
    if(this.flight)return;if(!force&&this.now()<this.retryAt)return;
    const previous=this.claim;if(previous&&this.now()>=this.validUntil){this.claim=null;this.validUntil=0;this.phase='connecting';this.changed();this.releaseClaim(this.current.id,previous);}
    const renewing=!!this.claim;await this.connect(sequence);
    // One answered renewal failure may immediately handshake; acquire failures back off.
    if(renewing&&!this.claim&&!this.blocked&&!this.disposed&&sequence===this.sequence)await this.connect(sequence);
  }
  resume(){if(!this.root&&this.observedRow&&!this.blocked&&this.isVisible())return this.task(this.transition(this.observedRow));return this.task(this.heartbeat(this.sequence,{force:true}));}
  async retry(){if(this.disposed||!this.current)return;this.blocked=false;this.retryAt=0;return this.heartbeat(this.sequence,{force:true});}
  assertReady(){
    if(this.claim&&this.now()>=this.validUntil){const claim=this.claim;this.lost(this.error({code:'STALE_LEASE',message:'Card Studio is reconnecting; your draft is preserved.'}),claim);}
    if(!this.current||!this.claim||this.phase!=='ready')throw this.error({code:'STUDIO_RECONNECTING',message:'編輯室正在重新連線，未保存文字仍保留；連線恢復後再確認操作。'});
  }
  async human(sender,request,expectedSequence,label){
    if(this.disposed||expectedSequence!==this.sequence||!sender)throw Object.assign(Error(label+' page is not ready.'),{code:'CONNECTION_SUPERSEDED'});this.assertReady();const sequence=this.sequence,session=this.current.id,claim=this.claim;
    try{const result=await sender(session,{...request,claim});if(this.disposed||sequence!==this.sequence)throw Object.assign(Error('Discarded response from previous Session.'),{code:'CONNECTION_SUPERSEDED'});if(!result.ok)throw this.error(result.error);return result.value;}
    catch(error){this.lost(error,claim);throw error;}
  }
  bind(sequence=this.sequence){
    // A continuation from an old Panel must not start its next RPC in a newly
    // selected Session, even if the preceding await already returned.
    return (action,args={})=>this.call(action,args,sequence);
  }
  async call(action,args={},expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim,librarySequence=this.librarySequence;
    if(this.disposed||expectedSequence!==sequence)throw new Error('Discarded operation from previous workspace/session.');
    this.assertReady();let result;
    try{result=await this.send(session.id,{action,args,claim});if(!result.ok)throw this.error(result.error);}catch(error){this.lost(error,claim);throw error;}
    if(this.disposed || sequence!==this.sequence)throw new Error('Discarded response from previous workspace/session.');
    if(claim===this.claim)this.updateSelection(result.selection_status);
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
    const result=await this.human(this.sendDownload,request,expectedSequence,'Export download');
    if(this.disposed||sequence!==this.sequence||this.claim!==claim)throw new Error('Discarded download response from previous Session or page lease.');
    return result;
  }
  async sceanControl(request,expectedSequence=this.sequence){
    try{return await this.human(this.sendScean,request,expectedSequence,'SCEAN human');}
    catch(error){if(request.mode==='start'&&this.connectionError(error)&&!['STALE_LEASE','STALE_WORKSPACE','LEASE','STUDIO_RECONNECTING','SESSION_ARCHIVED','WORKSPACE','SESSION'].includes(error.code))throw this.error({code:'HANDOFF_UNCONFIRMED',message:'尚未收到開局回執。連線恢復不會自動重送；請先到舞臺核對，再由你決定是否用相同請求確認。',details:{request_id:request.request_id}});throw error;}
  }
  async setLibraryRoot(path,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(this.disposed||expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendLibrary)throw new Error('Human Library control is not ready.');
    const value=await this.human(this.sendLibrary,{path,expected_revision:this.librarySettings?.revision??0},expectedSequence,'Human Library');
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded Library setting response from previous Session.');
    this.updateLibrary(value);return value;
  }
  async setAuthoringScope(mode,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendScope||!this.authoringScope)throw new Error('Human scope control is not ready.');
    const value=await this.human(this.sendScope,{mode,expected_epoch:this.authoringScope.epoch},expectedSequence,'Human scope');
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded scope response from previous Session.');
    if(claim===this.claim){this.authoringScope=value.authoring_scope;this.scopeChanged?.(this.authoringScope);}return value.authoring_scope;
  }
  async setCharacterMethod(name,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendMethod||!this.characterMethod)throw new Error('Human character method control is not ready.');
    const value=await this.human(this.sendMethod,{name,expected_epoch:this.characterMethod.epoch},expectedSequence,'Human character method');
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded method response from previous Session.');
    if(claim===this.claim){this.characterMethod=value.character_method;this.methodChanged?.(this.characterMethod,value.skills);}return value.character_method;
  }
  async close(){
    this.disposed=true;++this.sequence;++this.discoverySequence;this.discovery?.controller.abort();this.discovery=null;this.observedRow=null;this.cancelFlight();this.clearRetry();this.phase='inactive';this.hide();this.clearTimer(this.timer);this.timer=null;
    const old=this.current,claim=this.claim;this.current=null;this.claim=null;
    if(old&&claim)await this.releaseClaim(old.id,claim);
    await Promise.allSettled([...this.pending]);
  }
  async reviewMaterials(request,expectedSequence=this.sequence){
    const sequence=this.sequence,session=this.current,claim=this.claim;
    if(expectedSequence!==sequence||this.phase!=='ready'||!session||!claim||!this.sendReview||!this.authoringScope)throw new Error('Human review page is not ready.');
    const value=await this.human(this.sendReview,{...request,expected_epoch:this.authoringScope.epoch},expectedSequence,'Human review');
    if(this.disposed||sequence!==this.sequence)throw new Error('Discarded review response from previous Session.');
    return value;
  }
}
