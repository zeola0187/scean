// Offline GUI acceptance: real Studio Loader/Control + Host/Core/Store and the
// actual generated native iframe. DSH React/Session mounting is a synthetic shim.
// Run with --require ./scripts/w19-offline-network.cjs; no provider or private data.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {WorkspaceLoader} from '../packages/studio/lib/loader.js';
import {createSceanControl,resolveSceanCardContext} from '../packages/studio/lib/scean-integration.js';
import {compileNativePlayer} from './build-player-native.mjs';
const repo=path.resolve(import.meta.dirname,'..'),out=await fs.mkdtemp(path.join(repo,'.test-data/opening-gui-')),studioRoot=path.join(out,'studio');
await fs.mkdir(studioRoot);
const agent={id:'opening-gui-session',status:'idle',session:{header:{cwd:studioRoot}},whenIdle:async()=>{},cancel(){}};
const loader=new WorkspaceLoader({root:studioRoot,leaseMs:3600000,agentLookup:id=>id===agent.id?agent:null,activateAddon:async()=>({dispose(){}})});
await loader.init();await loader.setArchiveState([]);const claim=await loader.acquire(agent,'opening-gui-page'),record=loader.records.get(agent.id);
let modelCalls=0;
const host=await new SceanHost({root:path.join(out,'host'),engine:new SceanEngine({store:new DurableStore({root:path.join(out,'store')}),memory:new Memory(),model:{generate(){modelCalls++;throw Error('MODEL_FORBIDDEN');}}})}).init();
const control=createSceanControl(loader,()=>host),authority={principal:'synthetic-local-operator',requireCardScope:true,resolveCardScope:id=>resolveSceanCardContext(loader,id)};
let current=null;const calls=[];
const card=kind=>({spec:'chara_card_v3',spec_version:'3.0',data:{name:'合成開場測試 '+kind,description:'此頁只使用原創合成卡，沒有正式資料或真實模型。',personality:'Calm',scenario:'QA',first_mes:kind==='blank'?'':'主開場：觀測站大門亮起，守門人向你招手。',mes_example:'',creator_notes:'Synthetic acceptance only',system_prompt:'',post_history_instructions:'',alternate_greetings:kind==='single'?[]:['替代開場一：你站在港邊，守門人遞來一份星圖。','替代開場二：夜班列車抵站，月光照亮空蕩大廳。'],group_only_greetings:['未採用的群聊開場。'],tags:[],creator:'QA',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'守門人',description:'原創合成守門人。'}]}},character_book:{entries:[]}}});
const operation=async(action,args)=>{const r=await loader.call(agent,record,claim,action,args);if(!r.ok)throw Object.assign(Error(r.error.message),r.error);return r.value;};
async function prepare(kind){
 const value=card(kind),filename='synthetic-'+Date.now()+'.json';await fs.writeFile(path.join(studioRoot,'imports',filename),JSON.stringify(value));
 current=await operation('import',{path:'imports/'+filename,type:'card'});
 return control(agent,{mode:'start',claim,document_id:current.id,expected_revision:current.revision});
}
await prepare('multi');
const compiled=await compileNativePlayer();
const page=String.raw`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成開場 GUI 驗收</title><style>html,body{margin:0;height:100%;font-family:sans-serif}#qa{padding:8px;background:#f0eee7;display:flex;gap:6px;flex-wrap:wrap}#qa button{min-height:38px}#mount{height:calc(100% - 115px);min-height:500px}#qa-status{margin:0;font-size:12px}</style><div id="qa"><strong>合成驗收環境</strong><button data-case="multi">交接多開場卡</button><button data-case="single">交接單開場卡</button><button data-case="blank">交接空主開場卡</button><button data-case="revision">保存新 revision</button><button data-case="again">重新交接目前卡</button><button id="mobile">手機寬度 390px</button><p id="qa-status">合成資料；禁止模型調用。正式卡與 Profile 保持原狀。</p></div><div id="mount"></div><script>
const cleanups=[],effects=[],subscribers=new Set();let mobile=false;
const status=document.getElementById('qa-status');
for(const button of document.querySelectorAll('[data-case]'))button.onclick=async()=>{try{button.disabled=true;const r=await fetch('/fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:button.dataset.case})}).then(r=>r.json());if(!r.ok)throw Error(r.error);status.textContent='已完成合成操作 '+button.dataset.case+'；'+(r.value.runId?'已建立單開場故事。':'請到舞臺預覽開場。');window.dispatchEvent(new CustomEvent('scean:open',{detail:{authoringSessionId:'opening-gui-session',runId:r.value.runId}}));}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
document.getElementById('mobile').onclick=()=>{mobile=!mobile;Object.assign(document.getElementById('mount').style,{width:mobile?'390px':'100%',height:mobile?'844px':'calc(100% - 115px)',maxWidth:'100%'});window.dispatchEvent(new Event('resize'));};
const React={useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),createElement(type,props,...children){const node=document.createElement(type);for(const [key,value]of Object.entries(props??{})){if(key==='ref')value.current=node;else if(key==='style')Object.assign(node.style,value);else if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='srcDoc')node.srcdoc=value;else node.setAttribute(key,String(value));}for(const child of children)node.append(child);return node;}};
const context={sessions:{list:{getSnapshot:()=>({byId:{'opening-gui-session':{id:'opening-gui-session',retainedBy:{mainView:1}}}}),subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn);}}},remote:{$mount:async()=>{},scean:{request:r=>fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(r)}).then(r=>r.json())}},layout:{selectPanel:key=>{status.textContent=key==='local-cardstudio-scean'?'回 Studio：請用上方合成交接按鈕。':status.textContent;}},slots:{inject:(slot,fn)=>slot==='main'?fn():()=>{},register(options,Component){const element=Component();document.getElementById('mount').append(element);for(const effect of effects.splice(0)){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}return()=>element.remove();}},inject(_deps,fn){return fn(this);},effect(fn){cleanups.push(fn());}};
window.__ModuleLoader__={load:module=>module.factory(()=>React).apply(context)};
</script><script src="/client.js"></script></html>`;
const server=http.createServer(async(req,res)=>{
 const send=(value,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type+'; charset=utf-8','cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(value):value);};
 try{
  if(req.headers.host!==new URL(origin).host)return send({ok:false},403);
  if(req.url==='/'&&req.method==='GET')return send(page,200,'text/html');
  if(req.url==='/client.js'&&req.method==='GET')return send(compiled.client,200,'application/javascript');
  if(req.method!=='POST'||req.headers.origin!==origin)return send({ok:false},403);
  let body='';for await(const chunk of req){body+=chunk;if(body.length>1024*1024)throw Error('BODY_LIMIT');}const request=JSON.parse(body);
  if(req.url==='/rpc'){
   calls.push({action:request.action,openingIndex:request.openingIndex});
   const value=request.action==='models'?{ok:true,value:{mode:'native',source:'synthetic-model-forbidden'}}:await host.request(request,undefined,authority);
   await fs.writeFile(path.join(out,'result.json'),JSON.stringify({modelCalls,calls,runs:await host.engine.store.listRuns()},null,2));
   return send({ok:true,value});
  }
  if(req.url==='/fixture'){
   let value;
   if(request.kind==='revision'){const read=await operation('read',{document_id:current.id});value=await operation('patch',{document_id:current.id,expected_revision:read.revision,patches:[{op:'replace',path:'/data/alternate_greetings/0',value:'新 revision：守門人把新的星圖交給你。'}]});current.revision=value.revision;}
   else if(request.kind==='again')value=await control(agent,{mode:'start',claim,document_id:current.id,expected_revision:current.revision});
   else if(['multi','single','blank'].includes(request.kind))value=await prepare(request.kind);
   else throw Error('UNKNOWN_FIXTURE');
   return send({ok:true,value});
  }
  return send({ok:false},404);
 }catch(error){send({ok:false,error:error.code??error.message},400);}
});
let origin;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
await fs.writeFile(path.join(out,'ready.json'),JSON.stringify({url:origin,out,layer:'actual generated native iframe; real Studio Loader/Control + Host/Core/Store; synthetic DSH mount',modelCalls:0}));
console.log(JSON.stringify({url:origin,out,modelCalls:0}));
process.on('SIGINT',async()=>{server.close();await loader.close();await host.close();process.exit(0);});
