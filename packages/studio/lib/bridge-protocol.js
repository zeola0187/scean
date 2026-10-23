// Public Typert descriptor over the existing authenticated DSH Connection.
// Shared verbatim by Host and generated Client; no command/session-log transport.
export const cardstudioRemote = {
  package:'@local/dsh-card-studio-scean-test',
  descriptors:[{
    id:'@local/dsh-card-studio-scean-test#cardstudioScean/request',service:'cardstudioSceanBridge',namespace:'cardstudioScean',method:'request',
    invocation:{kind:'direct'},scope:{context:'agent',wire:'agentId'},
    parameters:[
      {name:'agent',wire:'agentId',source:'lookup',lookup:'agent',codec:{mode:'strict',typeSymbol:'@deepseek-ai/dsh-session/types#SessionId',create:()=>({parse(value){
        if(typeof value!=='string'||!value.trim())throw new TypeError('Expected an agent identity.');return value;
      }})}},
      {name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#CardStudioRequest',create:()=>({parse(value){
        if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.action!=='string')throw new TypeError('Expected a Card Studio action object.');return value;
      }})}},
    ],cancellation:{parameter:'signal'},result:{mode:'src-json'},
  }],
};

// Human-only immutable panel read. No arbitrary source, path, HTML or Agent
// dispatcher action is accepted; the Host rechecks receipt and live authority.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/savedPanelPreview',method:'savedPanelPreview',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanSavedPanelPreview',create:()=>({parse(value){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['claim','artifact'].includes(key))||!value.claim||!value.artifact||typeof value.artifact!=='object'||Array.isArray(value.artifact))throw new TypeError('Expected a current human page and saved panel receipt.');return value;
    }})}
  }]
});

cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/setCharacterMethod',method:'setCharacterMethod',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanCharacterMethod',create:()=>({parse(value){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['name','expected_epoch','claim'].includes(k))||!['character-authoring'].includes(value.name)||!Number.isSafeInteger(value.expected_epoch)||!value.claim)throw new TypeError('Expected a human Session character method request.');return value;
    }})}
  }]
});

// This is a separate client-side invocation, intentionally absent from the
// generic command dispatcher and all Agent tool action schemas.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],
  id:'@local/dsh-card-studio-scean-test#cardstudioScean/setAuthoringScope',method:'setAuthoringScope',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanScopeRequest',create:()=>({parse(value){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['mode','expected_epoch','claim'].includes(k))||!['content','full'].includes(value.mode)||!Number.isSafeInteger(value.expected_epoch)||!value.claim)throw new TypeError('Expected a human Session scope request.');return value;
    }})}
  }]
});

// Human-only review invocation. Never admitted by generic request/command or Agent schemas.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/reviewMaterials',method:'reviewMaterials',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanMaterialReview',create:()=>({parse(value){
      const fields=['recycle','restore'].includes(value?.mode)?['mode','material_id','record_sha256','expected_recycle_revision','operation_id','expected_epoch','claim']:['mode','extraction_id','expected_revision','candidate_sha256','accepted_ids','edits','expected_epoch','claim'];
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k))||!['edit','confirm','recycle','restore'].includes(value.mode)||!value.claim||!Number.isSafeInteger(value.expected_epoch))throw new TypeError('Expected a bound human material review.');return value;
    }})}
  }]
});

// Human folder choice is deliberately absent from Agent command/action schemas.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/setLibraryRoot',method:'setLibraryRoot',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanLibraryRoot',create:()=>({parse(value){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['path','expected_revision','claim'].includes(k))||value.path!==null&&typeof value.path!=='string'||!Number.isSafeInteger(value.expected_revision)||!value.claim)throw new TypeError('Expected a human Library folder request.');return value;
    }})}
  }]
});

