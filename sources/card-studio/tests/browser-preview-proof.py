"""Fresh Chromium/Edge, synthetic srcdoc only. No DSH, model, credentials, or external service."""
from pathlib import Path
import argparse,asyncio,base64,hashlib,html,http.server,json,shutil,subprocess,tempfile,threading,time,urllib.request
import websockets

parser=argparse.ArgumentParser();parser.add_argument('--browser',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'test-evidence/v014-preview';out.mkdir(parents=True,exist_ok=True)
fixtures=json.loads((out/'fixtures.json').read_text(encoding='utf-8'));requests=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        requests.append(self.path)
        if self.path=='/proof':
            payload=json.dumps(fixtures,ensure_ascii=True).replace('PORT',str(server.server_port)).replace('</script','<\\/script')
            script='''window.__cardScriptRan=false;window.__cardMessages=[];addEventListener('message',e=>window.__cardMessages.push(e.data));const data=DATA;const frames=[];for(const row of [...data.projections,{name:'raw-control',html:data.rawControl,viewport:390}]){const label=document.createElement('h3');label.textContent=row.name;document.body.append(label);const f=document.createElement('iframe');f.setAttribute('sandbox','');f.style.width=row.viewport+'px';f.style.height='520px';f.srcdoc=row.html;document.body.append(f);frames.push({name:row.name,f});}setTimeout(()=>{const checks=frames.map(({name,f})=>{let accessDenied=false;try{void f.contentWindow.document.body;}catch(e){accessDenied=e.name==='SecurityError';}return {name,sandbox:f.getAttribute('sandbox'),contentDocumentNull:f.contentDocument===null,parentAccessDenied:accessDenied};});document.querySelector('#result').textContent=JSON.stringify({checks,cardScriptRan:window.__cardScriptRan,messages:window.__cardMessages,frameCount:frames.length});},1200);'''.replace('DATA',payload)
            content=('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; frame-src \'self\'; connect-src \'none\'; base-uri \'none\'"><style>body{font-family:system-ui;background:#eceff6;padding:20px}iframe{display:block;border:1px solid #8893a2;margin-bottom:24px}h3{margin-bottom:8px}</style></head><body><pre id="result">pending</pre><script>'+script+'</script></body></html>').encode()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
        else:self.send_response(404);self.end_headers()
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
temp_parent=Path(tempfile.gettempdir()).resolve();profile=Path(tempfile.mkdtemp(prefix='cardstudio-preview-proof-',dir=temp_parent)).resolve();process=None;browser_log=(out/'chromium-browser-stderr.txt').open('wb')
async def run():
    global process
    command=[str(Path(args.browser).resolve()),'--headless','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+str(profile),'--window-size=1140,1800','about:blank']
    process=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=browser_log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    port_file=profile/'DevToolsActivePort'
    for _ in range(160):
        if port_file.exists():break
        if process.poll() is not None:raise RuntimeError('Fresh browser exited before DevTools became available')
        await asyncio.sleep(.05)
    debug_port=int(port_file.read_text().splitlines()[0]);endpoint='http://127.0.0.1:'+str(debug_port)
    targets=json.load(urllib.request.urlopen(endpoint+'/json/list'));target=next(t for t in targets if t['type']=='page')
    events=[];counter=0
    socket_url=target['webSocketDebuggerUrl'].replace('localhost:','127.0.0.1:')
    async with websockets.connect(socket_url,max_size=30*1024*1024,proxy=None) as ws:
        async def call(method,params=None,session_id=None):
            nonlocal counter
            counter+=1;ident=counter;packet={'id':ident,'method':method,'params':params or {}}
            if session_id:packet['sessionId']=session_id
            await ws.send(json.dumps(packet))
            while True:
                response=json.loads(await asyncio.wait_for(ws.recv(),15))
                if response.get('id')==ident:
                    if 'error'in response:raise RuntimeError(str(response['error']))
                    return response.get('result',{})
                if 'method'in response:events.append(response)
        for method in ['Page.enable','Runtime.enable','Log.enable','Network.enable']:await call(method)
        await call('Target.setAutoAttach',{'autoAttach':True,'waitForDebuggerOnStart':True,'flatten':True})
        await call('Page.navigate',{'url':'http://127.0.0.1:'+str(server.server_port)+'/proof'})
        result=None;sessions={}
        for _ in range(50):
            attached=[e['params'] for e in events if e['method']=='Target.attachedToTarget' and e['params']['sessionId'] not in sessions]
            for row in attached:
                session_id=row['sessionId'];sessions[session_id]=row['targetInfo']
                for method in ['Page.enable','Runtime.enable','Log.enable','Network.enable']:await call(method,session_id=session_id)
                await call('Runtime.runIfWaitingForDebugger',session_id=session_id)
            answer=await call('Runtime.evaluate',{'expression':'document.querySelector("#result")?.textContent','returnByValue':True})
            text=answer.get('result',{}).get('value')
            if text and text!='pending':result=json.loads(text);break
            await asyncio.sleep(.1)
        if result is None:raise RuntimeError('Synthetic browser page did not finish')
        tree=await call('Page.getFrameTree');contexts=[e['params']['context'] for e in events if e['method']=='Runtime.executionContextCreated'];frames=[]
        def walk(node):
            frames.append(node['frame'])
            for child in node.get('childFrames',[]):walk(child)
        walk(tree['frameTree']);parent_frame=tree['frameTree']['frame']['id'];measurements=[]
        for session_id,info in sessions.items():
            if info.get('type')!='iframe':continue
            child_tree=await call('Page.getFrameTree',session_id=session_id);frame=child_tree['frameTree']['frame']
            fixed_query='JSON.stringify({bodyText:document.body.innerText,viewport:innerWidth,cardStyle:document.querySelector(".card")?{color:getComputedStyle(document.querySelector(".card")).color,padding:getComputedStyle(document.querySelector(".card")).padding,background:getComputedStyle(document.querySelector(".card")).backgroundImage,font:getComputedStyle(document.querySelector(".card")).fontFamily}:null,scrollWidth:document.documentElement.scrollWidth,images:[...document.images].map(i=>({complete:i.complete,naturalWidth:i.naturalWidth,srcKind:i.getAttribute("src")?.startsWith("data:image/")?"data-raster":"other"})),scripts:document.scripts.length,events:[...document.querySelectorAll("*")].flatMap(e=>[...e.attributes].filter(a=>a.name.startsWith("on")).map(a=>a.name))})'
            answer=await call('Runtime.evaluate',{'expression':fixed_query,'returnByValue':True},session_id=session_id);value=answer.get('result',{}).get('value')
            measurements.append({'url':frame.get('url'),'securityOrigin':frame.get('securityOrigin'),'measurement':json.loads(value) if value else None})
        shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True});(out/'chromium-preview-proof.png').write_bytes(base64.b64decode(shot['data']))
        logs=list({json.dumps(e['params']['entry'],sort_keys=True):e['params']['entry'] for e in events if e['method']=='Log.entryAdded'}.values());failures=[e['params'] for e in events if e['method']=='Network.loadingFailed'];network=[{'url':e['params']['request']['url'],'type':e['params'].get('type')} for e in events if e['method']=='Network.requestWillBeSent']
        version=json.load(urllib.request.urlopen(endpoint+'/json/version'))['Browser']
        report={'browser':version,'freshProfile':True,'DSHLiveUIObserved':False,'remoteDebugging':'ephemeral loopback-only port owned by this test; closed after test','syntheticPage':True,'localServerRequests':requests,'parentChecks':result,'frameMeasurements':measurements,'browserSecurityLogs':logs,'networkFailures':failures,'pageNetworkEvents':network,'scope':'Actual Chromium rendering/sandbox/CSP on synthetic projections and explicit raw defence-in-depth control; not installed DSH UI compatibility'}
        checks=[]
        def check(name,value):checks.append({'name':name,'pass':bool(value)})
        check('six frames with empty-token opaque sandbox',len(result['checks'])==6 and all(c['sandbox']=='' and c['contentDocumentNull'] and c['parentAccessDenied'] for c in result['checks']))
        check('card script did not mutate parent or issue host RPC',result['cardScriptRan'] is False and result['messages']==[])
        check('no trap or external resource reached local server',requests==['/proof'])
        primary=[m for m in measurements if m.get('measurement',{}).get('scripts')==0]
        check('five sanitized projections inspected in actual browser',len(primary)==5)
        check('data raster rendered in five projected frames',all(any(i['naturalWidth']==2 and i['srcKind']=='data-raster' for i in m['measurement']['images']) for m in primary))
        check('five sizes render without horizontal overflow',sorted(m['measurement']['viewport'] for m in primary)==[360,390,768,960,1024] and all(m['measurement']['scrollWidth']<=m['measurement']['viewport'] for m in primary))
        check('responsive media changes computed padding and color',all(m['measurement']['cardStyle']['padding']==('8px' if m['measurement']['viewport']<=390 else '24px') and m['measurement']['cardStyle']['color']==('rgb(10, 20, 30)' if m['measurement']['viewport']<=390 else 'rgb(40, 50, 60)') for m in primary))
        check('gradient background and quoted font family render',all(m['measurement']['cardStyle']['background'].startswith('linear-gradient(') and 'Example Sans' in m['measurement']['cardStyle']['font'] for m in primary))
        check('label display conceals numeric sample; unknown macro inert',all('42' not in m['measurement']['bodyText'] and '有點害羞' in m['measurement']['bodyText'] and '{{getvar::unknown}}' in m['measurement']['bodyText'] for m in primary))
        check('raw defence control contains script but Chromium refuses sandbox execution',any('sandbox' in row.get('text','').lower() and 'script' in row.get('text','').lower() for row in logs))
        check('CSP records network resource block in raw defence control',any('Content Security Policy' in row.get('text','') and '/trap/raw-' in row.get('text','') and 'blocked' in row.get('text','') for row in logs))
        report['checks']=checks;report['files']={str(p.relative_to(root)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'cardstudio-bundle/lib/frontend-authoring.js',root/'cardstudio-bundle/lib/preview-projection.js',root/'cardstudio-bundle/lib/preview-css.js',root/'tests/browser-preview-proof.py',root/'tests/browser-preview-fixtures.js']}
        (out/'chromium-preview-proof.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'browser':version,'checks':checks,'evidence':str(out/'chromium-preview-proof.json')},ensure_ascii=True,indent=2))
        assert all(c['pass'] for c in checks),'Browser proof failed; examine evidence'
try:asyncio.run(run())
finally:
    server.shutdown();server.server_close()
    if process:
        process.terminate()
        try:process.wait(timeout=8)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
    browser_log.close()
    assert profile.parent==temp_parent and profile.name.startswith('cardstudio-preview-proof-');shutil.rmtree(profile,ignore_errors=True)
