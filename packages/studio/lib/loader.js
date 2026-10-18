import { randomUUID } from 'node:crypto';
import { fail } from './codec.js';
import fs from 'node:fs/promises';
import { sha,strictJson } from './codec.js';
import { canonicalRoot, errorResult,contained,atomicReplace } from './card-service.js';
import { MaterialCardService } from './material-service.js';
import { archiveIds } from './archive-lifecycle.js';
import { methodByName,restoreMethod,hasDialogue,methodInfo,methodSkills } from './character-method.js';
import path from 'node:path';
import { ExportDownloads } from './export-download.js';
import { assertScopeOperation } from './authoring-scope.js';

/** Trusted loader. Workspace configuration is data; it cannot name modules, commands, or URLs. */
export class WorkspaceLoader {
  constructor({root,agentLookup,activateAddon,skills=[],readMethodSkill=async row=>row,serviceFactory,leaseMs=90000,taskMs=600000,now=Date.now}) {
    this.root=root;this.agentLookup=agentLookup;this.activateAddon=activateAddon;this.skills=skills;
    this.readMethodSkill=readMethodSkill;
    this.serviceFactory=serviceFactory ?? (()=>new MaterialCardService(root));this.leaseMs=leaseMs;this.now=now;
    this.records=new Map();this.workspace=null;this.closed=false;this.transition=Promise.resolve();
    this.archiveIds=null;this.archived=new Set();this.archiveTask=Promise.resolve();
    if(!Number.isSafeInteger(taskMs)||taskMs<1||taskMs>3600000)throw new TypeError('Host task lifetime must be bounded to at most one hour.');
    this.taskMs=taskMs;this.downloads=new ExportDownloads({now});
  }
  async init() {this.canonical=await canonicalRoot(this.root);}
  async isCard(agent) {return !!agent && this.agentLookup(agent.id)===agent && await canonicalRoot(agent.session.header.cwd)===this.canonical;}
  async queue(fn) {const p=this.transition.catch(()=>{}).then(fn);this.transition=p;return p;}
  setArchiveState(value){
    const ids=archiveIds(value);this.archiveIds=ids;this.archived=new Set(ids);
    const job=this.queue(async()=>{
      if(this.closed)fail('CLOSING','Loader disposed.');
      const temporary=!this.workspace,service=this.workspace?.service??this.serviceFactory();
      try{if(temporary)await service.init();return await service.synchronizeArchiveState(ids);}
      finally{if(temporary)await service.close();}
    });
    this.archiveTask=job;return job;
  }
  scopeInfo(r){return {mode:r.scope.mode,epoch:r.scope.epoch,boundary:'Card Studio controlled tools and UI only; generic DSH filesystem/shell are outside this policy.'};}
  methodInfo(r){return methodInfo(r,this.skills);}
  methodSkills(r){return methodSkills(r,this.skills);}
  async readAuthoringScope(sessionId){
    const relative='.cardstudio-scean/authoring-scopes/'+sha(Buffer.from(sessionId))+'.json';
    try{
      const filename=await contained(this.root,relative,{existing:true}),stat=await fs.lstat(filename);
      if(stat.isSymbolicLink()||!stat.isFile())fail('AUTHORING_SCOPE_STORE','Scope must be a regular Host-owned file.');
      const value=strictJson(await fs.readFile(filename,'utf8'));
      if(value.schemaVersion!==1||!['content','full'].includes(value.mode)||!Number.isSafeInteger(value.epoch)||value.epoch<0)fail('AUTHORING_SCOPE_STORE','Invalid persisted Session scope.');
      return {mode:value.mode,epoch:value.epoch,characterMethod:value.characterMethod};
    }catch(error){if(error.code==='ENOENT')return {mode:'full',epoch:0};throw error;}
  }
  async writeSessionSettings(r){
    const stateRoot=await contained(this.root,'.cardstudio-scean');
    await fs.mkdir(stateRoot,{recursive:true});
    if((await fs.lstat(stateRoot)).isSymbolicLink())fail('AUTHORING_SCOPE_STORE','State directory cannot be redirected.');
    const directory=await contained(this.root,'.cardstudio-scean/authoring-scopes');
    await fs.mkdir(directory,{recursive:true});
    if((await fs.lstat(directory)).isSymbolicLink())fail('AUTHORING_SCOPE_STORE','Scope directory cannot be redirected.');
    const filename=await contained(this.root,'.cardstudio-scean/authoring-scopes/'+sha(Buffer.from(r.agent.id))+'.json');
    await atomicReplace(filename,Buffer.from(JSON.stringify({schemaVersion:1,...r.scope,characterMethod:r.method})+'\n'));
  }
  // Fixed, human-only choice. Not reachable through any Agent action/command.
  async setCharacterMethod(agent,request,signal){
    return this.queue(async()=>{
      const r=this.records.get(agent?.id);await this.validate(agent,r,request?.claim);signal?.throwIfAborted();
      if(!request?.claim||!methodByName(request.name)||request.expected_epoch!==r.method.epoch)fail('CHARACTER_METHOD_CHANGED','角色方法或視窗已變更；請重新整理目前對話。');
      if(request.name===r.method.name)return {character_method:this.methodInfo(r),skills:this.methodSkills(r).map(({name,description})=>({name,description}))};
      if(!r.method.name||r.method.locked||hasDialogue(agent))fail('CHARACTER_METHOD_LOCKED','本對話已開始或讀入方法；請開新對話並選擇另一方法。舊上下文不會被抹除。');
      if(agent.status==='running')fail('CHARACTER_METHOD_BUSY','對話正在工作，請完成後在新對話選擇方法。');
      if(!this.methodInfo(r).options.find(x=>x.name===request.name)?.available)fail('CHARACTER_METHOD_UNAVAILABLE','所選角色方法檔案缺失或無效，沒有自動改用另一方法。');
      const previous=r.method;r.method={name:request.name,epoch:previous.epoch+1,locked:false,reason:'fresh'};
      try{await this.writeSessionSettings(r);}catch(error){r.method=previous;throw error;}
      r.methodInvalidate?.();return {character_method:this.methodInfo(r),skills:this.methodSkills(r).map(({name,description})=>({name,description}))};
    });
  }
  async readCharacterSkill(agent,r,locator,signal){
    return this.queue(async()=>{
      await this.validate(agent,r,null);signal?.throwIfAborted();
      if(locator.epoch!==r.method.epoch||!methodByName(r.method.name)?.skills.includes(locator.name))return undefined;
      const row=this.skills.find(x=>x.name===locator.name);
      if(!row||row.unavailable)fail('CHARACTER_METHOD_UNAVAILABLE','所選角色方法不可讀，沒有自動改用另一方法。');
      let definition;
      try{definition=await this.readMethodSkill(row);}
      catch(error){row.unavailable=true;for(const record of this.records.values())record.methodInvalidate?.();fail('CHARACTER_METHOD_UNAVAILABLE','所選角色方法或 reference 缺失／無效，請修復後重新啟動 Card Studio。');}
      signal?.throwIfAborted();await this.validate(agent,r,null);
      if(!r.method.locked){const previous=r.method;r.method={...previous,locked:true,reason:'read'};try{await this.writeSessionSettings(r);}catch(error){r.method=previous;throw error;}r.methodInvalidate?.();}
      signal?.throwIfAborted();await this.validate(agent,r,null);return definition;
    });
  }
  scopePolicy(agent,r,claim,action,args){
    const mode=r.scope.mode,epoch=r.scope.epoch,selectionEpoch=r.selectionEpoch??0;
    const task=claim?null:r.hostTask;
    const selectionBound=!!args?.document_id&&args.expected_revision!==undefined&&!['open','read','history','diff'].includes(action);
    const assertCurrent=()=>{
      this.assertRecord(agent,r,claim,{task});
      if(r.scopeChanging||r.scope.epoch!==epoch)fail('AUTHORING_SCOPE_CHANGED','Authoring Scope changed while this operation was pending. Refresh and retry under the current scope.');
      if(selectionBound&&(r.selectionEpoch??0)!==selectionEpoch)fail('STUDIO_SELECTION_CHANGED','The Session selection changed while this operation was pending. Keep the draft and refresh before retrying.');
    };
    return {mode,epoch,sessionGeneration:r.generation,workspaceGeneration:r.workspaceGeneration,action,args,assertCurrent,validateSelection:async()=>{
      assertCurrent();if(!selectionBound)return;
      const selected=await this.workspace.service.selectedDocument?.(agent.id);assertCurrent();
      if(selected&&selected.document_id!==args.document_id)fail('STUDIO_SELECTION_CHANGED','The saved Session selection differs from this operation. Refresh before writing.');
    }};
  }
  // Dedicated authenticated client invocation. No model tool or command action
  // can call this method; claim+expected epoch prevent stale-window promotion.
  async setAuthoringScope(agent,request,signal){
    return this.queue(async()=>{
      const r=this.records.get(agent?.id);await this.validate(agent,r,request?.claim);signal?.throwIfAborted();
      if(!request?.claim||!['content','full'].includes(request.mode)||request.expected_epoch!==r.scope.epoch)fail('AUTHORING_SCOPE_CHANGED','Read the current Session scope and use the live human page control.');
      if(request.mode===r.scope.mode)return {authoring_scope:this.scopeInfo(r)};
      const previous=r.scope;r.scopeChanging=true;r.scope={mode:request.mode,epoch:previous.epoch+1};
      r.scopeController.abort(new DOMException('Authoring Scope changed','AbortError'));
      // Admission closes before draining. No old writer remains after ACK.
      this.workspace.service.uploads?.clear(agent.id);this.workspace.service.assetUploads?.clear(agent.id);
      this.workspace.service.generatedArms?.delete(agent.id);
      const job=(async()=>{
        await Promise.allSettled([...r.jobs]);
        await this.writeSessionSettings(r);
      })();r.scopeTask=job;
      try{await job;return {authoring_scope:this.scopeInfo(r)};}
      catch(error){r.scope={mode:'content',epoch:r.scope.epoch+1};throw error;}
      finally{r.scopeController=new AbortController();r.scopeChanging=false;r.scopeTask=null;}
    });
  }
  async acquire(agent,pageId,signal) {
    if (typeof pageId!=='string' || !/^[a-zA-Z0-9-]{10,100}$/.test(pageId))fail('LEASE','Invalid page identity.');
    return this.queue(async()=>{
      signal?.throwIfAborted();if(this.closed)fail('CLOSING','Loader disposed.');if(!await this.isCard(agent))fail('WORKSPACE','This Session is outside the configured Card Studio workspace.');
      if(this.archived.has(agent.id))fail('SESSION_ARCHIVED','Restore this Session in DSH before opening Card Studio.');
      let r=this.records.get(agent.id);
      if(!this.workspace){const service=this.serviceFactory();await service.init();try{if(this.archiveIds!==null)await service.synchronizeArchiveState(this.archiveIds);}catch(error){await service.close();throw error;}this.workspace={generation:randomUUID(),service};}
      if(!r){
        r={agent,owner:this,root:this.canonical,generation:randomUUID(),workspaceGeneration:this.workspace.generation,pages:new Map(),closing:false,controller:new AbortController(),jobs:new Set(),addon:null};
        const saved=await this.readAuthoringScope(agent.id);
        r.scope={mode:saved.mode,epoch:saved.epoch};r.method=restoreMethod(saved.characterMethod,agent);
        if(!saved.characterMethod&&agent.session.header.parentSession){
          const parent=await this.readAuthoringScope(agent.session.header.parentSession);
          if(parent.characterMethod){r.method=restoreMethod(parent.characterMethod,agent);r.method={...r.method,locked:true,reason:r.method.name?'inherited':'invalid'};}
        }
        if(r.method.name)await this.writeSessionSettings(r);
        r.scopeController=new AbortController();r.scopeChanging=false;r.scopeTask=null;
        r.selected=await this.workspace.service.selectedDocument?.(agent.id)??null;
        r.materialSelection=await this.workspace.service.selection?.(agent.id)??null;
        this.records.set(agent.id,r);
        try{r.addon=await this.activateAddon(r,this);}catch(e){this.records.delete(agent.id);if(!this.records.size){await this.workspace.service.close();this.workspace=null;}throw e;}
      }
      if(r.closing || r.agent!==agent)fail('LEASE','Session generation is closing.');
      const previous=r.pages.get(pageId);if(previous){previous.controller.abort(new DOMException('Page lease replaced','AbortError'));this.clearPage(r,pageId,previous);}
      const selectedSaved=r.selected&&this.workspace.service.read?await this.workspace.service.read(r.selected.document_id):null;
      const lease={id:randomUUID(),expires:this.now()+this.leaseMs,controller:new AbortController(),selection:r.selected?.document_id??null,selectionRevision:selectedSaved?.revision??null};r.pages.set(pageId,lease);
      this.trackHostTask(r);
      return {page_id:pageId,lease_id:lease.id,agent_generation:r.generation,workspace_generation:r.workspaceGeneration,workspace:this.canonical,skills:this.methodSkills(r).map(({name,description})=>({name,description})),lease_ms:this.leaseMs,selection_status:await this.selectionStatus(r,{page_id:pageId}),host_task:this.taskInfo(r),authoring_scope:this.scopeInfo(r),character_method:this.methodInfo(r)};
    });
  }
  taskInfo(r){return r.hostTask?{state:'running',task_id:r.hostTask.id,deadline:r.hostTask.deadline,max_ms:this.taskMs}:{state:'idle',max_ms:this.taskMs};}
  trackHostTask(r){
    if(r.hostTask&&r.agent.status!=='running'){r.hostTask.controller.abort(new DOMException('Agent task completed','AbortError'));r.hostTask=null;}
    if(!r.hostTask&&r.agent.status==='running'&&[...r.pages.values()].some(lease=>lease.expires>this.now())){
      // One absolute deadline per accepted Agent execution. Page renewals and
      // tool calls never extend it, and an idle transition retires the claim.
      const admittedAt=Math.min(this.now(),Math.max(...[...r.pages.values()].map(lease=>lease.expires)));
      const task={id:randomUUID(),deadline:admittedAt+this.taskMs,controller:new AbortController()};r.hostTask=task;
      Promise.resolve().then(()=>r.agent.whenIdle()).then(()=>this.queue(async()=>{
        if(this.records.get(r.agent.id)!==r||r.hostTask!==task)return;
        task.controller.abort(new DOMException('Agent task completed','AbortError'));r.hostTask=null;if(!r.pages.size)await this.stopRecord(r,'idle');
      })).catch(()=>{});
    }
    return r.hostTask;
  }
  agentStatus(agent){const r=this.records.get(agent?.id);if(!r||r.agent!==agent||r.closing)return;this.trackHostTask(r);if(agent.status!=='running'&&!r.pages.size)return this.queue(async()=>{if(this.records.get(agent.id)===r&&!r.pages.size&&!r.hostTask)await this.stopRecord(r,'idle');});}
  assertRecord(agent,r,claim,{task}={}) {
    if(this.closed || !r || r.owner!==this || this.records.get(agent.id)!==r || this.agentLookup(agent.id)!==agent || r.agent!==agent || r.root!==this.canonical || r.closing || r.controller.signal.aborted || !this.workspace || r.workspaceGeneration!==this.workspace.generation)fail('STALE_WORKSPACE','Card Studio capability is no longer active.');
    if(claim && (claim.agent_generation!==r.generation || claim.workspace_generation!==r.workspaceGeneration || r.pages.get(claim.page_id)?.id!==claim.lease_id || r.pages.get(claim.page_id).expires<=this.now()))fail('STALE_LEASE','Refresh the Card Studio capability menu; old page/generation rejected.');
    if(task&&(r.hostTask!==task||task.controller.signal.aborted||r.agent.status!=='running'))fail('STALE_HOST_TASK','The accepted Agent execution has finished.');
    if(!claim&&r.hostTask?.deadline<=this.now())fail('HOST_TASK_TIMEOUT','The bounded Host Agent task lifetime expired.');
    if(!claim && ![...r.pages.values()].some(lease=>lease.expires>this.now())&&!(r.hostTask&&r.agent.status==='running'&&!r.hostTask.controller.signal.aborted))fail('STALE_LEASE','No live page lease or accepted Host Agent task.');
  }
  async validate(agent,r,claim,{allowArchived=false,task}={}) {if(!allowArchived&&this.archived.has(agent?.id))fail('SESSION_ARCHIVED','Restore this Session in DSH before editing.');if(r&&!r.closing)this.trackHostTask(r);this.assertRecord(agent,r,claim,{task});if(!await this.isCard(agent))fail('WORKSPACE','Session cwd changed or owner no longer exists.');this.assertRecord(agent,r,claim,{task});}
  async selectionStatus(r,claim){const selected=await this.workspace.service.selectedDocument?.(r.agent.id)??null;r.selected=selected;const lease=r.pages.get(claim.page_id),saved=selected?await this.workspace.service.read(selected.document_id):null,changed=(lease.selection??null)!==(selected?.document_id??null)||(lease.selectionRevision??null)!==(saved?.revision??null);return {document_id:selected?.document_id??null,type:selected?.type??null,revision:saved?.revision??null,sha256:saved?.sha256??null,agent_generation:r.generation,workspace_generation:r.workspaceGeneration,changed};}
  async renew(agent,claim) {const r=this.records.get(agent.id);await this.validate(agent,r,claim);r.pages.get(claim.page_id).expires=this.now()+this.leaseMs;const selection_status=await this.selectionStatus(r,claim);await this.validate(agent,r,claim);return {active:true,...claim,selection_status,host_task:this.taskInfo(r),authoring_scope:this.scopeInfo(r),character_method:this.methodInfo(r),skills:this.methodSkills(r).map(({name,description})=>({name,description}))};}
  uploadOwner(agent,claim){return claim?{sessionId:agent.id,pageId:claim.page_id,leaseId:claim.lease_id}:agent.id;}
  clearPage(r,pageId,lease){const owner=this.uploadOwner(r.agent,{page_id:pageId,lease_id:lease.id});this.workspace?.service.uploads?.clearOwner(owner);this.workspace?.service.assetUploads?.clearOwner(owner);this.downloads.clear(r.agent.id,pageId,lease.id);}
  async setLibraryRoot(agent,request,signal){
    const r=this.records.get(agent?.id);await this.validate(agent,r,request?.claim);if(!request?.claim)fail('STALE_LEASE','Human Library control requires a current page.');
    const {claim,...choice}=request,service=this.workspace.service,allowedRoots=[await fs.realpath(this.root)];try{allowedRoots.push(await fs.realpath(service.librarySettings().path));}catch{}
    if(choice.path!==null){
      if(typeof choice.path!=='string'||!path.isAbsolute(choice.path)||/[\0]/.test(choice.path)||choice.path.split(/[\\/]/).includes('..'))fail('LIBRARY_CAPABILITY','Use a folder inside the current Library capability.');
      const selected=await fs.realpath(choice.path);
      if(!allowedRoots.some(root=>{const relative=path.relative(root,selected);return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}))fail('LIBRARY_CAPABILITY','A remote page may select only inside the configured workspace or current Library root. Select a new external root through an explicitly authorized Host setup.');
      choice.path=selected;
    }
    const combined=AbortSignal.any([r.controller.signal,r.pages.get(claim.page_id).controller.signal,...signal?[signal]:[]]);
    const job=service.setLibraryRoot(choice,combined,()=>this.assertRecord(agent,r,claim),{allowedRoots});r.jobs.add(job);try{const value=await job;await this.validate(agent,r,claim);return value;}finally{r.jobs.delete(job);}
  }
  async downloadExport(agent,request,signal){
    const r=this.records.get(agent?.id);await this.validate(agent,r,request?.claim);if(!request?.claim)fail('STALE_LEASE','Export download requires a current human page.');signal?.throwIfAborted();
    const {claim,...download}=request,selected=await this.workspace.service.selectedDocument(agent.id);
    if(selected?.document_id!==download.document_id)fail('STUDIO_SELECTION_CHANGED','The selected working copy changed on another page. Refresh before downloading.');
    const saved=await this.workspace.service.read(download.document_id);if(saved.revision!==download.expected_revision)fail('REVISION_CONFLICT','The saved card changed. Export its current revision again.');
    await this.validate(agent,r,claim);signal?.throwIfAborted();return this.downloads.request(this.uploadOwner(agent,claim),download);
  }
  async reviewMaterials(agent,request,signal){
    const r=this.records.get(agent?.id);await this.validate(agent,r,request?.claim);
    if(!request.claim||request.expected_epoch!==r.scope.epoch)fail('AUTHORING_SCOPE_CHANGED','Use the current human review page and scope epoch.');
    const {claim,expected_epoch,...review}=request;
    return this.call(agent,r,claim,'material',review,signal,true);
  }
  async call(agent,r,claim,action,args,signal,humanReview=false) {
    try{
      await this.archiveTask;
      await this.validate(agent,r,claim);if(r.scopeTask)await r.scopeTask;
      if(['import','upload_finish','create','library_copy'].includes(action)||action==='open'&&args.document_id!==r.selected?.document_id)r.selectionEpoch=(r.selectionEpoch??0)+1;
      const service=this.workspace.service;
      let policyArgs=args;
      if(action==='asset_upload_finish'){
        assertScopeOperation({mode:r.scope.mode},action,args);
        // The wire request carries only an upload ID. Resolve its immutable
        // document/revision from the trusted page-owned row before pinning the
        // policy; serialized admission and commit both recheck this selection.
        const upload=service.assetUploads.get(this.uploadOwner(agent,claim),args.upload_id);
        policyArgs={...args,document_id:upload.document_id,expected_revision:upload.expected_revision};
      }
      const policy=this.scopePolicy(agent,r,claim,action,policyArgs);
      const owned=new AbortController(),onAbort=()=>owned.abort(signal.reason);
      if(signal?.aborted)owned.abort(signal.reason);else signal?.addEventListener('abort',onAbort,{once:true});
      const task=claim?null:r.hostTask;
      const combined=AbortSignal.any([owned.signal,r.controller.signal,r.scopeController.signal,...claim?[r.pages.get(claim.page_id).controller.signal]:[],...task?[task.controller.signal]:[]]);
      const job=(async()=>{
        await this.validate(agent,r,claim,{task});combined.throwIfAborted();
        if(claim&&args.document_id&&args.expected_revision!==undefined&&!['open','read','history','diff'].includes(action)){
          const selected=await service.selectedDocument?.(agent.id);if(selected&&selected.document_id!==args.document_id)fail('STUDIO_SELECTION_CHANGED','This Session selected another working copy on a different page. Keep this draft and refresh the selection before writing.');
        }
        const context={sessionId:agent.id,uploadOwner:this.uploadOwner(agent,claim)};
        const invoke=async()=>humanReview?{ok:true,value:await service.humanMaterials(args,combined,context)}:service.operation(action,args,combined,context);
        const result=typeof service.withAuthoringScope==='function'?await service.withAuthoringScope(policy,invoke):await invoke();await this.validate(agent,r,claim,{task});
        if(result.ok&&['import','upload_finish','open','create','library_copy'].includes(action)){r.selected=await service.selectedDocument?.(agent.id)??null;if(claim)r.pages.get(claim.page_id).selection=r.selected?.document_id??null;}
        if(result.ok&&action==='material'&&args.action==='select')r.materialSelection=result.value.selection;
        if(result.ok){
          result.authoring_scope=this.scopeInfo(r);
          if(claim){
            const selection=await this.selectionStatus(r,claim),observedId=result.value?.id??result.value?.document_id;
            if(observedId&&observedId===selection.document_id&&result.value?.revision===selection.revision){const lease=r.pages.get(claim.page_id);lease.selection=selection.document_id;lease.selectionRevision=selection.revision;selection.changed=false;}
            result.selection_status=selection;
          }
          if(claim&&['export','export_backup','export_bundle','export_target'].includes(action)){
            try{const saved=await service.read(result.value.id);result.value.download=await this.downloads.issue(this.root,context.uploadOwner,result.value,saved,combined);await this.validate(agent,r,claim);}
            catch(error){result.value.download_unavailable={code:error.code??'DOWNLOAD_FAILED',message:error.message};}
            combined.throwIfAborted();await this.validate(agent,r,claim,{task});
          }
          if(result.value&&typeof result.value==='object'&&!Array.isArray(result.value))result.value={...result.value,authoring_scope:this.scopeInfo(r)};
        }
        return result;
      })();r.jobs.add(job);
      try{return await job;}finally{r.jobs.delete(job);signal?.removeEventListener('abort',onAbort);}
    }catch(e){return errorResult(e);}
  }
  async release(agent,claim) {
    return this.queue(async()=>{
      const r=this.records.get(agent.id);if(!r)return {released:true};await this.validate(agent,r,claim,{allowArchived:true});const lease=r.pages.get(claim.page_id);lease.controller.abort(new DOMException('Page left workspace','AbortError'));this.clearPage(r,claim.page_id,lease);r.pages.delete(claim.page_id);
      if(!r.pages.size&&!(r.hostTask&&r.agent.status==='running'&&r.hostTask.deadline>this.now()))await this.stopRecord(r,'page-left');return {released:true,remaining_pages:r.pages.size,host_task:this.taskInfo(r)};
    });
  }
  async stopRecord(r,reason='shutdown') {
    if(r.closing)return;r.closing=true; // Admission closes before cancellation, draining and unregistration.
    r.controller.abort(new DOMException(reason==='task-timeout'?'Host Agent task lifetime expired':'Workspace left: '+reason,'AbortError'));
    r.hostTask?.controller.abort(r.controller.signal.reason);this.downloads.clear(r.agent.id);
    this.workspace?.service.uploads?.clear(r.agent.id);
    this.workspace?.service.assetUploads?.clear(r.agent.id);
    this.workspace?.service.generatedArms?.delete(r.agent.id);
    this.workspace?.service.generatedResults?.delete(r.agent.id);
    for(const key of this.workspace?.service.previewStates?.keys()??[])if(key.startsWith(r.agent.id+':'))this.workspace.service.previewStates.delete(key);
    if(r.agent.status==='running')r.agent.cancel({kind:'user'});
    await Promise.allSettled([...r.jobs]);await r.agent.whenIdle();
    await r.addon?.dispose();this.records.delete(r.agent.id);
    if(!this.records.size && this.workspace){const service=this.workspace.service;this.workspace=null;await service.close();}
  }
  async sweep() {return this.queue(async()=>{this.workspace?.service.uploads?.sweep();this.workspace?.service.assetUploads?.sweep();this.downloads.sweep();for(const r of [...this.records.values()]){this.trackHostTask(r);for(const [id,lease] of r.pages)if(lease.expires<=this.now()){lease.controller.abort(new DOMException('Lease expired','AbortError'));this.clearPage(r,id,lease);r.pages.delete(id);}if(r.hostTask?.deadline<=this.now())await this.stopRecord(r,'task-timeout');else if(!r.pages.size&&!(r.hostTask&&r.agent.status==='running'))await this.stopRecord(r,'idle');}});}
  async disposed(agent) {return this.queue(async()=>{const r=this.records.get(agent.id);if(r?.agent===agent)await this.stopRecord(r);});}
  async close() {this.closed=true;return this.queue(async()=>{for(const r of [...this.records.values()])await this.stopRecord(r);});}
}
