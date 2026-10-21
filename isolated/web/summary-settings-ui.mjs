// The normal control is the saved per-story preference. Provider capabilities
// and optional memory services remain separate advanced configuration.
const failureText=code=>code==='CHAPTER_SOURCE_LIMIT'?'本章超過單次摘要容量，尚未產生摘要；請查看章節操作提示。':code==='CHAPTER_INTERRUPTED_NO_AUTORETRY'?'上次摘要工作中斷，尚未完成；不會因開啟頁面自動重送。':'上次摘要未完成，請查看章節操作提示後再恢復自動整理。';
export function chapterAutomationSummary(value={}){
 const enabled=value.settings?.autoEnabled===true,failure=value.automaticFailure;
 if(!enabled)return '本局自動摘要：已關閉。已保存的摘要仍可閱讀。';
 if(value.enabled!==true)return '本局自動摘要：已開啟，等待摘要服務設定。請前往舞臺全域設定檢查；不需要啟用向量搜尋或記憶召回。';
 if(failure)return '本局自動摘要：暫停。'+failureText(failure.code??failure.result?.code);
 if(value.chapterFailure)return '本局自動摘要：已開啟。'+failureText(value.chapterFailure.code??value.chapterFailure.result?.code);
 if(value.eligibility?.reason==='candidate_bytes_limit')return '本局自動摘要：已開啟；目前可整理原文超過單次容量，尚未開始模型工作。';
 return '本局自動摘要：已開啟。之後新回合保存後，達到整理時機才會執行；重啟後保持設定。';
}
export function chapterOperationSummary(value={}){
 const work=value.chapterWork,latestWork=work??(value.operations??[]).at(-1)?.batching;
 if(work)return `章節摘要處理中：已完成 ${work.completedCalls}/${work.totalCalls} 次呼叫${work.batchCount?'（'+work.batchCount+' 批原文及一次整合）':''}；完成整合前不會保存為完整摘要。`;
 const failure=value.chapterFailure??value.automaticFailure;
 if(failure)return failureText(failure.code??failure.result?.code);
 const latest=(value.operations??[]).at(-1);
 if(!latest)return '尚無章節整理工作；開啟本頁不會產生摘要。';
 const labels={pending:'章節摘要處理中。',completed:'最近一次章節整理已完成。',failed:'最近一次章節摘要未完成。',cancelled:'最近一次章節摘要已取消。',stale:'章節來源已變更；舊摘要不當作目前故事。'};
 const usage=latest.usage,counts=latestWork?` 已完成 ${latestWork.completedCalls}/${latestWork.totalCalls} 次呼叫。`:'',tokens=usage?.totalTokens??((usage?.inputTokens??usage?.promptTokens??0)+(usage?.outputTokens??usage?.completionTokens??0));
 if(labels[latest.status])return labels[latest.status]+counts+(tokens?` 已記錄用量 ${tokens} tokens。`:'');
 return labels[latest.status]??'章節工作狀態待確認，請重新讀取。';
}
