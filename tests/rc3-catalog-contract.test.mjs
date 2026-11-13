import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as wait} from 'node:timers/promises';
import {ModelListingCache,parseModelListing,resolveListedCatalog,resolveAdapterOptions,refuseListedModel,requestModelListing} from '@deepseek-ai/dsh-llm-deepseek';import {APP_IDENTITY} from '@deepseek-ai/dsh-llm';
const settings={url:'https://synthetic.invalid/models',timeoutMs:50,maxAgeMs:10};
const parsed=id=>parseModelListing({data:[{id,api_capabilities:{anthropic_messages:{}}}]});
test('RC3 real listing cache: missing credential never performs discovery; one bounded initial lookup per credential and endpoint',async()=>{
 let key,loads=0,now=0;const seen=[];const cache=new ModelListingCache({credential:async()=>key,load:async(url,credential)=>{loads++;seen.push({url,credential});return parsed('deepseek-flash');},now:()=>now,info(){},warn(){}});
 try{assert.equal((await cache.view(settings)).authenticated,false);assert.equal(loads,0);key='SYNTHETIC_A';await Promise.all([cache.view(settings),cache.view(settings)]);assert.equal(loads,1);key='SYNTHETIC_B';await cache.view(settings);assert.equal(loads,2);await cache.view({...settings,url:'https://other.invalid/models'});assert.equal(loads,3);assert.equal(seen[1].credential,'SYNTHETIC_B');}finally{cache.dispose();}
});
test('RC3 real listing cache: expired refresh retains last good and ignores obsolete credential result',async()=>{
 let key='SYNTHETIC_A',now=0,release;let count=0;const cache=new ModelListingCache({credential:async()=>key,load:async()=>{count++;if(count===2)return new Promise(r=>release=r);return parsed(count===1?'deepseek-flash':'deepseek-pro');},now:()=>now,info(){},warn(){}});
 try{await cache.view(settings);now=20;const old=await cache.view(settings);assert.equal(old.listing.entries[0].id,'deepseek-flash');key='SYNTHETIC_B';const next=await cache.view(settings);assert.equal(next.listing.entries[0].id,'deepseek-pro');release(parsed('obsolete'));await wait(1);assert.equal(cache.current().listing.entries[0].id,'deepseek-pro');}finally{cache.dispose();}
});
for(const kind of ['upgrade','unsupported'])test('RC3 actual catalog produces precise '+kind+' refusal before any model dispatch',()=>{
 const row={id:'deepseek-flash',api_capabilities:{anthropic_messages:{}}};if(kind==='upgrade')row.client_requirements={[APP_IDENTITY.product]:{min_version:'99.0.0'}};else row.api_capabilities={unknown_protocol:{}};
 const catalog=resolveListedCatalog({listing:parseModelListing({data:[row]}).entries,supported:resolveAdapterOptions({}).models,overrides:{},clientVersion:'0.2.1-rc.3'});assert.equal(catalog.offered.length,0);assert.throws(()=>refuseListedModel(row.id,catalog.refusals.get(row.id)),{code:kind==='upgrade'?'CLIENT_UPGRADE_REQUIRED':'MODEL_UNSUPPORTED'});
});
for(const status of [401,404,429,503])test('RC3 real discovery HTTP decoder preserves HTTP_'+status+' with synthetic in-process transport',async()=>{
 const old=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;return new Response('synthetic',{status});};try{await assert.rejects(requestModelListing(settings.url,{'x-api-key':'SYNTHETIC_ONLY'},new AbortController().signal),{code:'HTTP_'+status});assert.equal(requests,1);}finally{globalThis.fetch=old;}
});
test('RC3 malformed and empty listings fail explicitly; unknown capabilities stay unsupported',()=>{assert.throws(()=>parseModelListing({data:[]}),{code:'INVALID_RESPONSE'});assert.throws(()=>parseModelListing({wrong:[]}),{code:'INVALID_RESPONSE'});const c=resolveListedCatalog({listing:parsed('never-known').entries,supported:resolveAdapterOptions({}).models,overrides:{},clientVersion:'0.2.1-rc.3'});assert.equal(c.offered.length,0);assert.equal(c.refusals.get('never-known').kind,'unsupported');});
