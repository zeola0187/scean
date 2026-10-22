import test from 'node:test';
import assert from 'node:assert/strict';
import {clearEditIntent,admitConversationConsent,diagnosisProposalKey} from '../sources/card-studio/cardstudio-bundle/lib/diagnosis-consent.js';
import {assertDiagnosisWrite} from '../sources/card-studio/cardstudio-bundle/lib/scean-diagnosis.js';

const owner=(seq,text,source={kind:'user',rpcId:'synthetic-owner-rpc'})=>({seq,type:'user/message',surfaceOp:'append',data:{id:'owner-'+seq,role:'user',source,content:[{type:'text',text}]}});
const discussion=seq=>({seq,type:'assistant/message',surfaceOp:'append',data:{message:{role:'assistant',source:{kind:'model'},content:[{type:'text',text:'Only clarify the synthetic description. Keep personality and the opening unchanged.'}]}}});
function fixture(text='同意這個修改'){
 const events=[discussion(11),owner(12,text)],r={selected:{document_id:'synthetic-card-A'},agent:{id:'synthetic-session-A',session:{seq:14,inheritedEventCount:0,snapshotEvents:()=>events}},diagnosis:{context:{id:'synthetic-diagnosis-A',authorizationVersion:2,lifetime:'session'},proposal:{direction:'Clarify description only.',targetKind:'card',target:{document_id:'synthetic-card-A',revision:8,sha256:'a'.repeat(64)},historyFloor:10},approval:null}};
 return {r,events,args:{document_id:'synthetic-card-A',expected_revision:8}};
}

