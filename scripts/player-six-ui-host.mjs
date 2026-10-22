// Official Web/native fixture only. Fresh checkout-local DSH home, no credentials
// or inherited user profile; all model traffic is a bounded scripted adapter.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
const repo=path.resolve(import.meta.dirname,'..'),label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)??'player-six-native-ui';
if(!/^player-six-native-[a-z0-9-]{1,40}$/.test(label))throw Error('FRESH_SYNTHETIC_LABEL_REQUIRED');
const out=path.join(repo,'evidence',label),home=path.join(out,'home'),profile=path.join(home,'profiles/web'),restarting=process.argv.includes('--restart'),chapterContext=process.argv.includes('--chapter-context');
const env={SystemRoot:process.env.SystemRoot??'C:/Windows',WINDIR:'C:/Windows',ComSpec:'C:/Windows/System32/cmd.exe',USERPROFILE:path.join(out,'user'),APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TEMP:path.join(out,'temp'),TMP:path.join(out,'temp'),PATH:process.env.PATH,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_DISABLE_TELEMETRY:'1'};
if(!process.argv.includes('--worker')){
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.mkdir(out,{recursive:restarting});for(const dir of ['user','temp','appdata','localappdata'])await fs.mkdir(path.join(out,dir),{recursive:true});
  if(restarting)await fs.rename(path.join(out,'stop-request'),path.join(out,'stop-request-previous-'+Date.now())).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(restarting)await fs.unlink(path.join(out,'exit.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const child=spawn(process.execPath,['--require',path.join(repo,'scripts/w19-offline-network.cjs'),import.meta.filename,'--label='+label,'--worker',...(restarting?['--restart']:[]),...(chapterContext?['--chapter-context']:[])],{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=await fs.open(path.join(out,'host-redacted.log'),'a');const buffers=new Map();let queue=Promise.resolve();
  const emit=line=>{const safe=line.replace(/(?:token|key|authorization)=[^\s"<>]+/gi,'token=FIXTURE_REDACTED');queue=queue.then(()=>log.write(safe));process.stdout.write(safe);};
  for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');buffers.set(stream,'');stream.on('data',chunk=>{let pending=buffers.get(stream)+chunk,end;while((end=pending.indexOf('\n'))!==-1){emit(pending.slice(0,end+1));pending=pending.slice(end+1);}buffers.set(stream,pending);});}
  child.on('close',async code=>{for(const pending of buffers.values())if(pending)emit(pending);await queue;await log.close();process.exitCode=code??1;});
}else{
  if(process.env.DSH_HOME!==home||!home.startsWith(path.join(repo,'evidence')+path.sep))throw Error('ISOLATED_HOME_REQUIRED');
  const {internals}=await import('@deepseek-ai/dsh-web-app');internals.resolveDistIndex=()=>path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html');
  const installed=path.join(profile,'node_modules/@local/dsh-scean-suite'),data=path.join(home,'scean-synthetic'),workspace=path.join(home,'card-studio-scean-test/workspace');
  const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>resolve(n));});});
  const port=restarting?JSON.parse(await fs.readFile(path.join(out,'launch.json'),'utf8')).port:await freePort();
  if(!restarting){
    const {initProfile}=await import('@deepseek-ai/dsh-app-boot');initProfile(profile,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@local/dsh-scean-suite']);
    await fs.mkdir(installed,{recursive:true});const suite=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
    for(const rel of['package.json',...suite.files])await fs.cp(path.join(repo,rel),path.join(installed,rel),{recursive:true});
    const{seedPlayerSixStudio}=await import('../fixtures/player-six-ui.mjs');await seedPlayerSixStudio(workspace);
    const slash=p=>p.replaceAll('\\','/');
    await fs.writeFile(path.join(profile,'cordis.patch.yml'),`- insert:\n    - id: player-six-offline-adapter\n      name: ${pathToFileURL(path.join(repo,'fixtures/player-six-ui.mjs')).href}\n      config: {}\n- id: local-scean-host\n  config:\n    dataRoot: ${slash(data)}\n    usagePath: ${slash(data)}/usage.jsonl\n    modelSelection:\n      provider: six-scripted\n      model: offline\n      reasoningEffort: off\n    enableExistingEmbedding: false\n    summaryEnabled: false\n    chapterModelsEnabled: ${chapterContext}\n    technicalRetries: 0\n- id: local-cardstudio-scean-workspace-loader\n  config:\n    workspace: ${slash(workspace)}\n- id: agent-default-model\n  config:\n    provider: six-scripted\n    model: offline\n    reasoningEffort: off\n- id: ui-settings-account\n  config:\n    version: 1\n    step: done\n    usage: detailed\n    purpose: null\n    process: standard\n    completion: api-key\n`);
    const fixture=path.join(profile,'node_modules/@local/player-six-ui-session');await fs.mkdir(fixture,{recursive:true});
    await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'@local/player-six-ui-session',version:'0.0.0',private:true,type:'module',exports:{'.':'./index.js','./client':'./client.js'},dsh:{client:{platform:'web',immediately:true,inject:['@deepseek-ai/dsh-client-ui-workspace']}}}));
    await fs.writeFile(path.join(fixture,'index.js'),"export function apply(){}\n");
    await fs.writeFile(path.join(fixture,'client.js'),"window.__ModuleLoader__.load({id:'@local/player-six-ui-session',factory(){return {name:'player-six-ui-session',apply(ctx){ctx.inject(['sessions','layout','uiWorkspace'],scope=>{window.__uiSessions=scope.sessions;window.__uiLayout=scope.layout;window.__uiWorkspace=scope.uiWorkspace;})}}}});\n");
    await fs.appendFile(path.join(profile,'cordis.patch.yml'),'\n- insert:\n    - id: player-six-ui-session\n      name: "@local/player-six-ui-session"\n      config: {}\n');
  }
  // Only the isolated copied Host class is wrapped, never a formal service.
  const {SceanHost}=await import(pathToFileURL(path.join(installed,'packages/scean/plugin/host.mjs')).href),original=SceanHost.prototype.request;
  let fixtureHost;const counts={historyFailures:0,readerFailures:0,requests:[]};
  SceanHost.prototype.request=async function(request,signal,authority){
    fixtureHost=this;
    if(!this.durationFixtureWrapped){this.durationFixtureWrapped=true;const generate=this.engine.model.generate.bind(this.engine.model);this.engine.model.generate=async args=>{
      if(args.stage==='writer')for(let i=0;i<600&&await fs.stat(path.join(out,'hold-writer')).catch(()=>null);i++){args.signal?.throwIfAborted();await new Promise(r=>setTimeout(r,100));}
      return generate(args);
    };}
    counts.requests.push({action:request.action,runId:request.runId??null});
    for(const[action,marker,field]of[['historyPage','fail-next-history','historyFailures'],['playerWorldbook','fail-next-worldbook','readerFailures']])if(request.action===action&&await fs.stat(path.join(out,marker)).catch(()=>null)){
      await fs.unlink(path.join(out,marker));counts[field]++;await fs.writeFile(path.join(out,'faults.json'),JSON.stringify(counts));return{ok:false,error:{code:'SYNTHETIC_READ_FAILURE',message:'Synthetic one-shot read failure.'}};
    }
    if(request.action==='runTrash'&&await fs.stat(path.join(out,'fail-next-run-trash-ack')).catch(()=>null)){
      await fs.unlink(path.join(out,'fail-next-run-trash-ack'));const result=await original.call(this,request,signal,authority);
      if(result.ok)return {ok:false,error:{code:'CONNECTION_UNKNOWN',message:'Synthetic acknowledgement lost after canonical publication.'}};return result;
    }
    return original.call(this,request,signal,authority);
  };
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js'),{createLaunchEnvironmentSnapshot}=await import('@deepseek-ai/dsh-launch-environment');
  const app=await runProfile({profile:'web',patchFiles:[],args:['--host','127.0.0.1','--port',String(port),'--no-open'],environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}])});await app.ctx.loader.await();
  const server=app.ctx.get('webServer'),connection=app.ctx.get('connection');if(server?.host!=='127.0.0.1'||server?.port!==port||!connection)throw Error('OFFICIAL_HOST_NOT_READY');
  server.register({kind:'exact',path:'/__six_entry',handler(req,res){if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'same-origin'});res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>六項功能隔離驗收</title><h1>六項功能隔離驗收</h1><p>只有合成故事及 scripted adapter；不使用付費模型。</p><form method="post" action="/__six_login"><button type="submit">開啟隔離 DSH</button></form></html>');}});
  server.register({kind:'exact',path:'/__six_login',handler(req,res){if(req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}const url=new URL(connection.authenticatedUrl(`http://127.0.0.1:${port}/`));connection.authorizeIndex({method:'GET',url:url.pathname+url.search,headers:req.headers},res);}});
  const studio=app.ctx.get('cardstudioSceanBridge'),gateway=app.ctx.get('typertGateway');
  async function rpc(sessionId,request){const cardScope=await studio.resolveSceanScope(sessionId);if(!cardScope)throw Error('SYNTHETIC_CARD_SCOPE_REQUIRED');const currentConnection=app.ctx.get('connection'),peer=currentConnection.browserPeer??currentConnection.operator??gateway?.operatorPeer?.();const outer=await gateway.invokeRpc('scean/request',{args:{request:{sessionId,cardScope,...request}}},new AbortController().signal,peer);if(!outer.ok||!outer.value?.ok)throw Error(outer.value?.error?.code??outer.error?.code??'FIXTURE_RPC_FAILED');return outer.value.value;}
  let commandBusy=false,stopping=false;
  const commandTimer=setInterval(async()=>{
    if(commandBusy||stopping)return;let input;try{input=JSON.parse(await fs.readFile(path.join(out,'fixture-request.json'),'utf8'));}catch{return;}commandBusy=true;
    try{
      await fs.unlink(path.join(out,'fixture-request.json'));const agent=app.ctx.get('agents').get(input.sessionId);
      if(!agent?.session?.header?.cwd?.startsWith(workspace))throw Error('SYNTHETIC_SESSION_REQUIRED');
      let value;
      if(input.action==='context'){const scope=await studio.resolveSceanScope(input.sessionId),runs=await rpc(input.sessionId,{action:'list'});value={scope,runs};}
      else if(input.action==='seedStory'){
        for(let i=0;i<2;i++)await rpc(input.sessionId,{action:'turn',runId:input.runId,input:'整理第 '+(i+1)+' 份合成天氣記錄。',requestId:'six-seed-'+(i+1)});
        if(!fixtureHost)throw Error('SYNTHETIC_HOST_REFERENCE_REQUIRED');
        const {closeChapter}=await import(pathToFileURL(path.join(installed,'packages/scean/core/narrative.mjs')).href),{backfillChapterSummary}=await import(pathToFileURL(path.join(installed,'packages/scean/core/chapter-summary.mjs')).href);
        let run=await fixtureHost.engine.store.read(input.runId);const closed=await closeChapter(fixtureHost.engine,{runId:input.runId,operationId:'six-close-chapter',expectedVersion:run.version,expectedHead:run.head,title:'合成的第一個值班日'});run=await fixtureHost.engine.store.read(input.runId);
        const payload={title:'觀測站的第一個值班日',summary:'兩份天氣記錄已整理完成。旅人仍在觀測站，可以自由決定下一步。這是預先安排的合成章節摘要。',keywords:['天氣表'],characters:['合成值班員'],locations:['合成觀測站'],plotThreads:['下一份記錄'],emotionalTone:'平靜'};
        await backfillChapterSummary(fixtureHost.engine,{runId:input.runId,chapterId:closed.chapterId,operationId:'six-seed-chapter-payload',expectedVersion:run.version,expectedHead:run.head},{enabled:true,model:{async generate(){return{text:JSON.stringify(payload),model:'synthetic-ui-payload'};}}});await fixtureHost.refreshRuns();value={chapterId:closed.chapterId,seededTurns:2,payloadSeededLocally:true};
      }else if(input.action==='chapterState'){value=await rpc(input.sessionId,{action:'chapterStatus',runId:input.runId});
      }else if(input.action==='playChapterTurns'){for(let i=0;i<4;i++){await rpc(input.sessionId,{action:'turn',runId:input.runId,input:'整理第 '+(i+1)+' 份合成天氣記錄。',requestId:'chapter-ui-'+(i+1)});while(fixtureHost.chapterBackground?.size)await Promise.allSettled([...fixtureHost.chapterBackground]);}value=await rpc(input.sessionId,{action:'chapterStatus',runId:input.runId});
      }else if(input.action==='savePanel'){
        const{playerSixCard}=await import('../fixtures/player-six-ui.mjs'),scope=await studio.resolveSceanScope(input.sessionId),tool=app.ctx.get('tools').get('cardstudio_scean_frontend',agent);
        const current=await app.ctx.get('tools').get('card_read',agent).execute({document_id:scope.cardId},{agent,signal:new AbortController().signal});if(!current.ok)throw Error('SYNTHETIC_CARD_READ_FAILED');
        value=await tool.execute({action:'dynamic_save',document_id:scope.cardId,expected_revision:current.value.revision,frontend:playerSixCard().frontend},{agent,signal:new AbortController().signal});if(!value.ok)throw Error(value.error?.code??'SYNTHETIC_PANEL_SAVE_FAILED');
      }else if(input.action==='fingerprint'){
        const {hash}=await import(pathToFileURL(path.join(installed,'packages/scean/core/contracts.mjs')).href),run=await fixtureHost.engine.store.read(input.runId);value={runId:run.runId,version:run.version,head:run.head,snapshotHash:run.snapshot.hash,aggregateHash:hash(run),stateHash:hash(run.state),memoryHash:hash(run.memories),bodyHashes:run.turns.map(t=>t.bodyHash),turns:run.turns.length};
      }else throw Error('FIXTURE_COMMAND_REFUSED');
      await fs.writeFile(path.join(out,'fixture-result.json'),JSON.stringify({id:input.id,value}));
    }catch(error){await fs.writeFile(path.join(out,'fixture-result.json'),JSON.stringify({id:input.id,error:error.message}));}finally{commandBusy=false;}
  },100);commandTimer.unref();
  const launch={pid:process.pid,port,entry:`http://127.0.0.1:${port}/__six_entry`,browserEntry:`http://127.0.0.1:${port}/__six_entry`,origin:`http://127.0.0.1:${port}`,home,profile,data,workspace,isolated:true,surface:'official DSH Web with actual native iframe/RPC',productionWrites:0,paidModelCalls:0,embeddingCalls:0,restarted:restarting};await fs.writeFile(path.join(out,'launch.json'),JSON.stringify(launch,null,2)+'\n');console.log(JSON.stringify(launch));
  const stopTimer=setInterval(async()=>{
    if(stopping||commandBusy||!await fs.stat(path.join(out,'stop-request')).catch(()=>null))return;stopping=true;clearInterval(stopTimer);clearInterval(commandTimer);await fs.writeFile(path.join(out,'faults-final.json'),JSON.stringify(counts,null,2));await fs.writeFile(path.join(out,'exit.json'),JSON.stringify({normalDisposeRequested:true,at:new Date().toISOString(),productionWrites:0,paidModelCalls:0}));await app.shutdown.shutdown(0);
  },250);
}
