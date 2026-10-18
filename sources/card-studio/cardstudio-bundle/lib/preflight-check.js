import {canonical,sha,compatibilityWarnings} from './codec.js';
import {requireTavernDocument} from './card-service.js';
import {checkTarget} from './target-profile.js';
import {checkGates,simulateGates,compileGate,gateEntryHash} from './worldbook-gating.js';
import {inspectFrontend} from './frontend-authoring.js';
import {validateFixture,bindFixture} from './authoring-fixture.js';
import {validateVisualContract} from './visual-state.js';

export const EXPORT_ACTIONS=['export','export_target','export_backup','export_bundle'];
export function failureFingerprint(code,object){return sha(canonical({code,object}));}
const next=(tool,action,args={})=>({tool,action,...args});
export async function preflight({record,decoded,authoring,delivery,exportAction,name,cases=[],readBlob}){
 const intent=exportAction??delivery.primaryAction??'export',target=authoring.target,items=[];
 const context={document_id:record.id,revision:record.revision,target:target?{profile:target.config.profile,definitionDigest:target.definitionDigest}:null,export_action:intent,format:name?.endsWith('.json')?'json':decoded.kind,sha256:record.sha256,authoring_sha256:record.authoringSha256??null,cases_hash:sha(canonical(cases))};
 const add=(severity,code,message,object={},scope='static',nextAction=null,repair=null)=>items.push({severity,code,message,object,scope,fingerprint:failureFingerprint(code,object),nextAction:nextAction?{document_id:record.id,...nextAction}:null,...(repair?{repair}: {})});
 const manual=(code,message,object={},severity='FAIL')=>add(severity,code,message,object,'static',next('card_read','read',{document_id:record.id}));
 const backup=['export_backup','export_bundle'].includes(intent),playable=intent==='export_target';
 if(!EXPORT_ACTIONS.includes(intent))manual('CHECK_PURPOSE','請選擇有效的匯出目的。');
 try{requireTavernDocument(decoded,{exporting:!(decoded.kind==='png'&&context.format==='json')});add('PASS','CARD_STRUCTURE','已儲存卡片與 snapshot 結構／相容性檢查通過。');}catch(e){manual(e.code??'CARD_STRUCTURE',e.message,e.details??{});}
 for(const d of compatibilityWarnings(decoded.card))add('WARN',d.code,d.message??'Preserved compatibility value.',{path:d.path??'/data'});
 for(const d of decoded.warnings??[])add('WARN',d.code,'PNG 有其他 metadata，會原樣保留；JSON 僅輸出主卡。',{path:'/data'});
 if(decoded.kind==='png'&&context.format==='json')add('WARN','PNG_JSON_ONLY','JSON 僅包含主卡，不包含圖片與其他 PNG metadata。');
 if(!backup&&intent==='export'&&(delivery.targetProfile||delivery.requiresTargetPreparation))manual('EXPORT_PURPOSE_REQUIRED','此卡需要目標成品交付，或由作者明確選擇原始備份。',{path:'/data'},'FAIL');
 if(playable){
  const checked=checkTarget(decoded.card,authoring);
  for(const d of checked.diagnostics){
   const object={...(d.entry_id?{entry_id:d.entry_id}:{}),...(d.group?{group:d.group}:{}),...(d.path?{path:d.path}:{})};
   let repair=null;
   if(d.code==='GATE_STALE'&&d.entry_id){
    const g=authoring.gating?.entries.find(g=>g.entryId===d.entry_id),entry=decoded.card.data.character_book?.entries.find(e=>e.id===g?.cardEntryId);
    try{if(g?.compilerVersion===1&&g.namespace===target.config.namespace&&entry?.content.startsWith(compileGate(g.rule,{...target,definitionDigest:g.definitionDigest})+'\n')&&!/<%|(^|\n)\s*@@/.test(entry.content.slice(compileGate(g.rule,{...target,definitionDigest:g.definitionDigest}).length+1)))repair={kind:'gate_rebind',entry_id:g.entryId,expected_source_hash:gateEntryHash(entry),rule:g.rule};}catch{}
   }
   add('FAIL',d.code,d.message??'受管 Gate 規則／來源需要檢查。',object,'static',d.entry_id?next('cardstudio_scean_worldbook_gate','read',{entry_id:d.entry_id}):next('cardstudio_scean_target','read'),repair);
  }
  if(checked.ready)add('PASS','TARGET_STATIC','目標卡內來源、schema 與宣告一致。');
  add('WARN','HOST_UNTESTED','未查酒館實際安裝、啟用與腳本權限；靜態通過不是 runtime 通過。',{},'untested');
 }else{
  add('NA','TARGET_NOT_APPLICABLE',backup?'備份不宣稱目標成品 ready。':'此匯出不要求進階 target。',{},'not_applicable');
  for(const d of checkGates(decoded.card,authoring))add('WARN',d.code,d.message??'原始 Gate 已保留，未認證。',{...(d.entry_id?{entry_id:d.entry_id}:{})},'static',next('cardstudio_scean_worldbook_gate','inspect'));
 }
 const discovered=inspectFrontend(decoded.card,authoring.components??[],record.entryIds);
 for(const d of discovered.diagnostics)add('WARN',d.code,d.message??'前端來源需人工確認。',{...(d.entry_id?{entry_id:d.entry_id}:{})},'static',next('cardstudio_scean_frontend','inspect'));
 for(const c of discovered.components){
  if(c.dependencies.dynamicUnknown||c.dependencies.externalResources.length)add('WARN','FRONTEND_UNVERIFIED','已保留動態／外部內容；不執行、不連線。',{component_id:c.component_id,path:c.locator.path.join('/')},'untested',next('cardstudio_scean_frontend','read',{component_id:c.component_id}));
  for(const macro of c.dependencies.macros){const m=/^\{\{sample(?:_label)?::([^}]+)\}\}$/.exec(macro);if(m&&!Object.values(authoring.fixtures??{}).some(f=>Object.hasOwn(f.bindings,m[1])))add(playable?'FAIL':'WARN','BINDING_UNDECLARED','製卡綁定沒有已宣告的 fixture 欄位。',{component_id:c.component_id,field:m[1]},'static',next('cardstudio_scean_fixture','read'));}
 }
 if(!discovered.components.length)add('NA','FRONTEND_NOT_APPLICABLE','未使用可檢查的前端片段。',{},'not_applicable');
 const scripts=decoded.card.data.extensions?.tavern_helper?.scripts;
 if(scripts||decoded.card.data.extensions?.TavernHelper_scripts)add('WARN','SCRIPT_STATIC_ONLY','卡內腳本僅保存與靜態檢查，不執行其行為。',{},'untested',next('cardstudio_scean_target_source','list',{kind:'script'}));
 for(const [id,f] of Object.entries(authoring.fixtures??{}))try{const b=bindFixture(validateFixture(f));for(const d of b.diagnostics)add('WARN',d.code,d.message,{fixture_id:id,field:d.field},'static',next('cardstudio_scean_fixture','read',{fixture_id:id}));}catch(e){manual(e.code??'FIXTURE',e.message,{fixture_id:id},'WARN');}
 if(authoring.contract)try{validateVisualContract(authoring.contract);add('PASS','VISUAL_SCHEMA','視覺契約結構通過；不代表圖片解碼或排版實測。');}catch(e){manual(e.code??'VISUAL',e.message,{},playable?'FAIL':'WARN');}
 else add('NA','VISUAL_NOT_APPLICABLE','沒有視覺契約。',{},'not_applicable');
 const assets=authoring.assetManifest?.assets??[];
 if(playable||intent==='export_bundle'){
  if(assets.reduce((n,a)=>n+a.bytes,0)>256*1024*1024)manual('EXPORT_LIMIT','素材總量超過交付包限制。');
  for(const a of assets)try{await readBlob(a);add('PASS','ASSET_BYTES','本機素材實體、hash 與格式通過。',{asset_id:a.assetId});}catch(e){manual(e.code??'ASSET_UNAVAILABLE','素材缺失、損壞或 hash 不符。',{asset_id:a.assetId});}
 }
 if(!Array.isArray(cases)||cases.length>16||Buffer.byteLength(canonical(cases))>65536)manual('CHECK_CASES','作者案例最多 16 項、總計 64 KiB。');
 else if(cases.length&&!target)manual('CHECK_CASE_TARGET','合成 Gate 案例需要既有 target；不會自動建立。');
 else if(target)for(const [index,c] of cases.entries())try{
  if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['name','values','snapshot','expect'].includes(k)))throw Error('使用 name、values 或 snapshot、expect。');
  const result=simulateGates(decoded.card,record.entryIds,authoring,c),expected=c.expect??{};
  if(!expected||typeof expected!=='object'||Array.isArray(expected))throw Error('expect 需為 entry_id 到 pass/fail/unknown 的對照。');
  if(!Object.keys(expected).length)add('WARN','CASE_OBSERVATION','缺作者預期，只記錄觀察，不算行為驗收。',{case:index},'untested');
  for(const [id,status]of Object.entries(expected)){const actual=result.entries.find(e=>e.entry_id===id);if(!['pass','fail','unknown'].includes(status)||!actual)throw Error('預期須指向本次可檢查的 entry_id。');add(actual.status===status?'PASS':'FAIL','CASE_EXPECTATION',`預期 ${status}，實際 ${actual.status}（${actual.reason}）。`,{case:index,entry_id:id},'synthetic',next('cardstudio_scean_worldbook_gate','read',{entry_id:id}));}
  if(result.entriesOmitted)add('WARN','CHECK_TRUNCATED','有條目未納入合成結果。',{case:index},'untested');
 }catch(e){manual(e.code??'CHECK_CASE',e.message,{case:index});}
 if(authoring.gating?.entries?.length){
  add('WARN','FRESHNESS_UNTESTED','合成 evaluate 不驗訊息／swipe freshness、最終 keyword／budget 注入。',{},'untested');
  if(!Array.isArray(cases)||!cases.length)add('WARN','AUTHOR_CASES_UNTESTED','尚未提供作者預期的合成案例。',{},'untested');
 }else add('NA','GATE_NOT_APPLICABLE','沒有受管 Gate。',{},'not_applicable');
 const counts=Object.fromEntries(['PASS','WARN','FAIL','NA'].map(s=>[s,items.filter(i=>i.severity===s).length]));
 return {...context,overall:counts.FAIL?'FAIL':counts.WARN?'WARN':'PASS',exportAllowed:counts.FAIL===0,counts,items,runtimeVerified:false,coverage:'stored snapshot; static and explicit synthetic expectations only'};
}

