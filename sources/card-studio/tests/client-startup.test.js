import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import * as slotCore from '@deepseek-ai/dsh-client-ui-slots';

// Actual shipped ModuleSystem, Cordis Loader, LocaleRuntime and SlotRegistry.
// Native Gateway/namespace Service and Typert enforce real Cordis child-scope access.
// React/DOM, transport and public Session rows are synthetic; no browser,
// provider, private sessions, app startup or app profile mutation occurs here.
const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment',
  createContext:value=>({Provider:'provider',value}),memo:fn=>fn,forwardRef:fn=>fn,Component:class{},
  useState:initial=>[initial,()=>{}],useRef:current=>({current}),useCallback:fn=>fn,useEffect:()=>{}};
const document={querySelector:()=>({}),querySelectorAll:()=>[],documentElement:{lang:'en'}};
const sourceHashes={
  'dsh-api-gateway':'e09e26fcd4849cd55683b9cc702dca896efce93a5af3968431c1c8a62147b9cf',
  'dsh-typert-registry':'26fe17aab7e1cb9e28e55d984e30a7eb3d7e0482f7f38cf36e3d3ee65b3bed21',
  'dsh-client-modules':'6fa57df9f12225ea0644ed22bc149eadf7c21e5b0b43a8683c4081567b96374f',
  'dsh-client-locale':'8a0470449ce8ceb5efdd031eaefc1c37f20f84060c6a49338fe8cd654f847933',
  'dsh-client-ui-renderer':'ff99042d53a034cadad511ace442acfb3fa92f0ce86581de8611244e7664fb78',
};
async function shipped(name,requires={}){
  let registration;
  const file=new URL(`../evidence/app-asar/dsh/node_modules/@deepseek-ai/${name}/lib/client.js`,import.meta.url);
  const source=await fs.readFile(file,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),sourceHashes[name],'Installed 0.2.0-rc.2 fixture changed; review contract');
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:r=>{registration=r;}}},document,navigator:{languages:['en']},queueMicrotask,console,AbortController,AbortSignal,crypto:globalThis.crypto});
  return registration.factory(spec=>{assert(spec in requires,`Unexpected dependency: ${name}: ${spec}`);return requires[spec];});
}
const renderer=await shipped('dsh-client-ui-renderer',{react,'react-dom':{},'react-dom/client':{},'react/jsx-runtime':{},
  '@deepseek-ai/cordis':await import('@deepseek-ai/cordis'),'@deepseek-ai/dsh-client-ui-slots':slotCore});
