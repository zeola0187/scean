// Actual Chrome + generated opaque iframe, real Studio Loader/Control/Host/Core.
// The outer DSH React/Session mount is a synthetic harness. No model can run.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {launchUiBrowser} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),reportRoot=path.join(root,'evidence/opening-candidate');
await fs.mkdir(reportRoot,{recursive:true});await fs.mkdir(path.join(root,'.test-data'),{recursive:true});
const out=await fs.mkdtemp(path.join(reportRoot,'gui-'));
const report={status:'RUNNING',layer:'actual Chrome/generated native iframe; real Studio Loader/Control + Host/Core/Store; synthetic outer DSH mount',formalDesktop:'NOT_RUN',models:0,checks:[]};
let browser,child,ready;
const record=()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'});await record();}
const runs=async()=>{const dir=path.join(ready.out,'store/runs');const names=await fs.readdir(dir).catch(()=>[]);const values=await Promise.all(names.map(n=>fs.readFile(path.join(dir,n,'current.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;})));return values.filter(Boolean);};
const expectRuns=async count=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const rows=await runs();if(rows.length===count)return rows;await new Promise(r=>setTimeout(r,25));}throw Error('Committed Run count did not settle at '+count);};
const top=()=>browser.topFrame(),frame=()=>browser.nativeFrame();
async function fixture(kind){top();await browser.click('[data-case="'+kind+'"]');await frame();}
const offer=()=>browser.wait("!document.querySelector('#opening-selection').hidden&&!document.querySelector('#opening-start').disabled");
const readyRun=id=>browser.wait("!document.querySelector('#input').disabled&&document.querySelector('#run-version').textContent.includes("+JSON.stringify(id)+")");
try{
 child=spawn(process.execPath,['--require',path.join(root,'scripts/w19-offline-network.cjs'),path.join(root,'scripts/opening-selection-gui-host.mjs')],{cwd:root,env:{...process.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
 ready=await new Promise((resolve,reject)=>{let pending='';const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),20000);child.stdout.on('data',chunk=>{pending+=chunk;for(const line of pending.split('\n')){try{const row=JSON.parse(line);if(row.url&&row.out){clearTimeout(timer);resolve(row);return;}}catch{}}});child.on('exit',code=>reject(Error('Fixture exited '+code)));child.stderr.on('data',chunk=>fs.appendFile(path.join(out,'fixture-stderr.log'),chunk));});
 browser=await launchUiBrowser(path.join(out,'chrome-profile'));await browser.resize(1440,1000);await browser.navigate(ready.url);await frame();await offer();
 await check('saved main and alternate previews do not create a Run',async()=>{
  const before=await browser.evaluate("document.querySelector('#saved-opening-preview').textContent");assert(before.trim());
  assert.deepEqual(await browser.evaluate("[...document.querySelector('#opening-choice').options].map(o=>o.value)"),['0','1','2']);
  await browser.select('#opening-choice','2');assert.notEqual(await browser.evaluate("document.querySelector('#saved-opening-preview').textContent"),before);assert.equal((await runs()).length,0);
 });
 let first;
 await check('confirm alternate freezes its original saved identity and revision',async()=>{await browser.click('#opening-start');const list=await expectRuns(1);first=list[0];await readyRun(first.runId);assert.equal(first.snapshot.opening.id,'studio-opening-2');assert.equal(first.snapshot.revision,0);await browser.screenshot(path.join(out,'alternate-start.png'));});
 await check('reopen the same saved version with main opening; old Run remains unchanged',async()=>{
  await browser.click('#opening-new');await offer();await browser.select('#opening-choice','0');await browser.click('#opening-start');const list=await expectRuns(2);await readyRun(list.find(r=>r.runId!==first.runId).runId);assert(list.some(r=>r.snapshot.opening.id==='studio-opening-0'));
  const old=list.find(r=>r.runId===first.runId);assert.equal(old.snapshot.hash,first.snapshot.hash);assert.equal(old.snapshot.opening.text,first.snapshot.opening.text);
  if(await browser.evaluate("document.body.dataset.leftCollapsed==='true'"))await browser.click('#toggle-library');
  await browser.click('#runs button[data-run-id="'+first.runId+'"]');await browser.wait("document.querySelector('#run-version').textContent.includes("+JSON.stringify(first.runId)+")&&!document.querySelector('#input').disabled");
 });
 await check('blank main is omitted without renumbering; cancellation creates no Run',async()=>{await fixture('blank');await offer();assert.deepEqual(await browser.evaluate("[...document.querySelector('#opening-choice').options].map(o=>o.value)"),['1','2']);await browser.click('#opening-dismiss');await browser.wait("document.querySelector('#opening-selection').hidden");assert.equal((await runs()).length,2);});
 await check('single valid opening starts directly',async()=>{await fixture('single');const list=await expectRuns(3);const single=list.find(r=>r.snapshot.card.data.name.endsWith('single'));assert(single);await readyRun(single.runId);});
 await check('saved revision change invalidates stale choice; fresh handoff admits revision 1',async()=>{
  await fixture('multi');await offer();await fixture('revision');await browser.wait("!document.querySelector('#opening-error').hidden&&document.querySelector('#opening-start').disabled");assert.equal((await runs()).length,3);
  await fixture('again');await offer();await browser.select('#opening-choice','1');await browser.click('#opening-start');const list=await expectRuns(4);const revised=list.find(r=>r.snapshot.revision===1&&r.snapshot.opening.id==='studio-opening-1');assert(revised);await readyRun(revised.runId);
 });
 await check('all three palettes and independent sidebars remain usable after opening choice',async()=>{
  await browser.click('#preferences-panel>summary');await browser.select('#reading-theme','dark');for(const name of ['black','forest','wine']){await browser.select('#dark-palette',name);assert.equal(await browser.evaluate('document.documentElement.dataset.darkPalette'),name);}await browser.click('#preferences-panel .drawer-close');
  for(const [left,right] of [[true,false],[true,true],[false,true],[false,false]]){if((await browser.evaluate("document.body.dataset.leftCollapsed==='true'"))!==left)await browser.click('#toggle-library');if((await browser.evaluate("document.body.dataset.rightCollapsed==='true'"))!==right)await browser.click('#toggle-scene');assert.equal(await browser.evaluate("document.body.dataset.leftCollapsed==='true'"),left);assert.equal(await browser.evaluate("document.body.dataset.rightCollapsed==='true'"),right);}
 });
 await check('390px opening chooser is contained and action targets remain reachable',async()=>{await fixture('multi');await offer();top();await browser.click('#mobile');await frame();await offer();const sizes=await browser.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:['opening-start','opening-dismiss','opening-return'].map(id=>document.getElementById(id).getBoundingClientRect().height)})");assert.equal(sizes.width,390);assert(sizes.scroll<=391);assert(sizes.buttons.every(h=>h>=44));report.mobile=sizes;await browser.screenshot(path.join(out,'mobile-chooser.png'));await browser.click('#opening-dismiss');});
 const raw=JSON.parse(await fs.readFile(path.join(ready.out,'result.json'),'utf8'));assert.equal(raw.modelCalls,0);report.models=raw.modelCalls;report.runCount=(await runs()).length;report.fixtureResultSha256=createHash('sha256').update(JSON.stringify(raw)).digest('hex');report.status='PASS';await record();
}catch(error){report.status='FAIL';report.error={message:error.message,stack:error.stack};await record();if(browser)await browser.screenshot(path.join(out,'failure.png')).catch(()=>{});throw error;}
finally{await browser?.close();child?.kill();console.log(JSON.stringify({status:report.status,checks:report.checks.length,out}));}
