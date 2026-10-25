// Binding is authoritative. Optional book/Preset hydration must not delay
// navigation, and a browser-local entry intention can only be consumed once.
export class AuthoringNavigation {
  constructor(){this.owner=crypto.randomUUID();this.used=new Set();}
  begin(sessionId,kind){return {owner:this.owner,id:crypto.randomUUID(),sessionId,kind};}
  consume(intent,{currentIntent,sessionId,sequence,currentSequence,claim,currentClaim,ready,live,doc,selection}){
    if(!intent||intent!==currentIntent||intent.owner!==this.owner||this.used.has(intent.id)||intent.sessionId!==sessionId||!['create','picker'].includes(intent.kind))return false;
    if(!live||!ready||sequence!==currentSequence||!claim||claim!==currentClaim||doc?.type!=='card'||selection?.binding_status?.status!=='bound'||selection.document_id!==doc.id||selection.revision!==doc.revision)return false;
    this.used.add(intent.id);return true;
  }
}
