import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectionEpoch,OperationOwnership,PrivateDiagnosticsSession,generationAvailability,interactiveEnableRequest,shouldSubmit,requestForInput,progressText,committedMessages,valueText} from '../isolated/web/view-model.mjs';

test('switching run rejects old turn and old selection responses, including returning to same run',()=>{
  const view=new SelectionEpoch(),a=view.select('a'),b=view.select('b'),a2=view.select('a');
  assert.equal(view.current(a),false);assert.equal(view.current(b),false);assert.equal(view.current(a2),true);
});
test('Chinese composition and IME 229 never submit; Enter makes newline and modifier Enter submits',()=>{
  const key={key:'Enter',ctrlKey:true};
  assert.equal(shouldSubmit(key,true),false);assert.equal(shouldSubmit({...key,isComposing:true},false),false);
  assert.equal(shouldSubmit({...key,keyCode:229},false),false);assert.equal(shouldSubmit({key:'Enter'},false),false);
  assert.equal(shouldSubmit(key,false),true);assert.equal(shouldSubmit({key:'Enter',metaKey:true},false),true);
});
test('retry keeps request identity; editing requires new identity',()=>{
  const draft={input:'她走進艙室。',requestId:'stable'};
  assert.equal(requestForInput(draft,draft.input,()=>assert.fail()),'stable');
  assert.equal(requestForInput(draft,'她坐下。',()=> 'new'),'new');
});
test('progress is solely the actual last Host event, not an elapsed-time approximation',()=>{
  assert.equal(progressText({pending:true,events:[]}), '本輪處理中；等待階段紀錄。');
  assert.equal(progressText({events:[{stage:'director',status:'completed'},{stage:'post_stat',status:'pending',sequence:8}]}),'結算世界與記憶 · 進行中 · #8');
  assert.equal(progressText({pending:false,events:[]}), '');
});
test('chat projection contains only snapshot opening and committed run turns, never provisional attempt output',()=>{
  const run={snapshot:{opening:{text:'船艙安靜。'}},turns:[{turn:1,input:'嗨',body:'她點頭。',commitId:'c1'}],attempts:[{stages:[{result:{text:'未提交洩漏'}}]}]};
  const messages=committedMessages(run);assert.equal(messages.length,3);assert.equal(messages[2].body,'她點頭。');
  assert.ok(!JSON.stringify(messages).includes('未提交洩漏'));
});
test('world display handles nested arbitrary record fields and deep values without HTML execution',()=>{
  assert.equal(valueText({status:'pending',knowers:['kalt']}),'status：pending；knowers：kalt');
  assert.equal(valueText('<img onerror=bad>'),'<img onerror=bad>');
  assert.match(valueText({a:{b:{c:{d:{e:1}}}}}),/Inspector/);
});
test('same-input retry has a new operation owner; delayed cancel retains only its original target',()=>{
  const owners=new OperationOwnership();
  const first=owners.start('run-a','stable-request',()=> 'operation-1');
  const lateCancel=owners.target('run-a'),oldCallback=owners.capture();
  owners.reset();const retry=owners.start('run-a','stable-request',()=> 'operation-2');
  assert.equal(first.requestId,retry.requestId);assert.notEqual(first.operationId,retry.operationId);
  assert.deepEqual(lateCancel,{runId:'run-a',operationId:'operation-1'});
  assert.equal(owners.current(oldCallback),false);
  assert.deepEqual(owners.target('run-a'),{runId:'run-a',operationId:'operation-2'});
});
test('stale same-run progress cannot replace the newer submission owner',()=>{
  const owners=new OperationOwnership(),oldRead=owners.capture();
  owners.start('run-a','request-2',()=> 'new-operation');
  assert.equal(owners.observe({runId:'run-a',operationId:'old-operation',pending:true},oldRead),false);
  assert.equal(owners.target('run-a').operationId,'new-operation');
});
test('after reload cancellation uses actual active Host operation; run-only and wrong-run targets are absent',()=>{
  const owners=new OperationOwnership();assert.equal(owners.target('run-a'),null);
  owners.observe({runId:'run-a',requestId:'request',operationId:'host-operation',pending:true},owners.capture());
  assert.deepEqual(owners.target('run-a'),{runId:'run-a',operationId:'host-operation'});
  assert.equal(owners.target('run-b'),null);
  owners.observe({runId:'run-a',pending:false},owners.capture());assert.equal(owners.target('run-a'),null);
  owners.observe({runId:'run-a',pending:true},owners.capture());assert.equal(owners.target('run-a'),null);
});
test('native remaining generation allowance below four blocks new rounds; scripted remains usable',()=>{
  const limited=generationAvailability('native',{generationGate:{remaining:2}});
  assert.equal(limited.blocked,true);assert.match(limited.message,/剩餘 2 次生成.*不足完整新輪.*新授權/);
  assert.equal(generationAvailability('native',{remaining:0}).blocked,true);
  assert.equal(generationAvailability('native',{remaining:3}).blocked,true);
  assert.equal(generationAvailability('native',{remaining:4}).blocked,false);
  assert.equal(generationAvailability('scripted',{remaining:0}).blocked,false);
  assert.equal(generationAvailability('native',{}).blocked,false);
});
test('interactive launch stays locked until server confirms activation; acceptance cannot be unlocked',()=>{
  assert.equal(generationAvailability('interactive',{}).blocked,true);
  assert.equal(generationAvailability('interactive',{interactive:{enabled:false}}).requiresActivation,true);
  assert.equal(generationAvailability('interactive',{interactive:{enabled:'true'}}).blocked,true);
  assert.equal(generationAvailability('interactive',{interactive:{enabled:true},generationGate:null}).blocked,false);
  assert.equal(generationAvailability('native',{generationGate:{remaining:2},interactive:{enabled:true}}).blocked,true);
  assert.equal(generationAvailability('native',{generationGate:{remaining:2}}).requiresActivation,false);
});
test('interactive activation needs explicit checkbox, exact mode and launch token; no stored consent is inferred',()=>{
  const launch={enabled:false,activationToken:'synthetic-launch-1',acknowledgement:'enable-existing-dsh-provider-for-this-launch'};
  assert.equal(interactiveEnableRequest('interactive',launch,false),null);
  assert.equal(interactiveEnableRequest('interactive',launch,undefined),null);
  assert.equal(interactiveEnableRequest('native',launch,true),null);
  assert.equal(interactiveEnableRequest('scripted',launch,true),null);
  assert.equal(interactiveEnableRequest('interactive',{...launch,activationToken:''},true),null);
  assert.equal(interactiveEnableRequest('interactive',{...launch,acknowledgement:'wrong'},true),null);
  assert.equal(interactiveEnableRequest('interactive',{...launch,enabled:true},true),null);
  assert.deepEqual(interactiveEnableRequest('interactive',launch,true),{mode:'interactive',activationToken:'synthetic-launch-1',acknowledgement:launch.acknowledgement});
  assert.equal(generationAvailability('interactive',{interactive:{...launch,activationToken:'synthetic-launch-2'}}).blocked,true,'a restarted launch has no inherited activation');
});
test('private diagnostics requires matching run and unexpired grant; ordinary view does not receive data',()=>{
  let now=1000;const lease=new PrivateDiagnosticsSession('synthetic-tab',()=>now);
  assert.equal(lease.request(),null);
  const token=lease.begin('run-a');
  assert.equal(lease.adopt(token,{runId:'run-b',grantToken:'other-run',expiresAt:2000}),false);
  assert.equal(lease.adopt(token,{runId:'run-a',grantToken:'expired',expiresAt:999}),false);
  assert.equal(lease.adopt(token,{runId:'run-a',grantToken:'synthetic-grant',expiresAt:2000}),true);
  assert.deepEqual(lease.request(),{runId:'run-a',viewerId:'synthetic-tab',grantToken:'synthetic-grant'});
  now=2000;assert.equal(lease.request(),null);
  assert.equal(lease.grant?.privatePrompt,undefined,'grant ownership stores no diagnostic payload');
});
test('revocation or switching run invalidates late grant/read ownership without inheriting authorization',()=>{
  const lease=new PrivateDiagnosticsSession('synthetic-tab',()=>1000),first=lease.begin('run-a');
  lease.adopt(first,{runId:'run-a',grantToken:'old-grant',expiresAt:2000});
  assert.deepEqual(lease.clear(),{runId:'run-a',viewerId:'synthetic-tab',grantToken:'old-grant'});
  assert.equal(lease.current(first),false);assert.equal(lease.request(),null);
  const next=lease.begin('run-b');
  assert.equal(lease.adopt(first,{runId:'run-a',grantToken:'late-grant',expiresAt:2000}),false);
  assert.equal(lease.current(next),true);assert.equal(lease.request(),null);
  assert.equal(new PrivateDiagnosticsSession('new-tab',()=>1000).request(),null,'new page has no persisted grant');
});