/** Host-enforced finite repair invocation. Mutations use existing controlled tools. */
export async function repairLoop({check,patch,limit=3}){
 let result=await check();const rounds=[],repaired=new Set();
 for(let round=1;round<=Math.min(3,limit);round++){
  const failures=result.items.filter(i=>i.severity==='FAIL');if(!failures.length)return {result,rounds,stop:'complete'};
  const fixes=failures.filter(i=>i.repair?.kind==='gate_rebind').slice(0,64);if(!fixes.length)return {result,rounds,stop:'author_required'};
  const before=result;let patchError;try{await patch(fixes.map(i=>i.repair),before.revision);}catch(e){if(e.name==='AbortError')throw e;patchError={code:e.code??'FAILED',message:e.message};}result=await check();
  rounds.push({round,fingerprint:fixes[0].fingerprint,fingerprints:fixes.map(i=>i.fingerprint),batchSize:fixes.length,from:before.revision,to:result.revision,fullCheck:result});
  if(patchError)return {result,rounds,stop:'patch_failed',patchError};
  fixes.forEach(i=>repaired.add(i.fingerprint));
  if(result.items.some(i=>i.severity==='FAIL'&&repaired.has(i.fingerprint)))return {result,rounds,stop:'repeated_fingerprint'};
  if(result.counts.FAIL>before.counts.FAIL)return {result,rounds,stop:'failures_increased'};
 }
 return {result,rounds,stop:result.counts.FAIL?'round_limit':'complete'};
}
