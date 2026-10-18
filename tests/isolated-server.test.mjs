import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,unlink,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import http from 'node:http';
import {startServer,assertIsolatedWritePath,assertIsolatedWriteBoundary} from '../isolated/server.mjs';
import {GenerationGate} from '../isolated/generation-gate.mjs';
import {resolveSyntheticCreate} from '../fixtures/synthetic-catalog.mjs';

const temp=()=>mkdtemp(join(tmpdir(),'scean-isolated-'));
const call=(server,data,headers={})=>fetch(server.origin+'/api',{method:'POST',headers:{'Content-Type':'application/json','X-Scean-Token':server.token,...headers},body:JSON.stringify(data)});
test('isolated data and gate cannot target protected installations',()=>{
  const prior=process.env.SCEAN_PROTECTED_ROOTS_JSON;process.env.SCEAN_PROTECTED_ROOTS_JSON=JSON.stringify([resolve('synthetic-protected-app'),resolve('synthetic-protected-data')]);
  for(const path of [resolve('synthetic-protected-app/data'),resolve('synthetic-protected-data/runs'),join(homedir(),'.dsh','profiles','desktop')])assert.throws(()=>assertIsolatedWritePath(path),e=>e.code==='PROTECTED_DATA_PATH');
  if(prior===undefined)delete process.env.SCEAN_PROTECTED_ROOTS_JSON;else process.env.SCEAN_PROTECTED_ROOTS_JSON=prior;
});
test('loopback server validates origin/CSRF, exposes only safe catalog, rejects arbitrary snapshots',async()=>{
  const root=await temp(),server=await startServer({scripted:true,port:0,dataRoot:root});
  try{
    const bootstrap=await(await fetch(server.origin+'/api/bootstrap')).json();assert.equal(bootstrap.mode,'scripted');assert.equal(bootstrap.csrfToken,server.token);
    assert.equal((await call(server,{action:'list'},{'X-Scean-Token':'bad'})).status,403);
    assert.equal((await call(server,{action:'list'},{Origin:'https://evil.invalid'})).status,403);
    const evilHostStatus=await new Promise((done,reject)=>{http.get(server.origin+'/api/bootstrap',{headers:{Host:'evil.invalid'}},response=>{response.resume();done(response.statusCode);}).on('error',reject);});
    assert.equal(evilHostStatus,403);
    assert.equal((await fetch(server.origin+'/api/bootstrap',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    const catalog=await(await call(server,{action:'catalog'})).json();assert.equal(catalog.value.cards[0].revisions.length,2);
    const invalid=await(await call(server,{action:'create',snapshot:{schemaVersion:1}})).json();assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'CATALOG_SELECTION_INVALID');
    assert.equal((await fetch(server.origin+'/package.json')).status,404);
    assert.equal((await fetch(server.origin+'/../isolated-session.json')).status,404);
  }finally{await server.close();}
});
test('synthetic selection fixes revision, opening and independent complete snapshots',()=>{
  const a=resolveSyntheticCreate({cardId:'synthetic-observatory',revisionId:'r1',openingId:'cabin'});
  const b=resolveSyntheticCreate({cardId:'synthetic-observatory',revisionId:'r2',openingId:'deck'});
  assert.equal(a.snapshot.revision,'r1');assert.equal(b.snapshot.revision,'r2');assert.equal(a.snapshot.card.data.first_mes,a.snapshot.opening.text);
  b.snapshot.characters[0].name='changed';assert.equal(a.snapshot.characters[0].name,'卡爾特');
});
test('server stop/restart preserves committed turns and refuses a second owner',async()=>{
  const dataRoot=await temp();let server=await startServer({scripted:true,port:0,dataRoot,scriptedDelay:1});
  try{
    await assert.rejects(()=>startServer({scripted:true,port:0,dataRoot}),e=>e.code==='ISOLATED_DATA_LOCKED');
    const created=await(await call(server,{action:'create',cardId:'synthetic-observatory',revisionId:'r1',openingId:'cabin'})).json();assert.equal(created.ok,true);
    const runId=created.value.runId;
    const turn=await(await call(server,{action:'turn',runId,requestId:'first',input:'你好，銀色鑰匙在哪裡？'})).json();assert.equal(turn.ok,true,JSON.stringify(turn));assert.equal(turn.value.status,'committed');
    await server.close();server=await startServer({scripted:true,port:0,dataRoot});
    const list=await(await call(server,{action:'list'})).json();assert.equal(list.value.length,1);
    const inspected=await(await call(server,{action:'inspect',runId})).json();assert.equal(inspected.ok,true);assert.match(JSON.stringify(inspected),/銀色鑰匙/);
    const replay=await(await call(server,{action:'turn',runId,requestId:'first',input:'你好，銀色鑰匙在哪裡？'})).json();assert.equal(replay.ok,true);assert.equal(replay.value.commitId,turn.value.commitId);
  }finally{await server.close();}
});
test('shared generation gate counts unresolved attempts across restart, enforces 24 and records unknown cost',async()=>{
  const file=join(await temp(),'gate.jsonl');
  const gate=new GenerationGate(file);
  const first=await gate.reserve({caseId:'case',requestId:'first'});
  await gate.settle(first,{status:'completed',actualCostUsd:null,usage:{totalTokens:10}});
  for(let i=1;i<24;i++)await new GenerationGate(file).reserve({caseId:'case'+i,requestId:'r'+i});
  await assert.rejects(()=>new GenerationGate(file).reserve({caseId:'blocked',requestId:'r25'}),e=>e.code==='GENERATION_LIMIT_REACHED');
  const status=await gate.status();assert.equal(status.remaining,0);assert.equal(status.generationRequests,24);assert.equal(status.unresolved,23);assert.equal(status.unknownCostRequests,24);
});
test('concurrent gate reservation cannot exceed the cap',async()=>{
  const file=join(await temp(),'gate.jsonl'),gate=new GenerationGate(file);
  for(let i=0;i<23;i++)await gate.reserve({caseId:'case'+i,requestId:'r'+i});
  const results=await Promise.allSettled([gate.reserve({caseId:'last',requestId:'last1'}),new GenerationGate(file).reserve({caseId:'last',requestId:'last2'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await gate.status()).generationRequests,24);
});

test('interactive mode is explicit, per-launch locked, confirmation-bound and does not change acceptance evidence (fake model only)',async()=>{
  const {createScriptedModel}=await import('../fixtures/synthetic-catalog.mjs');
  const {UsageLedger}=await import('../adapters/budget.mjs');
  const {randomUUID}=await import('node:crypto');
  const root=await temp(),dataRoot=join(root,'interactive'),gatePath=join(root,'acceptance-gate.jsonl');
  const gate=new GenerationGate(gatePath);for(let n=0;n<24;n++)await gate.reserve({caseId:'acceptance-'+n,requestId:'acceptance-'+n});
  const before=await readFile(gatePath,'utf8');let generated=0,described=0;
  const ledger=new UsageLedger(join(dataRoot,'usage.jsonl')),scripted=createScriptedModel({delayMs:0});
  // This injected model records synthetic usage only; no DSH runtime or provider is contacted.
  const fake={async describe(){described++;return {requested:{provider:'fake-only',model:'scripted'},effective:{provider:'fake-only',model:'scripted'}};},async generate(args){generated++;const id=await ledger.reserve({caseId:args.context.requestId+':'+args.stage,requestId:randomUUID(),meta:{stage:args.stage}});const result=await scripted.generate(args);await ledger.settle(id,{status:'completed',actualCostUsd:null,usage:{totalTokens:1}});return result;}};
  let server=await startServer({interactive:true,port:0,dataRoot,gatePath,model:fake});
  try{
    const boot=await(await fetch(server.origin+'/api/bootstrap')).json();assert.equal(boot.mode,'interactive');assert.equal(boot.usageMode,'interactive');assert.equal(boot.interactive.enabled,false);assert.equal(boot.models.generationGate,null);assert.equal(server.session.gatePath,null);assert.equal(server.session.usageLedgerPath,join(dataRoot,'usage.jsonl'));assert(described>0);assert.equal(generated,0);
    const created=await(await call(server,{action:'create',cardId:'synthetic-observatory',revisionId:'r1',openingId:'cabin'})).json();assert.equal(created.ok,true);const runId=created.value.runId;
    const locked=await(await call(server,{action:'turn',runId,requestId:'locked',input:'安靜觀察。'})).json();assert.equal(locked.error.code,'INTERACTIVE_GENERATION_LOCKED');assert.equal(generated,0);
    await assert.rejects(async()=>server.host.engine.model.generate({stage:'director'}),e=>e.code==='INTERACTIVE_GENERATION_LOCKED');
    const enable={action:'interactiveEnable',mode:'interactive',activationToken:boot.interactive.activationToken,acknowledgement:boot.interactive.acknowledgement};
    assert.equal((await(await call(server,enable)).json()).error.code,'INTERACTIVE_ORIGIN_REQUIRED');
    assert.equal((await(await call(server,{...enable,acknowledgement:'automatic'},{Origin:server.origin})).json()).error.code,'INTERACTIVE_CONFIRMATION_REQUIRED');
    assert.equal((await(await call(server,{...enable,activationToken:'wrong'},{Origin:server.origin})).json()).error.code,'INTERACTIVE_CONFIRMATION_REQUIRED');
    assert.equal((await call(server,enable,{Origin:server.origin,'X-Scean-Token':'wrong'})).status,403);
    assert.equal(generated,0);
    const enabled=await(await call(server,enable,{Origin:server.origin})).json();assert.equal(enabled.ok,true);assert.equal(enabled.value.enabled,true);assert.equal(generated,0);
    for(let n=0;n<7;n++){const turn=await(await call(server,{action:'turn',runId,requestId:'manual-fake-'+n,operationId:'manual-op-'+n,input:'安靜觀察，不要求諮詢。'})).json();assert.equal(turn.ok,true,JSON.stringify(turn));}
    assert(generated>24);assert.equal((await ledger.summary()).generationRequests,generated);assert.equal((await ledger.summary()).unknownCostRequests,generated);assert.equal((await ledger.summary()).monetaryEnforcement,false);
    assert.equal(await readFile(gatePath,'utf8'),before);
    const sessionText=await readFile(join(dataRoot,'isolated-session.json'),'utf8');assert(!sessionText.includes(boot.interactive.activationToken));
    await server.close();server=await startServer({interactive:true,port:0,dataRoot,gatePath,model:fake});
    const restart=await(await fetch(server.origin+'/api/bootstrap')).json();assert.equal(restart.interactive.enabled,false);assert.notEqual(restart.interactive.activationToken,boot.interactive.activationToken);
    assert.equal((await(await call(server,enable,{Origin:server.origin})).json()).error.code,'INTERACTIVE_CONFIRMATION_REQUIRED');
    const after=await(await call(server,{action:'turn',runId,requestId:'after-restart',input:'不可自動生成。'})).json();assert.equal(after.error.code,'INTERACTIVE_GENERATION_LOCKED');
    assert.equal((await(await call(server,{action:'list'})).json()).value[0].turnCount,7);assert.equal(await readFile(gatePath,'utf8'),before);
  }finally{await server.close();}
});

test('interactive cannot share an acceptance data root or be enabled in ordinary mode (fake model only)',async()=>{
  const root=await temp();let server=await startServer({scripted:true,port:0,dataRoot:root});await server.close();
  await assert.rejects(()=>startServer({interactive:true,port:0,dataRoot:root,model:{generate(){throw Error('must not call');}}}),e=>e.code==='ISOLATED_USAGE_MODE_MISMATCH');
  await assert.rejects(()=>startServer({interactive:true,scripted:true,port:0,dataRoot:join(root,'invalid')}),e=>e.code==='ISOLATED_MODE_CONFLICT');
  server=await startServer({scripted:true,port:0,dataRoot:root});
  try{const denied=await(await call(server,{action:'interactiveEnable',mode:'interactive',activationToken:'not-applicable',acknowledgement:'enable-existing-dsh-provider-for-this-launch'},{Origin:server.origin})).json();assert.equal(denied.error.code,'INTERACTIVE_MODE_REQUIRED');}
  finally{await server.close();}
});

test('all modes persist identity and reject native/scripted/interactive directory reuse before changes',async()=>{
  for(const scripted of [true,false]){
    const root=await temp(),model={generate(){throw Error('No provider call allowed');},describe:async()=>({source:'fake'})};
    const server=await startServer({scripted,dataRoot:root,port:0,model});await server.close();
    const before=await readFile(join(root,'usage-mode.json'),'utf8');
    for(const next of [{scripted:!scripted},{interactive:true}])await assert.rejects(()=>startServer({...next,dataRoot:root,port:0,model}),e=>e.code==='ISOLATED_USAGE_MODE_MISMATCH');
    assert.equal(await readFile(join(root,'usage-mode.json'),'utf8'),before);
  }
});

test('legacy own native receipt allows conservative mode migration; unknown existing data does not',async()=>{
  const root=await temp(),model={generate(){throw Error('No provider calls');},describe:async()=>({source:'fake'})};
  await mkdir(join(root,'host'));await writeFile(join(root,'last-stop.json'),JSON.stringify({mode:'native'}));
  const server=await startServer({dataRoot:root,port:0,model});await server.close();assert.equal(JSON.parse(await readFile(join(root,'usage-mode.json'))).usageMode,'acceptance');
  const unknown=await temp();await mkdir(join(unknown,'host'));
  await assert.rejects(()=>startServer({dataRoot:unknown,port:0,model}),e=>e.code==='ISOLATED_USAGE_MODE_UNKNOWN');
  await assert.rejects(()=>access(join(unknown,'usage-mode.json')),{code:'ENOENT'});
});

test('existing ancestor junction is refused before data or gate writes (temporary paths only)',async()=>{
  const root=await temp(),destination=join(root,'target'),junction=join(root,'link');await mkdir(destination);
  await symlink(destination,junction,'junction');
  try{
    await assert.rejects(()=>assertIsolatedWriteBoundary(join(junction,'new','data')),e=>e.code==='ISOLATED_LINKED_PATH');
    await assert.rejects(()=>startServer({scripted:true,dataRoot:join(junction,'new','data'),port:0}),e=>e.code==='ISOLATED_LINKED_PATH');
    await assert.rejects(()=>startServer({scripted:true,dataRoot:join(root,'safe'),gatePath:join(junction,'gate.jsonl'),port:0}),e=>e.code==='ISOLATED_LINKED_PATH');
    await assert.rejects(()=>access(join(destination,'new')),{code:'ENOENT'});await assert.rejects(()=>access(join(root,'safe')),{code:'ENOENT'});
  }finally{await unlink(junction);}
});
