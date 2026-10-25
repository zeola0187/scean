const labels={director:'導演 Director',character:'角色顧問 Character',writer:'正文 Writer',stat:'裁決與結算 Stat',calendar:'日曆 Calendar',forum:'論壇 Forum',summary:'章節與長故事摘要',ideas:'玩家靈感'};
const errors={CLIENT_UPGRADE_REQUIRED:'此模型要求更新 DSH 客戶端；不會自動重試或切換模型。',MODEL_UNSUPPORTED:'目前 DSH 不支援此模型；不會自動重試或切換模型。',MODEL_ROUTING_UNAVAILABLE:'此 Host 尚未提供 Agent 模型設定。',MODEL_CATALOG_UNAVAILABLE:'目前無法讀取 DSH 模型清單。',NO_ADAPTER:'供應商已移除，請到 DSH 修復或另選現有模型。',UNKNOWN_MODEL:'模型不在 DSH 現有清單內，未改用其他模型。',INVALID_CONFIG:'DSH 模型設定無效，請先在 DSH 修復。',VERSION_CONFLICT:'設定已被其他頁面更新，請重新讀取。',MODEL_SETTINGS_SAVE_UNKNOWN:'保存結果尚未確認，請重新讀取；不會自動重送。',UNSUPPORTED_REASONING_EFFORT:'此模型不支援原設定的推理強度，請重新選取模型。'};
export function mountAgentModels({document,request,getRunId,getScopeKey=()=>'',secureContext=true}){
  const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const catalogState={value:null};
  const panels=[];
  function mount(prefix,container,global){
    const form=el('form');form.id=prefix+'-form';form.className='agent-models-form';
    const intro=el('p',global?'僅選用 DSH 已有模型；保存後從下一個新請求生效。本局可另行覆寫。':'未覆寫的職責保留既有本局選擇，再沿用全域預設。保存後下一個新請求生效，同一請求重試保留原選擇；背景工作建立時固定路由，既有工作不因改設定而換模型。');intro.className='hint';form.append(intro);
    const picks=new Map();
    for(const [role,label] of Object.entries(labels)){const box=el('fieldset'),legend=el('legend',label),select=el('select'),hint=el('p');select.id=prefix+'-'+role;select.setAttribute('aria-label',label);hint.className='hint';box.append(legend,select,hint);form.append(box);picks.set(role,{select,hint,original:null});}
    const rerank=el('p');rerank.id=prefix+'-rerank';rerank.className='hint';form.append(rerank);
    const actions=el('div');actions.className='longform-actions';const save=el('button','保存模型設定'),reload=el('button','重新讀取設定與清單'),cancel=el('button','取消未保存變更');save.type='submit';reload.type=cancel.type='button';save.id=prefix+'-save';reload.id=prefix+'-reload';cancel.id=prefix+'-cancel';actions.append(save,reload,cancel);
    const status=el('p'),error=el('p');status.id=prefix+'-status';status.setAttribute('role','status');status.className='hint';error.id=prefix+'-error';error.setAttribute('role','alert');error.className='error';form.append(actions,status,error);container.append(form);
    let serial=0,snapshot=null,owner=null,busy=false;
    const current=()=>global||owner&&owner.runId===getRunId()&&owner.scope===getScopeKey();
    const controls=()=>{save.disabled=busy||!secureContext||!snapshot||!current();reload.disabled=busy;cancel.disabled=busy||!snapshot;for(const p of picks.values())p.select.disabled=busy||!snapshot||!current();};
    function render(value){snapshot=value;const catalog=catalogState.value;
      for(const [role,p]of picks){p.select.replaceChildren();p.original=value.settings.roles[role];p.changed=false;p.select.onchange=()=>{p.changed=true;};const inheritance=role==='calendar'?'未另設時繼承狀態 Stat':role==='forum'?'未另設時繼承角色 Character':null;const base=el('option',inheritance?(global?inheritance:'沿用全域；'+inheritance):global?'沿用既有預設':'沿用本局既有／全域設定');base.value='';p.select.append(base);
        for(const provider of catalog?.providers??[]){const group=el('optgroup');group.label=provider.name||provider.id;for(const model of provider.models){const option=el('option',model.name+' · '+provider.id+' / '+model.id);option.value=JSON.stringify({provider:provider.id,model:model.id});group.append(option);}p.select.append(group);}
        if(p.original){const key=JSON.stringify({provider:p.original.provider,model:p.original.model});if(![...p.select.options].some(o=>o.value===key)){const stale=el('option','已保存但目前不可用：'+p.original.provider+' / '+p.original.model);stale.value=key;stale.dataset.unavailable='true';p.select.append(stale);}p.select.value=key;}else p.select.value='';
        const inherited=value.effective?.[role]??(global?value.dshSelection:value.global.roles[role]??value.dshSelection);p.hint.textContent=inherited?'新請求將要求：'+inherited.provider+' / '+inherited.model+(value.sources?.[role]?'（'+value.sources[role]+'）':''):'尚未選定可用的繼承來源。';
      }
      const r=value.rerank;rerank.textContent=r?.mode==='dsh_model'?'章節排序另沿用「進階摘要服務」的全域指定模型：'+r.provider+' / '+r.model:r?.mode==='dsh_current'||r?.mode==='legacy'?'章節排序沿用「進階摘要服務」設定；DSH 路由會在請求開始時固定。':'章節排序使用「進階摘要服務」內既有獨立服務；不受本頁摘要模型覆寫。';
      status.textContent='已讀取設定版本 '+value.settings.revision+'。模型清單與描述不代表已通過真模型連線測試。';error.textContent='';controls();
    }
    async function refresh(){const ticket=++serial;owner=global?null:{runId:getRunId(),scope:getScopeKey()};snapshot=null;error.textContent='';if(!global&&!owner.runId){status.textContent='請先選一局故事。';controls();return;}busy=true;status.textContent='正在讀取模型設定與 DSH 清單…';controls();
      try{const [catalog,value]=await Promise.all([request('agentModelCatalog'),request(global?'agentModelDefaults':'agentModels',global?{}:{runId:owner.runId})]);if(ticket!==serial||!current())return;catalogState.value=catalog;render(value);const unavailable=catalog.providers.filter(p=>p.status!=='ready');if(unavailable.length)error.textContent='部分供應商目前沒有可選清單：'+unavailable.map(p=>p.name||p.id).join('、')+'。已保存選擇會保留；不會自動換模型。';}
      catch(e){if(ticket===serial)error.textContent=errors[e.code]??'讀取未完成，請稍後重新讀取。（'+(e.code??'UNKNOWN')+'）';}
      finally{if(ticket===serial){busy=false;controls();}}
    }
    form.addEventListener('submit',async event=>{event.preventDefault();if(!secureContext||busy||!snapshot||!current())return;const ticket=serial,scopeOwner=owner;busy=true;error.textContent='';controls();
      try{const roles={};for(const [role,p]of picks){const selected=p.select.value?JSON.parse(p.select.value):null;roles[role]=selected&&p.original&&!p.changed&&selected.provider===p.original.provider&&selected.model===p.original.model?p.original:selected;}
        const value=await request(global?'agentModelDefaultsSave':'agentModelsSave',{...(global?{}:{runId:scopeOwner.runId}),roles,expectedRevision:snapshot.settings.revision,operationId:crypto.randomUUID()});if(ticket!==serial||!current())return;render(value);status.textContent='已保存設定版本 '+value.settings.revision+'。下一個新請求生效；進行中與同一請求重試保持原模型。';
      }catch(e){if(ticket===serial)error.textContent=errors[e.code]??'保存未完成；請重新讀取確認，不會自動重送。（'+(e.code??'UNKNOWN')+'）';}
      finally{if(ticket===serial){busy=false;controls();}}
    });
    reload.addEventListener('click',()=>void refresh());cancel.addEventListener('click',()=>{if(snapshot)render(snapshot);});controls();
    const panel={refresh,invalidate(){serial++;snapshot=null;busy=false;status.textContent='故事或來源已變更，請重新讀取本局模型設定。';controls();}};panels.push(panel);return panel;
  }
  const global=mount('global-agent-models',$('global-agent-models-panel'),true);
  const run=mount('run-agent-models',$('run-agent-models-panel'),false);
  const tabs=[...document.querySelectorAll('[data-global-settings-tab]')];
  function tab(name){for(const t of tabs){const selected=t.dataset.globalSettingsTab===name;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;$(t.getAttribute('aria-controls')).hidden=!selected;}if(name==='models')void global.refresh();}
  for(const [index,t]of tabs.entries()){t.addEventListener('click',()=>tab(t.dataset.globalSettingsTab));t.addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].click();tabs[next].focus();}});}
  $('global-chapter-open').addEventListener('click',()=>tab('general'));
  $('run-agent-models-open').addEventListener('click',()=>void run.refresh());
  return {invalidateRun:()=>run.invalidate()};
}
