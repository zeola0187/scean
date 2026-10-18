import {UsageLedger} from '../adapters/budget.mjs';
import {randomUUID} from 'node:crypto';

// A separate, shared journal limits this milestone's real generation attempts.
// An interrupted reservation still counts; changing run or restarting never resets it.
export class GenerationGate extends UsageLedger {
  constructor(filePath,{limit=24}={}) {
    super(filePath);
    if(limit!==24)throw new TypeError('Milestone A has a fixed 24-generation limit.');
    this.limit=limit;
  }
  async reserve({kind='generation',caseId,requestId=randomUUID(),retry=0,meta={}}) {
    if(kind!=='generation'||!caseId||!Number.isInteger(retry)||retry<0||retry>1)throw Object.assign(Error('INVALID_GENERATION_RESERVATION'),{code:'INVALID_GENERATION_RESERVATION'});
    return this.transaction(async(rows,append)=>{
      if(rows.filter(r=>r.type==='reserve').length>=this.limit)throw Object.assign(Error('GENERATION_LIMIT_REACHED'),{code:'GENERATION_LIMIT_REACHED',safeMessage:'本工單 24 次模型生成上限已達；沒有送出新請求。'});
      if(rows.some(r=>r.type==='reserve'&&r.requestId===requestId))throw Object.assign(Error('REQUEST_ALREADY_RECORDED'),{code:'REQUEST_ALREADY_RECORDED'});
      const id=randomUUID();
      const safeMeta=Object.fromEntries(['runId','attemptId','requestId','provider','model','stage','inputBytes','maxTokens'].filter(k=>typeof meta[k]==='string'||Number.isFinite(meta[k])).map(k=>[k,typeof meta[k]==='string'?meta[k].slice(0,160):meta[k]]));
      await append({type:'reserve',id,kind,caseId:String(caseId).slice(0,200),requestId,retry,meta:safeMeta});return id;
    });
  }
  async status(){const summary=await this.summary();return {...summary,limit:this.limit,remaining:Math.max(0,this.limit-summary.generationRequests)};}
}
