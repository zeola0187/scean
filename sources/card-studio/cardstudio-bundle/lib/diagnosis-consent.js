import {canonical,fail,sha} from './codec.js';

// This fingerprint binds the agreement to the prepared direction, exact
// document/revision and discussion floor. It is not an authorization token.
export const diagnosisProposalKey=proposal=>proposal?sha(Buffer.from(canonical(proposal))):null;

function readableEvents(agent){
  try{const session=agent.session,events=session.snapshotEvents(Math.max(session.inheritedEventCount??0,(session.seq??0)-256));return Array.isArray(events)?events.slice(-256):null;}catch{return null;}
}
export const diagnosisEvents=agent=>readableEvents(agent)??[];
export const diagnosisEventFloor=agent=>Math.max(-1,...diagnosisEvents(agent).map(e=>Number.isSafeInteger(e.seq)?e.seq:-1));
const textOf=message=>Array.isArray(message?.content)&&message.content.every(b=>b.type==='text'&&typeof b.text==='string')?message.content.map(b=>b.text).join('\n'):null;
const human=event=>event?.type==='user/message'&&event.data?.role==='user'&&event.data.source?.kind==='user';
const operator=event=>human(event)&&typeof event.data.id==='string'&&typeof event.data.source.rpcId==='string'&&event.data.source.rpcId.length>0&&event.data.source.rpcId.length<=256&&!event.data.source.principal&&event.surfaceOp!=='replace';
export function clearEditIntent(text){
  if(typeof text!=='string'||text.length>4000)return false;
  const value=text.trim();
  if(!value||/[?？]|```|^[>「『“"']|(?:^|\n)\s*(?:>|User:|Assistant:)|^(?:如果|假如|例如|有人|他說|她說|suppose\b|if\b|for example)/i.test(value))return false;
  // Preserving a field ("不要改性格") is a constraint, not a withdrawal.
  // Refusal, deferral and cancellation win over an affirmative in the same message.
  if(/(?:不|沒)(?:同意|確認|允許|批准)|不是(?:在)?(?:同意|確認)|不准|停止|取消|撤回|暫緩|等一下|先(?:別|不要|不)[\s，,]*(?:修改|改|動手|修|執行)|暫時不[\s，,]*(?:修改|改|動手|修|執行)|(?:不要|別)(?:動手|執行|套用)|(?:不要|別)(?:改|修改)(?:了|吧|[\s，,。！!]*$)|(?:確認|同意)[\s，,]*(?:不改|不修改|不執行|不動手|(?:先|只)?(?:討論|研究|看看|檢查))|\b(?:do not|don't|stop|cancel|not yet)\s+(?:edit|fix|change|apply|proceed)\b|\b(?:disagree|not agree|do not agree|don't agree)\b/i.test(value))return false;
  const head=value.slice(0,160),edit=/(?:修改|修正|調整|套用|改|照做|執行|這個|這項|提案|方案|方向)/;
  if(/^(?:我(?:已經|已|現在)?(?:明確)?[\s，,]*)?(?:同意|確認|批准)/.test(head))return edit.test(head)||/^(?:我)?(?:同意|確認|批准)[\s，,。！!]*$/.test(value);
  if(/^(?:這個|這項|上述|剛才)(?:修改|修正|調整|提案|方案|方向)[\s\S]{0,45}(?:我)?(?:同意|確認|批准)/.test(head))return true;
  if(/^(?:請)?(?:照|按|依照|按照)(?:這|那|剛才|你|上面|先前)[\s\S]{0,60}(?:修改|修正|調整|套用|改|執行)/.test(head))return true;
  if(/^(?:好(?:的|啊)?|可以|請|幫|就|照|行|嗯)[\s，,。！!]*[\s\S]{0,100}(?:幫我(?:改|修改|修)|幫忙改|請修改|請修正|照做|(?:照|按)[\s\S]{0,30}(?:改|修改|調整)|修改這張卡|開始修改|套用(?:這|剛才|建議)|執行(?:這|剛才|建議))/.test(head))return true;
  return /^(?:yes|okay|ok|agreed|please)[\s,!.]*[\s\S]{0,80}\b(?:edit|fix|change|apply|make the change|go ahead)\b/i.test(head)||/^(?:please\s+)?(?:apply|implement)\s+(?:this|the|that|your|proposed)\b/i.test(head);
}
export function approvalConstraints(text){
  const fields=[];
  if(/(?:不要|別|不(?:要)?改動|保留|保持)[^，。；\n]{0,18}(?:性格|人格)|(?:do not|don't|preserve|keep)[^,.\n]{0,35}personality/i.test(text))fields.push('personality');
  if(/(?:不要|別|保留|保持)[^，。；\n]{0,18}(?:世界書)|(?:do not|don't|preserve|keep)[^,.\n]{0,35}worldbook/i.test(text))fields.push('character_book');
  if(/(?:不要|別|保留|保持)[^，。；\n]{0,18}(?:開場)|(?:do not|don't|preserve|keep)[^,.\n]{0,35}opening/i.test(text))fields.push('first_mes','alternate_greetings','group_only_greetings');
  return fields;
}
/** Host-owned Session events only. No tool parameter or Run text can supply
 * consent. A visible assistant discussion must follow this exact proposal,
 * then a new owner-RPC human message must explicitly request the edit. */
export function admitConversationConsent(loader,r,args){
  const status=reason=>({reason,nextAction:'Discuss the prepared repair in this conversation, then let the human explicitly agree in a new normal chat message. Do not require a special phrase or an editor-only button. Never substitute a model claim or a tool answer for the owner message.'});
  const d=r.diagnosis;if(!d||d.revoked||d.context.authorizationVersion!==2||d.context.lifetime!=='session')return status('diagnosis_unavailable');
  if(!d.proposal)return status('proposal_required');
  const events=readableEvents(r.agent);
  // An unreadable history must not hide a newer human withdrawal during commit.
  if(!events){d.approval=null;return status('owner_history_unavailable');}
  const latest=events.filter(human).at(-1),a=d.approval;
  if(a&&latest&&latest.seq>(a.historyFloor??-1)&&latest.data.id!==a.consentMessageId)d.approval=null;
  if(d.approval)return {reason:'approved'};
  const p=d.proposal,text=textOf(latest?.data);
  if(!operator(latest))return status('owner_message_required');
  if(latest.seq<=p.historyFloor)return status('proposal_changed_or_message_too_old');
  if(!clearEditIntent(text))return status('explicit_agreement_not_recognized');
  if(d.usedConsentIds?.has(latest.data.id))return status('consent_already_consumed');
  const discussed=events.some(e=>e.type==='assistant/message'&&e.seq>p.historyFloor&&e.seq<latest.seq&&e.data?.message?.role==='assistant'&&e.data.message.source?.kind==='model'&&e.data.message.content?.some(b=>b.type==='text'&&typeof b.text==='string'&&b.text.trim()));
  if(!discussed)return status('complete_discussion_required');
  if(p.target.document_id!==args.document_id||r.selected?.document_id!==args.document_id)return status('proposal_target_changed');
  if(p.target.revision!==args.expected_revision)return status('proposal_revision_changed');
  d.usedConsentIds??=new Set();d.usedConsentIds.add(latest.data.id);
  d.approval={source:'owner-conversation',lifetime:'diagnosis',diagnosisId:d.context.id,proposalKey:diagnosisProposalKey(p),direction:p.direction,userInstruction:text,protectedFields:approvalConstraints(text),documentId:p.target.document_id,revision:p.target.revision,consentMessageId:latest.data.id,historyFloor:latest.seq};
  return {reason:'approved'};
}
export function assertDiagnosisCandidate(r,{before,after}){
  for(const field of r.diagnosis?.approval?.protectedFields??[])if(canonical(before?.data?.[field]??null)!==canonical(after?.data?.[field]??null))fail('DIAG_EDIT_CONSTRAINT','The human consent explicitly preserves '+field+'. Keep it unchanged and revise the local edit.');
}
