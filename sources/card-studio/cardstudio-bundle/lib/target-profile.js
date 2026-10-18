import { PRESENTATION_BASE_CSS } from './presentation-base.js';
import { clone,canonical,sha,fail } from './codec.js';
import { validateFixture } from './authoring-fixture.js';
import { validateVisualContract } from './visual-state.js';
import { tokenizeHtml,boundedSource } from './frontend-authoring.js';
import { sanitizeCss,sanitizeDeclarations } from './preview-css.js';
import { validateTargetState,reduceTargetUpdate,targetAssetFor,targetLabel,startTargetWriter,startTargetView,targetInputStamp } from './target-state.js';
import { checkGates } from './worldbook-gating.js';

export const TARGET_PROFILE='tauritavern-helper-ejs-v1';
export const TARGET_VERSIONS={tauritavern:'2.3.0',observedBuild:'dev 3fe9e055b512',tavernHelper:'4.11.3',promptTemplate:'1.17.9'};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.hasOwn(o,k);
const js=x=>JSON.stringify(x).replaceAll('<','\\u003c').replaceAll('$','\\u0024').replaceAll('{{','\\u007b\\u007b').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
export function validateTargetConfig(value,contract) {
  if(!object(value)||Object.keys(value).some(k=>!['profile','namespace','fields','initialState','source'].includes(k)))fail('TARGET_CONFIG','Use profile, namespace, fields, initialState and source.');
  if(value.profile!==TARGET_PROFILE||!/^[a-z][a-z0-9_]{0,47}$/.test(value.namespace)||['constructor','prototype','__proto__'].includes(value.namespace))fail('TARGET_CONFIG','Choose the supported target profile and a stable variable namespace.');
  if(!contract)fail('VISUAL_CONTRACT','Create/read the visual contract before configuring this target.',{path:'/authoring/contract',nextAction:{tool:'cardstudio_scean_visual_contract',action:'create'}});
  validateVisualContract(contract);
  if(!object(value.fields)||!Object.keys(value.fields).length||Object.keys(value.fields).length>16)fail('TARGET_CONFIG','Declare 1–16 bounded state fields.');
  validateFixture({schemaVersion:1,fixtureId:'target_validation',bindings:value.fields,values:value.initialState?.values??{}});
  boundedSource(value.source);
  const parsed=tokenizeHtml(value.source);
  if(!parsed.valid||!value.source.trim()||/<%|```/.test(value.source))fail('TARGET_SOURCE','The v1 compiler accepts a balanced HTML/CSS fragment, not arbitrary EJS/JS or markdown code fences.');
  const stack=[];
  for(const t of parsed.tokens) {
    if(t.type==='open') {
      if(!['section','header','div','span','p','h1','h2','h3','h4','b','strong','em','i','small','br','hr','ul','ol','li','dl','dt','dd','figure','figcaption','table','thead','tbody','tr','th','td','details','summary','img','style'].includes(t.name))fail('TARGET_SOURCE','Unsupported target template element <'+t.name+'> at offset '+t.start+'. Replace only this element with a supported inert container; preserve valid CSS.');
      if(t.attrs.some(a=>a.name.startsWith('on')||['src','srcset','href','data-state-field','data-state-display','data-state-notice'].includes(a.name)))fail('TARGET_SOURCE','Use admitted character/asset bindings; active attributes and existing state markers are not compiled.');
      if(t.name==='img'&&!t.attrs.some(a=>a.name==='data-character-id'&&own(contract.characters,a.value)))fail('TARGET_SOURCE','Every target image needs a declared data-character-id.');
      for(const a of t.attrs)if(/\{\{/.test(a.value))fail('TARGET_SOURCE','Macros in attributes are outside the target template contract.');
      for(const a of t.attrs)if(a.name==='style'){const diagnostics=[];sanitizeDeclarations(a.value,diagnostics);if(diagnostics.length)fail('TARGET_SOURCE','Unsupported inline CSS; correct only the indicated property/value.',{path:'/target/config/source',diagnostics:diagnostics.slice(0,16).map(d=>({...d,sourceOffset:a.valueStart+(d.details?.offset??0)})),nextAction:{tool:'cardstudio_scean_target',action:'read',instruction:'Preserve valid CSS; edit only the indicated unsupported declaration.'}});}
      if(!t.selfClosing)stack.push(t.name);
    }
    if(t.type==='close'&&stack.pop()!==t.name)fail('TARGET_SOURCE','Unbalanced target template.');
    if(t.type==='raw'&&/url\s*\(|@import|expression\s*\(|\{\{/i.test(t.value))fail('TARGET_SOURCE','External/style bindings are outside the target compiler contract.');
    if(t.type==='comment'&&/\{\{/.test(value.source.slice(t.start,t.end)))fail('TARGET_SOURCE','Macros in comments are outside the target template contract.');
    if(t.type==='raw'){const diagnostics=[];sanitizeCss(t.value,diagnostics);if(diagnostics.length)fail('TARGET_SOURCE','Unsupported CSS; no resource functions, escapes or arbitrary at-rules.',{path:'/target/config/source',diagnostics:diagnostics.slice(0,16).map(d=>({...d,sourceOffset:t.start+(d.details?.offset??0)})),nextAction:{tool:'cardstudio_scean_target',action:'read',instruction:'Preserve valid CSS; edit only the indicated selector/property.'}});}
    if(t.type==='text')for(const m of t.value.matchAll(/\{\{([\s\S]*?)\}\}/g))if(!/^(sample|sample_label)::[a-z][a-z0-9_-]*$/.test(m[1])||!own(value.fields,m[1].split('::')[1]))fail('TARGET_SOURCE','Only declared sample/sample_label text bindings can be compiled.');
  }
  if(stack.length)fail('TARGET_SOURCE','Unclosed target template.');
  try{validateTargetState({fields:value.fields,contract},value.initialState);}catch(e){fail('TARGET_STATE',e.message);}
  return clone(value);
}

export function targetDefinition(config,authoring) {
  validateTargetConfig(config,authoring.contract);
  const assets={};
  for(const asset of authoring.assetManifest.assets) {
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[asset.mediaType];
    assets[asset.assetId]='/user/images/'+config.namespace+'/'+asset.sha256+'.'+ext;
  }
  const definition={profile:TARGET_PROFILE,namespace:config.namespace,fields:config.fields,initialState:config.initialState,contract:authoring.contract,assets};
  return {...definition,digest:sha(canonical(definition))};
}

export function compileTarget(config,authoring) {
  const definition=targetDefinition(config,authoring), parsed=tokenizeHtml(config.source);
  let fragment='';
  for(const t of parsed.tokens) {
    if(t.type==='text')fragment+=t.value.replace(/\{\{(sample|sample_label)::([a-z][a-z0-9_-]*)\}\}/g,(_,kind,key)=>'<span data-state-field="'+key+'" data-state-display="'+(kind==='sample_label'?'label':'value')+'">—</span>');
    else if(t.type==='open'&&t.name==='img') {
      const character=t.attrs.find(a=>a.name==='data-character-id').value;
      const src=targetAssetFor(definition,character,validateTargetState(definition,config.initialState));
      const raw=config.source.slice(t.start,t.end);fragment+=raw.replace(/\/?\s*>$/,src?' src="'+src+'">':' hidden>');
    }else fragment+=config.source.slice(t.start,t.end);
  }
  const writer='// Character-owned state writer. TavernHelper APIs only; no CardStudio runtime.\n('+startTargetWriter.toString()+')('+js(definition)+','+validateTargetState.toString()+','+targetInputStamp.toString()+','+reduceTargetUpdate.toString()+');';
  const html='<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+PRESENTATION_BASE_CSS+'[data-state-notice]:empty{display:none}</style></head><body><div class="csscean-card-content">'+fragment+'</div><p data-state-notice role="status"></p><script>('+startTargetView.toString()+')('+js(definition)+','+targetLabel.toString()+','+targetAssetFor.toString()+','+targetInputStamp.toString()+');</script></body></html>';
  const prefix='roleplay-'+config.namespace;
  const regexes=[
    {id:prefix+'-hide-update',scriptName:'狀態資料不顯示',findRegex:'/<state-update>[\\s\\S]*?<\\/state-update>/g',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:true,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null},
    {id:prefix+'-panel',scriptName:'角色狀態面板',findRegex:'/$/',replaceString:'\n```html\n'+html.replaceAll('$','&#36;')+'\n```',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null}
  ];
  const script={type:'script',id:prefix+'-writer',name:'角色狀態更新',enabled:true,content:writer,info:'Character-scoped state updates use JSON data, never eval model output. Enable this character script in TavernHelper.',button:{enabled:false,buttons:[]},data:{},export_with:{data:false,button:false}};
  const sections=['values'],characters=Object.fromEntries(Object.entries(authoring.contract.characters).map(([id,c])=>[id,{expressions:c.expressions,dimensions:c.dimensions??{}}]));
  if(Object.keys(characters).length)sections.push('characters');
  const scene=authoring.contract.scene;
  if(scene)sections.push('scene');
  const example={values:config.initialState.values};
  const prompt='狀態由本卡的酒館助手腳本維護。每次助理回覆結尾可提供一個 state-update 資料區塊，只提交絕對值，省略欄位沿用前一樓。合法完整外層範例：<state-update>'+JSON.stringify(example)+'</state-update>。根物件只允許 '+sections.join('、')+'；狀態欄位必須放在 values 物件內，禁止將 '+Object.keys(config.fields).join('、')+' 等欄位直接放在根層。合法 no-op 仍是有效更新。無法依契約更新時省略區塊，不猜欄位或 ID；不合法資料整筆拒絕並保留前一狀態，腳本不會自動補包裝。不要輸出 JS、EJS、路徑、URL 或 CSS selector。顯示面板不更新狀態。\n'+
    'values 欄位規範（僅下列欄位）：'+JSON.stringify(config.fields)+'\n'+
    (Object.keys(characters).length?'characters 允許 ID／欄位：'+JSON.stringify(characters)+'\n':'')+
    (scene?'scene 允許欄位／ID：'+JSON.stringify({location:scene.locations,lighting:scene.lighting})+'\n':'未宣告場景；禁止提供 scene。\n')+
    '目前樓層狀態：<%- JSON.stringify(getvar('+js(config.namespace)+', {scope:"message",withMsg:{id:-1},noCache:true,defaults:null})?.state ?? null) %>';
  return {definition,html,script,regexes,prompt};
}

