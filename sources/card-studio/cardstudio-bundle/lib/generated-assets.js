import { sha,fail } from './codec.js';
import { validateRaster } from './asset-raster.js';

/** Accept only the registry's final admitted image result for an armed Session.
 * Paths, URLs and tool text are never interpreted as asset authority. */
export function observeGeneratedAssets(ctx,loader) {
  const calls=new Map();
  ctx.on('tools/execute',(exec,next)=>{
    if(exec.name==='generate_image'&&exec.agent){
      const service=loader.workspace?.service,session=exec.agent.id;
      const arm=service?.generatedArms.get(session);
      if(arm){service.generatedArms.delete(session);service.generatedInflight.add(session);calls.set(exec.callId,{arm,service,agent:exec.agent,record:loader.records.get(session)});}
    }
    return next();
  });
  ctx.on('tools/result',(exec,result)=>{
    const pending=calls.get(exec.callId);if(!pending)return;calls.delete(exec.callId);
    const {arm,service,agent,record}=pending,session=agent.id;service.generatedInflight.delete(session);
    const work=(async()=>{
      try{
        if(exec.agent!==agent||exec.name!=='generate_image'||result.isError)fail('GENERATED_FAILED','生圖未成功；未匯入圖片。');
        await loader.validate(agent,record,null);
        const ref=result.value?.attachment;
        if(!ref||typeof ref.attachmentId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>16*1024*1024||!['image/png','image/jpeg','image/webp'].includes(ref.mediaType))fail('GENERATED_REFERENCE','生圖沒有可驗證的正式圖片附件。');
        const block=result.content?.find(x=>x.type==='image'&&x.attachment?.attachmentId===ref.attachmentId);
        if(!block||['mediaType','bytes','width','height'].some(k=>block.attachment[k]!==ref[k]))fail('GENERATED_REFERENCE','附件摘要與正式圖片區塊不一致。');
        const store=ctx.get('attachments');if(typeof store?.readImage!=='function')fail('GENERATED_STORE','宿主沒有可用的正式圖片讀取介面。');
        const stored=await store.readImage(ref,record.controller.signal),bytes=Buffer.from(stored.data),meta=validateRaster(bytes);
        if(sha(bytes)!==ref.attachmentId.slice(7)||['mediaType','bytes','width','height'].some(k=>meta[k]!==ref[k]))fail('GENERATED_VERIFY','圖片摘要、尺寸或格式不一致。');
        await loader.validate(agent,record,null);
        const receipt=await service.withAuthoringScope(arm.scopePolicy,()=>{arm.scopePolicy?.assertCurrent?.();return service.importGenerated(arm,bytes,{attachmentId:ref.attachmentId,callId:exec.callId},AbortSignal.any([record.controller.signal,record.scopeController?.signal??record.controller.signal]));});
        service.generatedResults.set(session,{ok:true,...receipt});
      }catch(error){service.generatedResults.set(session,{ok:false,error:{code:error.code??'GENERATED_IMPORT',message:error.code?error.message:'自動匯入未完成；請檢查工作副本狀態。'}});}
    })();
    service.generatedJobs.set(session,work);record?.jobs.add(work);
    work.finally(()=>{if(service.generatedJobs.get(session)===work)service.generatedJobs.delete(session);record?.jobs.delete(work);});
    return work;
  });
  ctx.effect(()=>()=>calls.clear(),'generated assets observer cleanup');
}
