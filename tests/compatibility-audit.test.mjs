import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
import {buildSavedSnapshot} from '../studio/cardstudio-bundle/lib/scean-integration.js';
import {hash} from '../core/contracts.mjs';
const card=()=>({data:{first_mes:'Synthetic station.',extensions:{scean:{characters:[{id:'engineer',name:'Engineer',description:'Synthetic engineer.'}]}},character_book:{entries:[{id:1,keys:['lamp'],content:'Synthetic lamp.',enabled:true,extensions:{}}]}}});
function input(c){const saved={id:'synthetic-audit',type:'card',revision:0,sha256:hash(c),card:c};return {snapshot:buildSavedSnapshot(saved),saved:{id:saved.id,revision:0,sha256:saved.sha256},entryIds:['id:1']};}
test('audit is deterministic, input immutable, misses without expectations never become FAIL',()=>{
  const i=input(card()),before=structuredClone(i),a=auditSavedSnapshot(i);assert.deepEqual(a,auditSavedSnapshot(i));assert.deepEqual(i,before);assert.equal(a.counts.FAIL,0);assert.equal(a.items.find(r=>r.itemID==='A.entry.worldbook:0:entry:0').status,'NOT_TESTED');
});
test('malformed saved Blueprint and reference assertions report violations without aborting other domains',()=>{
  for(const refs of [null,'invalid',[null],[{scope:'world',category:'facts',key:'missing',type:'string',interface:'publicBlueprintState'}]]){
    const c=card();c.data.extensions.scean.stateBlueprint={variables:[null]};c.data.extensions.scean.auditFrontendReferences=refs;
    const r=auditSavedSnapshot(input(c));assert.equal(r.items.find(i=>i.itemID==='B.schema').status,'FAIL');assert(r.items.some(i=>i.itemID==='formal-play'));assert(r.items.some(i=>i.itemID.startsWith('A.entry.')));
  }
});
test('constraint deletions and extension relaxation are mechanical WARN, never creative FAIL',()=>{
  const c=card();c.data.extensions.scean.stateBlueprint={schemaVersion:1,id:'bp',version:1,extensionPolicy:'deny',variables:[{key:'days',displayName:'Days',scope:'world',category:'time',type:'number',visibility:'public',min:0,max:30}]};
  const old=input(c),current=structuredClone(c);current.data.extensions.scean.stateBlueprint.extensionPolicy='allow';current.data.extensions.scean.stateBlueprint.variables=[];const i=input(current);i.saved.revision=1;i.baseline=old;
  const r=auditSavedSnapshot(i);assert.equal(r.items.find(i=>i.itemID==='B.constraint-diff').status,'WARN');assert.equal(r.counts.FAIL,0);
});
test('runtime packaging retains audit implementation and Skill, without copying other authoring inputs',async()=>{
  const suite=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert(suite.files.includes('packages'));
  const pkg=JSON.parse(await readFile(new URL('../packages/scean/package.json',import.meta.url),'utf8'));
  assert(pkg.files.includes('authoring/compatibility-audit.mjs'));assert(pkg.files.includes('authoring/skills/scean-compatibility-audit'));
  const source=await readFile(new URL('../scripts/package-player-ui.mjs',import.meta.url),'utf8');assert(source.includes("'authoring/compatibility-audit.mjs'"));assert(source.includes("'authoring/skills/scean-compatibility-audit'"));
});