// Human-only explicit saved-snapshot handoff and readonly Inspector. Never an Agent tool.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/sceanControl',method:'sceanControl',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanSceanControl',create:()=>({parse(value){
      if(value?.mode?.startsWith('diagnosis_')){
        const fields={diagnosis_list:['offset'],diagnosis_grant:['runId','ranges','fromTurn','toTurn','ttlMs','acknowledgement'],diagnosis_status:[],diagnosis_consent:['expected_revision'],diagnosis_revoke:[]}[value.mode];
        if(!fields||!value.claim||Object.keys(value).some(k=>!['mode','claim',...fields].includes(k)))throw new TypeError('Expected a human diagnosis selection, bounded consent or revocation.');
        if(value.mode==='diagnosis_grant'&&typeof value.runId!=='string'||value.mode==='diagnosis_consent'&&!Number.isSafeInteger(value.expected_revision))throw new TypeError('Exact Run or saved repair revision is required.');
        return value;
      }
      const fields={start:['document_id','expected_revision','expected_preset_revision','worldbook_document_id','worldbook_revision','preset','characters','characters_revision','request_id'],prepare:['document_id','expected_revision','expected_preset_revision','worldbook_document_id','worldbook_revision','preset','characters','characters_revision'],publish:['document_id','expected_revision','expected_preset_revision','worldbook_document_id','worldbook_revision','preset','characters','characters_revision','request_id'],prepareStatus:['request_id'],startScript:['script_id','script_hash','expected_revision','request_id'],inspect:['runId','binding'],attach:['runId','binding'],presetRead:['document_id'],presetSave:['document_id','expected_revision','expected_preset_revision','preset','operation_id'],presetStatus:['document_id','operation_id']};
      const allowed=fields[value?.mode];
      if(!value||typeof value!=='object'||Array.isArray(value)||!allowed||Object.keys(value).some(k=>!['mode','claim',...allowed].includes(k))||!value.claim)throw new TypeError('Expected a current human SCEAN control request.');
      if(['start','prepare','publish'].includes(value.mode)&&(typeof value.document_id!=='string'||!Number.isSafeInteger(value.expected_revision)))throw new TypeError('Select a saved revision.');
      if(['publish','prepareStatus','startScript'].includes(value.mode)&&(typeof value.request_id!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(value.request_id)))throw new TypeError('Use a stable publication or operation request identity.');
      if(value.mode==='startScript'&&(typeof value.script_id!=='string'||!/^[a-f0-9]{64}$/.test(value.script_hash??'')||!Number.isSafeInteger(value.expected_revision)))throw new TypeError('Use an exact saved script receipt.');
      if(['inspect','attach'].includes(value.mode)&&(typeof value.runId!=='string'||!value.binding))throw new TypeError('Explicit inspection binding is required.');
      if(value.mode.startsWith('preset')&&(typeof value.document_id!=='string'||!value.document_id))throw new TypeError('Preset requires the bound working card.');
      if(['presetSave','presetStatus'].includes(value.mode)&&(typeof value.operation_id!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(value.operation_id)))throw new TypeError('Use the original Preset save operation identity.');
      if(value.expected_preset_revision!==undefined&&(!Number.isSafeInteger(value.expected_preset_revision)||value.expected_preset_revision<0))throw new TypeError('Use the saved Preset revision.');
      if(value.mode==='presetSave'&&(!Number.isSafeInteger(value.expected_revision)||value.expected_revision<0||!Number.isSafeInteger(value.expected_preset_revision)||!value.preset||typeof value.preset!=='object'||Array.isArray(value.preset)))throw new TypeError('Save complete Preset JSON with exact card and Preset revisions.');
      return value;
    }})}
  }]
});

// Browser downloads use existing authenticated RPC and exact export receipts.
// No path, URL or generic/model action is admitted.
cardstudioRemote.descriptors.push({
  ...cardstudioRemote.descriptors[0],id:'@local/dsh-card-studio-scean-test#cardstudioScean/downloadExport',method:'downloadExport',
  parameters:[cardstudioRemote.descriptors[0].parameters[0],{
    name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-card-studio-scean-test#HumanExportDownload',create:()=>({parse(value){
      const keys=['mode','receipt_id','document_id','expected_revision','sha256','offset','claim'];
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||!['chunk','release'].includes(value.mode)||!value.claim||typeof value.receipt_id!=='string'||typeof value.document_id!=='string'||!Number.isSafeInteger(value.expected_revision)||!/^[a-f0-9]{64}$/.test(value.sha256)||value.mode==='chunk'&&!Number.isSafeInteger(value.offset))throw new TypeError('Expected a bound human export download receipt.');return value;
    }})}
  }]
});
