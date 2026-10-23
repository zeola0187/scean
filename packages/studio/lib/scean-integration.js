import {derivedFactsPackage} from './w01/core/derived-facts.mjs';
import {frontendPackage} from './w01/core/frontend.mjs';
import { canonical, sha, fail } from './codec.js';
import { validateCharacterSources } from './character-sources.js';
import { validateRoster } from './w01/core/contracts.mjs';
import {createWorkReview} from './work-review.js';
import {inspectFrontend} from './frontend-authoring.js';
import {createPresetStore} from './preset-store.js';
import {DEFAULT_PRESET} from './preset-default.js';
export {DEFAULT_PRESET} from './preset-default.js';

const copy = value => structuredClone(value);
const digest = value => sha(Buffer.from(canonical(value)));
/** Availability only. Resolves no playback/authoring grant, creates no lease,
 * and never initializes lifecycle recovery. Archived Sessions stay archived. */
export async function resolveSceanPlaybackStatus(loader,sessionId){
  const unavailable={status:'unavailable'};
  if(typeof sessionId!=='string'||!sessionId||loader.closed||loader.archiveIds===null)return unavailable;
  try{
    const agent=loader.agentLookup(sessionId);
    if(!agent||!await loader.isCard(agent))return unavailable;
    if(loader.archived.has(sessionId))return {status:'session_archived'};
    const service=loader.workspace?.service??loader.serviceFactory(),before=await service.playbackStatus(sessionId);
    if(loader.closed||loader.agentLookup(sessionId)!==agent||!await loader.isCard(agent))return unavailable;
    if(loader.archived.has(sessionId))return {status:'session_archived'};
    const after=await service.playbackStatus(sessionId);
    if(before.status!==after.status||before.authoringBindingRequired!==after.authoringBindingRequired)return unavailable;
    if(loader.closed||loader.agentLookup(sessionId)!==agent||!await loader.isCard(agent))return unavailable;
    if(loader.archived.has(sessionId))return {status:'session_archived'};
    return after;
  }catch{return unavailable;}
}
/** Host-only playback read: preserve exact legacy selections without promoting
 * them to authoring bindings. No name matching, migration or RP activation. */
export async function resolveSceanCardContext(loader, sessionId) {
  if(typeof sessionId!=='string'||!sessionId)return null;
  const agent=loader.agentLookup(sessionId),r=loader.records.get(sessionId);
  if(!agent||!r)return null;
  await loader.validate(agent,r,null);
  const selected=await loader.workspace.service.selectedPlaybackDocument(sessionId);
  await loader.validate(agent,r,null);
  if(selected?.type!=='card')return null;
  const saved=await loader.workspace.service.read(selected.document_id);
  const current=await loader.workspace.service.selectedPlaybackDocument(sessionId);
  await loader.validate(agent,r,null);
  if(current?.document_id!==selected.document_id||current.type!=='card'||current.authoringBindingRequired!==selected.authoringBindingRequired)return null;
  return {schemaVersion:1,provider:'@local/dsh-card-studio-scean-test',cardId:selected.document_id,authoringSessionId:sessionId,generation:r.generation,savedRevision:saved.revision,savedSha256:saved.sha256,title:String(saved.card?.data?.name??selected.document_id).slice(0,500),authoringBindingRequired:selected.authoringBindingRequired};
}
/** Navigation only: an existing source conversation does not need an open
 * authoring page. This creates no lease, association, tool or write grant. */
