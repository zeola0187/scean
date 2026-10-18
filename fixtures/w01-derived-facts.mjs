// Independent synthetic predicates; no original private card's unknown rules.
import {w01Fixture} from './w01-frontends.mjs';
import {derivedFactsPackage} from '../core/derived-facts.mjs';
import {frontendPackage} from '../core/frontend.mjs';
export function derivedFixture({frontend=true,writer=true}={}){
 const f=w01Fixture(),rules=derivedFactsPackage({schemaVersion:1,id:'synthetic-public-observations',version:1,bindings:structuredClone(f.frontend.bindings),facts:[
  {id:'four-checks-permit',name:'四條件合成安全指示',description:'合成條件 check_1 到 check_4 全部為 true 才表示本次合成安全條件成立；未知不等於成立。沒有使用原私人卡的未確認條件。',provideToWriter:writer,expression:structuredClone(f.frontend.conditions.safe)},
  {id:'display-only-inverse',name:'第一項合成條件未成立',description:'只提供卡片顯示；沒有要求傳給 Writer。',provideToWriter:false,expression:{op:'not',args:[{ref:'check_1'}]}},
 ]},f.bp);
 f.snapshot.derivedFacts=rules;f.card.data.extensions.scean.derivedFacts=rules;
 if(frontend){const p=structuredClone(f.frontend);delete p.hash;p.conditions={};p.derivedBindings=[{alias:'safe',factId:'four-checks-permit'}];f.frontend=frontendPackage(p,f.bp,[],rules);f.snapshot.frontend=f.frontend;f.card.data.extensions.scean.frontend=f.frontend;}
 else{delete f.snapshot.frontend;delete f.card.data.extensions.scean.frontend;f.frontend=null;}
 return {...f,rules};
}