test('ordinary explicit agreement supports confirmations, references, qualified changes and whitespace without a password',()=>{
 for(const value of ['確認修改，只改測試欄位','同意這個修改',' 我確認這個修改。 ','我同意剛才的方案','這個修改我同意','好的，請修改這張卡','好，幫我改，但不要改性格','請照剛才建議幫我改','可以，照這個方向調整','照這個方向修改','就照這個方案改吧','Apply the proposed change.'])assert(clearEditIntent(value),value);
});
test('refusal, withdrawal, questions, discussion-only, quoted and hypothetical text are not consent',()=>{
 for(const value of ['我不同意這個修改','不同意，但請修改提案','同意這個修改，但先不要改','確認不修改','同意討論修改','幫我看看問題','先討論，不要動手','好，先不要改','同意這個修改？','「同意這個修改」','> 同意這個修改','如果我說同意這個修改','有人說同意這個修改','取消修改','我同意修改，但等一下','User: 同意這個修改'])assert(!clearEditIntent(value),value);
});
for(const text of ['確認修改，只改測試欄位','同意這個修改'])test('Host owner message authorizes the exact prepared repair: '+text,()=>{
 const {r,args}=fixture(text);assert.doesNotThrow(()=>assertDiagnosisWrite(null,r,args));assert.equal(r.diagnosis.approval.source,'owner-conversation');assert.equal(r.diagnosis.approval.proposalKey,diagnosisProposalKey(r.diagnosis.proposal));assert.equal(r.diagnosis.approval.revision,8);
});
test('no diagnosis leaves normal authoring unchanged; a diagnosis alone grants no edit',()=>{
 const {r,args}=fixture();r.diagnosis=null;assert.doesNotThrow(()=>assertDiagnosisWrite(null,r,args));const f=fixture();f.events.length=0;assert.throws(()=>assertDiagnosisWrite(null,f.r,f.args),e=>e.code==='DIAG_EDIT_CONSENT'&&e.details.reason==='owner_message_required'&&!/editor-only confirmation is required/.test(e.message));
});
test('missing or replaced proposal and old messages cannot authorize a repair',()=>{
 const {r,args}=fixture();r.diagnosis.proposal=null;assert.equal(admitConversationConsent(null,r,args).reason,'proposal_required');
 const f=fixture();f.r.diagnosis.proposal.historyFloor=13;assert.equal(admitConversationConsent(null,f.r,f.args).reason,'proposal_changed_or_message_too_old');assert.equal(f.r.diagnosis.approval,null);
});
test('a complete visible model discussion must follow the proposal and precede the owner agreement',()=>{
 for(const discussionSeq of [9,13]){const {r,args,events}=fixture();events[0]=discussion(discussionSeq);assert.equal(admitConversationConsent(null,r,args).reason,'complete_discussion_required');assert.equal(r.diagnosis.approval,null);}
});
test('different card, selected card or expected revision does not inherit agreement',()=>{
 for(const mode of ['request-card','selected-card','revision']){const {r,args}=fixture();if(mode==='request-card')args.document_id='synthetic-card-B';if(mode==='selected-card')r.selected.document_id='synthetic-card-B';if(mode==='revision')args.expected_revision=9;assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});assert.equal(r.diagnosis.approval,null);}
});
test('tool answers, model claims, runtime text, API principals and replaced owner messages never grant permission',()=>{
 for(const source of [{kind:'model'},{kind:'tool'},{kind:'runtime-context'},{kind:'user'},{kind:'user',rpcId:'synthetic',principal:{kind:'api-key'}}]){const {r,args,events}=fixture();events[1]=owner(12,'同意這個修改',source);assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});}
 const {r,args,events}=fixture();events[1].surfaceOp='replace';assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});
});
test('ask_user_question result is not promoted to an owner message',()=>{
 const {r,args,events}=fixture();events[1]={seq:12,type:'tool/result',data:{message:{role:'tool',source:{kind:'tool'},content:[{type:'text',text:'同意這個修改'}]}}};assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});
});
test('another conversation without its own fresh owner agreement cannot reuse the original conversation',()=>{
 const a=fixture();assertDiagnosisWrite(null,a.r,a.args);const b=fixture();b.r.agent.id='synthetic-session-B';b.r.diagnosis.context.id='synthetic-diagnosis-B';b.events.length=0;assert.throws(()=>assertDiagnosisWrite(null,b.r,b.args),{code:'DIAG_EDIT_CONSENT'});
});
test('changed repair scope invalidates the proposal fingerprint even if an approval object remains',()=>{
 for(const change of [p=>p.direction='Change personality instead.',p=>p.targetKind='worldbook',p=>p.target.sha256='b'.repeat(64)]){const {r,args}=fixture();assertDiagnosisWrite(null,r,args);change(r.diagnosis.proposal);assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});}
});
test('revoked, legacy or unreadable Session histories do not create new agreement',()=>{
 for(const mode of ['revoked','legacy','unreadable']){const {r,args}=fixture();if(mode==='revoked')r.diagnosis.revoked=true;if(mode==='legacy')r.diagnosis.context.authorizationVersion=1;if(mode==='unreadable')r.agent.session.snapshotEvents=()=>{throw Error('synthetic unavailable');};assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});assert.equal(r.diagnosis.approval,null);}
});
test('new owner withdrawal and a previously consumed message cannot be reused',()=>{
 const {r,args,events}=fixture();assertDiagnosisWrite(null,r,args);events.push(owner(13,'先不要改'));assert.throws(()=>assertDiagnosisWrite(null,r,args),{code:'DIAG_EDIT_CONSENT'});events.pop();assert.equal(admitConversationConsent(null,r,args).reason,'consent_already_consumed');
});
test('a history read failure cannot keep an old agreement alive while a withdrawal may be unavailable',()=>{
 const {r,args}=fixture();assertDiagnosisWrite(null,r,args);r.agent.session.snapshotEvents=()=>{throw Error('synthetic history unavailable');};assert.throws(()=>assertDiagnosisWrite(null,r,args),e=>e.code==='DIAG_EDIT_CONSENT'&&e.details.reason==='owner_history_unavailable');assert.equal(r.diagnosis.approval,null);
});
