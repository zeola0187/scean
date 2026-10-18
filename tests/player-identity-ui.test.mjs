import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlayerIdentity} from '../isolated/web/player-identity-ui.mjs';
function fixture(request){
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,events:{},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};let next=0;const bound=[];
  const ui=mountPlayerIdentity({request,document:{getElementById:element},makeId:()=>`synthetic-operation-${++next}`,onBound:async id=>bound.push(id)});
  return {ui,element,bound,click:()=>element('player-bind').events.click()};
}
const run=(id='legacy',version=1)=>({runId:id,version,head:'synthetic-head'});
test('lost adoption reply retains one exact request; changing page cannot publish an old response into its new Run',async()=>{
  const calls=[];let first=true;const f=fixture(async(action,payload)=>{calls.push({action,payload:structuredClone(payload)});if(first){first=false;throw Error('lost reply');}return {status:'committed'};});
  f.ui.update(run());f.element('player-bind-name').value='合成旅人';f.element('player-bind-name').events.input();await f.click();
  assert.equal(f.element('player-bind-name').disabled,true);assert.equal(f.element('player-bind').disabled,false);await f.click();assert.deepEqual(calls[0],calls[1]);assert.deepEqual(f.bound,['legacy']);
  let resolve;const delayed=fixture(()=>new Promise(r=>resolve=r));delayed.ui.update(run());delayed.element('player-bind-name').value='A';delayed.element('player-bind-name').events.input();const pending=delayed.click();delayed.ui.update(run('different'));resolve({status:'committed'});await pending;assert.deepEqual(delayed.bound,[]);assert.equal(delayed.element('player-bind-name').value,'');
});
test('active generation disables binding; authoritative named Run removes the once-only control',()=>{
  const f=fixture(()=>assert.fail('No request expected'));f.ui.update(run(),true);f.element('player-bind-name').value='A';f.element('player-bind-name').events.input();assert.equal(f.element('player-bind').disabled,true);
  f.ui.update({...run(),playerIdentity:{schemaVersion:1,name:'A',boundVersion:2,afterTurn:1}});assert.equal(f.element('player-bind-form').hidden,true);assert.equal(f.element('player-identity-status').textContent,'本局主角：A');
});
