import {frontendPreview} from './w01/core/frontend.mjs';
import {renderFrontendDocument} from './w01/isolated/web/frontend-runtime.mjs';
import {fail} from './codec.js';
import {validSavedPanelArtifact} from './chat-panel-preview.js';

// A saved receipt identifies one immutable revision. It grants no access: the
// loader separately verifies the live human Session, page lease and lifecycle.
export function savedPanelArtifact({record,decoded},sessionId){
  const proof=record.savedPanelReceipt,frontend=decoded.card.data.extensions?.scean?.frontend;
  if(!proof||proof.schemaVersion!==1||proof.sessionId!==sessionId||proof.revision!==record.revision||!frontend?.hash)fail('PANEL_RECEIPT','A completed panel save receipt is required.');
  const artifact={schemaVersion:1,kind:'cardstudio-saved-panel',document_id:record.id,revision:record.revision,card_sha256:record.sha256,frontend_hash:frontend.hash,receipt_id:proof.id};
  if(!validSavedPanelArtifact(artifact))fail('PANEL_RECEIPT','Invalid panel save receipt.');
  return artifact;
}

export function renderSavedPanel(loaded,artifact,sessionId){
  if(!validSavedPanelArtifact(artifact))fail('PANEL_RECEIPT','Use an exact completed panel save receipt.');
  const expected=savedPanelArtifact(loaded,sessionId);
  if(Object.keys(expected).some(key=>expected[key]!==artifact[key]))fail('PANEL_SOURCE_CHANGED','The saved panel receipt does not match its immutable source.');
  const s=loaded.decoded.card.data.extensions?.scean??{};
  const preview=frontendPreview(s.frontend,s.stateBlueprint,s.initialState,s.characters??[],s.derivedFacts);
  if(!preview.frontend||preview.frontend.hash!==artifact.frontend_hash)fail('PANEL_SOURCE_CHANGED','The saved frontend failed verification.');
  const html=renderFrontendDocument(preview.frontend,preview.projection,{authoringInitial:true});
  // Bounded separate human read; never inject card bytes or an entire State in
  // model-facing write receipts or chat history.
  if(Buffer.byteLength(html,'utf8')>256*1024)fail('PANEL_PREVIEW_LIMIT','This panel is too large for an inline preview.');
  return {artifact:expected,source:'authoring-initial-state-not-runtime',html};
}

export function boundPanelWriteReceipt(receipt,preview){
  const value={...receipt,...preview};
  if(Array.isArray(value.changes))value.changes=[...value.changes];
  // Reserve room for the existing loader scope/selection envelope (including
  // translated policy boundary), rather than overflowing its 8 KiB contract.
  while(Buffer.byteLength(JSON.stringify({ok:true,value}),'utf8')>7168&&value.changes?.length){value.changes.pop();value.changesOmitted=(value.changesOmitted??0)+1;}
  if(Buffer.byteLength(JSON.stringify({ok:true,value}),'utf8')>7168){delete value.panelPreview;value.panelPreviewStatus='unavailable';value.panelPreviewError={code:'PANEL_RECEIPT_LIMIT'};}
  return value;
}
