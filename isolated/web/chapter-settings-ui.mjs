const text=value=>new TextEncoder().encode(value);
const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
/** Seal replacement keys before they enter the parent bridge or RPC payload. */
export async function sealChapterKeys(transport,request,keys,cryptoApi=globalThis.crypto){
  if(!Object.keys(keys).length)return null;
  if(!transport?.publicKey||!cryptoApi?.subtle)throw Object.assign(new Error('此頁無法安全封裝金鑰，請使用正式舞臺或安全連線。'),{code:'CHAPTER_SETTINGS_CRYPTO_UNAVAILABLE'});
  const aes=await cryptoApi.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=cryptoApi.getRandomValues(new Uint8Array(12));
  const rsa=await cryptoApi.subtle.importKey('jwk',transport.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const ciphertext=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv,additionalData:text(JSON.stringify({operationId:request.operationId,expectedRevision:request.expectedRevision,settings:request.settings}))},aes,text(JSON.stringify(keys)));
  const wrappedKey=await cryptoApi.subtle.encrypt({name:'RSA-OAEP'},rsa,await cryptoApi.subtle.exportKey('raw',aes));
  return {keyId:transport.keyId,wrappedKey:base64(wrappedKey),iv:base64(iv),ciphertext:base64(ciphertext)};
}
const errors={
  CHAPTER_SETTINGS_DENIED:'只有已驗證的舞臺操作者可以讀寫全域設定。',
  CHAPTER_SETTINGS_STORAGE_UNAVAILABLE:'目前沒有可寫入的 DSH 憑證儲存，不能保存金鑰。請確認正式舞臺服務已啟用；不會改存瀏覽器或卡片。',
  CHAPTER_SETTINGS_STORAGE_INVALID:'已保存的全域設定格式無效，請由管理者檢查 DSH 憑證儲存。',
  CHAPTER_SETTINGS_INVALID:'設定不完整或格式有誤，請檢查供應商、模型與開關。',
  CHAPTER_SETTINGS_ENDPOINT:'服務網址須為 HTTPS；本機服務可使用 localhost 的 HTTP。網址不能含帳密、查詢或片段。',
  CHAPTER_SETTINGS_KEY_INVALID:'金鑰格式或安全封裝無效。請輸入真正的新金鑰，不要輸入遮罩符號。',
  CHAPTER_SETTINGS_KEY_EXPIRED:'舞臺已重新啟動，安全封裝已更新。請重新讀取設定後再輸入新金鑰。',
  CHAPTER_SETTINGS_KEY_DESTINATION_CHANGED:'供應商或服務網址已變更。請重新輸入該服務金鑰，避免把舊金鑰送到另一個目的地。',
  CHAPTER_SETTINGS_VERSION_CONFLICT:'另一個分頁已更新設定。請重新讀取後再保存。',
  CHAPTER_SETTINGS_OPERATION_CONFLICT:'本次保存身分已用於不同內容，請重新讀取後再保存。',
  CHAPTER_SETTINGS_CLEAR_CONFIRMATION:'請先勾選清除確認。',
  CHAPTER_SETTINGS_SAVE_UNKNOWN:'保存結果尚未確認。請重新讀取狀態，勿重複送出金鑰；必要時重啟舞臺後查詢。',
  CHAPTER_SETTINGS_BUSY:'故事或模型工作進行中。請完成或取消後，再保存全域設定。',
  CHAPTER_SETTINGS_DEPENDENCY:'章節記憶召回需要同時啟用章節分析與摘要、向量搜尋。',
  CHAPTER_SETTINGS_KEY_REQUIRED:'啟用的服務尚無可用金鑰。請輸入金鑰，或明確選用可用的環境變數備援。',
  CHAPTER_SETTINGS_MODEL_REQUIRED:'請先在舞臺選擇模型，或指定已註冊的供應商與排序模型，再啟用章節召回。',
};
export function chapterSettingsError(error){return errors[error?.code]??(error?.name==='AbortError'?'已取消等待；Host 可能已保存，請重新讀取狀態確認。':error?.code==='CHAPTER_SETTINGS_CRYPTO_UNAVAILABLE'?'此頁無法安全封裝金鑰。請使用正式舞臺、HTTPS 或 localhost；不會改用明文提交。':'無法確認設定服務結果。請重新讀取狀態，勿重複送出金鑰。');}
export function mountChapterSettings({request,onSaved=()=>{},document:doc=globalThis.document,secureContext=true}={}){
  const $=id=>doc.getElementById(id);let snapshot=null,busy=false,controller=null,serial=0,operationId=null;
  const ids=['global-chapter-models','global-chapter-retrieval','global-chapter-embedding','global-embedding-provider','global-embedding-model','global-embedding-url','global-embedding-nebius','global-embedding-env','global-embedding-key','global-rerank-mode','global-rerank-provider','global-rerank-model','global-rerank-url','global-rerank-env','global-rerank-key'];
  const dialog=$('global-chapter-dialog');
  const writable=()=>secureContext&&snapshot?.storageAvailable&&!snapshot?.saveOutcomeUncertain;
  const clearInputs=()=>{for(const id of ['global-embedding-key','global-rerank-key'])$(id).value='';};
  function controls(){
    for(const id of ids)$(id).disabled=busy||!writable();
    $('global-chapter-save').disabled=busy||!writable();$('global-chapter-clear').disabled=busy||!writable()||!$('global-chapter-clear-confirm').checked;
    $('global-chapter-clear-confirm').disabled=busy||!writable();$('global-chapter-refresh').disabled=busy;
    const provider=$('global-embedding-provider').value,mode=$('global-rerank-mode').value,remote=['openrouter','openai','compatible'].includes(mode);
    $('global-embedding-url').readOnly=provider!=='compatible';$('global-embedding-nebius').disabled=busy||!writable()||provider!=='openrouter';
    $('global-rerank-provider-row').hidden=mode!=='dsh_model';$('global-rerank-model-row').hidden=mode==='dsh_current';
    for(const id of ['global-rerank-url-row','global-rerank-key-row','global-rerank-env-row'])$(id).hidden=!remote;
    $('global-rerank-url').readOnly=mode!=='compatible';
    $('global-chapter-open').disabled=!secureContext;
    if(!globalThis.crypto?.subtle)for(const id of ['global-embedding-key','global-rerank-key']){$(id).disabled=true;$(id).placeholder='此頁無法安全輸入新金鑰，請使用正式舞臺或安全連線';}
  }
  function source(status){return status.source==='dsh'?(status.selectionRequired?'尚未選擇舞臺排序模型，請先設定模型來源。':'由舞臺模型服務管理；本頁不讀取金鑰'):`${status.stored?'已保存金鑰':'尚未保存金鑰'}；選用環境變數${status.environmentAvailable?'可用':'未找到'}（備援${status.environmentEnabled?'已開啟':'已關閉'}）；目前來源：${status.source==='stored'?'已保存金鑰':status.source==='environment'?'環境變數':'未設定'}`;}
  function render(value){
    snapshot=value;const s=value.settings;
    for(const [id,key]of [['global-chapter-models','chapterModelsEnabled'],['global-chapter-retrieval','chapterRetrievalEnabled'],['global-chapter-embedding','chapterEmbeddingEnabled']])$(id).checked=s.flags[key];
    for(const [id,key]of [['global-embedding-provider','provider'],['global-embedding-model','model'],['global-embedding-url','baseUrl']])$(id).value=s.embedding[key];
    $('global-embedding-nebius').checked=s.embedding.nebiusOnly;$('global-embedding-env').checked=s.embedding.environmentFallback;
    for(const [id,key]of [['global-rerank-mode','mode'],['global-rerank-provider','provider'],['global-rerank-model','model'],['global-rerank-url','baseUrl']])$(id).value=s.rerank[key];
    $('global-rerank-env').checked=s.rerank.environmentFallback;
    $('global-embedding-key-status').textContent=source(value.embeddingKey);$('global-rerank-key-status').textContent=source(value.rerankKey);
    $('global-embedding-key').placeholder=value.embeddingKey.stored?'已保存；留空保留，輸入新值才替換':'輸入服務金鑰（不回填）';
    $('global-rerank-key').placeholder=value.rerankKey.stored?'已保存；留空保留，輸入新值才替換':'輸入服務金鑰（不回填）';
    clearInputs();$('global-chapter-clear-confirm').checked=false;controls();
  }
  async function refresh(){
    if(!secureContext){$('global-chapter-error').textContent='請使用正式舞臺、HTTPS 或 localhost 開啟設定。';return;}
    const current=++serial;clearInputs();$('global-chapter-error').textContent='';$('global-chapter-status').textContent='正在讀取全域設定…';
    try{const value=await request('chapterProviderSettings');if(current!==serial)return;render(value);$('global-chapter-status').textContent=value.saveOutcomeUncertain?'上次保存結果未知。請重新讀取確認；仍無法確認時，重新啟動舞臺再查詢。章節工作已停用，不會重送金鑰。':value.appliedRevision!==value.revision?'已保存的設定尚未套用。請等工作完成後重新讀取，必要時重啟舞臺。':value.storageAvailable?`${value.settings.flags.chapterModelsEnabled?'摘要模型服務可用':'摘要模型服務已在進階設定停用'}；摘要與3＋8上下文統一使用各故事的主開關。向量／排序設定不足會保留原文並提示，連線尚未測試。`:'此環境沒有可寫入的安全憑證服務；僅顯示來源，不提供替代的明文儲存。';}
    catch(error){if(current===serial){$('global-chapter-error').textContent=chapterSettingsError(error);$('global-chapter-status').textContent='未能讀取全域設定。';}}
  }
  function settings(){
    const mode=$('global-rerank-mode').value,native=mode==='dsh_current'||mode==='dsh_model';
    return {flags:{chapterModelsEnabled:$('global-chapter-models').checked,chapterRetrievalEnabled:$('global-chapter-models').checked,chapterEmbeddingEnabled:$('global-chapter-models').checked},
      embedding:{provider:$('global-embedding-provider').value,model:$('global-embedding-model').value.trim(),baseUrl:$('global-embedding-url').value.trim(),nebiusOnly:$('global-embedding-provider').value==='openrouter'&&$('global-embedding-nebius').checked,environmentFallback:$('global-embedding-env').checked},
      rerank:{mode,provider:mode==='dsh_model'?$('global-rerank-provider').value.trim():'',model:mode==='dsh_current'?'':$('global-rerank-model').value.trim(),baseUrl:native?'':$('global-rerank-url').value.trim(),environmentFallback:native?false:$('global-rerank-env').checked}};
  }
  async function submit(clear=false){
    if(busy||!writable())return;const current=++serial;busy=true;controller=new AbortController();operationId=globalThis.crypto.randomUUID();
    const payload={operationId,expectedRevision:snapshot.revision,...(clear?{confirmation:'clear-shared-chapter-settings'}:{settings:settings()})},keys={};
    if(!clear){if($('global-embedding-key').value)keys.embedding=$('global-embedding-key').value;if($('global-rerank-key').value)keys.rerank=$('global-rerank-key').value;}
    clearInputs();controls();$('global-chapter-error').textContent='';$('global-chapter-status').textContent=clear?'正在清除共用設定…':'正在安全保存共用設定…';
    try{
      if(!clear)payload.sealedKeys=await sealChapterKeys(snapshot.keyTransport,payload,keys);
      for(const key of Object.keys(keys))delete keys[key];controller.signal.throwIfAborted();
      const value=await request(clear?'chapterProviderClear':'chapterProviderSave',payload,controller.signal);if(current!==serial)return;render(value);
      $('global-chapter-status').textContent=clear?'已清除共用金鑰並停用進階服務；沒有產生摘要。':'服務設定已保存，不需重啟。自動摘要依各故事已保存的開關，在之後新回合達到整理時機才執行；本次保存不會補算舊章。';
      onSaved(value);
    }catch(error){if(current===serial){$('global-chapter-error').textContent=chapterSettingsError(error);$('global-chapter-status').textContent='請依提示修正或重新讀取確認；沒有自動重送金鑰。';}}
    finally{for(const key of Object.keys(keys))delete keys[key];clearInputs();if(current===serial){busy=false;controller=null;controls();}}
  }
  $('global-chapter-open').addEventListener('click',()=>{dialog.showModal();void refresh();});
  $('global-chapter-close').addEventListener('click',()=>{if(busy)controller?.abort();clearInputs();dialog.close();});
  for(const event of ['cancel','close'])dialog.addEventListener(event,()=>{if(busy)controller?.abort();clearInputs();});
  $('global-chapter-form').addEventListener('submit',event=>{event.preventDefault();void submit();});
  $('global-chapter-refresh').addEventListener('click',()=>void refresh());
  $('global-chapter-clear-confirm').addEventListener('change',controls);
  $('global-chapter-clear').addEventListener('click',()=>{if($('global-chapter-clear-confirm').checked)void submit(true);});
  $('global-chapter-cancel').addEventListener('click',()=>{
    if(busy){controller?.abort();$('global-chapter-status').textContent='已取消等待；Host 可能已保存，請重新讀取確認。';}
    else if(snapshot){render(snapshot);$('global-chapter-error').textContent='';$('global-chapter-status').textContent='已取消未保存變更；金鑰輸入已清除。';}
    clearInputs();
  });
  $('global-embedding-provider').addEventListener('change',()=>{const p=$('global-embedding-provider').value;if(p==='openrouter'){$('global-embedding-url').value='https://openrouter.ai/api/v1';$('global-embedding-model').value='qwen/qwen3-embedding-8b';$('global-embedding-nebius').checked=true;}else if(p==='openai'){$('global-embedding-url').value='https://api.openai.com/v1';$('global-embedding-model').value='text-embedding-3-small';$('global-embedding-nebius').checked=false;}else{$('global-embedding-url').value='';$('global-embedding-nebius').checked=false;}$('global-embedding-key').value='';$('global-embedding-key').placeholder='選擇新目的地時，請輸入該服務的新金鑰';$('global-embedding-key-status').textContent='尚未保存此供應商設定；原金鑰不會自動送往新目的地。';controls();});
  $('global-rerank-mode').addEventListener('change',()=>{const m=$('global-rerank-mode').value;$('global-rerank-url').value=m==='openrouter'?'https://openrouter.ai/api/v1':m==='openai'?'https://api.openai.com/v1':'';$('global-rerank-key').value='';if(m==='dsh_current')$('global-rerank-model').value='';$('global-rerank-key-status').textContent=m==='dsh_current'||m==='dsh_model'?'保存後使用舞臺模型與憑證。':'尚未保存此供應商設定；請確認該服務的金鑰來源。';controls();});
  globalThis.addEventListener?.('pagehide',clearInputs);controls();
  return {refresh,clearInputs};
}
