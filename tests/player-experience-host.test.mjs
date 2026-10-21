import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {Memory} from '../core/memory.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {IDEA_CATEGORIES} from '../core/player-ideas.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
import {resolveSceanFrontendSource} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';

async function fixture(t){
 const base=path.resolve(import.meta.dirname,'../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'player-six-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=w01Fixture('fantasy'),snapshot=structuredClone(f.snapshot);delete snapshot.frontend;snapshot.source={provider:'@local/dsh-card-studio-scean-test',card:{id:snapshot.cardId,revision:1}};snapshot.worldbook={entries:[{id:1,content:'PUBLIC_LORE_CANARY',visibility:'public'},{id:2,content:'PRIVATE_LORE_CANARY'}]};
 const calls=[];const model={async generate(args){calls.push(args);if(args.stage==='ideas')return {text:JSON.stringify({ideas:IDEA_CATEGORIES.map(category=>({category,text:'Synthetic idea '+category}))}),model:'scripted-fixture',usage:{inputTokens:12,outputTokens:20}};if(args.stage==='director')return {text:JSON.stringify({handoffVersion:1,sceneIntent:'Observe the public room.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]})};if(args.stage==='post_stat')return {text:'{"contractVersion":2,"stateChanges":[],"memories":[]}'};return {text:'A calm synthetic room.'};}};
 const store=new DurableStore({root:path.join(root,'store')}),engine=new SceanEngine({store,model,memory:new Memory()}),host=await new SceanHost({engine,root:path.join(root,'host')}).init();t.after(()=>host.close());const run=await host.createRun({snapshot});
 await host.turn({runId:run.runId,input:'Read the public gauge.',requestId:'first-turn'});calls.length=0;
 const current=await store.read(run.runId),scope={schemaVersion:1,provider:snapshot.source.provider,cardId:snapshot.cardId,authoringSessionId:'session-a',generation:1};
 const source={frontend:structuredClone(f.frontend),source:{documentId:snapshot.cardId,revision:2,label:'Synthetic card'}};
 const authority={principal:'synthetic-operator',allowGlobalSettings:true,requireCardScope:true,resolveCardScope:()=>scope,resolvePresentationSource:async()=>source};
 const bridge=createNativeBridge({getSessionId:()=>scope.authoringSessionId,selectPanel(){},call:async request=>{const r=await host.request(request,undefined,authority);if(!r.ok)throw Object.assign(Error(r.error.code),r.error);return r.value;}});await bridge.request('native.context');t.after(()=>bridge.dispose());
 return {root,run:current,host,store,engine,calls,scope,source,authority,bridge,storyFile:path.join(store.runDir(run.runId),'current.json')};
}
test('native scoped reader and ideas routes are narrow, optional, and never mutate committed story',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.storyFile);const book=await f.bridge.request('playerWorldbook',{runId:f.run.runId});assert.equal(book.entries.length,1);const detail=await f.bridge.request('playerWorldbook',{runId:f.run.runId,entryId:book.entries[0].id});assert.equal(detail.entry.content,'PUBLIC_LORE_CANARY');assert(!JSON.stringify(book).includes('PRIVATE_LORE_CANARY'));
 const recap=await f.bridge.request('playerRecap',{runId:f.run.runId});assert(!JSON.stringify(recap).includes('PRIVATE_LORE_CANARY'));assert.equal(f.calls.length,0);
 const value=await f.bridge.request('playerIdeas',{runId:f.run.runId,expectedHead:f.run.head,expectedVersion:f.run.version,requestId:'ideas-one'});assert.equal(value.ideas.length,5);assert.equal(f.calls.length,1);assert.equal(f.calls[0].stage,'ideas');assert.deepEqual(f.calls[0].tools,[]);assert(!JSON.stringify(f.calls).includes('PRIVATE_LORE_CANARY'));assert.deepEqual(await fs.readFile(f.storyFile),before);
 const denied=await f.host.request({action:'playerIdeas',runId:f.run.runId,expectedHead:f.run.head,expectedVersion:f.run.version},undefined,{});assert.equal(denied.error.code,'PLAYER_ACTION_DENIED');assert.equal(f.calls.length,1);
});
test('source-card panel to native same-Run preview/apply/reopen/restore changes display only',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.storyFile),source=await f.bridge.request('presentationSource',{runId:f.run.runId});assert.equal(source.source.revision,2);
 const config=await f.bridge.request('presentation',{runId:f.run.runId});assert.equal(config.presentationRevision,0);
 const preview=await f.bridge.request('presentationPreview',{runId:f.run.runId,...source,expectedPresentationRevision:0});assert.equal(preview.status,'available');
 const args={runId:f.run.runId,previewToken:preview.previewToken,expectedPresentationRevision:0,operationId:'human-panel-one',confirmed:true};
 const applied=await f.bridge.request('presentationApply',args);assert.equal(applied.presentationRevision,1);
 const view=await f.bridge.request('runView',{runId:f.run.runId});assert.equal(view.version,f.run.version);assert.equal(view.head,f.run.head);assert.equal(view.presentationRevision,1);assert.equal(view.cardFrontend.status,'ready');
 const second=new SceanHost({engine:f.engine,root:path.join(f.root,'host')});await second.init();t.after(()=>second.close());assert.equal((await second.runView({runId:f.run.runId})).presentationRevision,1);
 await f.bridge.request('presentationRestore',{runId:f.run.runId,target:'original',expectedPresentationRevision:1,operationId:'human-panel-restore',confirmed:true});assert.equal((await f.bridge.request('runView',{runId:f.run.runId})).cardFrontend,null);
 assert.deepEqual(await fs.readFile(f.storyFile),before);assert.equal(f.calls.length,0);
});
test('cross-card routes, changed source revision, no operator and missing Blueprint fail without story writes',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.storyFile);
 const denied=await f.host.request({action:'presentationApply',runId:f.run.runId},undefined,{});assert.equal(denied.error.code,'PRESENTATION_DENIED');
 const bad=structuredClone(await f.bridge.request('presentationSource',{runId:f.run.runId}));bad.source.revision=99;
 await assert.rejects(f.bridge.request('presentationPreview',{...bad,runId:f.run.runId,expectedPresentationRevision:0}),{code:'PRESENTATION_SOURCE_CHANGED'});
 const wrong={...f.scope,cardId:'not-this-card'},otherAuthority={...f.authority,resolveCardScope:()=>wrong};const result=await f.host.request({action:'playerWorldbook',runId:f.run.runId,cardScope:wrong,sessionId:'session-a'},undefined,otherAuthority);assert.equal(result.ok,false);assert.equal(result.error.code,'CARD_SCOPE_MISMATCH');assert.deepEqual(await fs.readFile(f.storyFile),before);
});
test('Studio presentation source resolves exact selected document twice and never returns Blueprint or full card',async()=>{
 let revision=2;const cardId='source-card';const saved=()=>({revision,sha256:'digest-'+revision,card:{data:{name:'Synthetic',description:'PRIVATE_CARD_CANARY',extensions:{scean:{frontend:{id:'public-display'},stateBlueprint:{private:true}}}}}});
 const agent={id:'session-source'},record={generation:3};const loader={records:new Map([[agent.id,record]]),agentLookup:()=>agent,validate:async()=>{},workspace:{service:{selectedDocument:async()=>({type:'card',document_id:cardId}),read:async()=>saved()}}};
 const scope={cardId,authoringSessionId:agent.id,generation:3};const result=await resolveSceanFrontendSource(loader,agent.id,scope);assert.equal(result.source.documentId,cardId);assert.equal(result.source.revision,2);assert(!JSON.stringify(result).includes('PRIVATE_CARD_CANARY'));assert(!JSON.stringify(result).includes('stateBlueprint'));
 let calls=0;loader.workspace.service.read=async()=>{if(++calls===2)revision++;return saved();};await assert.rejects(resolveSceanFrontendSource(loader,agent.id,scope),{code:'PRESENTATION_SOURCE_CHANGED'});
});
