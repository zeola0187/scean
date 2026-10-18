// Startup/HTTP acceptance only. No generation is needed or allowed here.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import fs from 'node:fs/promises';
export const inject=['llm'];
const status=new URL('../evidence/ui-layout-official-host/adapter-status.json',import.meta.url);
class Offline extends LlmAdapter{
 async listModels(provider){return [await this.resolveModel(provider,'offline')];}
 async resolveModel(provider,id){if(provider!=='w19-scripted'||id!=='offline')throw Error('NON_FIXTURE_MODEL_REJECTED');return {provider,id,name:'Native Skills startup-only offline',toolUpdate:'addition-only',context:{contextWindow:65536},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
 async *stream(){throw Error('GENERATION_FORBIDDEN_IN_STARTUP_ACCEPTANCE');}
}
export async function apply(ctx){ctx.llm.registerAdapter(['w19-scripted'],new Offline());await fs.writeFile(status,JSON.stringify({registered:true,generationAllowed:false,paidModelCalls:0,embeddingCalls:0})+'\n');}
