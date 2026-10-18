import { randomUUID } from 'node:crypto';
import { fail } from './codec.js';
import fs from 'node:fs/promises';
import { sha,strictJson } from './codec.js';
import { canonicalRoot, errorResult,contained,atomicReplace } from './card-service.js';
import { MaterialCardService } from './material-service.js';
import { archiveIds } from './archive-lifecycle.js';
import { methodByName,restoreMethod,hasDialogue,methodInfo,methodSkills } from './character-method.js';

/** Trusted loader. Workspace configuration is data; it cannot name modules, commands, or URLs. */
export class WorkspaceLoader {
  constructor({root,agentLookup,activateAddon,skills=[],readMethodSkill=async row=>row,serviceFactory,leaseMs=90000,now=Date.now}) {
    this.root=root;this.agentLookup=agentLookup;this.activateAddon=activateAddon;this.skills=skills;
    this.readMethodSkill=readMethodSkill;
    this.serviceFactory=serviceFactory ?? (()=>new MaterialCardService(root));this.leaseMs=leaseMs;this.now=now;
    this.records=new Map();this.workspace=null;this.closed=false;this.transition=Promise.resolve();
    this.archiveIds=null;this.archived=new Set();this.archiveTask=Promise.resolve();
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
    const mode=r.scope.mode,epoch=r.scope.epoch;
    return {mode,epoch,sessionGeneration:r.generation,workspaceGeneration:r.workspaceGeneration,action,args,assertCurrent:()=>{
      this.assertRecord(agent,r,claim);
      if(r.scopeChanging||r.scope.epoch!==epoch)fail('AUTHORING_SCOPE_CHANGED','Authoring Scope changed while this operation was pending. Refresh and retry under the current scope.');
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
      r.pages.get(pageId)?.controller.abort(new DOMException('Page lease replaced','AbortError'));
      const lease={id:randomUUID(),expires:this.now()+this.leaseMs,controller:new AbortController()};r.pages.set(pageId,lease);
      return {page_id:pageId,lease_id:lease.id,agent_generation:r.generation,workspace_generation:r.workspaceGeneration,workspace:this.canonical,skills:this.methodSkills(r).map(({name,description})=>({name,description})),lease_ms:this.leaseMs,authoring_scope:this.scopeInfo(r),character_method:this.methodInfo(r)};
    });
  }
  assertRecord(agent,r,claim) {
    if(this.closed || !r || r.owner!==this || this.records.get(agent.id)!==r || this.agentLookup(agent.id)!==agent || r.agent!==agent || r.root!==this.canonical || r.closing || r.controller.signal.aborted || !this.workspace || r.workspaceGeneration!==this.workspace.generation || !r.pages.size)fail('STALE_WORKSPACE','Card Studio capability is no longer active.');
    if(claim && (claim.agent_generation!==r.generation || claim.workspace_generation!==r.workspaceGeneration || r.pages.get(claim.page_id)?.id!==claim.lease_id || r.pages.get(claim.page_id).expires<=this.now()))fail('STALE_LEASE','Refresh the Card Studio capability menu; old page/generation rejected.');
    if(!claim && ![...r.pages.values()].some(lease=>lease.expires>this.now()))fail('STALE_LEASE','No live page lease.');
  }
  async validate(agent,r,claim,{allowArchived=false}={}) {if(!allowArchived&&this.archived.has(agent?.id))fail('SESSION_ARCHIVED','Restore this Session in DSH before editing.');this.assertRecord(agent,r,claim);if(!await this.isCard(agent))fail('WORKSPACE','Session cwd changed or owner no longer exists.');this.assertRecord(agent,r,claim);}
  async renew(agent,claim) {const r=this.records.get(agent.id);await this.validate(agent,r,claim);r.pages.get(claim.page_id).expires=this.now()+this.leaseMs;return {active:true,...claim,authoring_scope:this.scopeInfo(r),character_method:this.methodInfo(r),skills:this.methodSkills(r).map(({name,description})=>({name,description}))};}
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
      const policy=this.scopePolicy(agent,r,claim,action,args);
      const owned=new AbortController(),onAbort=()=>owned.abort(signal.reason);
      if(signal?.aborted)owned.abort(signal.reason);else signal?.addEventListener('abort',onAbort,{once:true});
      const combined=AbortSignal.any([owned.signal,r.controller.signal,r.scopeController.signal,...claim?[r.pages.get(claim.page_id).controller.signal]:[]]);
      const service=this.workspace.service;
      const job=(async()=>{await this.validate(agent,r,claim);combined.throwIfAborted();const invoke=async()=>humanReview?{ok:true,value:await service.humanMaterials(args,combined,{sessionId:agent.id})}:service.operation(action,args,combined,{sessionId:agent.id});const result=typeof service.withAuthoringScope==='function'?await service.withAuthoringScope(policy,invoke):await invoke();await this.validate(agent,r,claim);if(result.ok&&['import','upload_finish','open','create','library_copy'].includes(action))r.selected=await service.selectedDocument?.(agent.id)??null;if(result.ok&&action==='material'&&args.action==='select')r.materialSelection=result.value.selection;if(result.ok){result.authoring_scope=this.scopeInfo(r);if(result.value&&typeof result.value==='object'&&!Array.isArray(result.value))result.value={...result.value,authoring_scope:this.scopeInfo(r)};}return result;})();r.jobs.add(job);
      try{return await job;}finally{r.jobs.delete(job);signal?.removeEventListener('abort',onAbort);}
    }catch(e){return errorResult(e);}
  }
  async release(agent,claim) {
    return this.queue(async()=>{
      const r=this.records.get(agent.id);if(!r)return {released:true};await this.validate(agent,r,claim,{allowArchived:true});r.pages.get(claim.page_id).controller.abort(new DOMException('Page left workspace','AbortError'));r.pages.delete(claim.page_id);
      if(!r.pages.size)await this.stopRecord(r);return {released:true,remaining_pages:r.pages.size};
    });
  }
  async stopRecord(r) {
    if(r.closing)return;r.closing=true; // Admission closes before cancellation, draining and unregistration.
    r.controller.abort(new DOMException('Workspace left','AbortError'));
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
  async sweep() {return this.queue(async()=>{this.workspace?.service.uploads?.sweep();this.workspace?.service.assetUploads?.sweep();for(const r of [...this.records.values()]){for(const [id,lease] of r.pages)if(lease.expires<=this.now()){lease.controller.abort(new DOMException('Lease expired','AbortError'));r.pages.delete(id);}if(!r.pages.size)await this.stopRecord(r);}});}
  async disposed(agent) {return this.queue(async()=>{const r=this.records.get(agent.id);if(r?.agent===agent)await this.stopRecord(r);});}
  async close() {this.closed=true;return this.queue(async()=>{for(const r of [...this.records.values()])await this.stopRecord(r);});}
}
