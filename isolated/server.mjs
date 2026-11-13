import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,open,unlink,access,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostname,homedir} from 'node:os';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {UsageLedger} from '../adapters/budget.mjs';
import {Memory} from '../core/memory.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
import {createReadOnlyDshRuntime} from './dsh-runtime.mjs';
import {GenerationGate} from './generation-gate.mjs';
import {createStudioBridge} from './studio-bridge.mjs';
import {syntheticCatalog,resolveSyntheticCreate,createScriptedModel} from '../fixtures/synthetic-catalog.mjs';

const codeRoot=fileURLToPath(new URL('../',import.meta.url));
const fail=code=>Object.assign(Error(code),{code});
export function assertIsolatedWritePath(path){
  const target=resolve(path).toLowerCase();
  const protectedRoots=[join(homedir(),'.dsh'),...JSON.parse(process.env.SCEAN_PROTECTED_ROOTS_JSON??'[]')].map(p=>resolve(p).toLowerCase());
  if(protectedRoots.some(p=>target===p||target.startsWith(p+'\\')||target.startsWith(p+'/')))throw fail('PROTECTED_DATA_PATH');
  return resolve(path);
}
export async function assertIsolatedWriteBoundary(path){
  const target=assertIsolatedWritePath(path);
  // Check every existing ancestor before creating any marker, lock, or directory.
  // Windows junctions are reported as symbolic links by Node lstat.
  for(let current=target;;current=dirname(current)){
    try{
      const info=await lstat(current);if(info.isSymbolicLink())throw fail('ISOLATED_LINKED_PATH');
      assertIsolatedWritePath(await realpath(current));
    }catch(error){if(error.code!=='ENOENT')throw error;}
    if(dirname(current)===current)break;
  }
  return target;
}
const sameSecret=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const publicError=e=>({code:/^[A-Z0-9_]{1,80}$/.test(e?.code??'')?e.code:'ISOLATED_SERVER_ERROR',message:'隔離環境無法完成此操作；請保留輸入後重試或查看本機診斷。',category:'validation',stage:'request'});
async function acquireDataLock(lockPath){
  try{return await open(lockPath,'wx');}catch(error){if(error.code!=='EEXIST')throw error;}
  let recovery;
  try{
    recovery=await open(lockPath+'.recovery','wx');
    const old=JSON.parse(await readFile(lockPath,'utf8'));
    if(old.host!==hostname()||!Number.isSafeInteger(old.pid)||old.pid<1)throw fail('ISOLATED_DATA_LOCKED');
    let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw fail('ISOLATED_DATA_LOCKED');
    await unlink(lockPath);return await open(lockPath,'wx');
  }finally{if(recovery){await recovery.close();await unlink(lockPath+'.recovery');}}
}
async function jsonBody(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>33*1024*1024)throw fail('REQUEST_TOO_LARGE');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value.action!=='importRun'&&bytes>1024*1024)throw fail('REQUEST_TOO_LARGE');return value;}catch(error){if(error.code)throw error;throw fail('INVALID_JSON');}}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}