const locale=await shipped('dsh-client-locale',{react,'react/jsx-runtime':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@deepseek-ai/dsh-client-store':{}});
const nativeModules=await shipped('dsh-client-modules');
const cordis=await import('@deepseek-ai/cordis');
const gateway=await shipped('dsh-api-gateway',{'@deepseek-ai/cordis':cordis});
const typert=await shipped('dsh-typert-registry',{'@deepseek-ai/cordis':cordis});
const commandSource=await fs.readFile(new URL('../evidence/app-asar/dsh/node_modules/@deepseek-ai/dsh-commands/lib/typert.remote-client.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(commandSource).digest('hex'),'19783415466cb498a5dd560c6568716cad39223e2587fc0a16350b591fe051ab');
const commandRemote=vm.runInNewContext(commandSource.replace("import { z } from 'zod'",'').replace('export const TYPERT_REMOTE','const TYPERT_REMOTE').replace('export default TYPERT_REMOTE','TYPERT_REMOTE'),{z});
const success=value=>({ok:true,value});
const skill={name:'synthetic-guide',description:'Synthetic guide'};
const defaultResponse=request=>success(request.action==='acquire'?{lease_id:'synthetic-lease'}:request.action==='capabilities'?{skills:[skill],tools:[]}:request.action==='documents'?{items:[],total:0,offset:0,limit:50,selectedId:null}:[]);
async function mountCommands(ctx){
  return ctx.plugin({name:'synthetic-command-descriptors',inject:['remote','typert'],async apply(scope){await scope.remote.$mount(commandRemote);}});
}
async function remoteRuntime(ctx,respond){
  const calls=[];
  await ctx.plugin({name:'synthetic-offline-carrier',apply(scope){scope.provide('connection',{
    registerGenerationSource:()=>()=>{},start:()=>({stop(){}}),
    rpc:{open(){throw new Error('Tests cannot open network streams');},async call(base,endpoint,payload){
      assert.equal(base,'/api');
       if(endpoint==='cardstudio/request'){const {agentId,request}=payload.args;assert.equal(agentId,'synthetic-card-session');if(request.action==='workspace')return {ok:true,value:success({workspace:'C:/Synthetic User/Card Studio'})};calls.push(request.action);return {ok:true,value:await respond(request)};}
       assert.equal(endpoint,'commands/execute');
      const {agentId,line,submittedAttachments}=payload.args;
      assert.equal(agentId,'synthetic-card-session');assert.deepEqual([...submittedAttachments],[]);
      assert(line.startsWith('/cardstudio '));const request=JSON.parse(line.slice('/cardstudio '.length));calls.push(request.action);
      return {ok:true,value:{commandId:'synthetic-command',result:{kind:'success',text:JSON.stringify(await respond(request))}}};
    }}
  });}});
  await ctx.plugin(typert);await ctx.plugin(gateway);
  return calls;
}
const clientSource=await fs.readFile(new URL('../cardstudio-bundle/client.js',import.meta.url),'utf8');
const pkg=JSON.parse(await fs.readFile(new URL('../cardstudio-bundle/package.json',import.meta.url),'utf8'));
const cardRow={id:'synthetic-card-session',cwd:'C:/Synthetic User/Card Studio',retainedBy:{mainView:1}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const textOf=node=>typeof node==='string'?node:Array.isArray(node)?node.map(textOf).join(' '):textOf(node?.props?.children??'');
const elements=node=>Array.isArray(node)?node.flatMap(elements):node&&typeof node==='object'?[node,...elements(node.props?.children)]:[];
const panelOf=client=>{const view=client.slots.entries('main').find(entry=>entry.options.key==='local-cardstudio').component();return view.type(view.props);};
const dockOf=client=>client.slots.entries('conversation.input.dock').find(entry=>entry.options.id==='local-cardstudio-entry').component();
const buttonOf=(node,label)=>elements(node).find(item=>item.type==='button'&&textOf(item)===label);
async function start({initialRow=cardRow,provideSessions=true,provideCommands=true,respond=defaultResponse,source=clientSource}={}){
  const ctx=new Context(),timers=new Set(),selected=[];let row=initialRow,subscription,loader;
  const calls=await remoteRuntime(ctx,respond);if(provideCommands)await mountCommands(ctx);
  await ctx.plugin({name:'synthetic-native-services',apply(scope){
    const slots=new renderer.SlotRegistry(scope);
    slots.register({name:'root',children:{main:{kind:'keyed',scope:'root'},'conversation.input.dock':{kind:'list',scope:'session'}}},()=>null);
    scope.provide('locale',new locale.LocaleRuntime(scope,undefined,{languages:['en']}));
    scope.provide('layout',{selectPanel:value=>selected.push(value)});
    if(provideSessions)scope.provide('sessions',{list:{getSnapshot:()=>({byId:row?{[row.id]:row}:{}}),subscribe:fn=>{subscription=fn;return()=>{subscription=undefined;};}}});

  }});
  let registration;
  const clientWindow={__ModuleLoader__:{load:r=>{registration=r;}}};
  vm.runInNewContext(source,{window:clientWindow,crypto:{randomUUID:()=> 'synthetic-page-001'},
    setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)});
  assert.equal(registration.id,pkg.name);
  assert.deepEqual(JSON.parse(JSON.stringify(nativeModules.parseDshClient(pkg.name,pkg.dsh.client))),pkg.dsh.client);
  const wire={rev:'synthetic',entries:[{id:pkg.name,url:'plugins/synthetic?rev=1',rev:'1',...pkg.dsh.client}],
    batches:[{phase:'application',url:'plugins/synthetic?rev=1',rev:'1',entries:[pkg.name]}]};
  const manifest=nativeModules.parseBootManifest(wire);
  const modules=new nativeModules.ClientModuleSystem({manifest,staticModules:{react},registrationTarget:{mode:'queue',pendingQueue:[registration]},
    bootstrapModule:{id:'@deepseek-ai/dsh-client-modules',exports:nativeModules},loadBundle:async()=>{throw new Error('Test cannot fetch bundles');}});
  await ctx.plugin({name:'synthetic-native-loader',apply(scope){loader=new Loader(scope);loader.internal=modules;}});
  await loader.create({name:pkg.name});await flush();
  return {ctx,loader,modules,manifest,calls,timers,selected,slots:ctx.slots,diagnostics:clientWindow.__DSH_CARDSTUDIO_DIAGNOSTICS__,
    change:value=>{row=value;subscription?.();},closeClient:()=>[...loader.entries()][0].fiber.dispose(),close:()=>ctx.fiber.dispose()};
}
test('actual installed ModuleSystem and Cordis Loader apply generated Client with native LocaleRuntime and SlotRegistry',async()=>{
  const client=await start();
  try{
    const entry=[...client.loader.entries()][0];assert.equal(entry.fiber.state,2);
    assert.equal(client.modules.importError(pkg.name),undefined);
    assert.deepEqual(client.calls,['acquire','capabilities'],JSON.stringify(client.diagnostics));
    assert(client.slots.entries('main').some(entry=>entry.options.key==='local-cardstudio'));
    assert(client.slots.entries('conversation.input.dock').some(entry=>entry.options.id==='local-cardstudio-entry'));
  }finally{await client.close();}
});
test('actual startup stays sessionless until a retained matching public Session row arrives',async()=>{
  const client=await start({initialRow:null});
  try{
    assert.deepEqual(client.calls,[]);assert.equal(client.slots.entries('conversation.input.dock').length,0);
    client.change(cardRow);await flush();
    assert.deepEqual(client.calls,['acquire','capabilities']);assert.equal(client.slots.entries('conversation.input.dock').length,1);
  }finally{await client.close();}
});
test('real service injection waits when sessions is unavailable; Host readiness cannot imply Client apply',async()=>{
  const client=await start({provideSessions:false});
  try{
    assert.equal([...client.loader.entries()][0].fiber.state,2,'Diagnostic observer is active while the functional child waits');
    assert.equal(client.diagnostics.stages.services.sessions,false);
    assert.equal(client.diagnostics.stages['services-ready'],undefined);
    assert.deepEqual(client.calls,[]);assert.equal(client.slots.entries('conversation.input.dock').length,0);
  }finally{await client.close();}
});
test('actual Loader fiber disposal removes native slot contributions and the workspace timer',async()=>{
  const client=await start();
  try{
    await client.closeClient();
    assert.deepEqual(client.calls,['acquire','capabilities','release']);assert.equal(client.timers.size,0);
    assert.equal(client.slots.entries('conversation.input.dock').length,0);
    assert.equal(client.slots.entries('main').length,0);
  }finally{await client.close();}
});

test('full native runtime shutdown cleans the client even when the Remote provider is withdrawn first',async()=>{
  const client=await start();await client.close();assert.equal(client.timers.size,0);
  assert.equal(client.diagnostics.stages.disposed!==undefined,true);
});

test('diagnostics cover factory, native injection, public session selection, slots and bridge without private row fields',async()=>{
  const client=await start({initialRow:{...cardRow,blank:true,title:'SYNTHETIC_PRIVATE_TITLE',conversation:'SYNTHETIC_PRIVATE_BODY'}});
  try{
    for(const stage of ['script','factory-enter','factory-ready','apply-enter','services-ready','entry-requested','main-registered','dock-registered','bridge-acquire-reply','bridge-capabilities-decoded'])assert(client.diagnostics.stages[stage],stage);
    assert.equal(client.diagnostics.stages.session.mainSelected,true);
    assert.equal(client.diagnostics.stages.session.rootMatches,true);
    assert.equal(client.diagnostics.stages.session.blank,true);
    const serialized=JSON.stringify(client.diagnostics);
    for(const forbidden of ['SYNTHETIC_PRIVATE_TITLE','SYNTHETIC_PRIVATE_BODY',cardRow.id,cardRow.cwd])assert(!serialized.includes(forbidden),forbidden);
  }finally{await client.close();}
});

test('actual Cordis service arrival starts the waiting functional child and updates diagnostic availability',async()=>{
  const client=await start({provideSessions:false});
  try{
    assert.equal(client.diagnostics.stages.services.sessions,false);assert.equal(client.calls.length,0);
    await client.ctx.plugin({name:'synthetic-late-sessions',apply(scope){
      scope.provide('sessions',{list:{getSnapshot:()=>({byId:{[cardRow.id]:cardRow}}),subscribe:()=>()=>{}}});
    }});
    await flush();
    assert.equal(client.diagnostics.stages.services.sessions,true);
    assert(client.diagnostics.stages['services-ready']);
    assert.deepEqual(client.calls,['acquire','capabilities']);
    assert.equal(client.slots.entries('conversation.input.dock').length,1);
  }finally{await client.close();}
});

test('native Remote namespace presence is not child-scope permission; declared injection permits delayed callbacks and descendants',async()=>{
  const ctx=new Context();const calls=await remoteRuntime(ctx,defaultResponse);await mountCommands(ctx);
  try{
    let denied,allowed,descendant;
    await ctx.plugin({name:'undeclared-consumer',inject:['remote'],apply(scope){
      assert(scope.get('remote.commands'),'Read-only availability lookup sees the service');
      denied=()=>scope.remote.commands.execute(cardRow.id,'/cardstudio {"action":"imports"}',[]);
    }});
    assert.throws(denied,/cannot get property "remote.commands" without inject/);assert.deepEqual(calls,[]);
    await ctx.plugin({name:'declared-consumer',inject:['remote','remote.commands'],async apply(scope){
      allowed=()=>scope.remote.commands.execute(cardRow.id,'/cardstudio {"action":"imports"}',[]);
      await scope.plugin({name:'descendant-consumer',apply(child){
        descendant=()=>child.remote.commands.execute(cardRow.id,'/cardstudio {"action":"documents"}',[]);
      }});
    }});
    assert.equal((await allowed()).ok,true);assert.equal((await descendant()).ok,true);
    assert.deepEqual(calls,['imports','documents']);
  }finally{await ctx.fiber.dispose();}
});

test('removing only the declared Card Studio RPC injection reproduces the native namespace permission error with the actual Remote namespace',async()=>{
  const source=clientSource.replace("'sessions','remote','remote.cardstudio-scean','locale'","'sessions','remote','locale'");
  const client=await start({source});
  try{
    assert(client.ctx.get('remote.commands'));assert.equal(client.diagnostics.stages['services-ready']!==undefined,true);
    assert.equal(client.diagnostics.stages['bridge-workspace-error'].kind,'Error');assert.deepEqual(client.calls,[]);
    assert.equal(client.slots.entries('conversation.input.dock').length,0,'No workspace can be selected without the declared root-discovery RPC');
  }finally{await client.close();}
});

test('blank workspace entry opens a ready panel and refresh uses the actual native bridge for imports and documents',async()=>{
  const client=await start({initialRow:null});
  try{
    client.change({...cardRow,blank:true});await flush();
    const dock=dockOf(client);assert.equal(textOf(dock),'Card Studio Character Library');dock.props.children[0].props.onClick();
    assert.deepEqual(client.selected,['local-cardstudio']);
    let panel=panelOf(client);assert.match(textOf(panel),/synthetic-guide/);assert(!elements(panel).some(node=>node.props?.role==='alert'));
    const refresh=buttonOf(panel,'Refresh');assert.equal(refresh.props.disabled,false);await refresh.props.onClick();
    assert.deepEqual(client.calls,['acquire','capabilities','imports','documents']);
    assert.equal(client.diagnostics.stages['bridge-capabilities-decoded'].ok,true);
  }finally{await client.close();}
});

test('Card Studio RPC mounts independently of the commands namespace',async()=>{
 const client=await start({provideCommands:false});
 try{assert.deepEqual(client.calls,['acquire','capabilities']);assert(client.ctx.get('remote.cardstudio-scean'));assert.equal(client.timers.size,1);}
 finally{await client.close();}
});

test('native Client idle/back renew uses only Card Studio RPC; leaving and reload leave no old timers',async()=>{
 const client=await start({provideCommands:false});
 try{
  await [...client.timers][0]();assert.equal(client.calls.at(-1),'renew');
  buttonOf(panelOf(client),'Conversation').props.onClick();assert.equal(client.selected.at(-1),null);
  await [...client.timers][0]();assert.equal(client.calls.at(-1),'renew');assert.equal(client.timers.size,1);
  client.change({...cardRow,id:'synthetic-other',cwd:'E:/synthetic-other'});await flush();assert.equal(client.timers.size,0);assert.equal(client.calls.at(-1),'release');
  client.change(cardRow);await flush();assert.equal(client.timers.size,1);await client.closeClient();assert.equal(client.timers.size,0);assert.equal(client.ctx.get('remote.cardstudio-scean'),undefined);
 }finally{await client.close();}
 const reloaded=await start({provideCommands:false});try{assert.equal(reloaded.timers.size,1);assert.deepEqual(reloaded.calls,['acquire','capabilities']);}finally{await reloaded.close();}assert.equal(reloaded.timers.size,0);
});

test('native bridge capability failure is visible and retry reclaims, refreshes capabilities and lists imports',async()=>{
  let fail=true;
  const client=await start({respond:request=>request.action==='capabilities'&&fail?{ok:false,error:{code:'SYNTHETIC',message:'synthetic bridge failure'}}:defaultResponse(request)});
  try{
    assert.deepEqual(client.calls,['acquire','capabilities','release']);
    assert.match(textOf(dockOf(client)),/Connection failed/);
    assert.match(textOf(panelOf(client)),/synthetic bridge failure/);
    fail=false;const retry=buttonOf(panelOf(client),'Retry connection');assert.equal(retry.props.disabled,false);await retry.props.onClick();await flush();
    assert.equal(textOf(dockOf(client)),'Card Studio Character Library');
    const panel=panelOf(client);assert(!elements(panel).some(node=>node.props?.role==='alert'));assert.match(textOf(panel),/synthetic-guide/);
    await buttonOf(panel,'Refresh').props.onClick();
    assert.deepEqual(client.calls,['acquire','capabilities','release','acquire','capabilities','imports','documents']);
  }finally{await client.close();}
});

test('renewal failure remains visible after automatic reconnect and persistent reconnect failure offers Retry',async()=>{
 let offline=false,failRenew=true;
 const client=await start({provideCommands:false,respond:r=>r.action==='renew'&&failRenew?{ok:false,error:{message:'Synthetic lease connection lost'}}:r.action==='acquire'&&offline?{ok:false,error:{code:'OFFLINE',message:'Synthetic offline'}}:defaultResponse(r)});
 try{
  await [...client.timers][0]();assert.match(textOf(panelOf(client)),/Synthetic lease connection lost/);assert.equal(client.timers.size,1);
  offline=true;await [...client.timers][0]();assert.equal(client.timers.size,0);assert.match(textOf(dockOf(client)),/Connection failed/);assert.match(textOf(panelOf(client)),/Synthetic offline/);
  offline=false;failRenew=false;await buttonOf(panelOf(client),'Retry connection').props.onClick();await flush();assert.equal(client.timers.size,1);assert.equal(textOf(dockOf(client)),'Card Studio Character Library');
 }finally{await client.close();}
});
