import test from 'node:test';import assert from 'node:assert/strict';
import {mountProseStyle} from '../isolated/web/prose-style-ui.mjs';
const tick=()=>new Promise(setImmediate);
function fixture(request,{confirm=true}={}){
 const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',events:{},addEventListener(k,f){this.events[k]=f;},focus(){}});return nodes.get(id);};
 let next=0;const ui=mountProseStyle({request,document:{getElementById:element},makeId:()=>String(++next),confirmDiscard:()=>confirm});
 const edit=text=>{element('prose-style-input').value=text;element('prose-style-input').events.input();};
 return {ui,element,edit,save:()=>element('prose-style-form').events.submit({preventDefault(){}}),click:id=>element(id).events.click()};
}
test('free text is preserved; cancel/clear remain local until explicit save',async()=>{
 const calls=[],f=fixture(async(action,args)=>{calls.push({action,args});return action==='proseStyle'?{revision:2,text:'saved'}:{revision:3,text:args.text};});
 f.ui.select('one');await tick();f.edit('arbitrary\n自由文風');assert.equal(f.element('prose-style-save').disabled,false);f.click('prose-style-cancel');assert.equal(f.element('prose-style-input').value,'saved');f.click('prose-style-clear');assert.equal(calls.length,1);await f.save();assert.equal(calls[1].args.text,'');assert.equal(calls[1].args.expectedRevision,2);assert.equal(f.element('prose-style-save').disabled,true);
});
test('lost reply disables another save, queries original operation, and confirms saved revision',async()=>{
 let actual={revision:0,text:null};const calls=[],f=fixture(async(action,args)=>{calls.push({action,args});if(action==='proseStyle')return actual;actual={revision:1,text:args.text,operationId:args.operationId};throw Object.assign(Error('lost'),{code:'CONNECTION_UNKNOWN'});});
 f.ui.select('one');await tick();f.edit('new');await f.save();assert.equal(f.element('prose-style-save').disabled,true);assert.equal(f.element('prose-style-input').disabled,true);f.click('prose-style-reload');await tick();assert.equal(f.element('prose-style-input').value,'new');assert.match(f.element('prose-style-status').textContent,/已確認保存/);assert.equal(calls.filter(x=>x.action==='proseStyleSave').length,1);
});
test('revision conflict retains draft and never silently rebases it over newer text',async()=>{
 const f=fixture(async(action)=>{if(action==='proseStyle')return {revision:1,text:'server'};throw Object.assign(Error('conflict'),{code:'VERSION_CONFLICT'});},{confirm:false});
 f.ui.select('one');await tick();f.edit('local');await f.save();assert.equal(f.element('prose-style-input').value,'local');assert.equal(f.element('prose-style-save').disabled,true);f.click('prose-style-reload');await tick();assert.equal(f.element('prose-style-input').value,'local');
});
test('late settings read or save cannot contaminate another selected Run',async()=>{
 let release;const f=fixture(async(action,args)=>args.runId==='one'?new Promise(r=>release=r):{revision:0,text:null});f.ui.select('one');f.ui.select('two');release({revision:8,text:'private previous run'});await tick();assert.equal(f.element('prose-style-input').value,'');assert(!f.element('prose-style-status').textContent.includes('8'));
});
test('unknown outcome with intervening revision preserves draft and requires explicit reload',async()=>{
 let reads=0;const f=fixture(async(action)=>{if(action==='proseStyle')return ++reads===1?{revision:0,text:null}:{revision:2,text:'other'};throw Object.assign(Error('unknown'),{code:'PROSE_STYLE_SAVE_UNKNOWN'});});f.ui.select('one');await tick();f.edit('local');await f.save();f.click('prose-style-reload');await tick();assert.equal(f.element('prose-style-input').value,'local');assert.equal(f.element('prose-style-save').disabled,true);assert.match(f.element('prose-style-status').textContent,/其他視窗/);
});
test('unconfirmed non-publication keeps original draft and permits a fresh save after readback',async()=>{
 const f=fixture(async(action)=>{if(action==='proseStyle')return {revision:0,text:null};throw Object.assign(Error('unknown'),{code:'PROSE_STYLE_SAVE_UNKNOWN'});});f.ui.select('one');await tick();f.edit('local');await f.save();f.click('prose-style-reload');await tick();assert.equal(f.element('prose-style-input').value,'local');assert.equal(f.element('prose-style-save').disabled,false);
});
