// Real official DSH Web Host, generated Editor A/Player and registered tools.
// Synthetic profile only. Tools are driven deterministically, no LLM request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {seedStudioA} from '../fixtures/studio-a.mjs';
import {launchUiBrowser,selectFixtureSession} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),hostOut=path.join(root,'evidence/w02-session-policy-host'),out=path.join(root,'evidence/w02-black-screen-'+(process.argv.includes('--expect-bug')?'baseline':'fixed')+'-ui');await fs.mkdir(out,{recursive:true});
const launch=JSON.parse(await fs.readFile(path.join(hostOut,'launch.json'),'utf8'));
if(!launch.isolated||!path.resolve(launch.workspace).startsWith(path.join(root,'evidence')+path.sep))throw Error('ISOLATION_REQUIRED');
await seedStudioA(launch.workspace);
const checks=[],errors=[],assert=(value,message)=>{if(!value)throw Error(message);},sha=bytes=>createHash('sha256').update(bytes).digest('hex');let browser,session;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=()=>browser.wait("!!document.querySelector('[data-working-picker]')&&!document.querySelector('[data-working-picker]').disabled");
async function check(name,fn){await fn();checks.push({name,pass:true});console.log('PASS '+name);}
async function textButton(text,container='.csscean-panel'){
 await browser.wait(`[...document.querySelectorAll(${JSON.stringify(container+' button')})].some(n=>n.textContent.trim()===${JSON.stringify(text)}&&n.checkVisibility()&&!n.disabled)`);
 await browser.evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(container+' button')})].find(n=>n.textContent.trim()===${JSON.stringify(text)}&&n.checkVisibility()&&!n.disabled);if(!n)throw Error('Missing button');n.dataset.qaClick='current';n.scrollIntoView({block:'center'});})()`);await browser.frames();await browser.click('[data-qa-click=current]');await browser.evaluate("document.querySelector('[data-qa-click=current]')?.removeAttribute('data-qa-click')");
}
async function input(selector,value){await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),proto=n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await browser.frames();}
async function tool(name,args){const id=randomUUID();await fs.writeFile(path.join(hostOut,'tool-request.json'),JSON.stringify({id,sessionId:session,name,args}));for(let i=0;i<200;i++){let value;try{value=JSON.parse(await fs.readFile(path.join(hostOut,'tool-result.json'),'utf8'));}catch{}if(value?.id===id){if(value.error)throw Error(value.error);return value.result;}await pause(50);}throw Error('Tool fixture timeout');}
async function currentCards(){const dir=path.join(launch.workspace,'.cardstudio-scean/documents'),cards=[];for(const id of await fs.readdir(dir)){const record=JSON.parse(await fs.readFile(path.join(dir,id,'current.json'),'utf8'));cards.push({id,revision:record.revision});}return cards;}
async function runFiles(){const dir=path.join(launch.data,'store/runs'),files=[];async function walk(p){for(const f of await fs.readdir(p,{withFileTypes:true}).catch(()=>[])){const at=path.join(p,f.name);if(f.isDirectory())await walk(at);else if(f.name==='current.json')files.push({path:at,hash:sha(await fs.readFile(at)),run:JSON.parse(await fs.readFile(at,'utf8'))});}}await walk(dir);return files;}
async function confirmOpening(){await browser.nativeFrame();await browser.wait("!!document.querySelector('#opening-selection')&&!document.querySelector('#opening-selection').hidden");await input('#opening-player-name','合成玩家');await browser.click('#opening-start');await browser.wait("document.querySelector('#opening-selection').hidden");}
async function stageDiagnose(){
 await browser.wait("document.querySelector('#agent-diagnose')?.checkVisibility()");
 browser.topFrame();const offset=await browser.evaluate("(()=>{const b=document.querySelector('iframe[data-scean-native-player]').getBoundingClientRect();return {x:b.left,y:b.top};})()");await browser.nativeFrame();
 const b=await browser.evaluate("(()=>{const n=document.querySelector('#agent-diagnose');n.scrollIntoView({block:'nearest'});const b=n.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()");
 await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:b.x+offset.x,y:b.y+offset.y});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:b.x+offset.x,y:b.y+offset.y});browser.topFrame();
}
async function screenshot(name,width,height){browser.topFrame();await browser.resize(width,height);await browser.evaluate("document.querySelector('.csscean-panel')?.scrollTo(0,0)");await browser.frames();assert(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'page overflow');await browser.screenshot(path.join(out,name+'.png'));}
try{
 browser=await launchUiBrowser(path.join(out,'chrome-profile'));
 browser.on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails?.exception?.description??p.exceptionDetails?.text));
 browser.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')errors.push(p.args.map(a=>a.description??a.value).join(' '));});
 await browser.resize(1440,1000);await browser.navigate(launch.entry);await browser.wait('!!window.__uiWorkspace');
 try{await browser.wait("[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='继续')",2000);await browser.evaluate("[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='继续').id='qa-continue'");await browser.click('#qa-continue');}catch{}
 await browser.evaluate(`__uiSessions.create({cwd:${JSON.stringify(launch.workspace)}}).then(id=>{window.__uiSession=id;})`);await browser.wait('!!window.__uiSession');session=await browser.evaluate('__uiSession');await selectFixtureSession(browser,session);await browser.wait("!!window.__DSH_CARDSTUDIO_SCEAN_DIAGNOSTICS__?.stages['main-registered']");await browser.evaluate("__uiLayout.selectPanel('local-cardstudio-scean')");await browser.wait("!!document.querySelector('[data-working-picker]')&&!document.querySelector('[data-working-picker]').disabled");
 let cardId,oldFile;
 await check('Editor A imports a synthetic working card and creates its original Run via official opening RPC',async()=>{
   await browser.click('[data-working-picker]');await browser.wait("!!document.querySelector('[data-view=picker]')");await browser.click('[data-details=import-working]>summary');await browser.select('.csscean-panel select[aria-label="imports 內的檔案"]','imports/qa-a.json');await textButton('匯入副本');await browser.wait("!!document.querySelector('[data-field=description]')");await ready();cardId=await browser.evaluate("document.querySelector('[data-details=identity] .csscean-path').textContent.split(' · ')[0]");
   await browser.click('[data-scean=start]');await browser.wait("!!document.querySelector('[data-view=stage]')");await ready();await browser.click('[data-scean=start]');await confirmOpening();
   const files=(await runFiles()).filter(f=>f.run.snapshot.cardId===cardId);assert(files.length===1,'original run count');oldFile=files[0];
 });

 browser.topFrame();
 const expectBug=process.argv.includes('--expect-bug');
 let otherSession;
 // A clean browser bootstrap preserves actual server Session selection and Run,
 // but intentionally has no editor viewCache for the affected Session.
 await browser.navigate(launch.entry);await browser.wait('!!window.__uiWorkspace');
 await browser.wait(`!!__uiSessions.list.getSnapshot().byId[${JSON.stringify(session)}]`);
 await browser.evaluate('__uiLayout.selectPanel(null)');await selectFixtureSession(browser,session);
 await browser.wait(`__uiSessions.list.getSnapshot().byId[${JSON.stringify(session)}]?.retainedBy.mainView>0`);
 await browser.wait("window.__DSH_CARDSTUDIO_SCEAN_DIAGNOSTICS__?.stages['bridge-capabilities-decoded']?.ok===true");
 await browser.evaluate(`window.dispatchEvent(new CustomEvent('scean:open',{detail:{runId:${JSON.stringify(oldFile.run.runId)},authoringSessionId:${JSON.stringify(session)}}}));__uiLayout.selectPanel('local-scean');`);
 await browser.nativeFrame();await browser.wait("document.querySelector('#agent-diagnose')?.checkVisibility()");
 const errorsBefore=errors.length;await stageDiagnose();
 if(expectBug){
   for(let i=0;i<100&&errors.length===errorsBefore;i++)await pause(50);
   assert(errors.slice(errorsBefore).some(e=>/undefined|items|map|offset/.test(e)), 'Expected cold-handoff render failure not observed');
   assert(!await browser.evaluate("!!document.querySelector('.csscean-panel')"),'Expected editor black screen');
   await browser.screenshot(path.join(out,'cold-handoff-black.png'));
   await browser.evaluate("__uiLayout.selectPanel(null);__uiLayout.selectPanel('local-cardstudio-scean')");
   await browser.frames();await browser.frames();
   assert(!await browser.evaluate("!!document.querySelector('.csscean-panel')"),'Expected cached failure when reopening');
   await browser.screenshot(path.join(out,'reopen-black.png'));
   await fs.writeFile(path.join(out,'reproduction.json'),JSON.stringify({status:'REPRODUCED_EXISTING_1_5_0_BUG',source:'official isolated DSH Web Host, synthetic cards only',session,run:oldFile.run.runId,errors,cardId,coldEditorCache:true,serverSessionSelectionPreserved:true,paidModelCalls:0,productionWrites:0},null,2));
   console.log(JSON.stringify({status:'REPRODUCED_EXISTING_1_5_0_BUG',errors:errors.length}));
 }else{
   await check('Cold same-Session Stage diagnosis renders the editor with no cache and no implicit grant',async()=>{
     await browser.wait("!!document.querySelector('[data-view=diagnosis]')");await ready();
     assert(await browser.evaluate("document.querySelector('[data-details=diagnosis-permission] code').textContent")===oldFile.run.runId,'handoff Run identity');
     assert(!await browser.evaluate("!!document.querySelector('[data-diagnosis-active]')"),'implicit Agent grant');
     await screenshot('cold-handoff-desktop',1440,1000);await screenshot('cold-handoff-narrow',700,1000);
   });
   await check('Return to conversation and reopen the same Session through its real dock button',async()=>{
     await browser.evaluate('__uiLayout.selectPanel(null)');
     await browser.wait("!!document.querySelector('[data-cardstudio-scean-dock] button')");
     await browser.click('[data-cardstudio-scean-dock] button');
     await browser.wait("!!document.querySelector('[data-view=diagnosis]')");await ready();
     assert(await browser.evaluate("document.querySelector('[data-details=diagnosis-permission] code').textContent")===oldFile.run.runId,'reopened Run identity');
   });
   await check('The other Session is unaffected and does not inherit this diagnosis',async()=>{
     await browser.evaluate(`__uiLayout.selectPanel(null);__uiSessions.create({cwd:${JSON.stringify(launch.workspace)}}).then(id=>{window.__otherSession=id;})`);
     await browser.wait('!!window.__otherSession');otherSession=await browser.evaluate('__otherSession');await selectFixtureSession(browser,otherSession);
     await browser.wait("!!document.querySelector('[data-cardstudio-scean-dock] button')");await browser.click('[data-cardstudio-scean-dock] button');await ready();
     assert(!await browser.evaluate("!!document.querySelector('[data-diagnosis-active]')"),'cross-session delegation');
     assert(!await browser.evaluate(`document.querySelector('.csscean-panel').textContent.includes(${JSON.stringify(oldFile.run.runId)})`),'cross-session diagnostic identity');
   });
   await check('A missing Run stays recoverable and reports failure without black-screening or creating data',async()=>{
     await browser.evaluate(`__uiLayout.selectPanel(null);window.dispatchEvent(new CustomEvent('scean:diagnose',{detail:{runId:'missing-synthetic-run',authoringSessionId:${JSON.stringify(otherSession)}}}));__uiLayout.selectPanel('local-cardstudio-scean');`);
     await browser.wait("!!document.querySelector('[data-view=diagnosis]')");await ready();await browser.click('[data-diagnosis-grant]');
     await browser.wait("!!document.querySelector('.csscean-error[role=alert]')");
     assert(await browser.evaluate("!!document.querySelector('[data-working-picker]')"),'editor recovery controls missing');
     await screenshot('missing-source-recoverable',390,844);
   });
   await check('Malformed and cross-Session handoffs leave the current editor usable',async()=>{
     const before=await browser.evaluate("document.querySelector('[data-details=diagnosis-permission] code').textContent");
     await browser.evaluate(`window.dispatchEvent(new CustomEvent('scean:diagnose',{detail:{runId:{invalid:true},authoringSessionId:${JSON.stringify(otherSession)}}}));window.dispatchEvent(new CustomEvent('scean:diagnose',{detail:{runId:'wrong-session-run',authoringSessionId:'another-session'}}));`);
     await browser.frames();
     assert(await browser.evaluate("document.querySelector('[data-details=diagnosis-permission] code').textContent")===before,'malformed event changed identity');
     await browser.evaluate('__uiLayout.selectPanel(null)');await browser.wait("!!document.querySelector('[data-cardstudio-scean-dock] button')");await browser.click('[data-cardstudio-scean-dock] button');await ready();
   });
   await check('A retained Snapshot with a missing working source opens readonly and never substitutes another card',async()=>{
     await browser.evaluate('__uiLayout.selectPanel(null)');await selectFixtureSession(browser,session);
     await browser.wait(`__uiSessions.list.getSnapshot().byId[${JSON.stringify(session)}]?.retainedBy.mainView>0`);
     await browser.wait("!!document.querySelector('[data-cardstudio-scean-dock] button')");await browser.click('[data-cardstudio-scean-dock] button');await ready();
     const docDir=path.join(launch.workspace,'.cardstudio-scean/documents',cardId),held=path.join(launch.workspace,'.qa-source-backup-'+cardId);
     assert(path.resolve(docDir).startsWith(path.resolve(launch.workspace)+path.sep)&&path.resolve(held).startsWith(path.resolve(launch.workspace)+path.sep),'synthetic source paths must remain in isolated workspace');
     // Temporarily move only this synthetic fixture, preserving its bytes; no
     // real profile is reachable. The original directory is restored in finally.
     await fs.rename(docDir,held);
     try{
       await browser.evaluate(`window.dispatchEvent(new CustomEvent('scean:diagnose',{detail:{runId:${JSON.stringify(oldFile.run.runId)},authoringSessionId:${JSON.stringify(session)}}}));__uiLayout.selectPanel('local-cardstudio-scean');`);
       await browser.wait(`document.querySelector('[data-details=diagnosis-permission] code')?.textContent===${JSON.stringify(oldFile.run.runId)}`);
       await browser.wait("!!document.querySelector('[data-diagnosis-grant]')&&!document.querySelector('[data-diagnosis-grant]').disabled");
       await browser.click('[data-diagnosis-grant]');await browser.wait("!!document.querySelector('[data-diagnosis-active]')||!!document.querySelector('.csscean-error[role=alert]')");
       assert(await browser.evaluate("!!document.querySelector('[data-diagnosis-active]')"),'Snapshot-only grant failed: '+await browser.evaluate("document.querySelector('.csscean-error[role=alert]')?.textContent"));
       const context=await tool('cardstudio_scean_diagnose',{});assert(context.ok,'snapshot-only context failed');assert(!context.value.editTarget.editable,'missing source was editable');assert(context.value.data.cardId===cardId,'missing source identity substituted');
       assert(await browser.evaluate("document.querySelector('[data-diagnosis-active]').textContent.includes('目前只能診斷')"),'readonly recovery message missing');await screenshot('missing-working-source-readonly',700,1000);
     }finally{await fs.rename(held,docDir);}
   });
   assert(errors.length===0,errors.join('\n'));
   assert(sha(await fs.readFile(oldFile.path))===oldFile.hash,'original Run bytes changed');
   await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify({status:'PASS',surface:'official DSH0.2.1-rc.2 Web Host, actual SDK/Stage bridge, synthetic data only',checks,errors,session,otherSession,cardId,runId:oldFile.run.runId,oldRunBytesUnchanged:true,paidModelCalls:0,productionWrites:0,liveInstalled:false},null,2));
   console.log(JSON.stringify({status:'PASS',checks:checks.length,errors:errors.length}));
 }
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2));if(browser){browser.topFrame();await browser.screenshot(path.join(out,'failure.png')).catch(()=>{});}console.error(error);process.exitCode=1;}finally{await browser?.close();}
