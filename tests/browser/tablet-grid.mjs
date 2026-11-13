let frame=document.querySelector('#fixture');
const summary=document.querySelector('#summary'),output=document.querySelector('#results'),run=document.querySelector('#run');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
let report,text;
function measure(label){
  const doc=frame.contentDocument,win=frame.contentWindow,q=s=>doc.querySelector(s),pane=q('#reading-pane');
  return {label,viewport:{width:win.innerWidth,height:win.innerHeight},state:{...doc.body.dataset},
    grid:win.getComputedStyle(q('.layout')).gridTemplateColumns,
    layout:rect(q('.layout')),library:rect(q('#library-pane')),player:rect(q('#player')),scene:rect(q('#scene-pane')),reading:rect(pane),input:rect(q('#input')),
    scroll:{height:pane.scrollHeight,client:pane.clientHeight,top:pane.scrollTop,width:pane.scrollWidth,clientWidth:pane.clientWidth},
    text:q('#chat').textContent,dialogs:doc.querySelectorAll('dialog[open]').length};
}
async function record(label,fn){
  let sample;
  try{await settle();sample=measure(label);await fn(sample);sample.status='PASS';}
  catch(error){sample??={label};sample.status='FAIL';sample.error=error.message;}
  if(sample.text){sample.textLength=sample.text.length;delete sample.text;}
  report.samples.push(sample);summary.textContent=`Running: ${report.samples.length} cases`;
}
async function checkStory(sample){
  const doc=frame.contentDocument,pane=doc.querySelector('#reading-pane'),main=doc.querySelector('#player'),win=frame.contentWindow;
  const expected=sample.layout.width-sample.library.width-sample.scene.width;
  assert(sample.text===text,'Story text changed during layout');
  assert(sample.player.width>100,'Story main has zero/insufficient width');
  assert(Math.abs(sample.player.width-expected)<2,'Story does not own released column space');
  assert(sample.reading.width>100&&sample.reading.x>=sample.player.x-1&&sample.reading.right<=sample.player.right+1,'Reading pane clipped by main overflow');
  assert(sample.reading.height>100,'Reading pane has insufficient height');
  assert(sample.scroll.width<=sample.scroll.clientWidth+1,'Story has horizontal overflow');
  assert(sample.input.width>0&&sample.input.right<=sample.player.right+1,'Composer clipped by main');
  assert(sample.dialogs===0,'Unexpected dialog overlay');
  pane.scrollTop=0;await settle();
  const range=doc.createRange(),body=doc.querySelector('.message .body');range.setStart(body.firstChild,0);range.setEnd(body.firstChild,1);
  const glyph=range.getBoundingClientRect(),box=pane.getBoundingClientRect();
  assert(glyph.width>0&&glyph.left>=box.left&&glyph.right<=box.right&&glyph.top>=box.top&&glyph.bottom<=box.bottom,'First story glyph is clipped');
  const hit=doc.elementFromPoint((glyph.left+glyph.right)/2,(glyph.top+glyph.bottom)/2);
  assert(main.contains(hit),'Story glyph is covered by another pane/overlay');
  assert(pane.scrollHeight>pane.clientHeight+100,'Synthetic story does not exercise scrolling');
  pane.scrollTop=Math.min(400,pane.scrollHeight-pane.clientHeight);await settle();
  assert(pane.scrollTop>100,'Story cannot scroll');
  const hasVisibleBody=[...doc.querySelectorAll('.message .body')].some(node=>{const r=node.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom&&r.width>100;});
  assert(hasVisibleBody,'Scrolled story has no visible text');
  sample.scrolledTop=pane.scrollTop;sample.glyphVisible=true;
  assert(win.getComputedStyle(main).display==='flex','Story is hidden');
  assert(parent.gridFixturePreferences.unexpected.length===0,'Unexpected native/data operation');
}
async function size(width,height){frame.style.width=width+'px';frame.style.height=height+'px';await settle();}
async function load(width,height,preferences={}){
  if(frame.hasAttribute('src')){
    // Keep the same mounted player while exercising both axes and breakpoints.
    await size(1280,800);
    for(const [key,selector] of [['leftCollapsed','#toggle-library'],['rightCollapsed','#toggle-scene']]){
      if((frame.contentDocument.body.dataset[key]==='true')!==(preferences[key]===true))await click(selector);
    }
    await click('[data-pane=story]');await size(width,height);return;
  }
  window.gridFixturePreferences={value:{...preferences},saves:0,unexpected:[]};
  const next=document.createElement('iframe');next.id='fixture';next.title='Synthetic player fixture';next.style.width=width+'px';next.style.height=height+'px';
  const loaded=new Promise(resolve=>next.addEventListener('load',resolve,{once:true}));
  next.src='/fixture?case='+report.samples.length;frame.replaceWith(next);frame=next;await loaded;
  for(let i=0;i<120&&!frame.contentDocument.body.dataset.fixtureReady;i++)await settle();
  assert(frame.contentDocument.body.dataset.fixtureReady==='true','Fixture did not mount');
  text=frame.contentDocument.querySelector('#chat').textContent;
}
async function click(selector){frame.contentDocument.querySelector(selector).click();await settle();}
run.addEventListener('click',async()=>{
  run.disabled=true;report={status:'RUNNING',synthetic:true,physicalTablet:'NOT_TESTED',productionWrites:0,modelCalls:0,samples:[]};
  try{
    for(const [width,height] of [[390,844],[760,1024]]){
      await load(width,height);await record(`${width}-story`,checkStory);
      for(const pane of ['library','state']){
        await click(`[data-pane=${pane}]`);
        await record(`${width}-${pane}-tab`,sample=>{assert(sample.state.playerView===pane,'Wrong mobile tab');assert(sample.player.width===0,'Mobile tabs must hide story');assert((pane==='library'?sample.library:sample.scene).width>100,'Mobile tab missing');});
        await click('[data-pane=story]');await record(`${width}-return-from-${pane}`,checkStory);
      }
    }
    for(const [width,height] of [[761,1024],[800,1280],[1000,800],[1001,800],[1024,768],[1179,820],[1180,820],[1280,800],[1440,900]]){
      await load(width,height);await record(`${width}-both-open`,checkStory);
      for(const [button,label] of [['#toggle-scene','right-closed'],['#toggle-library','both-closed'],['#toggle-scene','left-closed'],['#toggle-library','reopened']]){
        await click(button);await record(`${width}-${label}`,checkStory);
      }
    }
    await load(800,1280,{leftCollapsed:true,rightCollapsed:false});await record('precollapsed-left',checkStory);
    await load(800,1280,{leftCollapsed:true,rightCollapsed:true});await record('precollapsed-both',checkStory);
    await load(800,1280);await click('#toggle-library');
    for(const [width,height] of [[800,1280],[1280,800],[800,1280],[1179,820],[1180,820],[760,1024],[761,1024]]){
      await size(width,height);await record(`live-resize-${width}x${height}`,async sample=>{assert(sample.state.leftCollapsed==='true','Resize lost saved collapse state');await checkStory(sample);});
    }
    report.status=report.samples.every(sample=>sample.status==='PASS')?'PASS':'FAIL';
  }catch(error){report.status='FAIL';report.error=error.stack;}
  report.passed=report.samples.filter(sample=>sample.status==='PASS').length;report.failed=report.samples.filter(sample=>sample.status==='FAIL').length;
  output.textContent=JSON.stringify(report,null,2);summary.textContent=`${report.status}: ${report.passed} passed, ${report.failed} failed`;
  document.body.dataset.result=report.status;run.disabled=false;
});
