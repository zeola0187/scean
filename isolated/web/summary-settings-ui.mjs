// One saved per-story switch controls summary creation AND legal chapter context.
// Configuration availability is visible, never another hidden/per-launch grant.
const failureText=code=>code==='CHAPTER_SOURCE_LIMIT'?'本章超過單次摘要容量，尚未產生摘要；請查看章節操作提示。':code==='CHAPTER_INTERRUPTED_NO_AUTORETRY'?'上次摘要工作中斷，尚未完成；不會因開啟頁面自動重送。':'上次摘要未完成，請查看章節操作提示後再恢復自動整理。';
export function chapterAutomationSummary(value={}){
 const enabled=value.settings?.autoEnabled===true,failure=value.automaticFailure;
 if(!enabled)return '本局自動摘要與章節上下文：已關閉。已保存的摘要仍可閱讀。';
 if(value.enabled!==true)return '本局自動摘要與章節上下文：已開啟，等待章節服務設定。請前往舞臺全域設定；缺少設定時保留合法原文，不假裝已壓縮。';
 if(failure)return '本局自動摘要：暫停。'+failureText(failure.code??failure.result?.code);
 if(value.chapterFailure)return '本局自動摘要：已開啟。'+failureText(value.chapterFailure.code??value.chapterFailure.result?.code);
 if(value.lastRecall?.status==='degraded')return '上次回合的章節召回未完成，已完整保留合法原文，沒有靜默遺漏。請在舞臺全域設定檢查向量與排序服務（'+(value.lastRecall.failureCode??'CHAPTER_RECALL_FAILED')+'）。';
 if(value.contextReadiness?.status==='configuration_required')return '本局自動摘要已開啟；混合召回等待向量／排序設定（'+value.contextReadiness.reason+'）。未可用前保留合法原文，可前往舞臺全域設定修正。';
 if(['unchanged_candidate','no_endpoint_cooldown'].includes(value.eligibility?.reason))return '本局自動摘要與章節上下文：已開啟，正在等待自然章節切點；尚未摘要的原文完整保留。';
 return '本局自動摘要與章節上下文：已開啟。未整理原文約 16,000 估算 tokens 時尋找自然切點；之後每輪使用未壓縮原文、最近三章與混合挑出的最多八章，不重複注入已涵蓋原文。重啟後有效；摘要、向量與排序可能產生費用。';
}
export function chapterOperationSummary(value={}){
 const work=value.chapterWork,latestWork=work??(value.operations??[]).at(-1)?.batching;
 if(work)return `章節摘要處理中：已完成 ${work.completedCalls}/${work.totalCalls} 次呼叫${work.batchCount?'（'+work.batchCount+' 批原文及一次整合）':''}；完成整合前不會保存為完整摘要。`;
 const failure=value.chapterFailure??value.automaticFailure;
 if(failure)return failureText(failure.code??failure.result?.code);
 const latest=(value.operations??[]).at(-1);
 if(!latest)return '尚無章節整理工作；開啟本頁不會產生摘要。';
 if(latest.status==='completed'&&latest.result?.created===false)return '已檢查，尚無合適自然章界；未建立摘要，原文完整保留。';
 const labels={pending:'章節摘要處理中。',completed:'最近一次章節整理已完成。',failed:'最近一次章節摘要未完成。',cancelled:'最近一次章節摘要已取消。',stale:'章節來源已變更；舊摘要不當作目前故事。'};
 const usage=latest.usage,counts=latestWork?` 已完成 ${latestWork.completedCalls}/${latestWork.totalCalls} 次呼叫。`:'',tokens=usage?.totalTokens??((usage?.inputTokens??usage?.promptTokens??0)+(usage?.outputTokens??usage?.completionTokens??0));
 if(labels[latest.status])return labels[latest.status]+counts+(tokens?` 已記錄用量 ${tokens} tokens。`:'');
 return labels[latest.status]??'章節工作狀態待確認，請重新讀取。';
}
