import {MODEL_ROLES,MODEL_ROLE_INHERITANCE,MODEL_STAGE_ROLES,MODEL_STAGES,modelSelection,readModelSettings,saveModelSettings,captureRoutePin} from '../core/model-routing.mjs';
import {SceanError,clone} from '../core/contracts.mjs';
const fail=code=>{throw new SceanError(code);};
const label=v=>typeof v==='string'?v.slice(0,160):'';
export class AgentModelRouting {
  constructor({llm,agentDefaultModel,store,config={},chapterSelection}){Object.assign(this,{llm,agentDefaultModel,store,config,chapterSelection});this.epoch=0;}
  async catalog(){
    if(!this.llm?.listProviders||!this.llm?.listModels)fail('MODEL_CATALOG_UNAVAILABLE');
    const providers=this.llm.listProviders();if(!Array.isArray(providers)||providers.length>128)fail('INVALID_CATALOG');
    return {roles:[...MODEL_ROLES],providers:await Promise.all(providers.map(async p=>{
      const value={id:label(p.id),name:label(p.name),models:[],status:'ready'};
      try{const rows=await this.llm.listModels(p.id);if(!Array.isArray(rows)||rows.length>4096||new Set(rows.map(m=>m.id)).size!==rows.length)fail('INVALID_CATALOG');value.models=rows.map(m=>{modelSelection({provider:p.id,model:m.id});return {id:m.id,name:label(m.name)};});if(!rows.length)value.status='empty';}
      catch(e){value.status='unavailable';value.code=['NO_ADAPTER','MISSING_CREDENTIAL','INVALID_CREDENTIAL','INVALID_CATALOG'].includes(e.code)?e.code:'MODEL_CATALOG_UNAVAILABLE';}return value;
    }))};
  }
  async validate(selection,signal){
    signal?.throwIfAborted();selection=modelSelection(selection);
    if(!this.llm.listProviders().some(p=>p.id===selection.provider))fail('NO_ADAPTER');
    const models=await this.llm.listModels(selection.provider);signal?.throwIfAborted();
    if(!models.some(m=>m.id===selection.model))fail('UNKNOWN_MODEL');
    const info=await this.llm.resolveModelInfo(selection.provider,selection.model,signal);
    if(selection.reasoningEffort!==undefined&&!info.reasoning?.efforts?.some(e=>e.id===selection.reasoningEffort))fail('UNSUPPORTED_REASONING_EFFORT');
    return info;
  }
  async status(scope='@global'){
    const settings=await readModelSettings(this.store,scope),global=scope==='@global'?settings:await readModelSettings(this.store,'@global');
    const rerank=await this.chapterSelection?.()??{mode:'legacy',revision:0};
    const result={settings,global,rerank:{mode:rerank.mode,revision:rerank.revision??0,...rerank.mode==='dsh_model'?{provider:rerank.provider,model:rerank.model}:{}},dshSelection:null};
    try{result.dshSelection=modelSelection(await this.agentDefaultModel.currentSelection());}catch{}
    try{const plan=await this.plan(scope==='@global'?null:await this.store.read(scope));result.effective={};result.sources={};for(const role of MODEL_ROLES){const stage=Object.keys(MODEL_STAGE_ROLES).find(s=>MODEL_STAGE_ROLES[s]===role),route=plan.routes[stage];result.effective[role]=route.requested;result.sources[role]=({run_agent:'本局職責',run_stage:'本局既有階段',run:'本局既有共用',global_agent:'全域職責',plugin_stage:'Host 階段設定',plugin:'Host 設定',dsh_current_selection:'DSH 目前選擇',inherit_stat:'繼承狀態 Stat',inherit_character:'繼承角色 Character'})[route.selectionSource];}}catch{result.previewUnavailable=true;}
    return result;
  }
  async save(request){return saveModelSettings(this.store,request,(s,signal)=>this.validate(s,signal));}
  captureRoutes({run,requestId,kind='turn',inputHash=null,signal,expectedHash=null,lockHeld=false,requiredStage}){
    return captureRoutePin(this.store,{run,requestId,kind,inputHash,signal,expectedHash,lockHeld,requiredStage},()=>this.plan(run));
  }
  async plan(run){
      const global=await readModelSettings(this.store,'@global'),local=run?await readModelSettings(this.store,run.runId):{revision:0,roles:{}};
      let current=null,readCurrent=false;const dsh=async()=>{if(!readCurrent){readCurrent=true;try{current=modelSelection(await this.agentDefaultModel.currentSelection());}catch{}}return current;};
      const routes={};
      for(const stage of MODEL_STAGES){let role=MODEL_STAGE_ROLES[stage];const inherited=MODEL_ROLE_INHERITANCE[role]&&!local.roles[role]&&!global.roles[role];if(inherited)role=MODEL_ROLE_INHERITANCE[role];
        const candidates=[[local.roles[role],'run_agent'],[run?.stageModelSelections?.[stage],'run_stage'],[run?.modelSelection,'run'],[global.roles[role],'global_agent'],[this.config.stageModelSelections?.[stage],'plugin_stage'],[this.config.modelSelection,'plugin']];
        const chosen=candidates.find(([v])=>v!=null),requested=chosen?modelSelection(chosen[0]):await dsh();routes[stage]=requested?{requested,selectionSource:inherited?'inherit_'+role:chosen?.[1]??'dsh_current_selection'}:null;
      }
      const rerank=await this.chapterSelection?.()??{mode:'legacy',revision:0};
      if(rerank.revision>0){
        if(rerank.mode==='dsh_current'){const requested=await dsh();routes.chapter_rerank=requested?{requested,selectionSource:'global_chapter_dsh_current'}:null;}
        else if(rerank.mode==='dsh_model')routes.chapter_rerank={requested:modelSelection({provider:rerank.provider,model:rerank.model}),selectionSource:'global_chapter_dsh_model'};
        else routes.chapter_rerank=null;
      }
      return {globalRevision:global.revision,runRevision:local.revision,routes:clone(routes),rerank:{mode:rerank.mode,revision:rerank.revision??0}};
  }
}
