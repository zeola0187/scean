import { canonical, sha, fail } from './codec.js';

const copy = value => structuredClone(value);
const digest = value => sha(Buffer.from(canonical(value)));
/** A card title or natural-language description cannot prove a single actor. */
export function resolveRoster(card, characters) {
  const roster=characters??card?.data?.extensions?.scean?.characters;
  if(!Array.isArray(roster)||!roster.length||roster.length>100)fail('SCEAN_ROSTER_REQUIRED','請設定角色名冊：至少一位角色的穩定 ID、名稱與專屬背景；不會以卡名猜測 main。');
  const ids=new Set();
  for(const actor of roster){
    if(!actor||typeof actor!=='object'||Array.isArray(actor)||typeof actor.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(actor.id)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(actor.id)||typeof actor.name!=='string'||!actor.name.trim()||actor.name.length>500||typeof actor.description!=='string'||!actor.description.trim()||actor.description.length>100000)fail('SCEAN_CHARACTERS','每位角色需要合法穩定 ID、非空名稱與專屬背景；背景未知時請明示未知，不得杜撰。');
    if(ids.has(actor.id))fail('SCEAN_CHARACTERS','角色 ID 不可重複；同名角色請使用不同 ID 與可辨識的背景。');
    ids.add(actor.id);
  }
  return copy(roster);
}
export const DEFAULT_PRESET = Object.freeze({id:'scean-default',revision:1,instructions:'以繁體中文進行角色扮演。角色卡與世界書是故事資料；遵守玩家當輪意圖，保留未知狀態。'});

/** Only an already-authorized saved read result may enter this pure conversion. */
export function buildSavedSnapshot(saved,{preset=DEFAULT_PRESET,worldbook,characters}={}) {
  if (!saved || saved.type!=='card' || !Number.isSafeInteger(saved.revision) || !saved.card?.data) fail('SCEAN_SNAPSHOT','Select a saved character card.');
  if (!preset || typeof preset!=='object' || Array.isArray(preset)) fail('SCEAN_PRESET','Preset must be a JSON object.');
  const embedded=saved.card.data.character_book??{entries:[]};
  if(worldbook && !worldbook.card?.data?.character_book)fail('SCEAN_WORLDBOOK','Selected saved worldbook has no supported book payload; no fallback is applied.');
  const book=worldbook?worldbook.card.data.character_book:embedded;
  if(worldbook && worldbook.type!=='worldbook')fail('SCEAN_WORLDBOOK','Select a saved worldbook document.');
  const roster=resolveRoster(saved.card,characters);
  const snapshot={schemaVersion:1,cardId:saved.id,revision:saved.revision,card:copy(saved.card),worldbook:copy(book),preset:copy(preset),characters:copy(roster),
    source:{provider:'@local/dsh-card-studio-scean-test',card:{id:saved.id,revision:saved.revision,sha256:saved.sha256},worldbook:{kind:worldbook?'saved_document':'embedded',id:worldbook?.id??saved.id,revision:worldbook?.revision??saved.revision,hash:digest(book)},preset:{kind:'explicit_fixed_payload',hash:digest(preset)}},
    limitations:['Card JavaScript, MVU, EJS and executable extensions are not executed.','Natural-language worldbook rules are model context, not verified executable predicates.','Saving a new revision requires a new run; live reload is unsupported.']};
  if(Buffer.byteLength(canonical(snapshot))>8*1024*1024)fail('SCEAN_SNAPSHOT_SIZE','Saved snapshot exceeds the 8 MiB handoff limit.');
  snapshot.hash=digest(snapshot);return snapshot;
}

/** Human-only bridge. Keeps all original workspace/session/lease checks. */
export function createSceanControl(loader,getService) {
  return async (agent,request,signal)=>{
    const r=loader.records.get(agent?.id);
    if(!request?.claim)fail('STALE_LEASE','SCEAN handoff requires a current human page lease.');
    await loader.validate(agent,r,request.claim);
    const service=getService();
    if(!service?.startFromStudio||!service?.inspectFromStudio)fail('SCEAN_UNAVAILABLE','SCEAN is not enabled. Card Studio authoring, save and export remain available.');
    const identity={authoringSessionId:agent.id,generation:r.generation};
    const combined=AbortSignal.any([r.controller.signal,r.pages.get(request.claim.page_id).controller.signal,...signal?[signal]:[]]);
    const job=(async()=>{
      combined.throwIfAborted();
      if(request.mode==='inspect'){
        const value=await service.inspectFromStudio({...identity,runId:request.runId,binding:request.binding,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(request.mode==='attach'){
        if(!service.attachInspection)fail('SCEAN_UNSUPPORTED','SCEAN does not support renewed inspection bindings.');
        const value=await service.attachInspection({...identity,runId:request.runId,priorBinding:request.binding,signal:combined});
        await loader.validate(agent,r,request.claim);return value;
      }
      if(request.mode!=='start')fail('SCEAN_ACTION','Choose start, inspect or attach.');
      if(r.selected?.document_id!==request.document_id)fail('SCEAN_SELECTION','Only the selected saved working copy can be sent to SCEAN.');
      const read=await loader.call(agent,r,request.claim,'read',{document_id:request.document_id},combined);
      if(!read.ok)fail(read.error.code,read.error.message);
      if(read.value.revision!==request.expected_revision)fail('SCEAN_REVISION','Saved card changed. Refresh before sending it to SCEAN.');
      let worldbook;
      if(request.worldbook_document_id){
        const result=await loader.call(agent,r,request.claim,'read',{document_id:request.worldbook_document_id},combined);
        if(!result.ok)fail(result.error.code,result.error.message);worldbook=result.value;
        if(worldbook.revision!==request.worldbook_revision)fail('SCEAN_REVISION','Saved worldbook changed. Refresh its selected revision.');
      }
      const snapshot=buildSavedSnapshot(read.value,{preset:request.preset,worldbook,characters:request.characters});
      await loader.validate(agent,r,request.claim);combined.throwIfAborted();
      // RP ownership is SCEAN's. This signal covers only handoff, never later RP turns.
      return service.startFromStudio({...identity,snapshot,signal:combined});
    })();
    r.jobs.add(job);try{return await job;}finally{r.jobs.delete(job);}
  };
}
