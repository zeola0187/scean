// Official rc.2 Web Profile, separate home/browser data, no active Desktop.
import fs from 'node:fs/promises';
import path from 'node:path';
import {launchUiBrowser} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'evidence/ui-layout/official');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'RUNNING'}));
const launch=JSON.parse(await fs.readFile(path.join(root,'evidence/ui-layout-official-host/launch.json'),'utf8'));
if(!launch.isolated||!path.resolve(launch.home).startsWith(path.join(root,'evidence')+path.sep))throw Error('ISOLATION_REQUIRED');
let browser;
try{
 browser=await launchUiBrowser(path.join(out,'chrome-profile'));await browser.resize(1440,1000);await browser.navigate(launch.entry);await browser.wait("!!document.querySelector('#root')");await new Promise(r=>setTimeout(r,3500));
 const state=await browser.evaluate("({title:document.title,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(n=>({text:n.innerText,label:n.getAttribute('aria-label'),title:n.getAttribute('title')}))})");await fs.writeFile(path.join(out,'initial-dom.json'),JSON.stringify(state,null,2));await browser.screenshot(path.join(out,'official-initial.png'));console.log(JSON.stringify({title:state.title,officialUiReady:true}));
 await browser.evaluate("(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.innerText==='继续');if(n)n.id='ui-fixture-continue';})()");if(await browser.evaluate("!!document.querySelector('#ui-fixture-continue')"))await browser.click('#ui-fixture-continue');
 await browser.resize(1920,1080);
 await browser.wait('!!window.__uiWorkspace');
 await browser.evaluate(`__uiSessions.create({cwd:${JSON.stringify(launch.workspace)}}).then(id=>{window.__uiSession=id;__uiWorkspace.openSession(id);})`);await browser.wait('!!window.__uiSession');await browser.frames();
 await new Promise(r=>setTimeout(r,700));await browser.evaluate("__uiLayout.selectPanel('local-scean')");await browser.frames();await browser.nativeFrame();await browser.wait("!!document.querySelector('#reading-theme')");
 await browser.wait("document.querySelector('#connection').textContent.includes('已連線')");await new Promise(r=>setTimeout(r,700));await browser.click('#preferences-panel>summary');await browser.wait("document.querySelector('#preferences-panel dialog').open");await browser.select('#reading-theme','dark');await browser.select('#dark-palette','black');await browser.click('#preferences-panel .drawer-close');await browser.screenshot(path.join(out,'official-black.png'));
 const actual=await browser.evaluate("({width:innerWidth,height:innerHeight,palette:document.documentElement.dataset.darkPalette,body:getComputedStyle(document.body).backgroundColor,controls:getComputedStyle(document.querySelector('.workspace-controls')).display})");await fs.writeFile(path.join(out,'player-dom.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify({officialPlayer:actual}));
 if(actual.width>=1180){await browser.click('#toggle-library');await browser.click('#toggle-scene');await browser.screenshot(path.join(out,'official-both-closed.png'));}
 await browser.resize(768,1024);await browser.nativeFrame();await browser.click('#view-story');await browser.screenshot(path.join(out,'official-tablet.png'));
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'PASS',layer:'actual official DSH 0.2.1-rc.2 Web Profile + actual generated native panel; blank synthetic session, no real provider',formalDesktop:'NOT_RUN',paidModelCalls:0,embeddingCalls:0,actual,screenshots:['official-black.png','official-both-closed.png','official-tablet.png']},null,2));
}catch(error){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'FAIL',error:error.message}));if(browser){await browser.screenshot(path.join(out,'official-failure.png')).catch(()=>{});console.log(JSON.stringify(await browser.evaluate("({location:location.origin+location.pathname,text:document.body.innerText,html:document.body.innerHTML.slice(0,500)})").catch(e=>({error:e.message}))));}throw error;}finally{await browser?.close();}
