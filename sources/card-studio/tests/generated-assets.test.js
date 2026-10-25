import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AuthoringCardService } from '../cardstudio-bundle/lib/authoring-service.js';
import { observeGeneratedAssets } from '../cardstudio-bundle/lib/generated-assets.js';
import { syntheticPng } from './helpers/synthetic-assets.js';
import { validateRaster } from '../cardstudio-bundle/lib/asset-raster.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { nativeHost } from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';

test('armed admitted Agnes image auto imports and links once; ignores other sessions, tool text, paths and failed results',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-generated-')),service=new AuthoringCardService(root);await service.init();await service.synchronizeArchiveState([]);t.after(async()=>{await service.close();assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});});
  const agent={id:'session-a'},record={controller:new AbortController(),jobs:new Set()},handlers={},bytes=syntheticPng(),meta=validateRaster(bytes),ref={attachmentId:'sha256:'+meta.sha256,mediaType:meta.mediaType,bytes:meta.bytes,width:meta.width,height:meta.height};let reads=0;
  const loader={workspace:{service},records:new Map([[agent.id,record]]),validate:async(a,r)=>{assert.equal(a,agent);assert.equal(r,record);}};
  observeGeneratedAssets({on:(name,fn)=>handlers[name]=fn,get:name=>name==='attachments'?{readImage:async(r)=>{reads++;assert.deepEqual(r,ref);return {ref:r,data:bytes};}}:undefined,effect:()=>{}},loader);
  const op=async(action,args)=>{const r=await service.operation(action,args,undefined,{sessionId:agent.id});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};const c=await op('create',{name:'合成圖片測試'});await op('visual_contract',{action:'create',document_id:c.id,expected_revision:0,contract:{characters:{clerk:{}}}});
  const arm=()=>op('asset',{action:'arm_generated',document_id:c.id,expected_revision:1,character_id:'clerk',expression:'happy'});await arm();
  const result={isError:false,value:{attachment:ref},content:[{type:'image',attachment:ref}]};
  const foreign={name:'generate_image',callId:'foreign',agent:{id:'session-b'}};await handlers['tools/execute'](foreign,()=>{});await handlers['tools/result'](foreign,result);assert.equal(reads,0);
  const exec={name:'generate_image',callId:'generated-1',agent};await handlers['tools/execute'](exec,()=>{});await handlers['tools/result'](exec,result);
  const receipt=await op('asset',{action:'generated_status'});assert.equal(receipt.ok,true);const state=await service.state(c.id);assert.equal(state.record.revision,2);assert.equal(state.authoring.assetManifest.assets[0].provenance.kind,'agnes-admitted-attachment');assert.equal(state.authoring.contract.characters.clerk.variants[0].assetId,receipt.asset_id);
  await handlers['tools/result'](exec,result);assert.equal(reads,1);
  await op('asset',{action:'arm_generated',document_id:c.id,expected_revision:2,character_id:'clerk',expression:'neutral'});const bad={...exec,callId:'bad'};await handlers['tools/execute'](bad,()=>{});await handlers['tools/result'](bad,{isError:false,value:{url:'file:///private.png',text:JSON.stringify(ref)},content:[]});assert.equal((await op('asset',{action:'generated_status'})).ok,false);assert.equal(reads,1);assert.equal((await service.state(c.id)).record.revision,2);
});

test('actual installed DSH tools/execute and tools/result dispatch deliver a synthetic attachment through the plugin',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-generated-native-')),old=process.env.DSH_HOME;process.env.DSH_HOME=root;let host;
  try{
    host=await nativeHost(root,plugin);const bytes=syntheticPng(),meta=validateRaster(bytes),ref={attachmentId:'sha256:'+meta.sha256,mediaType:meta.mediaType,bytes:meta.bytes,width:meta.width,height:meta.height};
    await host.ctx.plugin({name:'synthetic-image-only',inject:['tools'],apply(ctx){ctx.provide('attachments',{readImage:async()=>({ref,data:bytes})});ctx.tools.register(defineTool({name:'generate_image',description:'Synthetic image fixture; no network.',parameters:{},output:{schema:{type:'json'},render:(_args,value)=>[{type:'image',attachment:value.attachment}]},execute:async()=>({attachment:ref})}));}});
    const agent=host.agent('synthetic-native-image',host.registry.list()[0].path),claim=(await host.request(agent,{action:'acquire',page_id:'synthetic-image-page'})).value;
    const call=async(action,args)=>{const r=await host.request(agent,{action,args,claim});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const card=await call('create',{name:'Synthetic native admitted attachment'});await call('visual_contract',{action:'create',document_id:card.id,expected_revision:0,contract:{characters:{clerk:{}}}});
    await call('asset',{action:'arm_generated',document_id:card.id,expected_revision:1,character_id:'clerk',expression:'neutral'});
    const generated=await host.ctx.tools.execute({agent,name:'generate_image',arguments:{},callId:'synthetic-native-image-call',signal:new AbortController().signal});assert.equal(generated.isError,false,JSON.stringify(generated));
    const result=await call('asset',{action:'generated_status'});assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.asset_id,/^asset_/);
    assert.equal((await call('asset',{action:'list',document_id:card.id})).assets.length,1);
  }finally{await host?.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
