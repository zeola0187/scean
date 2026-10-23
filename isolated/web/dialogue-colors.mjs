import {validDialoguePresentation,dialoguePalette} from './dialogue.mjs';
const rendered=new WeakMap();
// Never interpret prose or annotation values as HTML/CSS. The displayed text
// and text-node selection always reconstruct the canonical body exactly.
export function renderDialogueBody(element,item,context){
 const body=item.body;let value=null;try{value=validDialoguePresentation(item.dialoguePresentation,{...context,body,bodyHash:item.bodyHash,commitId:item.commitId});}catch{}
 const palette=value?dialoguePalette(context.actors):null;
 const signature=value?JSON.stringify(value.spans.map(s=>[s.start,s.end,s.speakerId,palette[s.speakerId],context.actors.find(a=>a.id===s.speakerId)?.name??null])):'neutral';
 const previous=rendered.get(element);
 if(previous?.body===body&&previous.signature===signature)return {status:value?'colored':'neutral',spans:value?.spans.length??0,updated:false};
 rendered.set(element,{body,signature});
 if(!value){element.textContent=body;return {status:'neutral',spans:0,updated:true};}
 const doc=element.ownerDocument??globalThis.document,fragment=doc.createDocumentFragment();let end=0;
 for(const part of value.spans){if(part.start>end)fragment.append(doc.createTextNode(body.slice(end,part.start)));const span=doc.createElement('span');span.className='scean-dialogue scean-dialogue-color-'+palette[part.speakerId];span.dataset.speakerId=part.speakerId;span.textContent=part.text;const actor=context.actors.find(a=>a.id===part.speakerId);if(actor?.name)span.title=actor.name;fragment.append(span);end=part.end;}
 if(end<body.length)fragment.append(doc.createTextNode(body.slice(end)));element.replaceChildren(fragment);return {status:'colored',spans:value.spans.length,updated:true};
}
