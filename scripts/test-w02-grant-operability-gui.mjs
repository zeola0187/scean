// Real official DSH Web Host, generated Editor A/Player and registered tools.
// Synthetic profile only. Tools are driven deterministically, no LLM request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {seedStudioA} from '../fixtures/studio-a.mjs';
import {launchUiBrowser,selectFixtureSession} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),hostOut=path.join(root,'evidence/w02-session-policy-host'),out=path.join(root,'evidence/w02-grant-'+(process.argv.includes('--expect-blocked')?'baseline':'fixed')+'-ui');await fs.mkdir(out,{recursive:true});
const launch=JSON.parse(await fs.readFile(path.join(hostOut,'launch.json'),'utf8'));
if(!launch.isolated||!path.resolve(launch.workspace).startsWith(path.join(root,'evidence')+path.sep))throw Error('ISOLATION_REQUIRED');
for(const name of ['delay-next-read','read-delayed.json','release-read','deny-next-grant','delay-next-grant-reply','grant-delayed.json','release-grant'])await fs.unlink(path.join(hostOut,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
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
async function screenshot(name,width,height){browser.topFrame();await browser.resize(width,height);await browser.evaluate("document.querySelector('[data-diagnosis-grant]')?.scrollIntoView({block:'center'})");await browser.frames();assert(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'page overflow');await browser.screenshot(path.join(out,name+'.png'));}
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
 await fs.writeFile(path.join(hostOut,'delay-next-read'),'synthetic only');
 await browser.navigate(launch.entry);await browser.wait('!!window.__uiWorkspace');
 await browser.wait(`!!__uiSessions.list.getSnapshot().byId[${JSON.stringify(session)}]`);
 await browser.evaluate('__uiLayout.selectPanel(null)');await selectFixtureSession(browser,session);
 await browser.wait(`__uiSessions.list.getSnapshot().byId[${JSON.stringify(session)}]?.retainedBy.mainView>0`);
 await browser.wait("window.__DSH_CARDSTUDIO_SCEAN_DIAGNOSTICS__?.stages['bridge-capabilities-decoded']?.ok===true");
 await browser.evaluate(`window.dispatchEvent(new CustomEvent('scean:open',{detail:{runId:${JSON.stringify(oldFile.run.runId)},authoringSessionId:${JSON.stringify(session)}}}));__uiLayout.selectPanel('local-scean');`);
 await browser.nativeFrame();await browser.wait("document.querySelector('#agent-diagnose')?.checkVisibility()");

 await stageDiagnose();await browser.wait("!!document.querySelector('[data-view=diagnosis]')");
 const waitFile=async name=>{for(let i=0;i<200;i++){try{return JSON.parse(await fs.readFile(path.join(hostOut,name),'utf8'));}catch{}await pause(50);}throw Error('Fixture signal missing: '+name);};
 await waitFile('read-delayed.json');
 const expectBlocked=process.argv.includes('--expect-blocked');
 const touchGrant=async()=>{
  await browser.evaluate("document.querySelector('[data-diagnosis-grant]').scrollIntoView({block:'center'})");await browser.frames();
  const p=await browser.evaluate("(()=>{const b=document.querySelector('[data-diagnosis-grant]'),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:b===document.elementFromPoint(x,y)||b.contains(document.elementFromPoint(x,y)),disabled:b.disabled};})()");
  assert(p.hit,'grant is covered');assert(!p.disabled,'grant is disabled');
  await browser.call('Emulation.setTouchEmulationEnabled',{enabled:true});
  await browser.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await browser.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await browser.frames();
 };
 if(expectBlocked){
  await browser.resize(390,844);await browser.frames();
  assert(await browser.evaluate("document.querySelector('[data-diagnosis-grant]').disabled"),'Baseline did not block diagnostic consent on working-card read');
  await screenshot('working-card-read-blocks-consent',390,844);
  const report={status:'REPRODUCED_UNRELATED_WORKING_CARD_READ_BLOCKS_DIAGNOSTIC_CONSENT',heldActualReadReply:true,implicitGrants:0,paidModelCalls:0,productionWrites:0};
  await fs.writeFile(path.join(out,'baseline.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }else{
  await check('Cold Stage handoff allows explicit consent while the unrelated initial working-card read is pending',async()=>{
   await browser.wait("!document.querySelector('[data-diagnosis-grant]').disabled",3000);
   assert(await browser.evaluate("document.querySelector('[data-working-picker]').disabled"),'working-card editor should remain busy');
   const denied=await tool('cardstudio_scean_diagnose',{});assert(!denied.ok&&denied.error.code==='DIAG_DENIED','diagnosis must remain unauthorized before the click');
   await screenshot('consent-ready-during-card-load',390,844);
  });
  await check('A denied grant RPC is visible, releases the consent lock and grants no Agent access',async()=>{
   await fs.writeFile(path.join(hostOut,'deny-next-grant'),'synthetic only');await touchGrant();
   await browser.wait("document.querySelector('.csscean-error[role=alert]')?.textContent.includes('DIAG_DENIED')&&!document.querySelector('[data-diagnosis-grant]').disabled");
   const denied=await tool('cardstudio_scean_diagnose',{});assert(!denied.ok&&denied.error.code==='DIAG_DENIED','denied response authorized an Agent');
   assert(!await browser.evaluate("!!document.querySelector('[data-diagnosis-active]')"),'denied grant appeared active');
  });
  await check('Mobile touch sends one scoped grant; a delayed reply and repeated press cannot duplicate it',async()=>{
   const count=async()=>JSON.parse(await fs.readFile(path.join(hostOut,'human-routing.json'),'utf8')).filter(x=>x.sessionId===session&&x.mode==='diagnosis_grant').length;
   const before=await count();await fs.writeFile(path.join(hostOut,'delay-next-grant-reply'),'synthetic only');await touchGrant();await waitFile('grant-delayed.json');
   assert(await browser.evaluate("document.querySelector('[data-diagnosis-grant]').disabled"),'pending consent was clickable');
   await browser.click('[data-diagnosis-grant]');await browser.frames();assert(await count()===before+1,'duplicate grant RPC');
   await fs.writeFile(path.join(hostOut,'release-grant'),'release');await browser.wait("!!document.querySelector('[data-diagnosis-active]')");
   const context=await tool('cardstudio_scean_diagnose',{});assert(context.ok&&context.value.data.runId===oldFile.run.runId,'grant exact Run identity');assert(context.value.data.ranges.join(',')==='story,snapshot,runtime','scope expanded');
   await screenshot('consent-active-mobile',390,844);
  });
  await check('Revocation remains available while the working-card read is pending and stops Agent access',async()=>{
   await browser.click('[data-diagnosis-revoke]');await browser.wait("!document.querySelector('[data-diagnosis-active]')");
   const denied=await tool('cardstudio_scean_diagnose',{});assert(!denied.ok&&denied.error.code==='DIAG_DENIED','revocation did not stop access');
  });
  await check('Completing background working-card hydration preserves the selected diagnostic Run',async()=>{
   await fs.writeFile(path.join(hostOut,'release-read'),'release');await ready();
   assert(await browser.evaluate("document.querySelector('[data-details=diagnosis-permission] code').textContent")===oldFile.run.runId,'hydration changed Run identity');
  });
  await check('Desktop keyboard consent traverses the real RPC and still requires separate repair agreement',async()=>{
   await browser.resize(1440,1000);await browser.evaluate("document.querySelector('[data-diagnosis-grant]').focus()");await browser.key('Enter');await browser.wait("!!document.querySelector('[data-diagnosis-active]')");
   const denied=await tool('card_patch_fields',{document_id:cardId,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Unauthorized synthetic patch'}]});assert(!denied.ok&&denied.error.code==='DIAG_EDIT_CONSENT','diagnostic consent granted edit rights');
   await screenshot('consent-active-desktop',1440,1000);await browser.click('[data-diagnosis-revoke]');await browser.wait("!document.querySelector('[data-diagnosis-active]')");
  });
  assert(errors.length===0,errors.join('\n'));assert(sha(await fs.readFile(oldFile.path))===oldFile.hash,'original Run bytes changed');
  const report={status:'PASS',checks,errors,surface:'official isolated DSH rc.2 Host; actual SDK/RPC/registered tools; scripted synthetic fault gates only; no model',oldRunBytesUnchanged:true,paidModelCalls:0,productionWrites:0,liveInstalled:false,phoneSafariTested:false};
  await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',checks:checks.length,errors:errors.length}));
 }
 await fs.writeFile(path.join(hostOut,'release-read'),'release');
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2));await fs.writeFile(path.join(hostOut,'release-read'),'release');await fs.writeFile(path.join(hostOut,'release-grant'),'release');if(browser){browser.topFrame();await browser.screenshot(path.join(out,'failure.png')).catch(()=>{});}console.error(error);process.exitCode=1;}finally{await browser?.close();}
