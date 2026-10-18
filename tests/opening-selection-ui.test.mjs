import test from 'node:test';
import assert from 'node:assert/strict';
import {mountOpeningSelection} from '../isolated/web/opening-selection-ui.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
function fixture(request){
 const elements=new Map(),created=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,children:[],events:{},replaceChildren(){this.children=[];},append(child){this.children.push(child);},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
 const document={getElementById:element,createElement:()=>element('option-'+elements.size)};
 const ui=mountOpeningSelection({enabled:true,document,request,onCreated:async r=>created.push(r),openStudio:()=>created.push('studio')});
 return {ui,element,created,click:id=>element(id).events.click()};
}
const offer=()=>({offerId:'offer',cardId:'card',revision:7,snapshotHash:'bound-hash',options:[{index:0,title:'主開場',text:'<script>plain source only</script>'},{index:2,title:'替代開場 2',text:'Alternative scene.'}]});
test('shared Desktop/Web selector previews raw text and sends the original saved index and version binding',async()=>{
 const calls=[],f=fixture(async(a,p)=>{calls.push([a,p]);return a==='openingOffer'?offer():{runId:'new-run'};});
 await f.ui.refresh();assert.equal(f.element('opening-selection').hidden,false);
 assert.equal(f.element('saved-opening-preview').textContent,'<script>plain source only</script>');
 f.element('opening-choice').value='2';f.element('opening-choice').events.change();
 assert.equal(f.element('saved-opening-preview').textContent,'Alternative scene.');
 await f.click('opening-start');
 assert.deepEqual(calls[1],['openingStart',{offerId:'offer',cardId:'card',revision:7,snapshotHash:'bound-hash',openingIndex:2}]);
 assert.deepEqual(f.created,[{runId:'new-run'}]);assert.equal(f.element('opening-selection').hidden,true);
});
test('cancel does not start or select a Run, and a lost start reply retains the same bound choice for explicit retry',async()=>{
 const calls=[];let fail=true;
 const f=fixture(async(a,p)=>{calls.push([a,p]);if(a==='openingOffer')return offer();if(a==='openingStart'&&fail){fail=false;throw Error('Temporary connection failure');}return a==='openingCancel'?{cancelled:true}:{runId:'same-run'};});
 await f.ui.refresh();await f.click('opening-dismiss');assert.equal(calls.filter(x=>x[0]==='openingStart').length,0);assert.deepEqual(f.created,[]);
 await f.ui.refresh();f.element('opening-choice').value='2';await f.click('opening-start');
 assert.equal(f.element('opening-choice').value,'2');assert.equal(f.element('opening-start').disabled,false);
 await f.click('opening-start');
 const starts=calls.filter(x=>x[0]==='openingStart');assert.deepEqual(starts[0],starts[1]);assert.deepEqual(f.created,[{runId:'same-run'}]);
});
test('stale revision disables the old choice and removes its preview; returning to Studio never starts a Run',async()=>{
 const f=fixture(async a=>{if(a==='openingOffer')return offer();throw Object.assign(Error('Saved revision changed'),{code:'OPENING_STALE'});});
 await f.ui.refresh();await f.click('opening-start');
 assert.equal(f.element('opening-start').disabled,true);assert.equal(f.element('saved-opening-preview').textContent,'');
 assert.equal(f.element('opening-error').textContent,'Saved revision changed');await f.click('opening-return');assert.deepEqual(f.created,['studio']);
});
test('navigation discards delayed offer/start responses and double clicks submit only once',async()=>{
 let resolve;const calls=[];
 const f=fixture(async(a,p)=>{calls.push(a);if(a==='openingOffer')return offer();return new Promise(r=>resolve=r);});
 await f.ui.refresh();const pending=f.click('opening-start');await f.click('opening-start');
 assert.equal(calls.filter(a=>a==='openingStart').length,1);f.ui.reset();resolve({runId:'previous-context-run'});await pending;
 assert.deepEqual(f.created,[]);assert.equal(f.element('opening-selection').hidden,true);
 const delayed=fixture(()=>new Promise(r=>resolve=r)),refresh=delayed.ui.refresh();delayed.ui.reset();resolve(offer());await refresh;
 assert.equal(delayed.element('opening-selection').hidden,true);
});
test('native adapter stamps authenticated Session/card context for all opening operations on Desktop and Web',async()=>{
 for(const surface of ['Desktop','Web']){
  const calls=[],scope={provider:'@local/dsh-card-studio-scean-test',cardId:'A',authoringSessionId:'session',generation:'g',savedRevision:2,savedSha256:'saved'};
  const bridge=createNativeBridge({call:async r=>{calls.push(r);return r.action==='context'?{cardScope:scope}:{};},getSessionId:()=>surface+'-session',selectPanel(){}});
  await bridge.request('native.context');
  for(const action of ['openingPrepare','openingOffer','openingStart','openingCancel']){await bridge.request(action,{offerId:'bound'});assert.equal(calls.at(-1).sessionId,surface+'-session');assert.deepEqual(calls.at(-1).cardScope,scope);}
  await bridge.dispose();
 }
});
test('stage new-story button is explicit; switching existing Runs discards a delayed preparation response',async()=>{
 let resolve;const calls=[],f=fixture(async(a,p)=>{calls.push([a,p]);return new Promise(r=>resolve=r);});
 f.ui.setRun({runId:'existing-A'});assert.deepEqual(calls,[]);
 const pending=f.click('opening-new');f.ui.setRun({runId:'existing-B'});resolve({runId:'new-from-A'});await pending;
 assert.deepEqual(calls,[['openingPrepare',{runId:'existing-A'}]]);assert.deepEqual(f.created,[]);
 assert.equal(f.element('opening-selection').hidden,true);assert.equal(f.element('opening-new').disabled,false);
});