export async function resolveSceanSourceSession(loader,sessionId,cardScope){
  const unavailable={available:false,authoringSessionId:sessionId};
  if(typeof sessionId!=='string'||!sessionId||cardScope?.provider!=='@local/dsh-card-studio-scean-test'||typeof cardScope.cardId!=='string')return unavailable;
  const agent=loader.agentLookup(sessionId);
  if(!agent||loader.closed||loader.archiveIds===null||loader.archived.has(sessionId)||!await loader.isCard(agent))return unavailable;
  // A fresh service object only reads persisted associations and lifecycle.
  // init/acquire/associate are intentionally absent from this lookup.
  const service=loader.workspace?.service??loader.serviceFactory();
  const selected=await service.selectedPlaybackDocument(sessionId),life=await service.lifecycle.read();
  const copy=life?.copies.find(row=>row.id===cardScope.cardId);
  if(selected?.type!=='card'||selected.document_id!==cardScope.cardId||copy&&(copy.location!=='active'||copy.pending))return unavailable;
  const current=await service.selectedPlaybackDocument(sessionId);
  if(current?.document_id!==selected.document_id||current.type!=='card')return unavailable;
  if(loader.agentLookup(sessionId)!==agent||loader.archived.has(sessionId)||!await loader.isCard(agent))return unavailable;
  return {available:true,authoringSessionId:sessionId,cardId:cardScope.cardId};
}
/** Human-only player source reader: exact selected saved card, never a Run mutation. */
export async function resolveSceanFrontendSource(loader,sessionId,expectedScope){
  const before=await resolveSceanCardContext(loader,sessionId);
  if(!before||before.cardId!==expectedScope?.cardId||before.authoringSessionId!==expectedScope.authoringSessionId||before.generation!==expectedScope.generation)fail('PRESENTATION_SOURCE_CHANGED','目前對話或工作卡已變更，請重新讀取。');
  const saved=await loader.workspace.service.read(before.cardId);
  const after=await resolveSceanCardContext(loader,sessionId);
  if(!after||after.cardId!==before.cardId||after.generation!==before.generation||after.savedRevision!==saved.revision||after.savedSha256!==saved.sha256||saved.revision!==before.savedRevision)fail('PRESENTATION_SOURCE_CHANGED','工作卡已更新，請重新讀取面板。');
  const frontend=saved.card?.data?.extensions?.scean?.frontend;
  if(!frontend)fail('PRESENTATION_SOURCE_UNAVAILABLE','請先讓 Card Studio Agent 製作並保存工作卡面板。');
  return {frontend:copy(frontend),source:{documentId:before.cardId,revision:saved.revision,label:before.title.slice(0,160)}};
}
/** A card title or natural-language description cannot prove a single actor. */
export function resolveRoster(card, characters) {
  const roster=characters??card?.data?.extensions?.scean?.characters;
  if(!Array.isArray(roster)||!roster.length||roster.length>100)fail('SCEAN_ROSTER_REQUIRED','請設定角色名冊：至少一位角色的穩定 ID、名稱與專屬背景；不會以卡名猜測 main。');
  const ids=new Set();
  for(const actor of roster){
    if(!actor||typeof actor!=='object'||Array.isArray(actor)||typeof actor.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(actor.id)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(actor.id)||typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>500||typeof actor.description!=='string'||!actor.description.trim()||actor.description.length>100000)fail('SCEAN_CHARACTERS','每位角色需要合法穩定 ID、非空名稱與專屬背景；背景未知時請明示未知，不得杜撰。');
    if(actor.id==='player')fail('RESERVED_ACTOR_ID','player is not an NPC ID.');
    if(ids.has(actor.id))fail('SCEAN_CHARACTERS','角色 ID 不可重複；同名角色請使用不同 ID 與可辨識的背景。');
    ids.add(actor.id);
  }
  // The same portable core contract used at Runtime creation also validates
  // identity/relationships/JSON before the dedicated binding tool can save.
  try{validateRoster(roster);}catch(error){fail(error.code,error.message);}
  return copy(roster);
}
/** Only an already-authorized saved read result may enter this pure conversion. */
export function buildSavedSnapshot(saved,{preset=DEFAULT_PRESET,presetSource,worldbook,characters}={}) {
  if (!saved || saved.type!=='card' || !Number.isSafeInteger(saved.revision) || !saved.card?.data) fail('SCEAN_SNAPSHOT','Select a saved character card.');
  if (!preset || typeof preset!=='object' || Array.isArray(preset)) fail('SCEAN_PRESET','Preset must be a JSON object.');
  const embedded=saved.card.data.character_book??{entries:[]};
  if(worldbook && !worldbook.card?.data?.character_book)fail('SCEAN_WORLDBOOK','Selected saved worldbook has no supported book payload; no fallback is applied.');
  const book=worldbook?worldbook.card.data.character_book:embedded;
  if(worldbook && worldbook.type!=='worldbook')fail('SCEAN_WORLDBOOK','Select a saved worldbook document.');
  const roster=resolveRoster(saved.card,characters);
  for(const actor of roster)validateCharacterSources(actor,{card:saved.card,worldbook:book});
  const snapshot={schemaVersion:1,cardId:saved.id,revision:saved.revision,card:copy(saved.card),worldbook:copy(book),preset:copy(preset),characters:copy(roster),
    source:{provider:'@local/dsh-card-studio-scean-test',card:{id:saved.id,revision:saved.revision,sha256:saved.sha256},worldbook:{kind:worldbook?'saved_document':'embedded',id:worldbook?.id??saved.id,revision:worldbook?.revision??saved.revision,hash:digest(book)},preset:{...presetSource??{kind:'explicit_fixed_payload'},hash:digest(preset)}},
    limitations:['Card JavaScript, MVU, EJS and executable extensions are not executed.','Natural-language worldbook rules are model context, not verified executable predicates.','Saving a new revision requires a new run; live reload is unsupported.']};
  const native=saved.card.data.extensions?.scean;
  if(native?.frontend||native?.derivedFacts){
    snapshot.stateBlueprint=copy(native.stateBlueprint);if(native.initialState!==undefined)snapshot.initialState=copy(native.initialState);
    if(native.derivedFacts){snapshot.derivedFacts=derivedFactsPackage(native.derivedFacts,snapshot.stateBlueprint,roster);snapshot.source.derivedFacts={id:snapshot.derivedFacts.id,version:snapshot.derivedFacts.version,hash:snapshot.derivedFacts.hash,storage:'embedded-in-saved-card-and-fixed-snapshot'};}
    if(native.frontend)snapshot.frontend=frontendPackage(native.frontend,snapshot.stateBlueprint,roster,snapshot.derivedFacts);
    if(snapshot.frontend)snapshot.source.frontend={profile:snapshot.frontend.runtime.profile,hash:snapshot.frontend.hash,storage:'embedded-in-saved-card-and-fixed-snapshot'};
  }
  if(Buffer.byteLength(canonical(snapshot))>8*1024*1024)fail('SCEAN_SNAPSHOT_SIZE','Saved snapshot exceeds the 8 MiB handoff limit.');
  snapshot.hash=digest(snapshot);return snapshot;
}

