// Actual bundled React/ReactDOM + generated Client; synthetic human RPC only.
const React=window.testReact,ReactDOM=window.testReactDOM,checks=[],calls=[],errors=[];
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const modern='character-authoring';
const longLabel='角色塑造（試用草稿 α1）｜'+('完整人物、環境作用與關係心理設計；'.repeat(7));
const options=[{name:modern,label:longLabel,available:true}];
const state=new Map(['A','B'].map(id=>[id,{name:modern,epoch:0,locked:false,available:true,options}]));
const info=id=>{const m=state.get(id);return {...m,label:options.find(x=>x.name===m.name).label,notice:m.locked?'本對話已開始或讀入方法；切換需開新對話並重新選擇。舊對話內容仍保留。':'只作用於本對話。開始對話或首次讀入後固定；切換需開新對話。'};};
const skills=id=>[{name:state.get(id).name,description:'Synthetic method only'}];
const scope={mode:'full',epoch:0};let delay,finish;
const assert=(value,message)=>{if(!value)throw Error(message);},tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(fn){for(let i=0;i<160;i++){if(fn())return;await tick();}throw Error('Method UI timed out');}
async function request(id,r){calls.push({id,action:r.action});let value={};if(r.action==='workspace')value={workspace:'C:/Synthetic'};else if(['acquire','renew','capabilities'].includes(r.action))value={lease_id:id,authoring_scope:scope,character_method:info(id),skills:skills(id),tools:[]};else if(r.action==='documents')value={items:[],total:0,offset:0,limit:50};else if(r.action==='imports')value=[];return {ok:true,value:{ok:true,value}};}
async function setCharacterMethod(id,r){
  calls.push({id,action:'human-method',request:r});const m=state.get(id);
  if(r.expected_epoch!==m.epoch)return {ok:true,value:{ok:false,error:{code:'CHARACTER_METHOD_CHANGED',message:'方法已變更，請重新整理。'}}};
  if(m.locked)return {ok:true,value:{ok:false,error:{code:'CHARACTER_METHOD_LOCKED',message:'切換需開新對話。'}}};
  if(delay){delay=false;await new Promise(resolve=>finish=resolve);}
  m.name=r.name;m.epoch++;return {ok:true,value:{ok:true,value:{character_method:info(id),skills:skills(id)}}};
}
function mount(container){
  const root=ReactDOM.createRoot(container),slots=new Map(),cleanup=[];let session='A',subscription,table;
  const render=()=>{const component=slots.get('local-cardstudio');root.render(component?React.createElement(component):null);};
  const ctx={get(name){return name.split('.').reduce((v,k)=>v?.[k],this);},on:()=>()=>{},typert:{},inject(_names,fn){fn(this);},effect(fn){const end=fn();if(typeof end==='function')cleanup.push(end);},locale:{register(_name,value){table=value.zh;return()=>{};},bind:()=>key=>table?.[key]??key},layout:{selectPanel(){render();}},sessions:{list:{getSnapshot:()=>({byId:{[session]:{id:session,cwd:'C:/Synthetic',retainedBy:{mainView:1}}}}),subscribe:fn=>{subscription=fn;return()=>{};}}},slots:{inject(_name,fn){return fn();},register(options,component){const key=options.key??options.id;slots.set(key,component);if(key==='local-cardstudio')render();return()=>{slots.delete(key);if(key==='local-cardstudio')render();};}},remote:{async $mount(){},cardstudio:{request,setCharacterMethod},session:{async canOpenWorkspacePath(){return {ok:true,value:false};}}}};
  window.testRegistration.factory(()=>React).apply(ctx);
  return {container,switch(id){session=id;subscription?.();},close(){for(const end of cleanup.reverse())end();root.unmount();}};
}
const one=mount(document.getElementById('one')),two=mount(document.getElementById('two'));
const select=view=>view.container.querySelector('.cs-method select');
async function pick(view,name){select(view).value=name;select(view).dispatchEvent(new Event('change',{bubbles:true}));await tick();}
async function refresh(view){const detail=view.container.querySelector('details[data-details=skills]');detail.open=true;detail.querySelector('button').click();await tick();}
async function check(name,fn){await fn();checks.push({name,pass:true});}
await until(()=>select(one)?.value===modern&&select(two)?.value===modern&&!select(one).disabled);
await check('single retained method; Palette absent and Scope independent',async()=>{assert(select(one).getAttribute('aria-label')==='角色設計方法（本對話）','Chinese control absent');assert(select(one).options.length===1,'Unexpected method count');assert(select(one).options[0].value===modern,'Retired method offered');assert(one.container.querySelector('[data-authoring-scope]').dataset.authoringScope==='full','Scope changed');});
await check('sole method uses dedicated human invocation with lease and epoch',async()=>{await pick(one,modern);await until(()=>!select(one).disabled);assert(calls.some(x=>x.action==='human-method'&&x.request.expected_epoch===0&&x.request.claim.lease_id==='A'),'Lease/epoch missing');assert(!calls.some(x=>x.action==='setCharacterMethod'),'Generic action selected method');});
await check('long Chinese label remains readable at 20px and 175% without horizontal overflow',async()=>{assert(devicePixelRatio===1.75,'Wrong device scale');for(const width of [1280,900,580,420,360]){one.container.style.width=width+'px';await tick();const panel=one.container.querySelector('.cs-panel'),label=one.container.querySelector('.cs-method-current');assert(panel.scrollWidth<=panel.clientWidth+1,'Overflow at '+width);assert(label.textContent===longLabel,'Long label truncated');assert(getComputedStyle(select(one)).fontSize==='20px','Select typography changed');assert(label.scrollWidth<=label.clientWidth+1,'Current label did not wrap');}});
await check('fresh and refreshed sessions retain only the surviving method',async()=>{await refresh(one);await until(()=>select(one).value===modern&&!select(one).disabled);assert(state.get('A').name===modern,'Retained method changed');assert(select(one).options.length===1,'Refresh restored a retired choice');});
await check('stale second window cannot override method state',async()=>{await pick(two,modern);await until(()=>two.container.querySelector('[role=alert]'));assert(state.get('A').name===modern,'Stale window changed method');await refresh(two);await until(()=>select(two).value===modern);});
await check('read/history lock disables method choice and requests new dialogue',async()=>{state.get('A').locked=true;await refresh(one);await until(()=>select(one).disabled);assert(one.container.querySelector('.cs-method [role=note]').textContent.includes('新對話'),'No activation guidance');});
await check('new Session retains character-authoring and discards late previous response',async()=>{state.get('A').locked=false;await refresh(one);await until(()=>!select(one).disabled);delay=true;await pick(one,modern);await until(()=>finish);one.switch('B');await until(()=>select(one)?.value===modern&&!select(one).disabled);finish();await tick();assert(select(one).value===modern,'Late response changed replacement Session');assert(state.get('B').epoch===0,'Late response changed new Session epoch');assert(state.get('B').name===modern,'Host B state changed');assert(!one.container.querySelector('[role=alert]'),'Previous Session error polluted current view');});
// Leave a visible long-label example for the screenshot.
await pick(one,modern);await until(()=>select(one).value===modern&&!select(one).disabled);one.container.querySelector('.cs-method').scrollIntoView({block:'center'});
document.getElementById('result').textContent=JSON.stringify({checks,errors,reactVersion:React.version,realReactDOM:true,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},DSHLiveUIObserved:false});
