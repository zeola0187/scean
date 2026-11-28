export function usageDetails(usage, piAdapter=false) {
 const numeric = x => Number.isFinite(x) && x>=0 ? x : null;
 const raw=usage?.providerCounts;
 if(raw) {
   const out=Object.fromEntries(['fullInput','cacheRead','cacheWrite','uncachedInput','reasoning','output','total','costUsd'].map(k=>[k,numeric(raw[k])]));
   return {...out,nonReasoningOutput:out.output!==null&&out.reasoning!==null&&out.output>=out.reasoning?out.output-out.reasoning:null,source:'provider_openai_compatible_usage'};
 }
 const value=k=>numeric(usage?.[k]);
 const total=value('totalTokens'),output=value('outputTokens');
 return {source:piAdapter?'dsh_sdk_pi_ai':'dsh_sdk',fullInput:piAdapter&&total!==null&&output!==null&&total>=output?total-output:null,
   cacheRead:value('cacheReadTokens'),cacheWrite:value('cacheWriteTokens'),uncachedInput:piAdapter?value('inputTokens'):null,
   reasoning:null,nonReasoningOutput:null,output,total,costUsd:null};
}
