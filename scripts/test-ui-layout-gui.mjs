// Actual Chrome renderer / shared Web UI + generated native iframe.
// Test-only public transport around the unchanged Host; isolated/server's
// PRIMARY_MACHINE_REQUIRED guard is never changed, mocked or invoked here.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {launchUiBrowser} from './ui-cdp-browser.mjs';
const root=path.resolve(import.meta.dirname,'..');await fs.mkdir(path.join(root,'evidence/ui-layout'),{recursive:true});const out=await fs.mkdtemp(path.join(root,'evidence/ui-layout/gui-'));
const baseline=process.argv.includes('--baseline'),web=path.join(baseline?path.resolve(root,'../ui-baseline'):root,'isolated/web');
const report={status:'RUNNING',baseline,layer:'Chrome renderer / public synthetic transport + unchanged real Host Core Store; native mount uses a synthetic DSH/React shell',formalDesktop:'NOT_RUN',physicalPhone:'NOT_RUN',paidModelCalls:0,embeddingCalls:0,checks:[],screenshots:[],requests:[]};
let browser,server,host,models=0;
const record=async()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'});await record();}
async function shot(name){const file=name+'.png';await browser.screenshot(path.join(out,file));report.screenshots.push(file);}
const runId='synthetic-ui-long-35';let frontId;
try{
  const store=new DurableStore({root:path.join(out,'data/store')});await store.create(syntheticLongrun({turns:35,runId,bodyRepeats:90,chapters:2}));
  const engine=new SceanEngine({store,memory:new Memory(),model:{async generate(){models++;throw Error('MODEL_FORBIDDEN');},async describe(){return {source:'UI-only synthetic fixture'};}}});
  host=await new SceanHost({engine,root:path.join(out,'data/host')}).init();
  frontId=(await host.createRun({snapshot:w01Fixture('fantasy').snapshot})).runId;
  const csrf=randomUUID(),viewerId=randomUUID();let origin;
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/api/bootstrap')return send(res,200,{csrfToken:csrf,viewerId,mode:'scripted',dataRootLabel:'合成 UI 驗收資料',models:{mode:'scripted',source:'UI-only fixture',paidCalls:0},studio:{available:false}});
      if(req.method==='POST'&&url.pathname==='/api'){
        if(req.headers.origin!==origin||req.headers['x-scean-token']!==csrf)return send(res,403,{ok:false});
        let text='';for await(const b of req){text+=b;if(text.length>1024*1024)throw Error('BOUND');}const request=JSON.parse(text);report.requests.push(request.action);
        if(['turn','operationSubmit','summaryStart','chapterSummarize','chapterAuto','chapterClose','chapterSettings','chapterProviderSave','chapterProviderClear'].includes(request.action))throw Error('GENERATION_OR_CONFIGURATION_FORBIDDEN');
        if(request.action==='catalog')return send(res,200,{ok:true,value:{cards:[]}});
        if(request.action==='models')return send(res,200,{ok:true,value:{mode:'scripted',source:'UI-only fixture'}});
        if(request.action==='context')return send(res,200,{ok:true,value:{cardScope:{provider:'synthetic-ui',cardId:'synthetic-ui',generation:'synthetic-ui'}}});
        // This appearance-only transport has no Studio pending handoff. The
        // opening workflow is covered separately with actual Studio authority.
        if(request.action==='openingOffer')return send(res,200,{ok:true,value:null});
        return send(res,200,await host.request(request,undefined,{allowPrivateDiagnostics:false,allowPrivateSaves:false,principal:'synthetic-ui-only'}));
      }
      if(req.method!=='GET')return send(res,405,{});
      if(url.pathname==='/native'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh"></body></html>');return;}
      if(url.pathname==='/native-client.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(await fs.readFile(path.join(root,'plugin/client.js')));return;}
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!/^[\w-]+\.(mjs|css|html)$/.test(name))return send(res,404,{});
      const data=await fs.readFile(path.join(web,name));res.writeHead(200,{'content-type':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});res.end(data);
    }catch(error){send(res,500,{ok:false,error:{code:'SYNTHETIC_FIXTURE_ERROR',message:error.message}});}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await launchUiBrowser(path.join(out,'chrome-profile'));report.browserErrors=[];browser.on('Runtime.exceptionThrown',p=>report.browserErrors.push(p.exceptionDetails.exception?.description??p.exceptionDetails.text));await browser.resize(1440,1000);await browser.navigate(origin);
  const selectRun=async id=>{const narrow=await browser.evaluate("getComputedStyle(document.querySelector('.view-tabs')).display!=='none'");if(narrow)await browser.click('#view-library');else if(!baseline&&await browser.evaluate("document.body.dataset.leftCollapsed==='true'"))await browser.click('#toggle-library');await browser.click('#runs button[data-run-id="'+id+'"]');await browser.wait(`document.querySelector('#run-version').textContent.includes(${JSON.stringify(id)})&&!document.querySelector('#input').disabled`);await browser.frames();};
  await browser.wait("document.querySelectorAll('#runs button').length===2");await selectRun(runId);
  await browser.click('#preferences-panel>summary');await browser.select('#reading-theme','dark');await browser.click('#preferences-panel .drawer-close');await shot(baseline?'before-desktop':'forest-desktop');
  if(baseline){report.status='PASS';await record();}
  else{
    await check('Web: three palettes, semantic colors and independent brightness',async()=>{
      await browser.click('#preferences-panel>summary');
      for(const [palette,page] of [['black','rgb(11, 11, 13)'],['forest','rgb(16, 25, 22)'],['wine','rgb(21, 16, 19)']]){await browser.select('#dark-palette',palette);assert.equal(await browser.evaluate('getComputedStyle(document.body).backgroundColor'),page);await browser.click('#preferences-panel .drawer-close');await shot(palette+'-desktop');await browser.click('#preferences-panel>summary');}
      await browser.select('#reading-theme','light');assert.equal(await browser.evaluate('document.documentElement.dataset.theme'),'light');await browser.select('#reading-theme','dark');await browser.click('#preferences-panel .drawer-close');
    });
    await check('Web: all four sidebar combinations and reading/input widths',async()=>{
      const widths=[];
      for(const [left,right,label] of [[false,false,'both'],[true,false,'left-closed'],[true,true,'both-closed'],[false,true,'right-closed']]){
        const current=await browser.evaluate('({left:document.body.dataset.leftCollapsed===\'true\',right:document.body.dataset.rightCollapsed===\'true\'})');if(current.left!==left)await browser.click('#toggle-library');if(current.right!==right)await browser.click('#toggle-scene');
        const size=await browser.evaluate(`({left:getComputedStyle(document.querySelector('#library-pane')).display,right:getComputedStyle(document.querySelector('#scene-pane')).display,chat:document.querySelector('#chat').getBoundingClientRect().width,input:document.querySelector('#input').getBoundingClientRect().width,viewport:innerWidth,scroll:document.documentElement.scrollWidth})`);
        assert.equal(size.left==='none',left);assert.equal(size.right==='none',right);assert(size.scroll<=size.viewport);widths.push({label,...size});await shot('layout-'+label);
      }
      report.widths=widths;assert(widths[2].chat>widths[0].chat+200,JSON.stringify(widths));assert(widths[2].input>widths[0].input+400,JSON.stringify(widths));
    });
    await check('Web: keyboard restore and hidden-pane focus recovery',async()=>{
      await browser.evaluate("document.querySelector('#toggle-scene').focus()");await browser.key('Enter');assert.equal(await browser.evaluate("document.body.dataset.rightCollapsed"),'false');
      await browser.evaluate("document.querySelector('#toggle-library').focus()");await browser.key(' ','Space');assert.equal(await browser.evaluate("document.body.dataset.leftCollapsed"),'true');
      await browser.key(' ','Space');assert.equal(await browser.evaluate("document.body.dataset.leftCollapsed"),'false');
      await browser.evaluate("document.querySelector('#runs button').focus();document.querySelector('#toggle-library').click()");assert.equal(await browser.evaluate('document.activeElement.id'),'toggle-library');
    });
    await check('Web: long text anchor and draft/focus survive repeated sidebar reflow',async()=>{
      await browser.evaluate("(()=>{const input=document.querySelector('#input');input.value='尚未送出的合成草稿';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(3,6);})()");await browser.frames();
      await browser.evaluate("(()=>{const r=document.querySelector('#reading-pane');r.scrollTop=r.scrollHeight*.45;})()");await browser.frames();
      await browser.evaluate("import('./reading-layout.mjs').then(m=>window.anchor=m.captureReadingAnchor(document.querySelector('#reading-pane')))");
      assert(await browser.evaluate('!!anchor?.range'));
      for(let i=0;i<12;i++)await browser.click('#toggle-scene');
      const state=await browser.evaluate("({offset:anchor.range.getBoundingClientRect().top-document.querySelector('#reading-pane').getBoundingClientRect().top,expected:anchor.offset,input:document.querySelector('#input').value,focus:document.activeElement.id,start:document.querySelector('#input').selectionStart,end:document.querySelector('#input').selectionEnd})");
      assert(Math.abs(state.offset-state.expected)<3,JSON.stringify(state));assert.equal(state.focus,'input');assert.equal(state.input,'尚未送出的合成草稿');assert.equal(state.start,3);assert.equal(state.end,6);await shot('long-text-anchor');
      await browser.click('#preferences-panel>summary');for(const value of ['comfortable','wide'])await browser.select('#reading-width',value);for(const value of ['normal','large'])await browser.select('#reading-size',value);await browser.click('#preferences-panel .drawer-close');
      const delta=await browser.evaluate("anchor.range.getBoundingClientRect().top-document.querySelector('#reading-pane').getBoundingClientRect().top-anchor.offset");assert(Math.abs(delta)<3,'font/width anchor drift '+delta);
    });
    await check('Web: responsive boundary sizes, three tabs and composer remain reachable',async()=>{
      report.viewports=[];
      for(const [width,height] of [[1920,1080],[1280,720],[1180,800],[1179,800],[1024,768],[768,1024],[600,800],[599,800],[390,844],[360,640],[844,390]]){
        await browser.resize(width,height);await browser.evaluate("(()=>{const t=document.querySelector('#view-story');if(getComputedStyle(t.parentElement).display!=='none')t.click();})()");await browser.frames();
        const size=await browser.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,input:document.querySelector('#input').getBoundingClientRect().toJSON(),send:document.querySelector('#send').getBoundingClientRect().toJSON(),tabs:getComputedStyle(document.querySelector('.view-tabs')).display,controls:getComputedStyle(document.querySelector('.workspace-controls')).display,reading:document.querySelector('#reading-pane').clientHeight})");
        assert(size.scroll<=width+1,JSON.stringify(size));assert(size.input.bottom<=height+1&&size.send.bottom<=height+1,JSON.stringify(size));assert(size.reading>60);assert.equal(size.tabs==='none',width>=1180);assert.equal(size.controls==='none',width<1180);report.viewports.push(size);
        if(width<1180)for(const tab of ['library','state','story']){await browser.click('#view-'+tab);assert.equal(await browser.evaluate('document.body.dataset.playerView'),tab);}
        size.anchorDrift=await browser.evaluate("anchor.range.getBoundingClientRect().top-document.querySelector('#reading-pane').getBoundingClientRect().top-anchor.offset");assert(Math.abs(size.anchorDrift)<3,'viewport '+width+' anchor drift '+size.anchorDrift);
        if([1179,768,390,844].includes(width))await shot('viewport-'+width+'x'+height);
      }
    });
    await browser.resize(1440,1000);
    await check('Web: text anchor survives desktop/tablet/mobile round trip',async()=>{const delta=await browser.evaluate("anchor.range.getBoundingClientRect().top-document.querySelector('#reading-pane').getBoundingClientRect().top-anchor.offset");assert(Math.abs(delta)<3,'viewport anchor drift '+delta);});
    await check('Web: chapter tools, history paging and safe card frontend preserve rendering',async()=>{
      await browser.click('#longform-panel>summary');assert.equal(await browser.evaluate("document.querySelectorAll('#chapters button').length"),2);await shot('chapters');await browser.click('#longform-panel .drawer-close');
      await browser.click('#history-earlier');await browser.wait("document.querySelectorAll('#chat .story').length>10");
      await selectRun(frontId);await browser.wait("document.querySelector('#card-frontend-frame')&&!document.querySelector('#card-frontend-frame').hidden");
      const before=await browser.evaluate("document.querySelector('#card-frontend-frame').srcdoc");assert(before.includes('#fff4d5'));assert.equal(await browser.evaluate("document.querySelector('#card-frontend-frame').getAttribute('sandbox')"),'');
      await browser.click('#preferences-panel>summary');await browser.select('#dark-palette','black');await browser.click('#preferences-panel .drawer-close');assert.equal(await browser.evaluate("document.querySelector('#card-frontend-frame').srcdoc"),before);await shot('card-frontend-black');
      await selectRun(runId);assert.equal(await browser.evaluate('document.documentElement.dataset.darkPalette'),'black');
    });
    await check('Web: persisted appearance and draft survive reload; blocked storage stays usable',async()=>{
      await browser.evaluate("(()=>{const i=document.querySelector('#input');i.value='重開後保留的合成草稿';i.dispatchEvent(new Event('input',{bubbles:true}));})()");await browser.wait("document.querySelector('#draft-status').textContent.includes('已保存')");
      const saved=await browser.evaluate("localStorage.getItem('scean.presentation.v1')");await browser.call('Page.reload');await browser.wait("document.querySelector('#run-version')?.textContent.includes('synthetic-ui-long-35')&&!document.querySelector('#input').disabled");assert.equal(await browser.evaluate("localStorage.getItem('scean.presentation.v1')"),saved);assert.equal(await browser.evaluate("document.querySelector('#input').value"),'重開後保留的合成草稿');
      await browser.evaluate("Storage.prototype.setItem=function(){throw Error('synthetic blocked storage')}");await browser.click('#toggle-scene');await browser.frames();assert(await browser.evaluate("document.querySelector('#presentation-status').textContent.includes('無法保存')"));assert.equal(await browser.evaluate("document.querySelector('#input').value"),'重開後保留的合成草稿');
    });
    // Generated client, opaque iframe and native bridge are exercised verbatim.
    await browser.navigate(origin+'/native');const nativeMount=`(()=>{
      const effects=[],cleanups=[];window.nativePanels=[];
      const React={useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),createElement(type,props,...children){const n=document.createElement(type);for(const [k,v] of Object.entries(props??{})){if(k==='ref')v.current=n;else if(k==='style')Object.assign(n.style,v);else if(k.startsWith('on'))n.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='srcDoc')n.srcdoc=v;else n.setAttribute(k,String(v));}for(const c of children)n.append(c);return n;}};
      const context={sessions:{list:{getSnapshot:()=>({byId:{synthetic:{id:'synthetic-ui-session',retainedBy:{mainView:1}}}}),subscribe:()=>()=>{}}},remote:{$mount:async()=>{},scean:{request:async request=>({ok:true,value:await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json','X-Scean-Token':${JSON.stringify(csrf)}},body:JSON.stringify(request)}).then(r=>r.json())})}},typert:{},layout:{selectPanel:k=>nativePanels.push(k)},slots:{inject:(_slot,fn)=>fn(),register(options,Component){if(options.key==='local-scean'){document.body.append(Component());for(const fn of effects.splice(0)){const dispose=fn();if(dispose)cleanups.push(dispose);}}return()=>{};}},inject(_deps,fn){return fn(this)},effect(fn){cleanups.push(fn())}};
      window.nativeUnmount=()=>{for(const cleanup of cleanups.reverse())cleanup?.();document.body.replaceChildren();};window.__ModuleLoader__={load:module=>module.factory(()=>React).apply(context)};const script=document.createElement('script');script.src='/native-client.js';document.body.append(script);
    })()`;await browser.evaluate(nativeMount);await browser.nativeFrame();await browser.wait("document.querySelector('#run-version')");browser.topFrame();await browser.evaluate(`window.dispatchEvent(new CustomEvent('scean:open',{detail:{runId:${JSON.stringify(runId)},authoringSessionId:'synthetic-ui-session'}}))`);await browser.nativeFrame();await browser.wait("document.querySelector('#run-version').textContent.includes('synthetic-ui-long-35')&&!document.querySelector('#input').disabled");
    await check('Native generated iframe: palette/sidebar preferences traverse only parent storage',async()=>{
      await browser.click('#preferences-panel>summary');await browser.select('#reading-theme','dark');await browser.select('#dark-palette','wine');await browser.click('#preferences-panel .drawer-close');await browser.click('#toggle-library');await browser.click('#toggle-scene');
      assert.equal(await browser.evaluate("document.documentElement.dataset.darkPalette"),'wine');assert.equal(await browser.evaluate("document.body.dataset.rightCollapsed"),'true');await shot('native-wine-wide');
      browser.topFrame();const saved=await browser.evaluate("JSON.parse(localStorage.getItem('scean.presentation.v1'))");assert.equal(saved.darkPalette,'wine');assert.equal(saved.rightCollapsed,true);await browser.nativeFrame();
      for(const [w,h] of [[1179,800],[768,1024],[390,844],[844,390]]){await browser.resize(w,h);await browser.click('#view-story');assert(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await shot('native-'+w+'x'+h);}
    });
    await check('Native: remount restores both sidebar preferences and storage failure remains local',async()=>{
      browser.topFrame();await browser.evaluate('nativeUnmount()');await browser.resize(1440,1000);await browser.evaluate(nativeMount);await browser.nativeFrame();await browser.wait("document.documentElement.dataset.darkPalette==='wine'&&document.body.dataset.leftCollapsed==='true'&&document.body.dataset.rightCollapsed==='true'");await shot('native-remount');
      browser.topFrame();await browser.evaluate("Storage.prototype.setItem=function(){throw Error('synthetic parent storage failure')}");await browser.nativeFrame();await browser.click('#toggle-scene');await browser.wait("document.querySelector('#presentation-status').textContent.includes('無法保存')");assert.equal(await browser.evaluate('document.body.dataset.rightCollapsed'),'false');
    });
    assert.equal(models,0);assert(!report.requests.includes('native.presentationSave'));report.status='PASS';await record();
  }
}catch(error){report.status='FAIL';report.error={message:error.message,stack:error.stack};await shot('failure').catch(()=>{});await record();throw error;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await host?.close();report.modelsAttempted=models;await record();console.log(JSON.stringify({status:report.status,checks:report.checks.length,out}));}
