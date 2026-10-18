import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {hash,validateRoster} from '../../core/contracts.mjs';
import {buildSavedSnapshot} from '../../studio/cardstudio-bundle/lib/scean-integration.js';
import {normalizeStudioHandoffSnapshot} from '../../plugin/studio-handoff.mjs';
import {materializeInitialState} from '../../core/state-blueprint.mjs';
import {publicSources} from '../../core/engine.mjs';
import {publicStateForModel} from '../../core/memory-policy.mjs';
const manifest=JSON.parse(await readFile(new URL('../contracts/plan-v1-capabilities.json',import.meta.url),'utf8'));
const domains=['characters','worldbook','variables','prompt','scripts','frontend','hostRules'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
export function validatePlan(plan,card,source){
 if(plan?.schemaVersion!==1||plan.runtimeCommit!==manifest.runtimeCommit||!['ready','blocked'].includes(plan.status))fail('AUTHORING_VERSION');
 if(!source||hash(source)!==plan.sourceHash)fail('AUTHORING_SOURCE_DRIFT');
 if(!Array.isArray(plan.inventory)||plan.inventory.length!==domains.length||new Set(plan.inventory.map(x=>x.domain)).size!==domains.length)fail('AUTHORING_COVERAGE');
 for(const d of domains){const row=plan.inventory.find(x=>x.domain===d);if(!row||row.sourcePointer!==`/${d}`||!Object.hasOwn(source,d)||hash(source[d])!==row.hash||!['complete','absent'].includes(row.coverage)||(row.coverage==='absent')!==(source[d]===null))fail('AUTHORING_COVERAGE');}
 if(!Array.isArray(plan.mechanisms)||!plan.mechanisms.length||!Array.isArray(plan.decisions))fail('AUTHORING_MAPPING');
 const ids=new Set(),caps=new Map(manifest.capabilities.map(c=>[c.id,c]));
 for(const m of plan.mechanisms){
  if(!nonempty(m.id)||ids.has(m.id)||!domains.includes(m.sourceDomain)||!nonempty(m.intent)||!nonempty(m.responsibility)||!nonempty(m.dataPath)||!Array.isArray(m.tests)||!m.tests.length||!m.tests.every(nonempty))fail('AUTHORING_MAPPING');ids.add(m.id);
  const c=caps.get(m.capability);if(!c||m.classification!==c.classification)fail('AUTHORING_FALSE_CAPABILITY');
  if(['script','formula','dice'].includes(m.implementation)&&m.classification==='runtime_executable')fail('AUTHORING_SCRIPT_NOT_HOST');
  if(['requires_host_ui','author_decision'].includes(m.classification)&&plan.status==='ready'){
   const decision=plan.decisions.find(d=>d.id===m.decisionId);
   if(!decision||decision.status!=='author-approved'||!nonempty(decision.choice)||!nonempty(decision.impact)||!nonempty(decision.evidence))fail('AUTHORING_DECISION_REQUIRED');
   if(m.classification==='requires_host_ui'&&!['deferred','explicit-accepted-change'].includes(m.disposition))fail('AUTHORING_UNIMPLEMENTED');
  }
 }
 if(plan.status==='ready'&&plan.decisions.some(d=>d.status!=='author-approved'))fail('AUTHORING_DECISION_REQUIRED');
 validateRoster(card?.data?.extensions?.scean?.characters);
 const saved={id:'authoring-validation',revision:0,type:'card',sha256:hash(card),card};
 const snapshot=normalizeStudioHandoffSnapshot(buildSavedSnapshot(saved));
 const initialized=materializeInitialState(snapshot.stateBlueprint,snapshot.initialState,snapshot.characters);
 // Explicit classifications only; this is not a semantic secrecy classifier.
 const visible=JSON.stringify({sources:publicSources({card:snapshot.card,worldbook:snapshot.worldbook}),state:publicStateForModel(initialized.state)});
 for(const secret of plan.classifiedPrivateLiterals??[]){if(!nonempty(secret)||secret.length<8)fail('AUTHORING_PRIVATE_MARKER');if(visible.includes(secret))fail('AUTHORING_PUBLIC_LEAK');}
 return {status:plan.status,skillVersion:manifest.skillVersion,layer:'L1 structural only; not semantic authorship',snapshotHash:snapshot.hash,mechanisms:plan.mechanisms.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [p,c]=process.argv.slice(2),plan=JSON.parse(await readFile(p,'utf8')),card=JSON.parse(await readFile(c,'utf8'));if(!plan.sourceFile||plan.sourceFile.includes('/')||plan.sourceFile.includes('\\'))fail('AUTHORING_SOURCE_PATH');const source=JSON.parse(await readFile(resolve(dirname(p),plan.sourceFile),'utf8'));console.log(JSON.stringify(validatePlan(plan,card,source),null,2));}
 catch(e){console.error(JSON.stringify({status:'FAIL',code:e.code??e.name}));process.exitCode=1;}
}
