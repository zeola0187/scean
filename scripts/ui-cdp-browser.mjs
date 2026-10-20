// Dependency-free Chrome test driver. Only localhost synthetic fixtures are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
// The official workspace may restore its sidebar asynchronously after a page
// reload. Let that retain the requested Session before one explicit selection,
// and await selection rather than racing a second open against the restore.
export async function selectFixtureSession(browser,id){
  const row=`__uiSessions.list.getSnapshot().byId[${JSON.stringify(id)}]`,selected=`${row}?.retainedBy.mainView>0`;
  await browser.wait(`!!${row}`);
  try{await browser.wait(selected,5000);}catch{
    await browser.evaluate(`(async()=>{if(!(${selected}))await __uiWorkspace.openSession(${JSON.stringify(id)});})()`);
  }
  await browser.wait(selected);await browser.frames();
}
export async function launchUiBrowser(directory){
  await fs.mkdir(directory,{recursive:true});
  await fs.unlink(path.join(directory,'DevToolsActivePort')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const child=spawn(process.env.SCEAN_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+directory,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--no-proxy-server','about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;
  for(let i=0;i<200;i++){try{port=Number((await fs.readFile(path.join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  if(!port){child.kill();throw Error('Chrome debugging startup failed');}
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  const socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl),pending=new Map(),events=new Map();let sequence=0;
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const message=JSON.parse(e.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}}else for(const fn of events.get(message.method)??[])fn(message.params,message.sessionId);};
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
  let contextId,frameSession,frameOffset={x:0,y:0};const contexts=new Map();
  events.set('Runtime.executionContextCreated',new Set([(p,sessionId)=>{if(p.context.auxData?.isDefault)contexts.set(p.context.auxData.frameId,{id:p.context.id,sessionId});}]));
  events.set('Target.attachedToTarget',new Set([p=>{if(p.targetInfo.type==='iframe')void call('Runtime.enable',{},p.sessionId).catch(()=>{});} ]));
  const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true,userGesture:true},frameSession);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){try{if(await evaluate(expression))return;}catch(error){if(!/navigated|context.*destroyed|Cannot find context/i.test(error.message))throw error;}await new Promise(r=>setTimeout(r,50));}throw Error('UI condition timed out: '+expression);};
  const frames=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click=async(selector)=>{const b=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing control');n.scrollIntoView({block:'nearest',inline:'nearest'});const b=n.getBoundingClientRect();if(!b.width||!b.height)throw Error('Hidden control');return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);b.x+=frameOffset.x;b.y+=frameOffset.y;await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...b});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...b});try{await frames();}catch(error){if(!/navigated|context.*destroyed|Cannot find context/i.test(error.message))throw error;await wait("document.readyState==='complete'");}};
  const select=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await frames();};
  const key=async(key,code=key,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text:key==='Enter'?'\r':key===' '?' ':undefined,windowsVirtualKeyCode:key==='Enter'?13:key===' '?32:undefined});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await frames();};
  const resize=async(width,height)=>{await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await frames();};
  const screenshot=async(file)=>{await frames();const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(file,Buffer.from(data,'base64'));};
  await call('Page.enable');await call('Runtime.enable');await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
  return {call,evaluate,wait,frames,click,select,key,resize,screenshot,async nativeFrame(){for(let i=0;i<200;i++){for(const c of [...contexts.values()].reverse()){try{const r=await call('Runtime.evaluate',{expression:"!!document.querySelector('#reading-pane')",contextId:c.id,returnByValue:true},c.sessionId);if(r.result?.value){contextId=c.id;frameSession=c.sessionId;const offset=await call('Runtime.evaluate',{expression:"(()=>{const f=document.querySelector('iframe[data-scean-native-player]');if(!f)return {x:0,y:0};const r=f.getBoundingClientRect();return {x:r.left,y:r.top};})()",returnByValue:true});frameOffset=offset.result.value;return;}}catch{}}await new Promise(r=>setTimeout(r,50));}throw Error('Native frame context unavailable');},topFrame(){contextId=undefined;frameSession=undefined;frameOffset={x:0,y:0};},on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},async navigate(url){contextId=undefined;frameSession=undefined;frameOffset={x:0,y:0};if(!url.startsWith('http://127.0.0.1:'))throw Error('Only synthetic localhost');await call('Page.navigate',{url});await wait("document.readyState==='complete'");},async close(){try{await call('Browser.close');}catch{}socket.close();child.kill();}};
}
