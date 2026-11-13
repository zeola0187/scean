import {clone,hash,json,safeId,SceanError} from './contracts.mjs';
import {validateBlueprint,validateBlueprintState} from './state-blueprint.mjs';
import {boundedConditionJSON,validateConditionExpression,evaluateCondition} from './condition-ast.mjs';
import {admitPublicBindings,publicBindingValues} from './public-state-bindings.mjs';
import {projectStoryState} from './state-operations.mjs';
const fail=code=>{throw new SceanError('DERIVED_'+code);},own=(v,k)=>Object.hasOwn(v??{},k);
const fields=(v,required,optional=[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!own(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('FIELDS');};
const label=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
/** Card-owned versioned rules, independent of HTML and absent on legacy cards. */
export function derivedFactsPackage(input,blueprint,characters=[]){
 if(input===undefined||input===null)return null;
 boundedConditionJSON(input,{prefix:'DERIVED',nodes:10000,depth:32});if(Buffer.byteLength(json(input))>100000)fail('SIZE');
 fields(input,['schemaVersion','id','version','bindings','facts'],['hash']);safeId(input.id);
 if(input.schemaVersion!==1||!Number.isSafeInteger(input.version)||input.version<1)fail('VERSION');
 const bp=validateBlueprint(blueprint,characters);if(!bp)fail('BLUEPRINT_REQUIRED');const types=admitPublicBindings(input.bindings,bp,'DERIVED');
 if(!Array.isArray(input.facts)||input.facts.length>64)fail('FACTS_LIMIT');const ids=new Set(),budget={n:0};
 for(const f of input.facts){fields(f,['id','name','description','provideToWriter','expression']);safeId(f.id);if(ids.has(f.id))fail('DUPLICATE_ID');ids.add(f.id);
  if(!label(f.name,300)||!label(f.description,2000)||typeof f.provideToWriter!=='boolean')fail('METADATA');
  if(validateConditionExpression(f.expression,types,budget,0,'DERIVED')!=='boolean')fail('EXPRESSION_TYPE');
 }
 const copy=clone(input);delete copy.hash;const digest=hash(copy);if(input.hash&&input.hash!==digest)fail('HASH_MISMATCH');return {...copy,hash:digest};
}
/** Pure projection of committed context, not an additional State or memory writer. */
export function projectDerivedFacts(run,{writerOnly=false,temporalCandidate}={}){
 const s=run.snapshot,config=derivedFactsPackage(s.derivedFacts,s.stateBlueprint,s.characters);if(!config)return null;
 validateBlueprintState(s.stateBlueprint,run.state,s.characters);const values=publicBindingValues(config.bindings,s.stateBlueprint,projectStoryState(run));
 const facts=config.facts.filter(f=>!writerOnly||f.provideToWriter).map(f=>{
  const result=evaluateCondition(f.expression,values);return {id:f.id,name:f.name,description:f.description,provideToWriter:f.provideToWriter,...result,ruleHash:hash(f)};
 });
 return {schemaVersion:1,source:temporalCandidate?'host-temporal-candidate':'host-committed-state',...(temporalCandidate?{candidateRef:temporalCandidate}:{}),runId:run.runId,cardId:s.cardId,revision:s.revision,snapshotHash:s.hash,canonical:{version:run.version,head:run.head??run.turns?.at(-1)?.commitId??null},config:{id:config.id,version:config.version,hash:config.hash},semantics:temporalCandidate?'Host-settled time/event candidate only; no prediction of prose outcomes or automatic NPC knowledge.':'World facts for writing context; not automatic NPC knowledge or character memory. Unknown/unavailable is not true. No same-turn prediction.',facts};
}
