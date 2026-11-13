import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defaultChapterSettings,newRunChapterSettings,seedNewRunChapterSettings,chapterSummaryView,backfillChapterSummary,updateChapterSettings} from '../core/chapter-summary.mjs';
import {validateNarrative} from '../core/narrative.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {chapterSettingsDefaults,ChapterProviderSettings} from '../plugin/chapter-settings.mjs';
import {chapterAutomationSummary,chapterOperationSummary} from '../isolated/web/summary-settings-ui.mjs';

test('new Run summary default is ON while legacy missing settings and explicit OFF remain OFF',()=>{
 assert.equal(newRunChapterSettings().autoEnabled,true);assert.equal(defaultChapterSettings().autoEnabled,false);
 const legacy=syntheticLongrun({turns:0,chapters:0});delete legacy.narrative;
 assert.equal(chapterSummaryView(legacy).settings.autoEnabled,false);
 const newlyCreated=structuredClone(legacy);seedNewRunChapterSettings(newlyCreated);assert.equal(chapterSummaryView(newlyCreated).settings.autoEnabled,true);assert.equal(validateNarrative(newlyCreated),true);
 const explicitOff=structuredClone(legacy);seedNewRunChapterSettings(explicitOff,false);assert.equal(chapterSummaryView(explicitOff).settings.autoEnabled,false);assert.equal(validateNarrative(explicitOff),true);
 assert.equal(legacy.narrative,undefined);
});

test('summary seeding only accepts a new creation object and never upgrades stored story metadata',()=>{
 for(const extra of [{version:1},{head:'existing-commit'},{turns:[{}]},{narrative:{schemaVersion:1}}])assert.throws(()=>seedNewRunChapterSettings({version:0,head:null,turns:[],...extra}),{code:'CHAPTER_NEW_RUN_ONLY'});
 assert.throws(()=>newRunChapterSettings('on'),{code:'INVALID_CHAPTER_SETTINGS'});
});

test('new initial ON and old initial OFF preserve portable validation without weakening initial setting bounds',()=>{
 for(const initial of [false,true]){
  const run=syntheticLongrun({turns:0,chapters:0});delete run.narrative;seedNewRunChapterSettings(run,initial);assert.equal(validateRunBundle(encodeRunBundle(run)).narrative.chapterSettings.autoEnabled,initial);
  run.narrative.chapterSettings.tokenThreshold=4000;assert.throws(()=>validateNarrative(run),{code:'INVALID_CHAPTER_SETTINGS'});
 }
});

