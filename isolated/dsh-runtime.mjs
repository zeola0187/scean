import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {homedir,hostname} from 'node:os';

const defaultSdk=fileURLToPath(new URL('../.playable-sdk/node_modules/',import.meta.url));
function readSelectedProvider(profilePath){
  const script=`import yaml,json,sys\nfrom pathlib import Path\nd=yaml.safe_load(Path(sys.argv[1]).read_text(encoding='utf8'))\na=next(x['config'] for x in d if x.get('name')=='@deepseek-ai/dsh-agent-default-model')\np=next(x['config'] for x in d if x.get('name')=='@deepseek-ai/dsh-llm-pi-ai')\nprint(json.dumps({'selection':a,'providers':{a['provider']:p['providers'][a['provider']]}}))`;
  try{return JSON.parse(execFileSync('python',['-c',script,profilePath],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));}
  catch{throw Object.assign(Error('DSH_MODEL_CONFIGURATION_UNAVAILABLE'),{code:'DSH_MODEL_CONFIGURATION_UNAVAILABLE'});}
}
export async function createReadOnlyDshRuntime({sdkRoot=defaultSdk,profilePath=join(homedir(),'.dsh','profiles','desktop','cordis.patch.yml')}={}) {
  if(hostname().toUpperCase()!==(process.env.SCEAN_PRIMARY_MACHINE??'').toUpperCase())throw Object.assign(Error('PRIMARY_MACHINE_REQUIRED'),{code:'PRIMARY_MACHINE_REQUIRED'});
  const load=async name=>import(pathToFileURL(resolve(sdkRoot,'@deepseek-ai',name,'lib','index.js')).href);
  const [{Context},{default:LlmRuntime},{default:AgentDefaultModel},pi,{default:LocalCredentials}]=await Promise.all(['cordis','dsh-llm','dsh-agent-default-model','dsh-llm-pi-ai','dsh-credentials-local'].map(load));
  class ReadOnlyCredentials extends LocalCredentials {
    async migrateFlatDocument(){throw Error('CREDENTIAL_MIGRATION_FORBIDDEN');}
    async set(){throw Error('CREDENTIAL_WRITE_FORBIDDEN');}
    async unset(){throw Error('CREDENTIAL_WRITE_FORBIDDEN');}
    async modifyRecord(){throw Error('CREDENTIAL_WRITE_FORBIDDEN');}
  }
  const raw=readSelectedProvider(profilePath);
  const route=raw.providers[raw.selection.provider];
  if(!route||Object.keys(route).some(k=>/^(apiKey|headers|credential|token)$/i.test(k)))throw Object.assign(Error('INLINE_CREDENTIAL_CONFIGURATION_REFUSED'),{code:'INLINE_CREDENTIAL_CONFIGURATION_REFUSED'});
  const ctx=new Context();
  try{
    await ctx.plugin(ReadOnlyCredentials,{watch:false});await ctx.plugin(LlmRuntime);
    await ctx.plugin(AgentDefaultModel,raw.selection);await ctx.plugin(pi,{providers:raw.providers});
    const selection=ctx.agentDefaultModel.currentSelection();
    const info=await ctx.llm.resolveModelInfo(selection.provider,selection.model);
    const available=(await ctx.credentials.describe(route.apiKeyEnv)).configured===true;
    if(!available)throw Object.assign(Error('DSH_EXISTING_CREDENTIAL_UNAVAILABLE'),{code:'DSH_EXISTING_CREDENTIAL_UNAVAILABLE'});
    return {ctx,llm:ctx.llm,agentDefaultModel:ctx.agentDefaultModel,selection,info,
      source:'DSH 0.2.0-rc.2 AgentDefaultModel + LlmRuntime + PiAiAdapter (read-only isolated composition)',
      selectionRefresh:'restart isolated environment after changing Desktop selection',
      close:()=>ctx.fiber.dispose()};
  }catch(error){await ctx.fiber.dispose();throw error;}
}
