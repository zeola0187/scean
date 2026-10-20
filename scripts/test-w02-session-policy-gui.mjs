// Real official DSH Web Host, generated Editor A/Player and registered tools.
// Synthetic profile only. Tools are driven deterministically, no LLM request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {seedStudioA} from '../fixtures/studio-a.mjs';
import {launchUiBrowser,selectFixtureSession} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),hostOut=path.join(root,'evidence/w02-session-policy-host'),out=path.join(root,'evidence/w02-session-policy-ui');await fs.mkdir(out,{recursive:true});
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
 await check('Stage launches existing editor diagnosis; human selects exact Run and grants bounded access',async()=>{
   await stageDiagnose();await browser.wait("!!document.querySelector('[data-view=diagnosis]')");await textButton('選擇遊玩紀錄');await browser.wait("document.querySelectorAll('[data-diagnosis-run]').length>=1");await ready();await browser.click('[data-diagnosis-run="'+oldFile.run.runId+'"]');await browser.click('[data-diagnosis-grant]');await browser.wait("!!document.querySelector('[data-diagnosis-active]')");
   const context=await tool('cardstudio_scean_diagnose',{});assert(context.ok,JSON.stringify(context));assert(context.value.editTarget.target.document_id===cardId,'target identity');assert(context.value.sourceRevision===0,'source revision');assert(!JSON.stringify(context).includes('grantToken'),'operator token leakage');assert(context.value.data.authorizationVersion===2&&context.value.data.lifetime==='session','Session-only authorization contract');assert(!JSON.stringify(context.value.data).includes('expiresAt'),'retired countdown field');assert(await browser.evaluate("document.querySelector('[data-diagnosis-grant]').textContent==='允許檢查這局'&&!!document.querySelector('[data-diagnosis-revoke]')&&!document.querySelector('[data-view=diagnosis]').textContent.includes('10 分鐘')"),'UI must expose grant/revoke without a countdown');
 });
 await check('Actual scoped Agent tools require human direction consent before writing a new revision',async()=>{
   const denied=await tool('card_patch_fields',{document_id:cardId,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Unauthorized.'}]});assert(!denied.ok&&denied.error.code==='DIAG_EDIT_CONSENT','automatic edit was allowed');
   const proposal=await tool('cardstudio_scean_diagnose',{action:'prepare_edit',direction:'讓守門人能夠保留判斷、溫和拒絕不合理要求；保持原本沉著的性格。'});assert(proposal.ok,JSON.stringify(proposal));
   await browser.click('[data-diagnosis-status]');await browser.wait("!!document.querySelector('[data-diagnosis-consent]')");
   await screenshot('diagnosis-desktop',1440,1000);await screenshot('diagnosis-narrow',700,1000);await screenshot('diagnosis-mobile',390,844);await browser.evaluate("document.querySelector('[data-diagnosis-consent]').scrollIntoView({block:'center'})");await browser.frames();await browser.screenshot(path.join(out,'repair-consent-mobile.png'));
   await browser.resize(1440,1000);await browser.evaluate("document.querySelector('[data-diagnosis-consent]').scrollIntoView({block:'center'})");await browser.click('[data-diagnosis-consent]');await browser.wait("document.querySelector('[data-diagnosis-active]').textContent.includes('已同意修改方向')");
   const edited=await tool('card_patch_fields',{document_id:cardId,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'守門人保留自主判斷，會溫和拒絕不合理要求；維持原本沉著性格。'}]});assert(edited.ok&&edited.value.revision===1,JSON.stringify(edited));assert((await currentCards()).find(c=>c.id===cardId).revision===1,'saved revision');await browser.click('[data-diagnosis-status]');await ready();await screenshot('source-and-working-version-desktop',1440,1000);
 });
 await check('Use-new-version refreshes saved card, creates a distinct Run and leaves original Run bytes fixed',async()=>{
   await browser.click('[data-scean=start]');await browser.wait("!!document.querySelector('[data-view=stage]')&&!!document.querySelector('[data-working-title]')");await ready();await browser.click('[data-scean=start]');await confirmOpening();
   const files=(await runFiles()).filter(f=>f.run.snapshot.cardId===cardId);assert(files.length===2,'new Run count');assert(sha(await fs.readFile(oldFile.path))===oldFile.hash,'original Run changed');assert(files.some(f=>f.run.snapshot?.revision===1),'new revision not frozen');await browser.wait("document.body.dataset.playerView==='story'");await browser.screenshot(path.join(out,'new-run-desktop.png'));
 });
 await check('Explicit revoke stops the registered diagnostic tool without affecting other plugins',async()=>{
   await stageDiagnose();await browser.wait("!!document.querySelector('[data-view=diagnosis]')");await ready();await browser.click('[data-diagnosis-revoke]');await browser.wait("!document.querySelector('[data-diagnosis-active]')");const revoked=await tool('cardstudio_scean_diagnose',{});assert(!revoked.ok&&revoked.error.code==='DIAG_DENIED','revoked tool read');
   assert(await browser.evaluate('!!window.__uiSessions&&!!window.__uiWorkspace'),'other SDK services unavailable');
 });
 assert(errors.length===0,errors.join('\n'));
 await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify({status:'PASS',surface:'official DSH rc.2 Web + actual registered tools; deterministic tool driver, no model',checks,errors,cardId,session,paidModelCalls:0,embeddingCalls:0,productionWrites:0,realModelSemanticAcceptance:'NOT_TESTED',physicalPhoneSafari:'NOT_TESTED'},null,2));
 console.log(JSON.stringify({status:'PASS',checks:checks.length,errors:errors.length}));
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2));if(browser){browser.topFrame();await browser.screenshot(path.join(out,'failure.png')).catch(()=>{});}console.error(error);process.exitCode=1;}finally{await browser?.close();}
