import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';
import {toolSpecs} from '../cardstudio-bundle/lib/tool-definitions.js';
import {errorResult} from '../cardstudio-bundle/lib/card-service.js';
import {createSceanControl} from '../cardstudio-bundle/lib/scean-integration.js';
import * as actualPlugin from '../cardstudio-bundle/index.js';
import {nativeHost} from './helpers/current-host.js';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const [{Context},{default:Tools,defineTool},{default:SystemPrompt},{createScope}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-scope'].map(n=>import(pathToFileURL(require.resolve(n)).href)));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
// Native registry/Host integration tests. Synthetic stores only, no model provider.
const outcomes=[];
const template=await fs.readFile(new URL('../cardstudio-bundle/client-template.js',import.meta.url),'utf8');
const resumeSource=template.split('\n').filter(l=>l.includes('const resumeStudio=')||l.includes("window.addEventListener('focus',resumeStudio)")).join('\n');
function foregroundEvents(client){const window=new EventTarget(),document=new EventTarget(),pending=[];document.visibilityState='visible';const observer={get sequence(){return client.sequence;},resume(){const p=client.resume();pending.push(p);return p;}};vm.runInNewContext(resumeSource,{window,document,controller:observer});return{setHidden(value){document.visibilityState=value?'hidden':'visible';},async fire({settle=false}={}){for(const name of ['focus','pageshow','online'])window.dispatchEvent(new Event(name));document.dispatchEvent(new Event('visibilitychange'));if(settle)await Promise.all(pending);await flush();}};}
function check(name,fn){test(name,async t=>{await fn(t);outcomes.push(name);});}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scean-lifecycle-rootcause-')),ctx=new Context(),agents=new Map(),events=[];let now=0,idle=deferred(),loader,stageCalls=0,timerId=0;const delays=new Map();
 await fs.mkdir(path.join(root,'.cardstudio-scean'));await fs.writeFile(path.join(root,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Synthetic lifecycle research'}));
 await ctx.plugin(SystemPrompt);await ctx.plugin(Tools,{mode:'native'});
 const agent={id:'synthetic-rootcause-session',status:'idle',session:{header:{id:'synthetic-rootcause-session',cwd:root},snapshotEvents:()=>[]},whenIdle(){return this.status==='running'?idle.promise:Promise.resolve();},cancel(){events.push({at:now,type:'agent-cancel'});this.status='idle';idle.resolve();}};
 agent.ctx=createScope(ctx,agent).ctx;agents.set(agent.id,agent);
 class ObservedLoader extends WorkspaceLoader{
  async stopRecord(r,reason){events.push({at:now,type:'stopRecord',reason:reason??'shutdown',generation:r.generation});return super.stopRecord(r,reason);}
 }
 const makeLoader=async()=>{const value=new ObservedLoader({root,now:()=>now,agentLookup:id=>agents.get(id),activateAddon:async r=>{
  const fiber=r.agent.ctx.plugin({name:'synthetic-cardstudio-'+r.generation,inject:['tools'],apply(c){for(const[name,description,operation,parameters]of toolSpecs)c.tools.register(defineTool({name,description,parameters,isConcurrencySafe:()=>false,output:{schema:{type:'json'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(args,exec)=>value.call(exec.agent,r,null,operation==='document'?args.action:operation,args,exec.signal)}));}});await fiber;
  events.push({at:now,type:'addon-registered',generation:r.generation,tools:ctx.tools.schemas(agent).length});
  return{dispose:async()=>{await fiber.dispose();events.push({at:now,type:'addon-disposed',generation:r.generation,tools:ctx.tools.schemas(agent).length});}};
 }});await value.init();return value;};
 loader=await makeLoader();
 const f={root,ctx,agent,events,agents,get loader(){return loader;},advance(ms){now+=ms;},async tick(ms){now+=ms;for(const [id,t]of [...delays])if(t.at<=now){delays.delete(id);t.fn();}await flush();},now(){return now;},tools(){return ctx.tools.schemas(agent).map(t=>t.name);},async drain(){await flush();await loader.transition;},run(){idle=deferred();agent.status='running';loader.agentStatus(agent);},async finish(){agent.status='idle';idle.resolve();loader.agentStatus(agent);await flush();await loader.transition;},async restart(){await loader.close();loader=await makeLoader();},stageCalls:()=>stageCalls};
 const human=createSceanControl({get root(){return loader.root;},get records(){return loader.records;},validate:(...a)=>loader.validate(...a),get workspace(){return loader.workspace;},call:(...a)=>loader.call(...a)},()=>({async startFromStudio(){stageCalls++;return{openingRequired:true,openingOfferId:'synthetic-offer'};},async inspectFromStudio(){}}));
 f.client=async pageId=>{const state={offline:false,blockRenew:null,renewEntered:deferred(),actions:[],notifications:[]};const client=new WorkspaceClient({root,pageId,now:()=>now,setDelay:(fn,ms)=>{delays.set(++timerId,{fn,at:now+ms});return timerId;},clearDelay:id=>delays.delete(id),show(){},hide(){},notify:e=>state.notifications.push(e.message),setTimer:()=>1,clearTimer(){},send:async(_id,r)=>{state.actions.push(r.action);if(state.offline)throw Error('SYNTHETIC_OFFLINE');if(r.action==='renew'&&state.blockRenew){state.renewEntered.resolve();return state.blockRenew.promise;}try{if(r.action==='workspace')return{ok:true,value:{workspace:root}};if(r.action==='acquire')return{ok:true,value:await loader.acquire(agent,r.page_id)};if(r.action==='renew')return{ok:true,value:await loader.renew(agent,r.claim)};if(r.action==='release')return{ok:true,value:await loader.release(agent,r.claim)};if(r.action==='capabilities'){await loader.validate(agent,loader.records.get(agent.id),r.claim);return{ok:true,value:{tools:ctx.tools.schemas(agent),skills:[]}};}return loader.call(agent,loader.records.get(agent.id),r.claim,r.action,r.args);}catch(e){return errorResult(e);}},sendScean:async(_id,r)=>{const result=await human(agent,r).then(value=>({ok:true,value})).catch(errorResult);if(!result.ok)throw Error(result.error.message);return result.value;}});state.client=client;await client.transition({id:agent.id,cwd:root});assert.equal(client.phase,'ready',JSON.stringify({notifications:state.notifications,events,root,clientRoot:client.root}));return state;};
 t.after(async()=>{agent.status='idle';idle.resolve();await loader.close();await ctx.fiber.dispose();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('scean-lifecycle-rootcause-'));await fs.rm(root,{recursive:true,force:true});});
 return f;
}
check('01 normal heartbeat keeps the native 29 tools through idle and same-Session identity updates',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-normal');for(let i=0;i<8;i++){f.advance(20000);await s.client.heartbeat(s.client.sequence);await f.loader.sweep();await s.client.transition({id:f.agent.id,cwd:f.root});assert.equal(f.tools().length,29);}assert.equal(s.actions.filter(x=>x==='acquire').length,1);await s.client.close();assert.equal(f.tools().length,0);
});
check('02 no heartbeat for 90 seconds while idle causes sweep to dispose the addon and its native tools',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-background');assert.equal(f.tools().length,29);f.advance(95000);await f.loader.sweep();assert.equal(f.tools().length,0);assert.equal(f.loader.records.size,0);assert(f.events.some(r=>r.type==='stopRecord'&&r.reason==='idle'));assert.equal(s.client.phase,'ready');await s.client.close();
});
check('03 accepted Agent survives background expiry, then idle completion unloads all tools before the next user turn',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-agent');f.advance(50000);f.run();f.advance(45000);await f.loader.sweep();assert.equal(f.tools().length,29);assert.equal(f.loader.records.get(f.agent.id).pages.size,0);await f.finish();assert.equal(f.tools().length,0);f.run();assert.equal(f.tools().length,0);await f.finish();await s.client.close();
});
check('04 foreground heartbeat with an answered stale renewal reacquires the same saved working card',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-return');const doc=await s.client.call('create',{name:'Synthetic identity'}),first=s.client.claim;f.advance(95000);await f.loader.sweep();await s.client.heartbeat(s.client.sequence);assert.equal(s.client.phase,'ready');assert.equal(f.tools().length,29);assert.notEqual(s.client.claim.agent_generation,first.agent_generation);assert.equal(s.client.selectionStatus.document_id,doc.id);assert.equal((await s.client.call('read',{document_id:doc.id})).revision,0);await s.client.close();
});
check('05 reconnects from the former claim-null dead end via canonical foreground handlers without switching Session',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-offline'),sequence=s.client.sequence;f.advance(95000);await f.loader.sweep();s.offline=true;await s.client.heartbeat(s.client.sequence);assert.equal(s.client.phase,'error');assert.equal(s.client.claim,null);s.offline=false;await foregroundEvents(s.client).fire({settle:true});assert.equal(f.tools().length,29);assert.equal(s.client.sequence,sequence);await s.client.close();
});
check('06 hanging renew aborts at deadline, restores native tools, and ignores its late result',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-hung');s.blockRenew=deferred();const sequence=s.client.sequence,pending=s.client.heartbeat(s.client.sequence);await s.renewEntered.promise;f.advance(95000);await f.loader.sweep();assert.equal(f.tools().length,0);await f.tick(15000);await pending;assert.equal(s.client.phase,'ready');assert.equal(f.tools().length,29);assert.equal(s.client.sequence,sequence);const claim=s.client.claim;s.blockRenew.resolve({ok:true,value:{selection_status:{document_id:'wrong-late',revision:99}}});await f.drain();assert.equal(s.client.claim,claim);assert.equal(f.stageCalls(),0);await s.client.close();
});
check('07 simulated normal Host restart preserves card identity, rejects old generation, and an answered heartbeat reactivates',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-restart');const doc=await s.client.call('create',{name:'Synthetic restart'}),old=s.client.claim;await f.restart();assert.equal(f.tools().length,0);await s.client.heartbeat(s.client.sequence);assert.equal(f.tools().length,29);assert.notEqual(s.client.claim.workspace_generation,old.workspace_generation);assert.equal(s.client.selectionStatus.document_id,doc.id);assert.equal((await s.client.call('read',{document_id:doc.id})).revision,0);await s.client.close();
});
check('08 two Clients in one Session: releasing one cannot remove the other lease or addon',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-client-A'),b=await f.client('synthetic-page-client-B');assert.equal(f.loader.records.get(f.agent.id).pages.size,2);await a.client.close();assert.equal(f.tools().length,29);assert.equal(f.loader.records.get(f.agent.id).pages.size,1);await b.client.close();assert.equal(f.tools().length,0);
});
check('09 two Clients: one stale lease expires while a renewed peer keeps all tools mounted',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-expire-A'),b=await f.client('synthetic-page-expire-B');f.advance(80000);await b.client.heartbeat(b.client.sequence);f.advance(15000);await f.loader.sweep();assert.equal(f.tools().length,29);assert.equal(f.loader.records.get(f.agent.id).pages.size,1);await a.client.heartbeat(a.client.sequence);assert.equal(f.tools().length,29);assert.equal(f.loader.records.get(f.agent.id).pages.size,2);await a.client.close();await b.client.close();
});
check('10 old-generation release and repeated old addon disposal do not remove a newly registered generation',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-generation'),oldClaim=a.client.claim,old=f.loader.records.get(f.agent.id);await f.loader.release(f.agent,oldClaim);await a.client.heartbeat(a.client.sequence);assert.equal(f.tools().length,29);await assert.rejects(f.loader.release(f.agent,oldClaim),e=>e.code==='STALE_LEASE');await old.addon.dispose();await old.addon.dispose();assert.equal(f.tools().length,29);await a.client.close();
});
check('11 repeated delayed disposal of a replaced Agent identity cannot delete the current Agent record',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-old-agent'),oldAgent=f.agent;await f.loader.release(oldAgent,a.client.claim);const replacement={...oldAgent};replacement.ctx=createScope(f.ctx,replacement).ctx;f.agents.set(replacement.id,replacement);const next=await f.loader.acquire(replacement,'synthetic-page-new-agent');await f.loader.disposed(oldAgent);await f.loader.disposed(oldAgent);assert.equal(f.loader.records.get(replacement.id).agent,replacement);assert.equal(f.ctx.tools.schemas(replacement).length,29);await f.loader.release(replacement,next);await a.client.close();
});
check('12 pending accepted-task idle callback cannot retire the newer record or extend its deadline',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-task');f.run();const old=f.loader.records.get(f.agent.id),deadline=old.hostTask.deadline;f.advance(20000);await a.client.heartbeat(a.client.sequence);assert.equal(old.hostTask.deadline,deadline);await f.finish();assert.equal(f.tools().length,29);await f.loader.release(f.agent,a.client.claim);await a.client.heartbeat(a.client.sequence);await f.drain();assert.equal(f.tools().length,29);await a.client.close();
});
check('13 same Session auto-recovery preserves its view sequence; actual Session changes retire the old view',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-switch'),sequence=s.client.sequence;s.offline=true;await s.client.heartbeat(s.client.sequence);s.offline=false;assert.equal(s.client.phase,'error');await s.client.resume();assert.equal(s.client.phase,'ready');assert.equal(s.client.sequence,sequence);await s.client.transition({id:'synthetic-other',cwd:os.tmpdir()});assert.equal(s.client.phase,'inactive');await s.client.transition({id:f.agent.id,cwd:f.root});assert.equal(s.client.phase,'ready');assert.equal(f.tools().length,29);await s.client.close();
});
check('14 full canonical plugin + native DSH Host registry: same-Session reacquire and stale release preserve the original card and all tools',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'scean-lifecycle-rootcause-native-')),home=path.join(base,'synthetic-home'),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;let host;
 try{
  host=await nativeHost(home,actualPlugin);const root=host.registry.list()[0].path,a=host.agent('synthetic-full-native-session',root),request=r=>host.request(a,r);assert.equal(host.ctx.tools.schemas(a).length,0);
  const acquired=await request({action:'acquire',page_id:'synthetic-native-page-A'});assert(acquired.ok,JSON.stringify(acquired));const first=acquired.value;
  assert.equal(host.ctx.tools.schemas(a).length,29);const made=await request({action:'create',args:{name:'Synthetic private-free card'},claim:first});assert(made.ok,JSON.stringify(made));const id=made.value.id;
  const peer=(await request({action:'acquire',page_id:'synthetic-native-page-B'})).value;assert((await request({action:'release',claim:first})).ok);assert.equal(host.ctx.tools.schemas(a).length,29);assert((await request({action:'release',claim:peer})).ok);assert.equal(host.ctx.tools.schemas(a).length,0);
  const next=await request({action:'acquire',page_id:'synthetic-native-page-A'});assert(next.ok,JSON.stringify(next));assert.equal(next.value.selection_status.document_id,id);assert.equal(host.ctx.tools.schemas(a).length,29);assert.notEqual(next.value.agent_generation,first.agent_generation);
  const stale=await request({action:'release',claim:first});assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_LEASE');assert.equal(host.ctx.tools.schemas(a).length,29);assert((await request({action:'read',claim:next.value,args:{document_id:id}})).ok);
 }finally{await host?.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(base),os.tmpdir());assert(path.basename(base).startsWith('scean-lifecycle-rootcause-native-'));await fs.rm(base,{recursive:true,force:true});}
});
check('15 canonical focus/pageshow/online/visibility handlers skip hidden pages and recover an answered stale lease when visible',async t=>{
 const f=await fixture(t),s=await f.client('synthetic-page-events'),events=foregroundEvents(s.client);f.advance(95000);await f.loader.sweep();events.setHidden(true);const before=s.actions.length;await events.fire();assert.equal(s.actions.length,before);assert.equal(f.tools().length,0);events.setHidden(false);await events.fire({settle:true});await f.drain();assert.equal(s.client.phase,'ready');assert.equal(f.tools().length,29);await s.client.close();
});
check('16 concurrent release/reacquire waits for addon disposal; old tool closures are refused while closing and after replacement',async t=>{
 const f=await fixture(t),a=await f.client('synthetic-page-drain'),doc=await a.client.call('create',{name:'Synthetic draining identity'}),old=f.loader.records.get(f.agent.id),gate=deferred(),entered=deferred(),dispose=old.addon.dispose;
 old.addon.dispose=async()=>{entered.resolve();await gate.promise;await dispose();};const retiring=f.loader.release(f.agent,a.client.claim);await entered.promise;const replacing=f.loader.acquire(f.agent,'synthetic-page-after-drain');await flush();assert.equal(f.events.filter(r=>r.type==='addon-registered').length,1);assert.equal((await f.loader.call(f.agent,old,null,'read',{document_id:doc.id})).error.code,'STALE_WORKSPACE');
 gate.resolve();await retiring;const next=await replacing;assert.equal(f.tools().length,29);assert.notEqual(next.agent_generation,old.generation);assert.equal((await f.loader.call(f.agent,old,null,'read',{document_id:doc.id})).error.code,'STALE_WORKSPACE');assert((await f.loader.call(f.agent,f.loader.records.get(f.agent.id),next,'read',{document_id:doc.id})).ok);await a.client.close();
});
