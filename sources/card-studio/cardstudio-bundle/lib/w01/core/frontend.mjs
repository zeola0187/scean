import {boundedConditionJSON,validateConditionExpression} from './condition-ast.mjs';
import {admitPublicBindings,publicBindingValues} from './public-state-bindings.mjs';
import {derivedFactsPackage,projectDerivedFacts} from './derived-facts.mjs';
import {hash,json,clone,SceanError,safeId} from './contracts.mjs';
import {validateBlueprint,validateBlueprintState,materializeInitialState,publicBlueprintState} from './state-blueprint.mjs';
import {tokenizeHtml} from '../authoring/frontend-html.mjs';
import {sanitizeCss} from '../authoring/frontend-css.mjs';
export const FRONTEND_PROFILE = 'scean-html-bindings-v1';
const fail=(code,details)=>{throw Object.assign(new SceanError(code),details?{details}:{});};
const own=(v,k)=>Object.hasOwn(v??{},k);
const fields=(v,required,optional=[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!own(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('FRONTEND_FIELDS');};
const key=v=>json([v.scope,v.characterId??null,v.category,v.key]);
const tags=new Set('section article div span p h1 h2 h3 h4 h5 h6 header footer main aside nav ul ol li dl dt dd strong em small b i code pre blockquote br hr details summary progress table thead tbody tr th td caption'.split(' '));
const attrs=new Set(['id','class','title','role','aria-label','aria-live','open','hidden','max','data-scean-text','data-scean-state','data-scean-when','data-scean-progress']);
const forbidden=new Set(['__proto__','constructor','prototype']);
/** Admission is repeated at save, handoff, Run creation and import. Never execute authored code. */
export function validateFrontend(input,blueprint,characters=[],derivedFacts) {
  if(input===undefined||input===null)return null;
  boundedConditionJSON(input);if(Buffer.byteLength(json(input))>200000)fail('FRONTEND_SIZE');
  fields(input,['schemaVersion','id','runtime','html','css','bindings','conditions','capabilities'],['hash','derivedBindings']);safeId(input.id);
  fields(input.runtime,['profile','apiMajor']);if(input.schemaVersion!==1||input.runtime.profile!==FRONTEND_PROFILE||input.runtime.apiMajor!==1)fail('FRONTEND_RUNTIME_UNSUPPORTED');
  fields(input.capabilities,['network','worldActions','derivedDisplays']);if(input.capabilities.network!=='none'||!Array.isArray(input.capabilities.worldActions)||input.capabilities.worldActions.length||!Array.isArray(input.capabilities.derivedDisplays)||input.capabilities.derivedDisplays.length)fail('FRONTEND_CAPABILITY_UNSUPPORTED');
  const bp=validateBlueprint(blueprint,characters);if(!bp)fail('FRONTEND_BLUEPRINT_REQUIRED');
  const types=admitPublicBindings(input.bindings,bp),diagnostics=[];
  const alias=v=>{safeId(v);if(forbidden.has(v)||types.has(v))fail('FRONTEND_ALIAS');};
  if(input.derivedBindings!==undefined){
    if(!Array.isArray(input.derivedBindings)||input.derivedBindings.length>64)fail('FRONTEND_BINDINGS_LIMIT');
    const rules=derivedFactsPackage(derivedFacts,bp,characters);if(!rules)fail('FRONTEND_DERIVED_REQUIRED');
    for(const b of input.derivedBindings){fields(b,['alias','factId']);alias(b.alias);if(!rules.facts.some(f=>f.id===b.factId))fail('FRONTEND_DERIVED_MISSING');types.set(b.alias,'boolean');}
  }
  if(!input.conditions||Array.isArray(input.conditions)||typeof input.conditions!=='object'||Object.keys(input.conditions).length>64)fail('FRONTEND_CONDITIONS_LIMIT');
  const sourceTypes=new Map(types),budget={n:0};
  for(const [name,e]of Object.entries(input.conditions)){alias(name);validateConditionExpression(e,sourceTypes,budget);types.set(name,'boolean');}
  if(typeof input.html!=='string'||input.html.length>96000||typeof input.css!=='string'||input.css.length>64000)fail('FRONTEND_ASSET_LIMIT');
  const parsed=tokenizeHtml(input.html);if(!parsed.valid)fail('FRONTEND_HTML_INVALID');
  const tree=[],stack=[{children:tree}],ids=new Set();let count=0;
  for(const t of parsed.tokens){
    if(++count>2000||stack.length>32)fail('FRONTEND_DOM_LIMIT');
    if(t.type==='comment')continue;
    if(t.type==='text'){stack.at(-1).children.push({text:t.value});continue;}
    if(t.type==='close'){if(stack.length<2||stack.at(-1).tag!==t.name)fail('FRONTEND_HTML_NESTING');stack.pop();continue;}
    if(t.type!=='open'||!tags.has(t.name))fail('FRONTEND_HTML_UNSUPPORTED');
    const a={};for(const attr of t.attrs){
      if(!attrs.has(attr.name)||attr.value.length>500||/[&<>\u0000-\u001f]/.test(attr.value))fail('FRONTEND_ATTRIBUTE_UNSUPPORTED');
      if(['id','class'].includes(attr.name)&&!/^[a-zA-Z0-9_ -]+$/.test(attr.value))fail('FRONTEND_ATTRIBUTE_VALUE');
      if(attr.name==='id'){if(ids.has(attr.value))fail('FRONTEND_DUPLICATE_ID');ids.add(attr.value);}
      if(attr.name.startsWith('data-scean-')){
        if(!types.has(attr.value))fail('FRONTEND_REFERENCE_MISSING',{alias:attr.value});
        const expected=attr.name.endsWith('progress')?'number':attr.name.endsWith('text')?null:'boolean';
        if(expected&&types.get(attr.value)!==expected)fail('FRONTEND_OUTPUT_TYPE');
        if(attr.name.endsWith('progress')&&t.name!=='progress')fail('FRONTEND_OUTPUT_TYPE');
      }
      if(attr.name==='max'&&(t.name!=='progress'||!Number.isFinite(Number(attr.value))||Number(attr.value)<=0))fail('FRONTEND_ATTRIBUTE_VALUE');
      a[attr.name]=attr.value;
    }
    const n={tag:t.name,attrs:a,children:[]};stack.at(-1).children.push(n);if(!t.selfClosing)stack.push(n);
  }
  if(stack.length!==1)fail('FRONTEND_HTML_NESTING');
  const safeCss=sanitizeCss(input.css,diagnostics);
  if(diagnostics.length)fail('FRONTEND_CSS_UNSUPPORTED');
  const copy=clone(input);delete copy.hash;const digest=hash(copy);if(input.hash&&input.hash!==digest)fail('FRONTEND_HASH_MISMATCH');
  return {...copy,hash:digest,tree,safeCss};
}
export function frontendPackage(input,blueprint,characters,derivedFacts){const v=validateFrontend(input,blueprint,characters,derivedFacts);if(!v)return null;const {tree,safeCss,...saved}=v;return saved;}
/** Host chooses the Run; card HTML receives no callable RPC or credentials. */
export function frontendProjection(run){
  const frontend=validateFrontend(run.snapshot.frontend,run.snapshot.stateBlueprint,run.snapshot.characters,run.snapshot.derivedFacts);if(!frontend)return null;
  validateBlueprintState(run.snapshot.stateBlueprint,run.state,run.snapshot.characters);
  const values=publicBindingValues(frontend.bindings,run.snapshot.stateBlueprint,run.state),derived=frontend.derivedBindings?.length?projectDerivedFacts(run):null;
  for(const b of frontend.derivedBindings??[]){const f=derived.facts.find(f=>f.id===b.factId);values[b.alias]={status:f.status,type:'boolean',...(f.status==='known'?{value:f.value}:{}),provenance:{factId:f.id,ruleHash:f.ruleHash,config:derived.config,runId:derived.runId,snapshotHash:derived.snapshotHash,canonical:derived.canonical}};}
  return {projectionApiVersion:1,runId:run.runId,cardId:run.snapshot.cardId,snapshotHash:run.snapshot.hash,frontendHash:frontend.hash,canonical:{version:run.version,head:run.head??run.turns?.at(-1)?.commitId??null},freshness:'current',values};
}
export function frontendPreview(input,blueprint,initialState,characters=[],derivedFacts){
  const frontend=validateFrontend(input,blueprint,characters,derivedFacts),{state}=materializeInitialState(blueprint,initialState,characters);
  const run={runId:'authoring-preview',version:0,snapshot:{cardId:'authoring-preview',hash:'preview',derivedFacts,frontend:frontendPackage(input,blueprint,characters,derivedFacts),stateBlueprint:blueprint,characters},state};
  return {frontend,projection:frontendProjection(run),source:'authoring-initial-state-not-runtime'};
}
