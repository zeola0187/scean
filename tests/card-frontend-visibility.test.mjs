import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCardFrontend} from '../isolated/web/card-frontend.mjs';
function fixture(){
 const ids=new Map(),doc={createElement:()=>({style:{},hidden:false,events:{},set id(id){ids.set(id,this);},setAttribute(){},removeAttribute(){},append(){},after(){},remove(){},addEventListener(name,fn){this.events[name]=fn;}}),getElementById:id=>ids.get(id)};
 const chat=doc.createElement();chat.id='chat';
 return{ids,ui:mountCardFrontend({document:doc,setTimer:()=>1,clearTimer:()=>{}})};
}
test('a Run without frontend stays absent after matching history arrives or refreshes',()=>{
 const {ids,ui}=fixture(),run={runId:'synthetic-run',snapshot:{hash:'synthetic-snapshot'},version:1,head:null};
 ui.update(run);ui.history({runId:run.runId,snapshotHash:run.snapshot.hash,head:null});
 assert.equal(ids.get('card-frontend').hidden,true);
 ui.update({...run,version:2,head:'commit-1'});ui.history({runId:run.runId,snapshotHash:run.snapshot.hash,head:'commit-1'});
 assert.equal(ids.get('card-frontend').hidden,true);ui.dispose();
});
test('an unavailable frontend retains an honest fallback when matching history arrives',()=>{
 const {ids,ui}=fixture(),run={runId:'synthetic-run',snapshot:{hash:'synthetic-snapshot'},version:1,head:null,cardFrontend:{status:'unavailable',code:'FRONTEND_UNAVAILABLE'}};
 ui.update(run);ui.history({runId:run.runId,snapshotHash:run.snapshot.hash,head:null});
 assert.equal(ids.get('card-frontend').hidden,false);assert.equal(ids.get('card-frontend-frame').hidden,true);
 assert.match(ids.get('card-frontend-status').textContent,/FRONTEND_UNAVAILABLE/);ui.dispose();
});
