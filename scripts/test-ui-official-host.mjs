// Reproducible official rc.2 Web Host. Writes ONLY this checkout/evidence/ui-layout-official-host.
// Clean child environment, no inherited .env, keys, profile, or private content.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const repo=path.resolve(import.meta.dirname,'..'),task=path.dirname(repo),out=path.join(repo,'evidence/ui-layout-official-host');
const home=path.join(out,'home'),profile=path.join(home,'profiles/web');
const port=Number(process.env.SCEAN_UI_HOST_PORT??19638),entryPort=port-1;
const env={SystemRoot:'C:/Windows',WINDIR:'C:/Windows',ComSpec:'C:/Windows/System32/cmd.exe',USERPROFILE:path.join(out,'user'),APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TEMP:path.join(out,'temp'),TMP:path.join(out,'temp'),PATH:[path.dirname(process.execPath),path.join(process.env.SystemRoot??'C:/Windows','System32')].join(path.delimiter),DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_DISABLE_TELEMETRY:'1'};
await fs.mkdir(out,{recursive:true});
if(process.argv[2]!=='--worker'){
  for(const dir of [env.TEMP,env.APPDATA,env.LOCALAPPDATA])await fs.mkdir(dir,{recursive:true});
  const child=spawn(process.execPath,['--require',path.join(repo,'scripts/w19-offline-network.cjs'),import.meta.filename,'--worker'],{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const redact=s=>s.replace(/token=[^\s"<>]+/g,'token=FIXTURE_REDACTED');
  const log=await fs.open(path.join(out,'host-redacted.log'),'a');
  let writeQueue=Promise.resolve();const buffers=new Map();
  const emit=line=>{const clean=redact(line);writeQueue=writeQueue.then(()=>log.write(clean));process.stdout.write(clean);};
  for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');buffers.set(stream,'');stream.on('data',chunk=>{let pending=buffers.get(stream)+chunk;let end;while((end=pending.indexOf('\n'))!==-1){emit(pending.slice(0,end+1));pending=pending.slice(end+1);}buffers.set(stream,pending);});}
  child.on('close',async(code,signal)=>{for(const pending of buffers.values())if(pending)emit(pending);await writeQueue;await log.close();process.exitCode=code??1;console.log(JSON.stringify({fixtureExit:code,signal}));});
}else{
  if(process.env.DSH_HOME!==home)throw Error('ISOLATION_REQUIRED');
  const frontend=path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist');
  const {internals}=await import('@deepseek-ai/dsh-web-app');
  internals.resolveDistIndex=()=>path.join(frontend,'index.html');
  const {initProfile}=await import('@deepseek-ai/dsh-app-boot');
  initProfile(profile,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@local/dsh-scean-suite']);
  await fs.mkdir(path.join(profile,'node_modules/@local'),{recursive:true});
  const installed=path.join(profile,'node_modules/@local/dsh-scean-suite');
  await fs.mkdir(installed,{recursive:true});
  const suite=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
  for(const rel of ['package.json',...suite.files])await fs.cp(path.join(repo,rel),path.join(installed,rel),{recursive:true,force:true});
  const data=path.join(home,'synthetic-scean').replaceAll('\\','/');
  const workspace=path.join(home,'card-studio-scean-test/workspace').replaceAll('\\','/');
  await fs.writeFile(path.join(profile,'cordis.patch.yml'),`- insert:\n    - id: native-skills-offline-adapter\n      name: ${pathToFileURL(path.join(repo,'scripts/ui-official-offline-adapter.mjs')).href}\n      config: {}\n- id: local-scean-host\n  config:\n    dataRoot: ${data}\n    usagePath: ${data}/usage.jsonl\n    modelSelection:\n      provider: w19-scripted\n      model: offline\n      reasoningEffort: off\n    enableExistingEmbedding: false\n    summaryEnabled: false\n    chapterModelsEnabled: false\n    technicalRetries: 0\n- id: local-cardstudio-scean-workspace-loader\n  config:\n    workspace: ${workspace}\n- id: agent-default-model\n  config:\n    provider: w19-scripted\n    model: offline\n- id: ui-settings-account\n  config:\n    version: 1\n    step: done\n    usage: detailed\n    purpose: null\n    process: standard\n    completion: api-key\n`);

  const fixture=path.join(profile,'node_modules/@local/ui-isolated-fixture');await fs.mkdir(fixture,{recursive:true});
  await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'@local/ui-isolated-fixture',version:'0.0.0',private:true,type:'module',exports:{'.':'./index.js','./client':'./client.js'},dsh:{client:{platform:'web',immediately:true,inject:['@deepseek-ai/dsh-client-ui-workspace']}}}));
  await fs.writeFile(path.join(fixture,'index.js'),"export const name='ui-isolated-fixture';export function apply(){}\n");
  await fs.writeFile(path.join(fixture,'client.js'),"window.__ModuleLoader__.load({id:'@local/ui-isolated-fixture',factory(){return {name:'ui-isolated-fixture',apply(ctx){ctx.inject(['sessions','layout','uiWorkspace'],scope=>{window.__uiSessions=scope.sessions;window.__uiLayout=scope.layout;window.__uiWorkspace=scope.uiWorkspace;})}}}});\n");
  await fs.appendFile(path.join(profile,'cordis.patch.yml'),'\n- insert:\n    - id: ui-isolated-fixture\n      name: \"@local/ui-isolated-fixture\"\n      config: {}\n');

  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
  const {createLaunchEnvironmentSnapshot}=await import('@deepseek-ai/dsh-launch-environment');
  const app=await runProfile({profile:'web',patchFiles:[],args:['--host','127.0.0.1','--port',String(port),'--no-open'],environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}])});
  await app.ctx.loader.await();
  const connection=app.ctx.get('connection'),server=app.ctx.get('webServer');
  if(!connection||server?.host!=='127.0.0.1'||server?.port!==port)throw Error('OFFICIAL_LOOPBACK_HOST_NOT_READY');
  // Synthetic-only browser bootstrap. No launch token enters a browser URL or
  // HTML. Like the entry bridge below, this intentionally authorizes the test
  // operator and must never be copied into a real/private Host deployment.
  server.register({kind:'exact',path:'/__w01_entry',handler(req,res){
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
    res.end('<!doctype html><html><meta charset="utf-8"><title>SCEAN native Skills synthetic Host</title><body><h1>SCEAN native Skills synthetic Host</h1><p>Localhost fixture. No private data or paid model.</p><form method="post" action="/__w01_login"><button type="submit">Open synthetic DSH</button></form></body></html>');
  }});
  server.register({kind:'exact',path:'/__w01_login',handler(req,res){
    if(req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    const request={method:'GET',url:new URL(connection.authenticatedUrl(`http://127.0.0.1:${port}/`)).pathname+new URL(connection.authenticatedUrl(`http://127.0.0.1:${port}/`)).search,headers:req.headers};
    connection.authorizeIndex(request,res);
  }});
  const bridge=createServer((req,res)=>{
    if(req.url==='/entry'&&req.method==='GET'){res.writeHead(302,{location:connection.authenticatedUrl(`http://127.0.0.1:${port}/`),'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return;}
    res.writeHead(404);res.end('W01 localhost acceptance fixture only');
  });
  await new Promise((resolve,reject)=>{bridge.once('error',reject);bridge.listen(entryPort,'127.0.0.1',resolve);});
  const record={pid:process.pid,version:'0.2.1-rc.2',surface:'official DSH Web',entry:`http://127.0.0.1:${entryPort}/entry`,browserEntry:`http://127.0.0.1:${port}/__w01_entry`,origin:`http://127.0.0.1:${port}`,home,profile,data,workspace,isolated:true,productionWrites:0,paidModelCalls:0,embeddingCalls:0};
  await fs.writeFile(path.join(out,'launch.json'),JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record));
  let stopping=false;
  const interval=setInterval(async()=>{
    if(stopping||!await fs.stat(path.join(out,'stop-request')).catch(()=>null))return;
    stopping=true;clearInterval(interval);bridge.close();
    await fs.rename(path.join(out,'stop-request'),path.join(out,'stop-request-'+Date.now()+'.txt'));
    await fs.writeFile(path.join(out,'exit.json'),JSON.stringify({at:new Date().toISOString(),normalDispose:true,productionWrites:0,paidModelCalls:0,embeddingCalls:0}));
    await app.shutdown.shutdown(0);
  },250);
}
