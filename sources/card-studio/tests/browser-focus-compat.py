"""Bounded CSS compatibility regression; fresh browser, no live Desktop writes."""
from pathlib import Path
import argparse,asyncio,hashlib,json,re,subprocess,tempfile,time,urllib.request
import websockets

args=argparse.ArgumentParser()
args.add_argument('--browser',required=True)
options=args.parse_args()
root=Path(__file__).resolve().parents[1]
template=root/'cardstudio-bundle/client-template.js'
css=lambda text:re.search(r'const css=`(.*?)`;',text,re.S).group(1)
current=css(template.read_text(encoding='utf-8'))
old=subprocess.check_output(['git','-c','safe.directory='+str(root).replace('\\','/'),'show','7969f6d:cardstudio-bundle/client-template.js'],cwd=root).decode('utf-8')
old_css=css(old)
palettes={
 'daily-observed':{'primary':'#e1f1fa','secondary':'#c0ced6','base':'#0c2231','surface':'#293d4a','accent':'#b0693b','business':'#b0693b'},
 'dark':{'primary':'#f9fafb','secondary':'#bfc0c1','base':'#151517','surface':'#2c2c2e','accent':'#f9fafb','business':'#b0693b'},
 'light':{'primary':'#20252c','secondary':'#63666c','base':'#f4f5f7','surface':'#ffffff','accent':'#205987','business':'#b0693b'},
 'custom':{'primary':'#f0f4ef','secondary':'#b3c2b5','base':'#18231c','surface':'#25362b','accent':'#9bd6aa','business':'#b0693b'}
}
host='#root :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}'
markup='<div id="root"><button id="outside">Host control</button><section class="cs-panel"><label>Authoring Scope<select id="scope"><option>完整模式 / Full</option></select></label><input id="input" value="Synthetic"><textarea id="textarea">Synthetic only</textarea><button disabled class="cs-button" id="disabled">Disabled</button><button id="button" class="cs-button">中文長標籤：讀完整素材並核驗來源快照</button></section><div class="cs-dock"><button id="dock" class="cs-button">Card Studio</button></div></div>'

class CDP:
 def __init__(self,ws):self.ws=ws;self.seq=0
 async def call(self,method,params=None):
  self.seq+=1;seq=self.seq
  await self.ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
  while True:
   response=json.loads(await self.ws.recv())
   if response.get('id')==seq:
    assert 'error' not in response,response.get('error')
    return response['result']
 async def evaluate(self,expression):
  response=await self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True})
  assert 'exceptionDetails' not in response,response.get('exceptionDetails')
  return response['result'].get('value')

