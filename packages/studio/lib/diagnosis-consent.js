import {canonical,fail} from './codec.js';

export function diagnosisEvents(agent){
  try{const session=agent.session,events=session.snapshotEvents(Math.max(session.inheritedEventCount??0,(session.seq??0)-256));return Array.isArray(events)?events.slice(-256):[];}catch{return [];}
}
export const diagnosisEventFloor=agent=>Math.max(-1,...diagnosisEvents(agent).map(e=>Number.isSafeInteger(e.seq)?e.seq:-1));
const textOf=message=>Array.isArray(message?.content)&&message.content.every(b=>b.type==='text'&&typeof b.text==='string')?message.content.map(b=>b.text).join('\n'):null;
const human=event=>event?.type==='user/message'&&event.data?.role==='user'&&event.data.source?.kind==='user';
const operator=event=>human(event)&&typeof event.data.id==='string'&&typeof event.data.source.rpcId==='string'&&event.data.source.rpcId.length>0&&event.data.source.rpcId.length<=256&&!event.data.source.principal&&event.surfaceOp!=='replace';
export function clearEditIntent(text){
  if(typeof text!=='string'||text.length>4000||/[?？]|```|^[\s>「『“"']|^(?:如果|假如|例如|有人|他說|她說|suppose|if |for example)/i.test(text))return false;
  if(/(?:先(?:別|不要|不)|暫時不|不准|不允許|停止|取消)(?:[\s，,]*)(?:修改|改|動手|修|執行)|^(?:不要改|別改|不要修改|不要動手)[\s，。！!]*$|\b(?:do not|don't|stop|cancel|not yet)\s+(?:edit|fix|change|proceed)\b/i.test(text))return false;
  return /^(?:好(?:的|啊)?|可以|同意|請|行|嗯)[\s，,。！!]*(?:[\s\S]{0,100})(?:幫我(?:改|修改|修)|請(?:改|修改|修)|(?:照|按)(?:這|那|剛才|你說的|建議)[\s\S]{0,30}(?:改|修改)|修改這張卡|開始修改)/.test(text)||/^(?:yes|okay|ok|agreed|please)[\s,!.]*(?:[\s\S]{0,80})\b(?:edit|fix|change|apply|make the change|go ahead)\b/i.test(text);
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
  const d=r.diagnosis;if(!d||!d.proposal||d.revoked||d.context.authorizationVersion!==2||d.context.lifetime!=='session')return;
  const events=diagnosisEvents(r.agent),latest=events.filter(human).at(-1),a=d.approval;
  if(a&&latest&&latest.seq>(a.historyFloor??-1)&&latest.data.id!==a.consentMessageId)d.approval=null;
  if(d.approval)return;
  const p=d.proposal,text=textOf(latest?.data);
  if(!operator(latest)||latest.seq<=p.historyFloor||!clearEditIntent(text)||d.usedConsentIds?.has(latest.data.id))return;
  const discussed=events.some(e=>e.type==='assistant/message'&&e.seq>p.historyFloor&&e.seq<latest.seq&&e.data?.message?.role==='assistant'&&e.data.message.source?.kind==='model'&&e.data.message.content?.some(b=>b.type==='text'&&typeof b.text==='string'&&b.text.trim()));
  if(!discussed||p.target.document_id!==args.document_id||p.target.revision!==args.expected_revision||r.selected?.document_id!==args.document_id)return;
  d.usedConsentIds??=new Set();d.usedConsentIds.add(latest.data.id);
  d.approval={source:'owner-conversation',lifetime:'diagnosis',diagnosisId:d.context.id,direction:p.direction,userInstruction:text,protectedFields:approvalConstraints(text),documentId:p.target.document_id,revision:p.target.revision,consentMessageId:latest.data.id,historyFloor:latest.seq};
}
export function assertDiagnosisCandidate(r,{before,after}){
  for(const field of r.diagnosis?.approval?.protectedFields??[])if(canonical(before?.data?.[field]??null)!==canonical(after?.data?.[field]??null))fail('DIAG_EDIT_CONSTRAINT','The human consent explicitly preserves '+field+'. Keep it unchanged and revise the local edit.');
}
