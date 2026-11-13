"""Actual installed React and generated Client in an offline, fresh browser profile."""
from pathlib import Path
import argparse,hashlib,html,json,re,shutil,subprocess,tempfile

parser=argparse.ArgumentParser();parser.add_argument('--browser',required=True);parser.add_argument('--preview',choices=['overview','book','entry']);parser.add_argument('--width',type=int,default=2194);parser.add_argument('--height',type=int,default=1234);parser.add_argument('--scale',type=float,default=1.75);args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
fixture=root/'evidence/app-asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js'
raw=fixture.read_bytes();assert hashlib.sha256(raw).hexdigest()=='af3ff948cf3f132edbddebea93e2f9f02233b390a94bd4c9842182300be811bb'
source=raw.decode('utf-8')
# Only the embedded MIT React/JSX/Scheduler/ReactDOM module block is evaluated.
# No Vite imports, DSH bootstrap, Cordis app, desktop bridge or native profile.
helper=source[source.index('function as(e,n)'):source.index('(function(){',source.index('function as(e,n)'))]
react=source[source.index('function _o(e)'):source.index(',Ff={},Hf=')]+ ';window.testReact=Ef;window.testReactDOM={...Rf,...Df};'
client=(root/'cardstudio-bundle/client.js').read_text(encoding='utf-8')
cases=(root/'tests/browser-dock-ui.js').read_text(encoding='utf-8')
native=(root/'evidence/app-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js').read_bytes()
assert hashlib.sha256(native).hexdigest()=='64843c950b829f44feed3248af6c46bbd620cf85e7c687b4f7f60e1ec4eb4782'
styles=[json.loads(match) for match in re.findall(r'const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");',native.decode('utf-8'))]
css=''.join(value for value in styles if any(name in value for name in ['.Dc7zOa_body{','.RlGAzG_root{']))
assert '.Dc7zOa_composerHero' in css and '.RlGAzG_card' in css
cases='window.nativeConversationCss='+json.dumps(css)+';\n'+cases
parent=Path(tempfile.gettempdir()).resolve();directory=Path(tempfile.mkdtemp(prefix='cardstudio-browser-session-',dir=parent)).resolve()
assert directory.parent==parent and directory.name.startswith('cardstudio-browser-session-')
try:
    script='window.addEventListener("error",e=>{document.getElementById("result").textContent=JSON.stringify({bootError:e.message});});\n'+helper+react+'\nwindow.__ModuleLoader__={load:value=>{window.testRegistration=value;}};\n'+client+'\n(async()=>{'+cases+'})().catch(e=>{document.getElementById("result").textContent=JSON.stringify({error:e.message});});'
    page=directory/'test.html';page.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'"><style>:root{--dsw-alias-label-primary:#e8e9ed;--dsw-alias-label-secondary:#a7aab2;--dsw-alias-bg-base:#18191c;--dsw-alias-bg-layer-2:#222328;--dsw-alias-border-l1:#3a3c43;--dsw-alias-mask:#0008;color-scheme:dark}body{margin:0;font-family:Segoe UI,sans-serif;background:var(--dsw-alias-bg-base)}#one,#two{height:100vh}</style><div id="one"></div><div id="two"></div><pre id="result">pending</pre><script>'+script.replace('</script','<\\/script')+'</script>',encoding='utf-8')
    command=[str(Path(args.browser).resolve()),'--window-size='+str(args.width)+','+str(args.height),'--force-device-scale-factor='+str(args.scale),'--headless','--dump-dom','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--timeout=15000','--virtual-time-budget=8000','--user-data-dir='+str(directory/'profile'),page.as_uri()+('?preview='+args.preview if args.preview else '')]
    if args.preview:command.insert(-1,'--screenshot='+str(root/'test-evidence'/('ui-'+args.preview+'-'+str(args.width)+'.png')))
    process=subprocess.run(command,capture_output=True,timeout=25,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    output=process.stdout.decode('utf-8',errors='replace');match=re.search(r'<pre id="result"[^>]*>(.*?)</pre>',output,re.S);content=match.group(1) if match else ''
    if not content or content=='pending':
        (root/'test-evidence/browser-dock-debug.html').write_text(output,encoding='utf-8')
        (root/'test-evidence/browser-dock-stderr.txt').write_bytes(process.stderr)
        raise RuntimeError('No completed browser result; exit '+str(process.returncode))
    report=json.loads(html.unescape(content));report.update({'clientSha256':hashlib.sha256((root/'cardstudio-bundle/client.js').read_bytes()).hexdigest(),'DSHFrontendFixtureSha256':hashlib.sha256(raw).hexdigest(),'freshProfile':True,'remoteDebugging':False,'networkFromTestPage':'blocked by CSP','scope':'Actual generated Dock and React/ReactDOM; pinned native composer CSS and display:contents slot topology; synthetic DOM/Session, no live DSH'})
    (root/'test-evidence'/('browser-dock-ui'+('-'+args.preview+'-'+str(args.width) if args.preview else '')+'.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,indent=2))
    assert (args.preview or len(report.get('checks',[]))==8) and all(row['pass'] for row in report.get('checks',[])) and not report.get('errors'),'Browser UI regression failed'
finally:
    assert directory.resolve().parent==parent and directory.name.startswith('cardstudio-browser-session-');shutil.rmtree(directory)
