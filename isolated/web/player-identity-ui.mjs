// Host persists defaults and Run bindings. Browser storage never owns a name.
export function mountPlayerIdentity({request,onBound=()=>{},document=globalThis.document,makeId=()=>crypto.randomUUID()}){
  const $=id=>document.getElementById(id);let defaults=null,settingsBusy=false,settingsRequest=null,run=null,busy=false,hostBusy=false,pending=null,epoch=0;
  const message=(id,value)=>{$(id).textContent=value??'';};
  function controls(){
    $('player-default-save').disabled=settingsBusy||!defaults;
    $('player-default-name').disabled=settingsBusy;
    $('player-bind').disabled=!run||!!run.playerIdentity||busy||hostBusy||!$('player-bind-name').value.trim();
    $('player-bind-name').disabled=busy||hostBusy||!!pending;
    $('player-bind').textContent=pending?'重試／查回本局補名':'保存本局主角名稱（僅一次）';
  }
  async function refreshDefaults(){
    try{defaults=await request('playerDefaults');$('player-default-name').value=defaults.name??'';message('player-default-status',defaults.name?'已保存；只預填之後的新局。':'尚未設定通用預設；開新局時請填寫主角名稱。');
      for(const id of ['create-player-name','studio-player-name'])if($(id)&&!$(id).value)$(id).value=defaults.name??'';
    }catch(error){message('player-default-status','未讀取：'+error.message);}finally{controls();}
  }
  $('player-default-form').addEventListener('submit',async event=>{
    event.preventDefault();if(settingsBusy||!defaults)return;
    const name=$('player-default-name').value.trim()||null;
    if(!settingsRequest||settingsRequest.name!==name)settingsRequest={name,expectedRevision:defaults.revision,operationId:makeId()};
    settingsBusy=true;controls();
    try{defaults=await request('playerDefaultsSave',settingsRequest);settingsRequest=null;message('player-default-status','已保存；既有故事的姓名保持原值。');}
    catch(error){message('player-default-status','未確認保存：'+error.message);if(error.code==='VERSION_CONFLICT'){settingsRequest=null;await refreshDefaults();}}
    finally{settingsBusy=false;controls();}
  });
  $('player-bind-name').addEventListener('input',controls);
  $('player-bind').addEventListener('click',async()=>{
    if($('player-bind').disabled)return;const token=epoch,target=run.runId;
    pending??={runId:target,name:$('player-bind-name').value,expectedVersion:run.version,expectedHead:run.head??null,operationId:makeId()};
    busy=true;controls();message('player-bind-status','正在保存本局名稱…');
    try{await request('playerBind',pending);if(token!==epoch)return;pending=null;message('player-bind-status','已保存，從後續生成生效；歷史原文保持不變。');await onBound(target);}
    catch(error){if(token!==epoch)return;message('player-bind-status','未確認補名：'+error.message);if(['VERSION_CONFLICT','HISTORY_HEAD_CONFLICT','PLAYER_NAME_ALREADY_BOUND','INVALID_PLAYER_NAME','RUN_BUSY'].includes(error.code)){pending=null;await onBound(target);}}
    finally{if(token===epoch){busy=false;controls();}}
  });
  function update(value,isBusy=false){
    if(value?.runId!==run?.runId){epoch++;pending=null;busy=false;$('player-bind-name').value='';message('player-bind-status','');}
    run=value;hostBusy=isBusy;$('player-identity-panel').hidden=!run;
    $('player-bind-form').hidden=!run||!!run.playerIdentity;
    message('player-identity-status',!run?'':run.playerIdentity?'本局主角：'+run.playerIdentity.name:'本局尚未設定主角名稱；保留原行為，可補設一次，從後續生成生效。');controls();
  }
  $('global-chapter-open').addEventListener('click',()=>void refreshDefaults());
  controls();return {refreshDefaults,update,isBusy:()=>busy};
}
