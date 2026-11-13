// Only the fresh fidelity fixture mounts these two deterministic routes.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {apply as applyFidelity} from './fidelity-ui.mjs';
export const inject=['llm'];
export async function apply(ctx){
  const home=process.env.DSH_HOME;if(!home?.includes('player-six-native-agent-models'))throw Error('AGENT_MODELS_SYNTHETIC_HOME_REQUIRED');
  await applyFidelity(ctx);const out=path.dirname(home),calls=[];
  class Alternate extends LlmAdapter{
    async listModels(provider){if(await fs.stat(path.join(out,'hide-alternate')).catch(()=>null))return [];return [await this.resolveModel(provider,'alternate')];}
    async resolveModel(provider,id){if(provider!=='six-alternate'||id!=='alternate')throw Error('NON_SYNTHETIC_ROUTE_REFUSED');return {provider,id,name:'Alternate scripted fixture',context:{contextWindow:131072},defaultMaxTokens:8192,reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
    async *stream(options){calls.push({provider:options.provider,model:options.model,purpose:options.purpose});await fs.writeFile(path.join(out,'alternate-calls.json'),JSON.stringify(calls));yield* ctx.llm.stream({...options,provider:'six-scripted',model:'offline'});}
  }
  ctx.llm.registerAdapter(['six-alternate'],new Alternate());
}
