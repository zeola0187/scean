import {resolveTemplateSegments} from './player-text.mjs';
// One shared Desktop/Web controller. Choice text is displayed as text only.
export function mountOpeningSelection({enabled=false,request,onCreated,onOffer=()=>{},openStudio,document=globalThis.document}){
  const $=id=>document.getElementById(id);let offer=null,busy=false,serial=0,runId=null;
  const controls=()=>{for(const id of ['opening-choice','opening-start','opening-dismiss'])$(id).disabled=busy||!offer;$('opening-new').disabled=busy||!runId;if($('opening-player-name')){$('opening-player-name').disabled=busy;$('opening-start').disabled=busy||!offer||!$('opening-player-name').value.trim();}};
  const setRun=run=>{const next=run?.runId??null;if(next!==runId)reset();runId=next;$('opening-new').hidden=!enabled||!runId;controls();};
  const error=value=>{$('opening-error').textContent=value?.message??'';$('opening-error').hidden=!value;};
  const payload=()=>({offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash});
  const preview=()=>{$('saved-opening-preview').textContent=offer?.options.find(row=>row.index===Number($('opening-choice').value))?.text??'';$('saved-opening-preview').textContent=resolveTemplateSegments($('saved-opening-preview').textContent,$('opening-player-name')?.value.trim(),offer?.options.find(row=>row.index===Number($('opening-choice').value))?.textSpans);};
  const reset=()=>{serial++;offer=null;busy=false;$('opening-selection').hidden=true;$('saved-opening-preview').textContent='';$('opening-choice').replaceChildren();error(null);controls();};
  async function refresh(){
    if(!enabled)return false;
    const token=++serial;offer=null;busy=true;error(null);controls();
    try{
      const value=await request('openingOffer');if(token!==serial)return false;
      offer=value??null;$('opening-selection').hidden=!offer;$('opening-choice').replaceChildren();
      if(offer){
         if($('opening-player-name'))$('opening-player-name').value=offer.defaultPlayerName??'';
        $('opening-revision').textContent='已保存版本 r'+offer.revision+' · 確認後才建立新故事；既有故事保留原開場。';
        for(const row of offer.options){const option=document.createElement('option');option.value=String(row.index);option.textContent=row.title;$('opening-choice').append(option);}
        $('opening-choice').value=String(offer.options[0].index);preview();
      }
      return !!offer;
    }catch(value){if(token===serial){$('opening-selection').hidden=false;error(value);}return token===serial;}
    finally{if(token===serial){busy=false;controls();}}
  }
  async function act(action){
    if(!enabled||!offer||busy)return;
    const token=serial,args=payload();if(action==='openingStart'){args.openingIndex=Number($('opening-choice').value);args.playerName=$('opening-player-name')?.value;}
    busy=true;error(null);controls();
    try{
      const result=await request(action,args);if(token!==serial)return;
      reset();if(result.runId)await onCreated(result);
    }catch(value){if(token===serial){if(['OPENING_STALE','OPENING_EXPIRED','CARD_CONTEXT_CHANGED','CARD_CONTEXT_REQUIRED'].includes(value.code)){offer=null;$('saved-opening-preview').textContent='';}error(value);}}
    finally{if(token===serial){busy=false;controls();}}
  }
  $('opening-choice').addEventListener('change',preview);
  $('opening-player-name')?.addEventListener('input',()=>{preview();controls();});
  $('opening-new').addEventListener('click',async()=>{
    if(!enabled||!runId||busy)return;const token=serial,target=runId;busy=true;error(null);controls();
    try{const result=await request('openingPrepare',{runId:target});if(token!==serial)return;
      if(result.runId){reset();await onCreated(result);}else{await refresh();onOffer();}
    }catch(value){if(token===serial){$('opening-selection').hidden=false;error(value);}}
    finally{if(token===serial){busy=false;controls();}}
  });
  $('opening-start').addEventListener('click',()=>act('openingStart'));
  $('opening-dismiss').addEventListener('click',()=>act('openingCancel'));
  $('opening-return').addEventListener('click',()=>openStudio());
  reset();setRun(null);return {refresh,reset,setRun};
}
