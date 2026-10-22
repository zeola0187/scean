// Fresh native DSH Web fixture. Only synthetic cards and locally authored
// Agent turn; no paid model, credentials or production profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'..'),arg=key=>process.argv.find(value=>value.startsWith('--'+key+'='))?.split('=').slice(1).join('='),label=arg('label')??'player-six-native-chat-preview';
if(!/^player-six-native-chat-preview[a-z0-9-]*$/.test(label))throw Error('SYNTHETIC_LABEL_REQUIRED');
const suite=path.resolve(repo,arg('suite')??'.');if(suite!==repo&&!suite.startsWith(repo+path.sep))throw Error('CHECKOUT_SUITE_REQUIRED');
const out=path.join(repo,'evidence',label),home=path.join(out,'home'),profile=path.join(home,'profiles/web'),workspace=path.join(home,'card-studio-scean-test/workspace');
const resuming=process.argv.includes('--resume');
const env={SystemRoot:process.env.SystemRoot??'C:/Windows',WINDIR:'C:/Windows',ComSpec:'C:/Windows/System32/cmd.exe',USERPROFILE:path.join(out,'user'),APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TEMP:path.join(out,'temp'),TMP:path.join(out,'temp'),PATH:process.env.PATH,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_DISABLE_TELEMETRY:'1'};
function scriptedFixtureSource(directory){return `import fs from 'node:fs/promises';
import path from 'node:path';import {LlmAdapter} from '@deepseek-ai/dsh-llm';
const out=${JSON.stringify(directory)};export const inject=['llm'];
export function apply(ctx){class Offline extends LlmAdapter{
async listModels(provider){return[await this.resolveModel(provider,'offline')];}
async resolveModel(provider,id){if(provider!=='preview-scripted'||id!=='offline')throw Error('SCRIPTED_MODEL_ONLY');return{provider,id,name:'Synthetic chat preview fixture',toolUpdate:'addition-only',defaultMaxTokens:8192,context:{contextWindow:131072},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
async *stream(options){if(options.provider!=='preview-scripted'||options.model!=='offline')throw Error('SCRIPTED_MODEL_ONLY');const plan=JSON.parse(await fs.readFile(path.join(out,'scripted-plan.json'),'utf8'));let calls=[];try{calls=JSON.parse(await fs.readFile(path.join(out,'scripted-calls.json'),'utf8'));}catch{}if(calls.length>=2)throw Error('SCRIPTED_TWO_REQUEST_LIMIT');const index=calls.length;calls.push({index:index+1,stage:index?'text-close':'frontend-save-tool',synthetic:true,paid:false});await fs.writeFile(path.join(out,'scripted-calls.json'),JSON.stringify(calls));options.signal?.throwIfAborted();
if(index===0)yield{type:'block-end',index:0,block:{type:'tool-call',id:'synthetic-panel-save-call',name:'cardstudio_scean_frontend',arguments:JSON.stringify(plan.args)}};
else{let result;for(const message of options.messages??[])if(message.role==='tool')for(const part of message.content??[])if(part.type==='text'){try{const value=JSON.parse(part.text);if(value.ok&&value.value?.panelPreview)result=value.value;}catch{}}if(!result)throw Error('SCRIPTED_SUCCESSFUL_SAVE_REQUIRED');await fs.writeFile(path.join(out,'scripted-result.json'),JSON.stringify(result));yield{type:'block-end',index:0,block:{type:'text',text:'合成面板已保存。這段回覆來自本機 scripted adapter，沒有付費模型呼叫。'}};}
yield{type:'usage',usage:{inputTokens:20,outputTokens:40,totalTokens:60}};yield{type:'finish',reason:{kind:index?'stop':'tool-calls'}};
}}
ctx.llm.registerAdapter(['preview-scripted'],new Offline());}
`;}
if(!process.argv.includes('--worker')){
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out,{recursive:resuming});for(const directory of ['user','appdata','localappdata','temp'])await fs.mkdir(path.join(out,directory),{recursive:resuming});
  if(resuming){await fs.unlink(path.join(out,'stop-request')).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.unlink(path.join(out,'exit.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const child=spawn(process.execPath,['--require',path.join(repo,'scripts/w19-offline-network.cjs'),import.meta.filename,'--worker','--label='+label,'--suite='+suite,...resuming?['--resume']:[]],{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=await fs.open(path.join(out,'host-redacted.log'),'a');let queue=Promise.resolve();
  for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',chunk=>{const safe=chunk.replace(/(?:token|key|authorization)=[^\s"<>]+/gi,'token=FIXTURE_REDACTED');queue=queue.then(()=>log.write(safe));process.stdout.write(safe);});}
  child.on('close',async code=>{await queue;await log.close();process.exitCode=code??1;});
}else{
  const {internals}=await import('@deepseek-ai/dsh-web-app');internals.resolveDistIndex=()=>path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html');
  if(!resuming){
  const installed=path.join(profile,'node_modules/@local/dsh-scean-suite');const {initProfile}=await import('@deepseek-ai/dsh-app-boot');initProfile(profile,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@local/dsh-scean-suite']);
  const manifest=JSON.parse(await fs.readFile(path.join(suite,'package.json'),'utf8'));await fs.mkdir(installed,{recursive:true});for(const rel of ['package.json',...manifest.files])await fs.cp(path.join(suite,rel),path.join(installed,rel),{recursive:true});
  const{seedPlayerSixStudio}=await import('../fixtures/player-six-ui.mjs');await seedPlayerSixStudio(workspace);
  const slash=p=>p.replaceAll('\\','/');await fs.writeFile(path.join(profile,'cordis.patch.yml'),`- insert:\n    - id: synthetic-preview-offline\n      name: ${pathToFileURL(path.join(repo,'fixtures/player-six-ui.mjs')).href}\n      config: {}\n- id: local-scean-host\n  config:\n    dataRoot: ${slash(path.join(home,'scean-synthetic'))}\n    modelSelection:\n      provider: six-scripted\n      model: offline\n      reasoningEffort: off\n    enableExistingEmbedding: false\n    summaryEnabled: false\n    technicalRetries: 0\n- id: local-cardstudio-scean-workspace-loader\n  config:\n    workspace: ${slash(workspace)}\n- id: agent-default-model\n  config:\n    provider: preview-scripted\n    model: offline\n    reasoningEffort: off\n- id: ui-settings-account\n  config:\n    version: 1\n    step: done\n    usage: detailed\n    purpose: null\n    process: standard\n    completion: api-key\n`);
  const fixture=path.join(profile,'node_modules/@local/studio-preview-ui');await fs.mkdir(fixture,{recursive:true});await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'@local/studio-preview-ui',version:'0.0.0',private:true,type:'module',exports:{'.':'./index.js','./client':'./client.js'},dsh:{client:{platform:'web',immediately:true,inject:['@deepseek-ai/dsh-client-ui-workspace']}}}));await fs.writeFile(path.join(fixture,'index.js'),scriptedFixtureSource(out));await fs.writeFile(path.join(fixture,'client.js'),"window.__ModuleLoader__.load({id:'@local/studio-preview-ui',factory(){return{name:'synthetic-studio-preview-ui',apply(ctx){ctx.inject(['sessions','layout','uiWorkspace','uiSession'],scope=>{window.__uiSessions=scope.sessions;window.__uiLayout=scope.layout;window.__uiWorkspace=scope.uiWorkspace;window.__uiSession=scope.uiSession;});}}}});\n");await fs.appendFile(path.join(profile,'cordis.patch.yml'),'\n- insert:\n    - id: synthetic-studio-preview-ui\n      name: "@local/studio-preview-ui"\n      config: {}\n');
  }
  const port=resuming?JSON.parse(await fs.readFile(path.join(out,'launch.json'),'utf8')).port:await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const {runProfile}=await import('../node_modules/@deepseek-ai/dsh/lib/profile-boot.js'),{createLaunchEnvironmentSnapshot}=await import('@deepseek-ai/dsh-launch-environment');const app=await runProfile({profile:'web',patchFiles:[],args:['--host','127.0.0.1','--port',String(port),'--no-open'],environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}])});await app.ctx.loader.await();
  const server=app.ctx.get('webServer'),connection=app.ctx.get('connection');if(server.host!=='127.0.0.1'||server.port!==port)throw Error('ISOLATED_LOOPBACK_REQUIRED');
  server.register({kind:'exact',path:'/__preview_entry',handler(req,res){if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'same-origin'});res.end('<!doctype html><meta charset="utf-8"><title>合成聊天預覽驗證</title><form method="post" action="/__preview_login"><button type="submit">開啟隔離 DSH</button></form>');}});
  server.register({kind:'exact',path:'/__preview_login',handler(req,res){if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}const url=new URL(connection.authenticatedUrl(`http://127.0.0.1:${port}/`));connection.authorizeIndex({method:'GET',url:url.pathname+url.search,headers:req.headers},res);}});
  const studio=app.ctx.get('cardstudioSceanBridge'),preview=studio.humanPanelPreview;let previewCalls=0;studio.humanPanelPreview=async(...args)=>{previewCalls++;const result=await preview(...args),value=result.value,artifact=args[1]?.artifact;await fs.writeFile(path.join(out,'preview-reads.json'),JSON.stringify({calls:previewCalls,ok:result.ok,valueKeys:Object.keys(value??{}),source:value?.source,artifactKeys:Object.keys(value?.artifact??{}),artifactEqual:Object.fromEntries(Object.keys(artifact??{}).map(key=>[key,value?.artifact?.[key]===artifact[key]])),htmlType:typeof value?.html,htmlLength:value?.html?.length,errorCode:result.error?.code}));return result;};
  let busy=false,stopping=false;const timer=setInterval(async()=>{
    if(busy||stopping)return;let request;try{request=JSON.parse(await fs.readFile(path.join(out,'fixture-request.json'),'utf8'));}catch{return;}busy=true;
    try{await fs.unlink(path.join(out,'fixture-request.json'));const agent=app.ctx.get('agents').get(request.sessionId);if(agent?.session?.header?.cwd!==workspace||agent.status==='running')throw Error('IDLE_SYNTHETIC_SESSION_REQUIRED');let value;
      if(request.action==='preparePanelChat'){
        const tools=app.ctx.get('tools'),document=await tools.get('cardstudio_scean_create',agent).execute({name:'合成聊天面板'},{agent,signal:new AbortController().signal});if(!document.ok)throw Error(document.error?.code??'CREATE_FAILED');
        const{playerSixCard}=await import('../fixtures/player-six-ui.mjs'),s=playerSixCard().card.data.extensions.scean,args={action:'dynamic_save',document_id:document.value.id,expected_revision:0,blueprint:s.stateBlueprint,initial_state:s.initialState,frontend:playerSixCard().frontend};
        await fs.writeFile(path.join(out,'scripted-plan.json'),JSON.stringify({args}));value={documentId:document.value.id,paidModelCalls:0};
      }else if(request.action==='panelResult'){const receipt=JSON.parse(await fs.readFile(path.join(out,'scripted-result.json'),'utf8'));value={artifact:receipt.panelPreview,revision:receipt.revision,modelCalls:0,scriptedCalls:JSON.parse(await fs.readFile(path.join(out,'scripted-calls.json'),'utf8')).length};}
      else if(request.action==='previewCalls')value={calls:previewCalls};else throw Error('FIXTURE_ACTION_REFUSED');
      await fs.writeFile(path.join(out,'fixture-result.json'),JSON.stringify({id:request.id,value}));
    }catch(error){await fs.writeFile(path.join(out,'fixture-result.json'),JSON.stringify({id:request.id,error:error.message}));}finally{busy=false;}
  },100);
  await fs.writeFile(path.join(out,'launch.json'),JSON.stringify({pid:process.pid,port,origin:`http://127.0.0.1:${port}`,entry:`http://127.0.0.1:${port}/__preview_entry`,home,workspace,suite,isolated:true,modelCalls:0}));console.log(JSON.stringify({ready:true,label,port}));
  const stop=setInterval(async()=>{if(stopping||busy||!await fs.stat(path.join(out,'stop-request')).catch(()=>null))return;stopping=true;clearInterval(timer);clearInterval(stop);await fs.writeFile(path.join(out,'exit.json'),JSON.stringify({normalDisposeRequested:true,modelCalls:0,previewCalls}));await app.shutdown.shutdown(0);},250);
}
