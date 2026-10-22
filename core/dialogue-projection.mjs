import {hash} from './contracts.mjs';
import {publicCharacter} from './memory-policy.mjs';
import {validDialoguePresentation} from './dialogue.mjs';
export function publicTurnDialogue(run,turn){
 if(!turn?.dialoguePresentation)return {};
 try{
  const bodyHash=hash(turn.body);if(turn.bodyHash!==bodyHash)return {};
  const value=validDialoguePresentation(turn.dialoguePresentation,{body:turn.body,bodyHash,runId:run.runId,snapshotHash:run.snapshot.hash,commitId:turn.commitId,actors:run.snapshot.characters.map(publicCharacter)});
  return value?{bodyHash,dialoguePresentation:value}:{};
 }catch{return {};}
}
