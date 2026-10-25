// Private standalone regression driver for the already shipped SCEAN namespace.
// The pinned public helper remains unchanged; all real Host authority checks run.
import {nativeHost as portableHost} from './portable-host.js';
export async function nativeHost(...args){
 const host=await portableHost(...args);
 const bridge=host.ctx.get('cardstudioSceanBridge');
 if(!bridge){await host.close();throw Error('Current SCEAN native bridge did not activate');}
 host.request=(agent,request)=>bridge.request(agent,request,new AbortController().signal);
 return host;
}
