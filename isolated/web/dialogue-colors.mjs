import {validDialoguePresentation,dialoguePalette} from './dialogue.mjs';
// Never interpret prose or annotation values as HTML/CSS. The displayed text
// and text-node selection always reconstruct the canonical body exactly.
export function renderDialogueBody(element,item,context){
 const body=item.body;let value=null;try{value=validDialoguePresentation(item.dialoguePresentation,{...context,body,bodyHash:item.bodyHash,commitId:item.commitId});}catch{}
 if(!value){element.textContent=body;return {status:'neutral',spans:0};}
 const doc=element.ownerDocument??globalThis.document,palette=dialoguePalette(context.actors),fragment=doc.createDocumentFragment();let end=0;
 for(const part of value.spans){if(part.start>end)fragment.append(doc.createTextNode(body.slice(end,part.start)));const span=doc.createElement('span');span.className='scean-dialogue scean-dialogue-color-'+palette[part.speakerId];span.dataset.speakerId=part.speakerId;span.textContent=part.text;const actor=context.actors.find(a=>a.id===part.speakerId);if(actor?.name)span.title=actor.name;fragment.append(span);end=part.end;}
 if(end<body.length)fragment.append(doc.createTextNode(body.slice(end)));element.replaceChildren(fragment);return {status:'colored',spans:value.spans.length};
}
