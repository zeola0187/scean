import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {sixHttp} from '../fixtures/player-six-http.mjs';
import {resolveSceanCardContext} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};

test('six-item actual isolated HTTP serves new modules behind Host/origin/CSRF fences',async t=>{
 const f=await sixHttp(t),s=f.server,boot=await(await fetch(s.origin+'/api/bootstrap')).json();assert.equal(boot.mode,'scripted');assert.equal(boot.csrfToken,s.token);assert.equal(f.calls.length,0);
 for(const name of ['history-sync.mjs','player-ideas-ui.mjs','player-readers-ui.mjs','presentation-panel-ui.mjs']){const response=await fetch(s.origin+'/'+name);assert.equal(response.status,200,name);assert.match(response.headers.get('Content-Type'),/javascript/);assert((await response.text()).length>30);}
 assert.equal((await f.call({action:'playerWorldbook',runId:'synthetic'},{'X-Scean-Token':'wrong'})).status,403);
 assert.equal((await f.call({action:'playerRecap',runId:'synthetic'},{Origin:'https://invalid.example'})).status,403);
 assert.equal((await fetch(s.origin+'/api/bootstrap',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>http.get(s.origin+'/api/bootstrap',{headers:{Host:'invalid.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(hostStatus,403);
 assert.equal((await fetch(s.origin+'/private-assets/synthetic/unlisted.json')).status,404);assert.equal(f.calls.length,0);
});

test('HTTP reader actions use fixed public source, preserve draft and all story bytes, and produce no models',async t=>{
 const f=await sixHttp(t),created=await f.importRun(),runId=created.runId;
 await f.ok({action:'draftSave',runId,viewerId:'reader-page',requestId:'saved-draft',input:'EXISTING_SYNTHETIC_DRAFT'});
 const before=await f.storyBytes(runId),run=await f.server.host.engine.store.read(runId),stamp={runId,expectedSnapshotHash:run.snapshot.hash,expectedHead:run.head};
 const world=await f.ok({action:'playerWorldbook',...stamp});assert.equal(world.entries.length,1);assert.equal(world.entries[0].title,'公開碼頭');assert(!JSON.stringify(world).includes('CANARY'));
 const detail=await f.ok({action:'playerWorldbook',...stamp,entryId:world.entries[0].id});assert.equal(detail.entry.content,'這是一座合成碼頭。');
 assert.equal((await f.ok({action:'playerWorldbook',...stamp,query:'PRIVATE_BOOK_CONTENT_CANARY'})).total,0);
 const recap=await f.ok({action:'playerRecap',...stamp});assert.equal(recap.status,'empty');assert.equal((await f.ok({action:'draftGet',runId,viewerId:'reader-page'})).input,'EXISTING_SYNTHETIC_DRAFT');assert.deepEqual(await f.storyBytes(runId),before);assert.equal(f.calls.length,0);
 assert.equal((await f.call({action:'playerWorldbook',...stamp,expectedHead:'other'})).error.code,'READER_SOURCE_CHANGED');
 assert.equal((await f.call({action:'playerRecap',...stamp,chapterId:'../../snapshot'})).error.code,'READER_QUERY_INVALID');
});

test('HTTP optional ideas make one generation, coalesce no extra work while busy, preserve draft and survive failure',async t=>{
 const f=await sixHttp(t),created=await f.importRun(),runId=created.runId;
 const result=await f.ok({action:'turn',runId,requestId:'first-http-turn',input:'我看看碼頭的公共儀表。'});assert.equal(result.status,'committed');assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','post_stat']);
 await f.ok({action:'draftSave',runId,viewerId:'ideas-page',requestId:'ideas-draft',input:'KEEP_THIS_DRAFT'});
 const view=await f.ok({action:'runView',runId}),before=await f.storyBytes(runId),began=deferred(),release=deferred();
 f.ideasHandler=async()=>{began.resolve();await release.promise;return{text:JSON.stringify({ideas:['玩家行動','角色自主','場景展開','世界自然運轉','意外與轉折'].map(category=>({category,text:'合成方向 '+category}))})};};
 const args={action:'playerIdeas',runId,expectedHead:view.head,expectedVersion:view.version,requestId:'ideas-explicit'},first=f.call(args);await began.promise;
 const busy=await f.call({...args,requestId:'ideas-concurrent'});assert.equal(busy.error.code,'IDEAS_BUSY');release.resolve();const received=await first;assert.equal(received.ok,true);assert.equal(received.value.ideas.length,5);assert.equal(f.calls.filter(c=>c.stage==='ideas').length,1);assert.equal(received.value.usage.totalTokens,43);
 const call=f.calls.find(c=>c.stage==='ideas');assert.deepEqual(call.tools,[]);assert.deepEqual(Object.keys(call.input).sort(),['directions','turns']);assert(!JSON.stringify(call.input).includes('PRIVATE'));assert.deepEqual(await f.storyBytes(runId),before);assert.equal((await f.ok({action:'draftGet',runId,viewerId:'ideas-page'})).input,'KEEP_THIS_DRAFT');
 f.ideasHandler=async()=>({text:'not valid JSON'});const bad=await f.call({...args,requestId:'ideas-bad'});assert.equal(bad.error.code,'IDEAS_INVALID_RESPONSE');assert.equal(f.calls.filter(c=>c.stage==='ideas').length,2);assert.deepEqual(await f.storyBytes(runId),before);
 const next=await f.ok({action:'turn',runId,requestId:'continue-after-ideas-failure',input:'我繼續觀察。'});assert.equal(next.status,'committed');assert.equal((await f.ledger.summary()).knownActualCostUsd,0);
});

test('HTTP same-Run presentation previews, applies, restores and persists without changing story version or State',async t=>{
 const f=await sixHttp(t),created=await f.importRun({withoutFrontend:true}),runId=created.runId;
 const modelCalls=f.calls.length,before=await f.storyBytes(runId),view=await f.ok({action:'runView',runId});assert.equal(view.cardFrontend,null);
 const first=await f.ok({action:'presentation',runId});assert.equal(first.presentationRevision,0);assert.equal(first.status,'available');
 const candidate=structuredClone(created.fixture.frontend);delete candidate.hash;candidate.html=candidate.html.replace('旅人手札','合成新版面板');
 const preview=await f.ok({action:'presentationPreview',runId,frontend:candidate,expectedPresentationRevision:0});assert.equal(preview.preview.projection.values.mana.value,75);assert(!JSON.stringify(preview).includes('RESTRICTED'));
 assert.equal((await f.call({action:'presentationApply',runId,previewToken:preview.previewToken,expectedPresentationRevision:0,operationId:'without-confirmation'})).error.code,'PRESENTATION_CONFIRM_REQUIRED');
 const operation={action:'presentationApply',runId,previewToken:preview.previewToken,expectedPresentationRevision:0,operationId:'apply-http-panel',confirmed:true};const applied=await f.ok(operation);assert.equal(applied.presentationRevision,1);assert.deepEqual(applied.canonical,{version:view.version,head:view.head});assert.deepEqual(await f.storyBytes(runId),before);
 let changed=await f.ok({action:'runView',runId});assert.equal(changed.presentationRevision,1);assert.equal(changed.cardFrontend.projection.values.mana.value,75);assert.equal(changed.head,view.head);assert.equal(changed.version,view.version);
 await f.restart();changed=await f.ok({action:'runView',runId});assert.equal(changed.presentationRevision,1);assert.equal(changed.cardFrontend.projection.presentationRevision,1);assert.equal((await f.ok(operation)).replayed,true);
 const restored=await f.ok({action:'presentationRestore',runId,expectedPresentationRevision:1,operationId:'restore-original-http',target:'original',confirmed:true});assert.equal(restored.presentationRevision,2);assert.equal((await f.ok({action:'runView',runId})).cardFrontend,null);assert.deepEqual(await f.storyBytes(runId),before);assert.equal(f.calls.length,modelCalls);
 const prohibited=await f.call({action:'presentationPreview',runId,frontend:candidate,blueprint:{},expectedPresentationRevision:2});assert.equal(prohibited.error.code,'PRESENTATION_INPUT_FIELDS');
});

test('actual scoped Host rejects other-card readers, ideas and presentation without generating',async t=>{
 const f=await sixHttp(t),created=await f.importRun(),host=f.server.host,bridge=f.server.studioBridge,scope=await resolveSceanCardContext(bridge.loader,bridge.agent.id);assert(scope);
 const actual=await host.request({action:'playerWorldbook',runId:created.runId,sessionId:bridge.agent.id,cardScope:scope},undefined,{requireCardScope:true,resolveCardScope:async()=>scope,principal:'synthetic',allowGlobalSettings:true});assert.equal(actual.ok,true);
 const wrong={...scope,documentId:'different-card-uuid',cardId:'different-card-uuid'};
 for(const action of ['playerWorldbook','playerRecap','playerIdeas','presentation','presentationPreview']){const response=await host.request({action,runId:created.runId,sessionId:bridge.agent.id,cardScope:wrong},undefined,{requireCardScope:true,resolveCardScope:async()=>scope,principal:'synthetic',allowGlobalSettings:true});assert.equal(response.ok,false);assert.equal(response.error.code,'CARD_CONTEXT_CHANGED');}
 assert.equal(f.calls.length,0);
});

test('HTTP presentation source resolves the actual saved working card and checks its revision before preview',async t=>{
 const f=await sixHttp(t),created=await f.importRun({withoutFrontend:true}),bridge=f.server.studioBridge,runId=created.runId,before=await f.storyBytes(runId);
 assert.equal((await f.call({action:'presentationSource',runId})).error.code,'PRESENTATION_SOURCE_UNAVAILABLE');
 const record=bridge.loader.records.get(bridge.agent.id);
 await bridge.loader.setAuthoringScope(bridge.agent,{claim:created.claim,mode:'full',expected_epoch:record.scope.epoch});
 try{
  await bridge.operation(created.claim,'patch',{document_id:created.documentId,expected_revision:0,patches:[{op:'add',path:'/data/extensions/scean/frontend',value:created.fixture.frontend}]});
 }finally{const current=bridge.loader.records.get(bridge.agent.id);await bridge.loader.setAuthoringScope(bridge.agent,{claim:created.claim,mode:'content',expected_epoch:current.scope.epoch});}
 const source=await f.ok({action:'presentationSource',runId});assert.equal(source.source.documentId,created.documentId);assert.equal(source.source.revision,1);assert(!JSON.stringify(source).includes('RESTRICTED'));
 const stale=await f.call({action:'presentationPreview',runId,frontend:source.frontend,source:{...source.source,revision:0},expectedPresentationRevision:0});assert.equal(stale.error.code,'PRESENTATION_SOURCE_CHANGED');
 const preview=await f.ok({action:'presentationPreview',runId,frontend:source.frontend,source:source.source,expectedPresentationRevision:0});
 await f.ok({action:'presentationApply',runId,previewToken:preview.previewToken,expectedPresentationRevision:0,operationId:'apply-actual-saved-source',confirmed:true});
 const view=await f.ok({action:'runView',runId});assert.equal(view.presentation.source.revision,1);assert.equal(view.cardFrontend.frontend.hash,source.frontend.hash);assert.deepEqual(await f.storyBytes(runId),before);assert.equal(f.calls.length,0);
});

test('HTTP old Run without Blueprint keeps official State and refuses panel migration',async t=>{
 const f=await sixHttp(t),created=await f.ok({action:'create',cardId:'synthetic-observatory',revisionId:'r1',openingId:'cabin'}),runId=created.runId,before=await f.storyBytes(runId),view=await f.ok({action:'runView',runId});
 assert.equal(view.presentation.status,'unavailable');assert.equal(view.presentation.code,'PRESENTATION_BLUEPRINT_REQUIRED');assert(view.state.world);assert.equal(view.cardFrontend,null);
 const candidate=(await import('../fixtures/w01-frontends.mjs')).w01Fixture('fantasy').frontend;
 const denied=await f.call({action:'presentationPreview',runId,frontend:candidate,expectedPresentationRevision:0});assert.equal(denied.error.code,'PRESENTATION_BLUEPRINT_REQUIRED');assert.deepEqual(await f.storyBytes(runId),before);assert.equal(f.calls.length,0);
});
