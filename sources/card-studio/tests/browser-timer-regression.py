"""Run the exact controller with real browser timers in a fresh, isolated profile."""
from pathlib import Path
import argparse,hashlib,html,json,shutil,subprocess,tempfile

parser=argparse.ArgumentParser()
parser.add_argument('--browser',required=True,help='Existing signed Chrome/Chromium executable; no browser download')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
raw=(root/'cardstudio-bundle/lib/client-controller.js').read_bytes()
source=raw.decode('utf-8').replace('export class WorkspaceClient','class WorkspaceClient')
cases=r'''
const results=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const row={id:'synthetic-session',cwd:'C:/Synthetic/Card Studio'};
function fixture({failAcquire=false,failCapabilities=false,failRenew=false,failPresent=false,deferredAcquire=false}={}){
  const calls=[],errors=[];let complete;
  const client=new WorkspaceClient({root:row.cwd,pageId:'synthetic-page',hide:()=>calls.push('hide'),
    present:()=>{calls.push('present');if(failPresent){failPresent=false;throw new TypeError('synthetic presentation failure');}},
    show:()=>calls.push('show'),notify:error=>errors.push(error.name),send:async(_id,request)=>{
      calls.push(request.action);
      if(request.action==='acquire'&&deferredAcquire)return await new Promise(resolve=>{complete=resolve;});
      if(request.action==='acquire'&&failAcquire){failAcquire=false;return {ok:false,error:{code:'SYNTHETIC',message:'acquire failed once'}};}
      if(request.action==='capabilities'&&failCapabilities){failCapabilities=false;return {ok:false,error:{code:'SYNTHETIC',message:'capabilities failed once'}};}
      if(request.action==='renew'&&failRenew){failRenew=false;return {ok:false,error:{message:'renew failed once'}};}
      return {ok:true,value:request.action==='acquire'?{lease_id:'synthetic-lease'}:{skills:[],tools:[]}};
    }});
  return {client,calls,errors,complete:()=>complete({ok:true,value:{lease_id:'synthetic-late'}})};
}
async function check(name,options,run){
  const f=fixture(options);
  try{await run(f);results.push({name,pass:true});}
  catch(error){results.push({name,pass:false,kind:error.name,message:error.message});}
  finally{clearInterval(f.client.timer);await f.client.close().catch(()=>{});}
}
await check('initial empty Session, valid Session, duplicate notification, workspace switch, repeated disposal',{},async({client,calls})=>{
  await client.transition(undefined);await client.transition(undefined);
  assert(client.phase==='inactive'&&!calls.includes('acquire'),'empty Session must stay inactive');
  await client.transition(row);assert(client.phase==='ready'&&typeof client.timer==='number','valid Session must start browser heartbeat');
  const count=calls.length;await client.transition(row);assert(calls.length===count,'duplicate notification reacquired');
  await client.transition({...row,cwd:'E:/synthetic-other'});assert(client.phase==='inactive'&&client.timer===null,'workspace switch must clear heartbeat');
  await client.transition(row);assert(client.phase==='ready','return must reconnect');
  await client.close();await client.close();assert(client.timer===null,'dispose must clear heartbeat');
  assert(calls.filter(value=>value==='acquire').length===2&&calls.filter(value=>value==='release').length===2,'lease lifecycle mismatch');
});
await check('failed acquire retry and failed heartbeat recovery',{failAcquire:true,failRenew:true},async({client,errors})=>{
  await client.transition(row);assert(client.phase==='error','acquire failure must become error');
  await client.retry();assert(client.phase==='ready','retry must recover');
  await client.heartbeat(client.sequence);assert(client.phase==='ready'&&errors.length===2,'heartbeat must reacquire');
  await client.close();assert(client.timer===null,'heartbeat must clear on close');
});
await check('presentation failure remains retryable',{failPresent:true},async({client,calls})=>{
  await client.transition(row);assert(client.phase==='error'&&!calls.includes('acquire'),'presentation failure must be caught before acquire');
  await client.retry();assert(client.phase==='ready','presentation retry must recover');
});
await check('late acquire after disposal releases without showing stale UI',{deferredAcquire:true},async({client,calls,complete})=>{
  const pending=client.transition(row);await Promise.resolve();await client.close();complete();await pending;
  assert(!calls.includes('show')&&client.timer===null,'late acquire resurrected UI');
  assert(calls.filter(value=>value==='release').length===1,'late claim must be released once');
});
await check('capability failure releases claim and retry recovers',{failCapabilities:true},async({client,calls})=>{
  await client.transition(row);assert(client.phase==='error'&&client.timer===null,'capability failure must clear ownership');
  assert(calls.filter(value=>value==='release').length===1,'failed claim was not released');
  await client.retry();assert(client.phase==='ready','capability retry must recover');
});
document.getElementById('result').textContent=JSON.stringify({engine:navigator.userAgent,checks:results});
'''
parent=Path(tempfile.gettempdir()).resolve()
directory=Path(tempfile.mkdtemp(prefix='cardstudio-browser-timer-',dir=parent)).resolve()
assert directory.parent==parent and directory.name.startswith('cardstudio-browser-timer-')
try:
    page=directory/'test.html'
    page.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'"><pre id="result">pending</pre><script>\n'+source+'\n(async()=>{'+cases+'})()</script>',encoding='utf-8')
    command=[str(Path(args.browser).resolve()),'--headless','--dump-dom','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--timeout=10000','--user-data-dir='+str(directory/'profile'),page.as_uri()]
    process=subprocess.run(command,capture_output=True,timeout=25,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    output=process.stdout.decode('utf-8',errors='replace')
    start='<pre id="result">'; content=output.partition(start)[2].partition('</pre>')[0]
    if not content:raise RuntimeError('No headless test result, exit '+str(process.returncode))
    report=json.loads(html.unescape(content))
    report.update({'controllerSha256':hashlib.sha256(raw).hexdigest(),'freshProfile':True,'remoteDebugging':False,'DSHLiveUIObserved':False,'networkFromTestPage':'blocked by CSP'})
    resultPath=root/'test-evidence/browser-timer-regression.json';resultPath.parent.mkdir(exist_ok=True)
    resultPath.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
    assert len(report['checks'])==5 and all(row['pass'] for row in report['checks']),'Browser regression failed'
finally:
    assert directory.resolve().parent==parent and directory.name.startswith('cardstudio-browser-timer-')
    shutil.rmtree(directory,ignore_errors=True)
