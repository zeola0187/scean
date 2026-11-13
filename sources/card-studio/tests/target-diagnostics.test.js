import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTargetConfig} from '../cardstudio-bundle/lib/target-profile.js';
import {createVisualContract} from '../cardstudio-bundle/lib/visual-state.js';
const contract=createVisualContract({characters:{guide:{}}});
const config=source=>({profile:'tauritavern-helper-ejs-v1',namespace:'test_state',fields:{score:{type:'number',min:0,max:10}},initialState:{values:{score:0}},source});
test('CSS configure errors preserve inline attribute and nested stylesheet source positions',()=>{
 for(const source of ['<section title="position:fixed" style="color:red;position:fixed">Plain</section>','<style>/*keep offset*/ @media (max-width:390px){.safe{color:red;position:fixed}}</style><section>Plain</section>']){
  let error;try{validateTargetConfig(config(source),contract);}catch(e){error=e;}assert.equal(error.code,'TARGET_SOURCE');assert.equal(error.details.path,'/target/config/source');assert.ok(error.details.diagnostics.length);
  const d=error.details.diagnostics.find(d=>d.details?.property==='position');assert.ok(d);assert.equal(source.slice(d.sourceOffset,d.sourceOffset+8),'position');assert.match(error.details.nextAction.instruction,/Preserve valid CSS/);
 }
});
test('missing visual contract gives a precise authoring locator and bounded next action',()=>{
 assert.throws(()=>validateTargetConfig(config('<p>Plain</p>')),(e)=>e.code==='VISUAL_CONTRACT'&&e.details.path==='/authoring/contract'&&e.details.nextAction.tool==='cardstudio_scean_visual_contract');
});
