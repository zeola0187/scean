import test from 'node:test';
import assert from 'node:assert/strict';
import {installOutputDefaultGuard,methodHash} from './guard.mjs';
function rig({provider='openrouter',api='openai-completions',configured=false,explicit,prior,hookThrow=false}={}){
 const model={provider,id:'test',api};
 const adapter={streamWithSnapshot(options,snapshot){return snapshot.models.streamSimple(model,{messages:[]},{onPayload:prior});}};
 let payload;
 const snapshot={profiles:new Map([['openrouter',{configuredMaxTokens:new Map(configured?[['test',2000]]:[])}]]),models:{marker:1,async streamSimple(m,c,o){const p={model:'test',max_tokens:10000,max_completion_tokens:10000,stream:true};payload=await o.onPayload?.(p,m)??p;return payload;}}};
 const original=adapter.streamWithSnapshot; const h=installOutputDefaultGuard(adapter,{expectedMethodHash:methodHash(adapter.streamWithSnapshot),onOmission(){if(hookThrow)throw Error('observer');}});
 return {adapter,snapshot,h,original,call:()=>adapter.streamWithSnapshot({provider,model:'test',...(explicit===undefined?{}:{maxTokens:explicit})},snapshot)};
}
test('omits both SDK defaults only on implicit OpenRouter chat completion',async()=>{const r=rig();assert.deepEqual(await r.call(),{model:'test',stream:true});assert.equal(r.snapshot.models.marker,1);});
for(const c of [{provider:'openai'},{api:'openai-responses'},{configured:true},{explicit:700}])test('preserves intentional/non-target '+JSON.stringify(c),async()=>{const r=rig(c);assert.equal((await r.call()).max_tokens,10000);});
test('prior payload transformation is chained and unrelated fields preserved',async()=>{const r=rig({prior:p=>({...p,temperature:.3})});assert.equal((await r.call()).temperature,.3);});
test('prior undefined payload returns default fields',async()=>{const r=rig({prior:()=>undefined});assert.equal((await r.call()).max_tokens,undefined);});
test('observer exception does not break generation',async()=>{await rig({hookThrow:true}).call();});
test('unknown SDK method fails closed and is not modified',()=>{const a={streamWithSnapshot(){}};const f=a.streamWithSnapshot;const h=installOutputDefaultGuard(a,{expectedMethodHash:'wrong'});assert.equal(h.active,false);assert.equal(a.streamWithSnapshot,f);});
test('dispose restores original own method',()=>{const r=rig();r.h.dispose();assert.equal(r.adapter.streamWithSnapshot,r.original);});
test('dispose does not overwrite a later independent replacement',()=>{const r=rig(),other=()=>{};r.adapter.streamWithSnapshot=other;r.h.dispose();assert.equal(r.adapter.streamWithSnapshot,other);});