export async function startServer({scripted=false,interactive=false,port=43210,dataRoot=join(codeRoot,'.playable-data',interactive?'interactive':scripted?'scripted':'native'),gatePath=join(codeRoot,'.playable-data','milestone-a-generation-gate.jsonl'),scriptedDelay=50,summaryEnabled=false,chapterModelsEnabled=false,worldRoutineAutomatic=true,recentWindow=6,model:injectedModel,runtimeFactory=createReadOnlyDshRuntime,studioHost,chapterProviderSettings,chapterRuntimeFactory}={}){
  if(hostname().toUpperCase()!==(process.env.SCEAN_PRIMARY_MACHINE??'').toUpperCase())throw fail('PRIMARY_MACHINE_REQUIRED');
  if(scripted&&interactive)throw fail('ISOLATED_MODE_CONFLICT');
  const mode=interactive?'interactive':scripted?'scripted':'native',usageMode=interactive?'interactive':scripted?'scripted':'acceptance';
  dataRoot=await assertIsolatedWriteBoundary(dataRoot);gatePath=await assertIsolatedWriteBoundary(gatePath);
  const markerPath=join(dataRoot,'usage-mode.json');
  let marker;try{marker=JSON.parse(await readFile(markerPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(marker&&(marker.schemaVersion!==1||marker.usageMode!==usageMode))throw fail('ISOLATED_USAGE_MODE_MISMATCH');
  if(!marker){
    let legacyMode;
    for(const file of ['isolated-session.json','last-stop.json']){
      let prior;try{prior=JSON.parse(await readFile(join(dataRoot,file),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const priorMode=prior.usageMode??({native:'acceptance',scripted:'scripted',interactive:'interactive'}[prior.mode]);
      if(!priorMode||legacyMode&&legacyMode!==priorMode)throw fail('ISOLATED_USAGE_MODE_UNKNOWN');legacyMode=priorMode;
    }
    if(legacyMode&&legacyMode!==usageMode)throw fail('ISOLATED_USAGE_MODE_MISMATCH');
    if(!legacyMode)for(const name of ['store','host','studio','usage.jsonl']){try{await access(join(dataRoot,name));throw fail('ISOLATED_USAGE_MODE_UNKNOWN');}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  if(interactive&&!marker){
    if(['native','scripted'].some(name=>dataRoot.toLowerCase()===resolve(codeRoot,'.playable-data',name).toLowerCase()))throw fail('INTERACTIVE_DATA_NOT_ISOLATED');
    for(const name of ['store','host','studio','usage.jsonl','isolated-session.json']){try{await access(join(dataRoot,name));throw fail('INTERACTIVE_DATA_NOT_ISOLATED');}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  await mkdir(dataRoot,{recursive:true});
  const lockPath=join(dataRoot,'isolated.lock');let lock;
  try{lock=await acquireDataLock(lockPath);await lock.writeFile(JSON.stringify({pid:process.pid,host:hostname()}));await lock.sync();}catch{throw fail('ISOLATED_DATA_LOCKED');}
  let runtime,host,server,studioBridge,closed=false;
  try{
    // Acceptance evidence is untouched in interactive mode, including read paths that initialize a journal.
    const generationGate=interactive?null:new GenerationGate(gatePath);
    if(!marker)await writeFile(markerPath,JSON.stringify({schemaVersion:1,usageMode,createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
    let interactiveEnabled=false;
    const activationToken=interactive?randomBytes(32).toString('hex'):null;
    const acknowledgement='enable-existing-dsh-provider-for-this-launch';
    const interactiveStatus=()=>interactive?{enabled:interactiveEnabled,requiresConfirmation:!interactiveEnabled,activationToken,acknowledgement,paidCallsMayOccur:true}:null;
    if(!scripted&&!injectedModel)runtime=await runtimeFactory();
    const nativeOrScriptedModel=injectedModel??(scripted?createScriptedModel({delayMs:scriptedDelay}):createNativeModelPort({llm:runtime.llm,agentDefaultModel:runtime.agentDefaultModel,usageLedger:new UsageLedger(join(dataRoot,'usage.jsonl')),...(generationGate?{generationGate}:{}),technicalRetries:0,timeoutMs:180000}));
    const model=interactive?{
      describe:(...args)=>nativeOrScriptedModel.describe?.(...args)??{source:'injected model'},
      generate:args=>{if(!interactiveEnabled)throw fail('INTERACTIVE_GENERATION_LOCKED');return nativeOrScriptedModel.generate(args);},
    }:nativeOrScriptedModel;
    host=await new SceanHost({engine:new SceanEngine({store:new DurableStore({root:join(dataRoot,'store')}),model,memory:new Memory(),recentWindow}),root:join(dataRoot,'host'),summaryEnabled,chapterModelsEnabled,worldRoutineAutomatic,chapterProviderSettings,chapterRuntimeFactory}).init();
    studioBridge=await createStudioBridge({root:join(dataRoot,'studio'),sceanHost:studioHost===undefined?host:studioHost}).init();
    const token=randomBytes(32).toString('hex');let origin;
    const models=async()=>scripted?{mode,usageMode,label:'合成腳本測試；不是真實模型',source:'synthetic fixture',paidCalls:0,interactive:null}:{mode,usageMode,source:runtime?.source??'injected test native port',selectionRefresh:runtime?.selectionRefresh,...await model.describe(),interactive:interactiveStatus(),usageLedger:'usage.jsonl',generationGate:generationGate?await generationGate.status():null,monetaryEnforcement:false};
    const close=async()=>{
      if(closed)return;closed=true;await host.close();
      await new Promise(resolveClose=>{server.close(resolveClose);server.closeIdleConnections?.();});
      await studioBridge.close();await host.writeQueue?.catch(()=>{});await runtime?.close();
      await writeFile(join(dataRoot,'last-stop.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,host:hostname(),mode,usageMode}));
      await lock.close();await unlink(lockPath);await unlink(join(dataRoot,'isolated-session.json')).catch(()=>{});
    };
    server=http.createServer(async(req,res)=>{
      try{
        if(req.headers.host!==origin?.slice(7))return send(res,403,{ok:false,error:publicError(fail('HOST_DENIED'))});
        // A static development entry contains no token, data or executable code.
        // Clicking its same-origin link permits normal navigation from extension
        // controlled browsers; every app/API request below keeps the full fence.
        if(req.method==='GET'&&req.url==='/entry'){
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});
          return res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>W19 localhost 合成驗收入口</title><a href="/">開啟本地合成玩家</a><p>僅 localhost；無私人資料或模型連線。</p></html>');
        }
        if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{ok:false,error:publicError(fail('ORIGIN_DENIED'))});
        if(req.headers['sec-fetch-site']==='cross-site')return send(res,403,{ok:false,error:publicError(fail('ORIGIN_DENIED'))});
        const url=new URL(req.url,origin);
        if(req.method==='GET'&&url.pathname==='/api/bootstrap')return send(res,200,{csrfToken:token,mode,usageMode,interactive:interactiveStatus(),dataRootLabel:'獨立隔離資料目錄',models:await models(),studio:studioBridge.capabilities()});
        if(req.method==='POST'&&url.pathname==='/api'){
          if(!sameSecret(req.headers['x-scean-token'],token))return send(res,403,{ok:false,error:publicError(fail('CSRF_DENIED'))});
          if(!String(req.headers['content-type']??'').startsWith('application/json'))throw fail('JSON_REQUIRED');
          const request=await jsonBody(req);
          if(typeof request.action==='string'&&request.action.startsWith('studio.')){
            const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
            return send(res,200,await studioBridge.request(request,controller.signal));
          }
          if(request.action==='catalog')return send(res,200,{ok:true,value:syntheticCatalog()});
          if(request.action==='models')return send(res,200,{ok:true,value:await models()});
          if(request.action==='interactiveEnable'){
            if(!interactive)throw fail('INTERACTIVE_MODE_REQUIRED');
            // An explicit per-launch acknowledgement, not proof of a human gesture. Never called automatically.
            if(req.headers.origin!==origin)throw fail('INTERACTIVE_ORIGIN_REQUIRED');
            if(request.mode!=='interactive'||!sameSecret(request.activationToken,activationToken)||request.acknowledgement!==acknowledgement)throw fail('INTERACTIVE_CONFIRMATION_REQUIRED');
            interactiveEnabled=true;return send(res,200,{ok:true,value:interactiveStatus()});
          }
          const generationKind=request.action==='operationSubmit'?request.kind:request.action;
          if(['turn','regenerate','summaryStart','chapterSummarize','chapterAuto','playerIdeas'].includes(generationKind)&&interactive&&!interactiveEnabled)throw fail('INTERACTIVE_GENERATION_LOCKED');
          if(request.action==='shutdown'){send(res,200,{ok:true,value:{stopping:true}});setImmediate(()=>close().catch(()=>{}));return;}
          const allowed=['worldRoutineRead','agentModelCatalog','agentModelDefaults','agentModelDefaultsSave','agentModels','agentModelsSave','writingMode','writingModeSave','proseStyle','proseStyleSave','writingStylesImport','playerIdeas','playerWorldbook','playerRecap','playerCollaboration','ownerWorldbook','presentation','presentationSource','presentationPreview','presentationApply','presentationRestore','playerDefaults','playerDefaultsSave','playerBind','chapterProviderSettings','chapterProviderSave','chapterProviderClear','operationSubmit','operationStatus','notificationWatch','notificationStatus','notificationClaim','notificationTarget','notificationStop','chapterStatus','chapterSettings','chapterSummarize','chapterAuto','chapterCancel','runView','historyPage','historySearch','historyRead','summaryStatus','summaryStart','summaryCancel','chapterClose','capabilities','create','list','turn','rollback','regenerate','exportRun','importRun','cancel','inspect','banList','progress','draftSave','draftGet','diagnosticsGrant','diagnosticsRead','diagnosticsRevoke'];
          allowed.push('scriptList','scriptGet','scriptStart','scriptStatus');
          if(!allowed.includes(request.action))throw fail('ACTION');
          if(['chapterProviderSettings','chapterProviderSave','chapterProviderClear'].includes(request.action)&&req.headers.origin!==origin)throw fail('CHAPTER_SETTINGS_ORIGIN_REQUIRED');
          if(request.action.startsWith('diagnostics')&&req.headers.origin!==origin)throw fail('DIAGNOSTICS_ORIGIN_REQUIRED');
          if(['exportRun','importRun'].includes(request.action)&&req.headers.origin!==origin)throw fail('SAVE_ORIGIN_REQUIRED');
          // All UI creates resolve a known immutable source. Never read Studio DB.
          const actual=request.action==='create'?resolveSyntheticCreate(request):request;
          const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          return send(res,200,await host.request(actual,controller.signal,{principal:token,allowGlobalSettings:true,allowPrivateDiagnostics:true,allowPrivateSaves:true,resolvePresentationSource:(_session,_scope,_signal,runId)=>studioBridge.presentationSource(runId)}));
        }
        if(req.method==='GET'){
          const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
          if(!["agent-models-ui.mjs","card-frontend.mjs","chapter-settings-ui.mjs","collaboration-reader-ui.mjs","condition-ast.mjs","dialogue-colors.mjs","dialogue.mjs","frontend-runtime.mjs","history-sync.mjs","notifications.mjs","opening-selection-ui.mjs","player-ideas-ui.mjs","player-identity-ui.mjs","player-readers-ui.mjs","player-shell.mjs","player-text.mjs","presentation-panel-ui.mjs","presentation.mjs","prose-style-ui.mjs","reading-layout.mjs","run-recycle-ui.mjs","script-library-ui.mjs","studio-view-model.mjs","studio.mjs","summary-settings-ui.mjs","turn-duration.mjs","view-model.mjs","world-routine-ui.mjs","writing-mode-ui.mjs",'dialogue-colors.css','index.html','app.js','styles.css','style.css','app.mjs','writing-mode-ui.mjs','prose-style-ui.mjs','chapter-settings-ui.mjs','opening-selection-ui.mjs','opening-selection.css','view-model.mjs','player-text.mjs','player-identity-ui.mjs','studio.mjs','studio-view-model.mjs','player-shell.mjs','player.css','presentation.css','presentation.mjs','reading-layout.mjs','notifications.mjs','card-frontend.mjs','frontend-runtime.mjs','condition-ast.mjs','history-sync.mjs','player-ideas-ui.mjs','player-readers-ui.mjs','collaboration-reader-ui.mjs','presentation-panel-ui.mjs','script-library-ui.mjs'].includes(name))return send(res,404,{ok:false,error:publicError(fail('NOT_FOUND'))});
          const body=await readFile(join(codeRoot,'isolated','web',name));
          res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(body);
        }
        send(res,405,{ok:false,error:publicError(fail('METHOD_DENIED'))});
      }catch(error){if(!res.headersSent)send(res,400,{ok:false,error:publicError(error)});else res.end();}
    });
    server.requestTimeout=240000;
    await new Promise((ready,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ready);});
    origin=`http://127.0.0.1:${server.address().port}`;
    const session={schemaVersion:1,pid:process.pid,host:hostname(),origin,token,mode,usageMode,dataRoot,codeRoot,gatePath:interactive?null:resolve(gatePath),usageLedgerPath:join(dataRoot,'usage.jsonl'),startedAt:new Date().toISOString()};
    await writeFile(join(dataRoot,'isolated-session.json'),JSON.stringify(session,null,2),{mode:0o600});
    return {origin,token,host,studioBridge,close,session,models};
  }catch(error){await host?.close();await studioBridge?.close().catch(()=>{});await runtime?.close().catch(()=>{});await lock.close();await unlink(lockPath).catch(()=>{});throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  try{
    const running=await startServer({scripted:args.includes('--scripted'),summaryEnabled:args.includes('--enable-summary'),chapterModelsEnabled:args.includes('--enable-chapters'),...(args.includes('--recent-window')?{recentWindow:Number(value('--recent-window'))}:{}),interactive:args.includes('--interactive'),...(args.includes('--port')?{port:Number(value('--port'))}:{}),...(args.includes('--data-root')?{dataRoot:value('--data-root')}:{}),...(args.includes('--gate-path')?{gatePath:value('--gate-path')}:{}),...(args.includes('--scripted-delay')?{scriptedDelay:Number(value('--scripted-delay'))}:{})});
    console.log(JSON.stringify({status:'ready',origin:running.origin,mode:running.session.mode,pid:process.pid}));
    for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>running.close().catch(()=>{process.exitCode=1;}));
  }catch(error){console.error(JSON.stringify({status:'blocked',...publicError(error)}));process.exitCode=1;}
}
