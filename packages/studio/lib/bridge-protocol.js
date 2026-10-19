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
      const keys=['mode','claim','document_id','expected_revision','worldbook_document_id','worldbook_revision','preset','characters','runId','binding','request_id'];
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||!['start','inspect','attach'].includes(value.mode)||!value.claim)throw new TypeError('Expected a current human SCEAN control request.');
      if(value.mode==='start'&&(typeof value.document_id!=='string'||!Number.isSafeInteger(value.expected_revision)))throw new TypeError('Select a saved revision.');
      if(value.mode!=='start'&&(typeof value.runId!=='string'||!value.binding))throw new TypeError('Explicit inspection binding is required.');
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