test('a summary captured under new initial ON still validates after a later explicit OFF and re-import',async t=>{
 const root=fileURLToPath(new URL('../.test-data/',import.meta.url));await mkdir(root,{recursive:true});const dataRoot=await mkdtemp(path.join(root,'summary-authority-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}));
 const run=syntheticLongrun({turns:16,chapters:1,bodyRepeats:5});run.narrative.schemaVersion=2;run.narrative.chapterSummaries=[];run.narrative.chapterSettings=newRunChapterSettings();
 const store=new DurableStore({root:dataRoot});await store.create(run);let calls=0;const engine=new SceanEngine({postBody:false,store,model:{async generate(){throw Error('normal narrative generation is not used');}},memory:{async retrieve(){throw Error('no memory request');}}});
 const model={async generate(){calls++;return {text:JSON.stringify({title:'Synthetic chapter',summary:'The synthetic characters finished their watch.',keywords:['watch'],characters:['Synthetic'],locations:['Station'],plotThreads:[],emotionalTone:'quiet'}),model:'synthetic-summary'};}};
 await backfillChapterSummary(engine,{runId:run.runId,operationId:'one-explicit-summary',expectedVersion:run.version,expectedHead:run.head,chapterId:run.narrative.chapters[0].id},{enabled:true,model});
 const after=await store.read(run.runId);await updateChapterSettings(engine,{runId:run.runId,operationId:'explicit-off',expectedVersion:after.version,expectedHead:after.head,settings:{autoEnabled:false,tokenThreshold:16000,bufferTurns:6,detail:'auto'}});
 const off=await store.read(run.runId);assert.equal(calls,1);assert.equal(off.narrative.chapterSettings.autoEnabled,false);assert.equal(validateNarrative(off),true);assert.equal(validateRunBundle(encodeRunBundle(off)).narrative.chapterSettings.autoEnabled,false);
 assert.equal(off.narrative.operations['one-explicit-summary'].settingsSnapshot.autoEnabled,true);
});

test('fresh summary service defaults enabled without enabling embedding or retrieval; explicit capability OFF is respected',()=>{
 assert.deepEqual(chapterSettingsDefaults().flags,{chapterModelsEnabled:true,chapterRetrievalEnabled:false,chapterEmbeddingEnabled:false});
 assert.deepEqual(chapterSettingsDefaults({chapterModelsEnabled:false}).flags,{chapterModelsEnabled:false,chapterRetrievalEnabled:false,chapterEmbeddingEnabled:false});
});

test('reading new or stored global summary preferences never writes settings or calls a model',async()=>{
 let writes=0;const records=new Map(),credentials={readRecord:async key=>records.get(key),modifyRecord:async(key,fn)=>{writes++;const value=fn(records.get(key));if(value!==undefined)records.set(key,value);return records.get(key);}};
 const manager=new ChapterProviderSettings({credentials,scope:'synthetic-summary-authority',environment:()=>undefined});const fresh=await manager.status({transport:false});assert.equal(fresh.settings.flags.chapterModelsEnabled,true);assert.equal(writes,0);assert.equal(fresh.chapterSummaryAuthority,'run.chapterSettings.autoEnabled');assert.equal(fresh.saveStartsModelWork,false);
 const settings=chapterSettingsDefaults({chapterModelsEnabled:false});await manager.save({operationId:'explicit-service-off',expectedRevision:0,settings});const reopened=new ChapterProviderSettings({credentials,scope:'synthetic-summary-authority',environment:()=>undefined});assert.equal((await reopened.status({transport:false})).settings.flags.chapterModelsEnabled,false);assert.equal(writes,1);manager.close();reopened.close();
});

test('simple summary status distinguishes OFF, effective ON, unavailable service, and actual preflight failure',()=>{
 assert.match(chapterAutomationSummary({settings:{autoEnabled:false}}),/已關閉/);
 assert.match(chapterAutomationSummary({settings:{autoEnabled:true},enabled:true,autoArmed:false}),/已開啟/);
 assert.match(chapterAutomationSummary({settings:{autoEnabled:true},enabled:false}),/等待章節服務設定/);
 const failed={settings:{autoEnabled:true},enabled:true,chapterFailure:{code:'CHAPTER_SOURCE_LIMIT'},operations:[]};assert.match(chapterAutomationSummary(failed),/超過單次摘要容量/);assert.match(chapterOperationSummary(failed),/尚未產生摘要/);assert(!chapterOperationSummary(failed).includes('not_started'));
 assert.match(chapterOperationSummary({operations:[]}),/開啟本頁不會產生摘要/);
});

test('normal summary UI has one persistent switch for summary AND chapter context; no per-launch recall consent',async()=>{
 const html=await readFile(new URL('../isolated/web/index.html',import.meta.url),'utf8'),local=html.match(/<form id="chapter-settings-form">([\s\S]*?)<\/form>/)[1];
 const normal=local.replace(/<details id="chapter-summary-tuning">[\s\S]*?<\/details>/,'');assert.equal((normal.match(/type="checkbox"/g)??[]).length,1);assert(normal.includes('自動整理摘要並用於後續遊玩'));assert(normal.includes('BM25＋向量'));assert.equal((local.match(/id="chapter-recall-enabled"/g)??[]).length,0);assert(!local.includes('Host 重啟後需重新確認'));assert(html.includes('id="chapter-summary-tuning"'));assert(html.includes('id="legacy-summary-tools"'));assert(!html.includes('global-chapter-settings" class="global-chapter-settings" open'));
});
