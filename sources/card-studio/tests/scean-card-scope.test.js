import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {resolveSceanCardContext,createSceanControl} from '../cardstudio-bundle/lib/scean-integration.js';
test('Host resolves per-Session selected working-copy UUID without names, and validates live ownership',async t=>{
  const base=new URL('../.scope-test-data/',import.meta.url);await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(new URL('studio-',base));
  const agents=new Map(['A','B','empty'].map(id=>[id,{id,session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel(){}}]));
  const loader=new WorkspaceLoader({root,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose:async()=>{}})});await loader.init();await loader.setArchiveState([]);t.after(()=>loader.close());
  const claims=new Map();for(const [id,agent] of agents)claims.set(id,await loader.acquire(agent,'card-scope-page-'+id));
  const call=async(id,action,args={})=>{const r=await loader.call(agents.get(id),loader.records.get(id),claims.get(id),action,args);assert(r.ok,JSON.stringify(r));return r.value;};
  assert.equal(await resolveSceanCardContext(loader,'empty'),null);assert.equal(await resolveSceanCardContext(loader,'unknown'),null);
  const a=await call('A','create',{name:'Same name',description:'Synthetic A'}),b=await call('B','create',{name:'Same name',description:'Synthetic B'});assert.notEqual(a.id,b.id);
  assert.equal((await resolveSceanCardContext(loader,'A')).cardId,a.id);assert.equal((await resolveSceanCardContext(loader,'B')).cardId,b.id);
  const switched=await loader.call(agents.get('B'),loader.records.get('B'),claims.get('B'),'open',{document_id:a.id});assert.equal(switched.error.code,'SESSION_CARD_BOUND');
  await call('empty','open',{document_id:a.id});assert.equal((await resolveSceanCardContext(loader,'empty')).cardId,a.id);
  const scope=await resolveSceanCardContext(loader,'B');assert.equal(scope.cardId,b.id);assert.equal(scope.authoringSessionId,'B');
  const observed=[];const service={startFromStudio(){},inspectFromStudio:async r=>{observed.push(r);return {};},attachInspection:async r=>{observed.push(r);return {};}};
  const control=createSceanControl(loader,()=>service);
  await control(agents.get('B'),{claim:claims.get('B'),mode:'inspect',runId:'synthetic',binding:'synthetic'});assert.equal(observed[0].cardScope.cardId,b.id);
  await control(agents.get('B'),{claim:claims.get('B'),mode:'attach',runId:'synthetic',binding:'synthetic'});assert.equal(observed[1].cardScope.cardId,b.id);
  // Reacquiring/reopening does not change document identity; lease generations
  // remain part of the request context and stale pages retain no authority.
  await fs.mkdir(join(root,'other'));agents.get('B').session.header.cwd=join(root,'other');await assert.rejects(resolveSceanCardContext(loader,'B'),{code:'WORKSPACE'});
});