export function applyTarget(card,authoring,config,entryIds) {
  const previous=authoring.target;
  if(previous)assertOwnedTarget(card,previous);
  const compiled=compileTarget(config,authoring), ext=card.data.extensions??={};
  if(ext.tavern_helper!==undefined&&!object(ext.tavern_helper))fail('TARGET_METADATA','Existing helper metadata is not an object; preserve and adapt it explicitly.');
  const helper=ext.tavern_helper??={};helper.scripts??=[];ext.regex_scripts??=[];
  if(!Array.isArray(helper.scripts)||!Array.isArray(ext.regex_scripts))fail('TARGET_METADATA','Existing script lists are not arrays.');
  const allScripts=[];const collect=list=>{if(!Array.isArray(list))fail('TARGET_METADATA','Malformed helper folder.');for(const s of list){if(s.type==='folder')collect(s.scripts);else allScripts.push(s);}};collect(helper.scripts);
  if(!previous&&(allScripts.some(s=>s.enabled)||ext.TavernHelper_scripts!==undefined||ext.TavernHelper_characterScriptVariables!==undefined))fail('TARGET_EXISTING_RUNTIME','Existing active/legacy helper scripts need an explicit writer inventory before configuring this profile.',{inventory:{total:allScripts.length,items:allScripts.slice(0,32).map(script=>({id:String(script.id??'').slice(0,160),enabled:!!script.enabled,sourceHash:sha(String(script.content??''))})),omitted:Math.max(0,allScripts.length-32),legacy:ext.TavernHelper_scripts!==undefined||ext.TavernHelper_characterScriptVariables!==undefined},nextAction:{tool:'cardstudio_scean_target_source',action:'list',kind:'script',instruction:'Review each existing writer; do not delete all Helper/regex metadata.'}});
  if(allScripts.some(s=>s.id===compiled.script.id&&!helper.scripts.includes(s)))fail('TARGET_COLLISION','A nested user script already uses this ID.');
  const replaceOwned=(list,items,oldIds)=>{
    for(const item of items){const index=list.findIndex(x=>x.id===item.id);if(index>=0&&!oldIds?.includes(item.id))fail('TARGET_COLLISION','A user script already uses this ID.');if(index>=0)list[index]={...list[index],...item};else list.push(item);}
  };
  if(previous&&previous.config.namespace!==config.namespace)fail('TARGET_NAMESPACE','Namespace is stable after creation.');
  replaceOwned(helper.scripts,[compiled.script],previous?.scriptIds);
  replaceOwned(ext.regex_scripts,compiled.regexes,previous?.regexIds);
  card.data.character_book??={entries:[],extensions:{}};
  const entries=card.data.character_book.entries;if(!Array.isArray(entries))fail('TARGET_BOOK','Use a canonical card worldbook array.');
  let entry=previous?entries.find(e=>e.id===previous.bookId):null;
  if(!entry){const ids=entries.map(e=>e.id).filter(Number.isSafeInteger);const bookId=Math.max(-1,...ids)+1;entry={id:bookId,keys:[],secondary_keys:[],content:'',enabled:true,constant:true,insertion_order:100,extensions:{},comment:'角色狀態規則（TavernHelper／EJS）'};entries.push(entry);}
  entry.content=compiled.prompt;
  authoring.target={config:clone(config),scriptIds:[compiled.script.id],regexIds:compiled.regexes.map(x=>x.id),bookId:entry.id,ownedHash:ownedHash(card,[compiled.script.id],compiled.regexes.map(x=>x.id),entry.id),definitionDigest:compiled.definition.digest};
  return compiled;
}
function ownedHash(card,scriptIds,regexIds,bookId) {
  return sha(canonical({scripts:(card.data.extensions?.tavern_helper?.scripts??[]).filter(x=>scriptIds.includes(x.id)),regexes:(card.data.extensions?.regex_scripts??[]).filter(x=>regexIds.includes(x.id)),entry:(card.data.character_book?.entries??[]).find(x=>x.id===bookId)}));
}
export function assertOwnedTarget(card,target){if(ownedHash(card,target.scriptIds,target.regexIds,target.bookId)!==target.ownedHash)fail('TARGET_SOURCE_CONFLICT','Target script/regex/worldbook was edited outside this profile. Raw export remains available; do not overwrite custom code.');}
export function checkTarget(card,authoring) {
  const diagnostics=[],target=authoring.target;
  const add=(code,message,object={path:'/authoring/target'})=>diagnostics.push({code,severity:'error',message,...object});
  if(!target)add('TARGET_MISSING','尚未建立目標設定與狀態更新腳本。');
  else try {
    assertOwnedTarget(card,target);
    const expected=compileTarget(target.config,authoring);
    const storedScript=card.data.extensions.tavern_helper.scripts.find(s=>s.id===expected.script.id),storedRegexes=card.data.extensions.regex_scripts,storedEntry=card.data.character_book.entries.find(e=>e.id===target.bookId);
    if(storedScript?.content!==expected.script.content||storedEntry?.content!==expected.prompt||expected.regexes.some(r=>{const old=storedRegexes.find(x=>x.id===r.id);return old?.findRegex!==r.findRegex||old?.replaceString!==r.replaceString;}))add('TARGET_STALE','Generated target content differs from the current compiler. Explicitly rebuild and recheck; existing card bytes were preserved.');
    if(expected.definition.digest!==target.definitionDigest)add('TARGET_STALE','圖片或契約已改變，請明確重建目標內容。');
    if(!card.data.extensions.tavern_helper.scripts.find(x=>x.id===expected.script.id)?.enabled)add('TARGET_WRITER','狀態更新腳本未啟用。');
    const initial=validateTargetState(expected.definition,target.config.initialState);
    for(const t of tokenizeHtml(target.config.source).tokens)if(t.type==='open'&&t.name==='img'){
      const character=t.attrs.find(a=>a.name==='data-character-id')?.value;
      if(!targetAssetFor(expected.definition,character,initial))add('TARGET_ASSET','版型圖片沒有可交付的初始或預設素材。');
    }
    for(const c of Object.values(authoring.contract.characters))for(const v of c.variants)if(!authoring.assetManifest.assets.some(a=>a.assetId===v.assetId))add('TARGET_ASSET','視覺契約引用了未交付圖片。');
  }catch(e){add(e.code??'TARGET_INVALID',e.message);}
  // Scan actual target text, not the authoring sidecar. Never certify raw private binders.
  const strings=[];function scan(x,path){if(typeof x==='string')strings.push({s:x,path});else if(x&&typeof x==='object')for(const [k,v]of Object.entries(x))scan(v,path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'));}scan(card.data,'/data');
  for(const {s,path} of strings) {
    if(/\{\{sample(?:_label)?::/.test(s))add('TARGET_UNRESOLVED_SAMPLE','卡片仍含編輯器樣本標記。',{path});
    for(const m of s.matchAll(/<img\b[^>]*>/gi))if(!/\bsrc\s*=/.test(m[0])&&!/\bhidden\b/.test(m[0]))add('TARGET_IMAGE_SRC','圖片缺少可交付來源。',{path});
  }
  diagnostics.push(...checkGates(card,authoring));
  return {profile:TARGET_PROFILE,versions:TARGET_VERSIONS,ready:!diagnostics.length,runtimeVerified:false,assetDeploymentRequired:true,gating:{managedCount:authoring.gating?.entries?.length??0,coverage:'conditions only; final prompt injection is not simulated',runtimeVerified:false},diagnostics};
}