async def run(directory,process):
 deadline=time.monotonic()+8;active=directory/'DevToolsActivePort'
 while not active.exists():
  assert process.poll() is None,'Isolated Chrome exited before CDP was ready'
  assert time.monotonic()<deadline,'CDP readiness timeout'
  await asyncio.sleep(.05)
 port=active.read_text().splitlines()[0]
 targets=json.load(urllib.request.urlopen('http://127.0.0.1:'+port+'/json/list',timeout=3))
 target=next(t for t in targets if t['type']=='page')
 async with websockets.connect(target['webSocketDebuggerUrl'],proxy=None,max_size=4*1024*1024) as ws:
  c=CDP(ws);await c.call('Page.enable')
  rows=[]
  for name,palette in palettes.items():
   tokens=':root{'+''.join('--dsw-alias-'+key+':'+palette[value]+';' for key,value in {'label-primary':'primary','label-secondary':'secondary','bg-base':'base','bg-layer-2':'surface','brand-primary':'accent','state-business-primary':'business'}.items())+'}'
   for order in ['host-before','host-after']:
    sheets=[host,current] if order=='host-before' else [current,host]
    page='<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>'+tokens+'body{background:var(--dsw-alias-bg-base);margin:0} .cs-panel{height:650px} '+''.join(sheets)+'</style>'+markup
    await c.call('Page.setDocumentContent',{'frameId':(await c.call('Page.getFrameTree'))['frameTree']['frame']['id'],'html':page})
    await c.evaluate("document.body.tabIndex=-1;document.body.focus()")
    await c.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
    await c.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
    outside=await c.evaluate("({id:document.activeElement.id,visible:document.activeElement.matches(':focus-visible'),color:getComputedStyle(document.activeElement).outlineColor,offset:getComputedStyle(document.activeElement).outlineOffset})")
    assert outside['id']=='outside' and outside['visible'] and outside['color']=='rgb(176, 105, 59)' and abs(float(outside['offset'].removesuffix('px'))-2)<.58,outside
    samples=[]
    for expected in ['scope','input','textarea','button','dock']:
     await c.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
     await c.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
     sample=await c.evaluate('''(()=>{const e=document.activeElement,s=getComputedStyle(e),rgb=v=>v.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};let bg=e;while(getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;return {id:e.id,visible:e.matches(':focus-visible'),color:s.outlineColor,contrast:ratio(rgb(s.outlineColor),rgb(getComputedStyle(bg).backgroundColor)),width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),style:s.outlineStyle,dpr:devicePixelRatio}})()''')
     assert sample['id']==expected and sample['visible'],sample
     assert sample['style']=='solid' and abs(sample['width']-2)<=1/sample['dpr'] and abs(sample['offset']-3)<=1/sample['dpr'],sample
     assert sample['contrast']>=3,sample
     samples.append(sample)
    assert await c.evaluate("document.getElementById('disabled').disabled"),'Native disabled changed'
    rows.append({'palette':name,'order':order,'outsideHostFocusUnchanged':True,'nativeDisabledSkipped':True,'samples':samples,'pass':True})
  # The exact old CSS and observed daily values must reproduce the measured failure.
  palette=palettes['daily-observed']
  tokens=':root{--dsw-alias-label-primary:#e1f1fa;--dsw-alias-bg-layer-2:#293d4a;--dsw-alias-brand-primary:#b0693b;--dsw-alias-state-business-primary:#b0693b}'
  page='<style>'+tokens+old_css+host+'</style>'+markup
  await c.call('Page.setDocumentContent',{'frameId':(await c.call('Page.getFrameTree'))['frameTree']['frame']['id'],'html':page})
  await c.evaluate("document.getElementById('scope').focus()")
  previous=await c.evaluate("({color:getComputedStyle(document.activeElement).outlineColor,background:getComputedStyle(document.activeElement).backgroundColor})")
  assert previous=={'color':'rgb(176, 105, 59)','background':'rgb(41, 61, 74)'},previous
  report={'pass':True,'cases':rows,'knownFailOracle':{'pass':True,'observed':previous,'contrast':2.6494879241419618},'generatedClientSha256':hashlib.sha256((root/'cardstudio-bundle/client.js').read_bytes()).hexdigest(),'testScope':'Shipped CardStudio CSS in isolated Chromium; exact observed appearance values and four palettes, both cascade orders. Keyboard Tab and outside-scope control checks. Corrected daily Electron not installed or certified.','DPI':'Test browser scale 1.75; emulated fixture, not additional native DPI proof','liveDesktopModified':False}
  (root/'test-evidence/focus-compatibility.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
  print(json.dumps({'pass':True,'paletteOrderCases':len(rows),'focusedControls':sum(len(r['samples']) for r in rows),'dailyFocusedContrast':rows[0]['samples'][0]['contrast'],'knownFailOracle':True,'nativeDisabledSkipped':True,'outsideHostFocusUnchanged':True}))
  await c.call('Browser.close')

with tempfile.TemporaryDirectory(prefix='cardstudio-focus-compat-') as temp:
 directory=Path(temp)
 process=subprocess.Popen([options.browser,'--headless','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+str(directory),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--force-device-scale-factor=1.75','--window-size=1279,821','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 try:asyncio.run(run(directory,process))
 finally:
  if process.poll() is None:process.terminate()
  process.wait(timeout=5)