/** Human-only bridge. Keeps all original workspace/session/lease checks. */
export function createSceanControl(loader,getService,workReview=createWorkReview(loader)) {
  const presets=createPresetStore({root:loader.root,defaultPreset:DEFAULT_PRESET});
  return async (agent,request,signal)=>{
    const r=loader.records.get(agent?.id);
    if(!request?.claim)fail('STALE_LEASE','SCEAN handoff requires a current human page lease.');
    await loader.validate(agent,r,request.claim);
    const identity={authoringSessionId:agent.id,generation:r.generation};
    const selected=await loader.workspace.service.selectedDocument(agent.id);
    if(selected?.type!=='card')fail('SCEAN_SELECTION','請先在目前對話選取角色卡。');
    const cardScope={provider:'@local/dsh-card-studio-scean-test',cardId:selected.document_id};
    const combined=AbortSignal.any([r.controller.signal,r.scopeController.signal,r.pages.get(request.claim.page_id).controller.signal,...signal?[signal]:[]]);
    const scopeEpoch=r.scope.epoch;
    const presetCheck=async()=>{
      combined.throwIfAborted();await loader.validate(agent,r,request.claim);
      if(r.scopeChanging||r.scope.epoch!==scopeEpoch)fail('AUTHORING_SCOPE_CHANGED','編輯授權已變更，請重新讀取。');
      const bound=await loader.workspace.service.selectedDocument(agent.id);
      if(bound?.document_id!==selected.document_id||request.document_id!==selected.document_id||r.selected?.document_id!==selected.document_id)fail('SESSION_CARD_MISMATCH','Preset 只屬於本對話固定的工作卡。');
      if(request.mode==='presetSave'){
        if(r.scope.mode!=='full')fail('AUTHORING_SCOPE','保存完整 Preset 需要目前對話的完整編輯模式；請使用既有的人類授權控制。');
        const saved=await loader.workspace.service.read(selected.document_id);
        if(saved.revision!==request.expected_revision)fail('SCEAN_REVISION','工作卡已更新；請重新讀取後比較 Preset。');
      }
      combined.throwIfAborted();await loader.validate(agent,r,request.claim);
    };
    const job=(async()=>{
      combined.throwIfAborted();
      if(['presetRead','presetSave','presetStatus'].includes(request.mode)){
        const args={documentId:request.document_id,signal:combined,check:presetCheck};
        if(request.mode==='presetRead')return presets.read(args);
        if(request.mode==='presetStatus')return presets.status({...args,operationId:request.operation_id});
        return presets.save({...args,preset:request.preset,expectedRevision:request.expected_preset_revision,operationId:request.operation_id});
      }
      const service=getService();
      if(!service?.startFromStudio||!service?.inspectFromStudio)fail('SCEAN_UNAVAILABLE','SCEAN is not enabled. Card Studio authoring, save and export remain available.');
      if(request.mode==='inspect'){
        const value=await service.inspectFromStudio({...identity,cardScope,runId:request.runId,binding:request.binding,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(request.mode==='attach'){
        if(!service.attachInspection)fail('SCEAN_UNSUPPORTED','SCEAN does not support renewed inspection bindings.');
        const value=await service.attachInspection({...identity,cardScope,runId:request.runId,priorBinding:request.binding,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(request.mode==='prepareStatus'){
        if(!service.scriptStatusFromStudio)fail('SCEAN_UNSUPPORTED','Saved script receipts are unavailable.');
        const value=await service.scriptStatusFromStudio({...identity,cardScope,requestId:request.request_id,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(request.mode==='startScript'){
        if(!service.startScriptFromStudio)fail('SCEAN_UNSUPPORTED','Saved script start is unavailable.');
        const value=await service.startScriptFromStudio({...identity,cardScope,scriptId:request.script_id,scriptHash:request.script_hash,expectedRevision:request.expected_revision,operationId:request.request_id,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(!['start','prepare','publish'].includes(request.mode))fail('SCEAN_ACTION','Choose prepare, publish, prepareStatus, startScript, start, inspect or attach.');
      if(selected.document_id!==request.document_id||r.selected?.document_id!==request.document_id)fail('SCEAN_SELECTION','Only the selected saved working copy can be sent to SCEAN.');
      const read=await loader.call(agent,r,request.claim,'read',{document_id:request.document_id},combined);
      if(!read.ok)fail(read.error.code,read.error.message);
      if(read.value.revision!==request.expected_revision)fail('SCEAN_REVISION','Saved card changed. Refresh before sending it to SCEAN.');
      if(request.characters!==undefined&&request.characters_revision!==read.value.revision)fail('SCEAN_ROSTER_REVISION','角色名冊的來源版本已改變；請重新確認名冊，再送往舞臺。');
      let worldbook;
      if(request.worldbook_document_id){
        // Retain the existing human-only explicit worldbook dependency. It does
        // not select another document, grant tools cross-card reads, or accept
        // another card as a dependency. Edits require its own bound Session.
        await loader.validate(agent,r,request.claim);combined.throwIfAborted();
        worldbook=await loader.workspace.service.read(request.worldbook_document_id);
        if(worldbook.type!=='worldbook')fail('SCEAN_WORLDBOOK','只能明確引用已保存的獨立世界書；其他工作卡不可作為此對話來源。');
        await loader.validate(agent,r,request.claim);combined.throwIfAborted();
        if(worldbook.revision!==request.worldbook_revision)fail('SCEAN_REVISION','Saved worldbook changed. Refresh its selected revision.');
      }
      const storedPreset=await presets.read({documentId:request.document_id,signal:combined,check:presetCheck});
      if(request.expected_preset_revision!==undefined&&request.expected_preset_revision!==storedPreset.revision)fail('PRESET_REVISION','Preset 已在另一對話更新，請讀取並比較已保存版本。');
      if(request.preset!==undefined&&digest(request.preset)!==digest(storedPreset.preset))fail('PRESET_UNSAVED','請先獨立保存完整 Preset，再檢查與送往舞台。');
      const snapshot=buildSavedSnapshot(read.value,{preset:storedPreset.preset,presetSource:{kind:'working_card_preset',documentId:read.value.id,revision:storedPreset.revision},worldbook,characters:request.characters});
      await loader.validate(agent,r,request.claim);combined.throwIfAborted();
      if((await loader.workspace.service.selectedDocument(agent.id))?.document_id!==request.document_id)fail('SCEAN_SELECTION','Selected card changed during handoff. Refresh before opening a Run.');
      if(request.mode==='prepare'||request.mode==='publish'){
        if(!service.auditSavedSnapshot||!service.publishFromStudio)fail('SCEAN_UNSUPPORTED','Work preparation requires saved script and compatibility audit services.');
        const data=snapshot.card.data;
        if(![data.first_mes,...(Array.isArray(data.alternate_greetings)?data.alternate_greetings:[])].some(text=>typeof text==='string'&&text.trim()))fail('OPENING_EMPTY','Save at least one nonempty opening before preparing this work.');
        // Backup preflight checks source structure without claiming tavern export
        // compatibility. SCEAN audit separately records Runtime-specific limits.
        const checked=await loader.call(agent,r,request.claim,'check',{document_id:read.value.id,expected_revision:read.value.revision,export_action:'export_backup'},combined);
        if(!checked.ok)fail(checked.error.code,checked.error.message);
        const audit=await service.auditSavedSnapshot({snapshot,saved:{id:read.value.id,revision:read.value.revision,sha256:read.value.sha256,format:read.value.format},entryIds:read.value.entryIds,frontend:inspectFrontend(read.value.card,[],read.value.entryIds),cases:[]});
        const checks={preflight:checked.value,audit};
        if(checked.value.overall==='FAIL'||audit.items?.some(item=>item.status==='FAIL'))fail('SCEAN_PREPARATION_BLOCKED','Saved source checks failed; review the check details.',{check:checked.value,audit});
        const review=await workReview.prepare(agent,r,{snapshot,checks},request.claim,combined);
        const prepared=review.status==='completed'&&review.verdict==='pass'&&review.coverage==='complete';
        if(request.mode==='prepare')return {prepared,documentId:snapshot.cardId,revision:snapshot.revision,snapshotHash:snapshot.hash,review,checks};
        if(!prepared)fail('SCEAN_REVIEW_PENDING','Current Agent semantic review is incomplete or requests changes. Return to the conversation to finish this exact review.');
        // The persisted receipt is looked up by the Host; no UI review claim is trusted.
        return service.publishFromStudio({...identity,snapshot,requestId:request.request_id,review,signal:combined});
      }
      // RP ownership is SCEAN's. This signal covers only handoff, never later RP turns.
      return service.startFromStudio({...identity,snapshot,requestId:request.request_id,signal:combined});
    })();
    r.jobs.add(job);try{return await job;}finally{r.jobs.delete(job);}
  };
}
