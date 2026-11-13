import {mountPlayerShell} from './player-shell.mjs';
// All preferences live only in the parent test page's memory. Never mount app.mjs.
const owner=parent.gridFixturePreferences;
let preferences={schemaVersion:1,theme:'light',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false,...owner.value};
globalThis.__SCEAN_NATIVE__={request:async(action,value)=>{
  if(action==='native.presentationGet')return {...preferences,persistence:'saved'};
  if(action==='native.presentationEnvironment')return {dark:false};
  if(action==='native.presentationSave'){preferences={...value};owner.value={...value};owner.saves++;return {...value,persistence:'saved'};}
  owner.unexpected.push(action);throw Error('Unexpected operation: '+action);
}};
const shell=mountPlayerShell();
document.querySelector('#mode-banner').hidden=true;
document.querySelector('#run-title').textContent='Synthetic layout regression — no real Run';
document.querySelector('#connection').textContent='SYNTHETIC ONLY';
const chat=document.querySelector('#chat');chat.replaceChildren();
for(let i=1;i<=24;i++){
  const article=document.createElement('article');article.className='message story';
  const header=document.createElement('header');header.textContent='SYNTHETIC STORY '+i;
  const body=document.createElement('div');body.className='body';body.textContent='隔離合成正文：書架與此刻收合時，這段文字仍應完整顯示並可以捲動。\n\n雨後的街道映著燈光，旅人沿著河岸繼續前行。';
  article.append(header,body);chat.append(article);
}
document.querySelector('#card-title').textContent='Synthetic story';
document.querySelector('#state-summary').textContent='Synthetic scene, no production data';
shell.committed();shell.adoptReading();
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
document.body.dataset.fixtureReady='true';
