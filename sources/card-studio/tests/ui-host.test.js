import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { UploadBuffer,UPLOAD_CHUNK } from '../cardstudio-bundle/lib/upload-buffer.js';
import { CardService } from '../cardstudio-bundle/lib/card-service.js';
import { decodeCard,pngChunk } from '../cardstudio-bundle/lib/codec.js';
import * as plugin from '../cardstudio-bundle/index.js';
import { nativeHost } from './helpers/current-host.js';

const synthetic=()=>({spec:'chara_card_v2',spec_version:'2.0',opaque:null,data:{name:'{{not_a_prompt_variable}}',description:'SYNTHETIC',personality:'',scenario:'',first_mes:'SYNTHETIC',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{opaque:{retain:null}},character_book:{scan_depth:null,extensions:{keep:'yes'},entries:[{id:9,keys:['place'],content:'SYNTHETIC {{char}}',enabled:true,insertion_order:0,extensions:{retain:null},opaque:'keep'}]}}});
const bytes=()=>Buffer.from(JSON.stringify(synthetic()));
async function isolated(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-ui-host-'));try{await fn(root);}finally{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('cardstudio-ui-host-'));await fs.rm(root,{recursive:true,force:true});}}
async function upload(service,source,name,type='card',session='synthetic-A'){
 const call=async(action,args)=>{const r=await service.operation(action,args,undefined,{sessionId:session});assert(r.ok,JSON.stringify(r));return r.value;};
 const row=await call('upload_begin',{name,size:source.length,type});
 for(let offset=0;offset<source.length;offset+=UPLOAD_CHUNK)await call('upload_chunk',{upload_id:row.upload_id,offset,base64:source.subarray(offset,offset+UPLOAD_CHUNK).toString('base64')});
 return call('upload_finish',{upload_id:row.upload_id});
}
test('bounded uploads reject traversal, malformed chunks, wrong Session/order, overrun and expiry; full-sized chunks decode without recursion',()=>{
 let now=0;const buffer=new UploadBuffer({now:()=>now}),args={name:'synthetic.json',size:UPLOAD_CHUNK,type:'card'};
 for(const name of ['../card.json','C:\\card.json','x.exe','x\0.json'])assert.throws(()=>buffer.begin('A',{...args,name}));
 assert.throws(()=>buffer.begin('A',{...args,size:33*1024*1024}));
 const row=buffer.begin('A',args),id=row.upload_id;
 assert.throws(()=>buffer.append('B',{upload_id:id,offset:0,base64:'eA=='}));
 assert.throws(()=>buffer.append('A',{upload_id:id,offset:1,base64:'eA=='}));
 for(const base64 of ['%%%%','eA','eA===','eB=='])assert.throws(()=>buffer.append('A',{upload_id:id,offset:0,base64}));
 assert.throws(()=>buffer.finish('A',id));
 const full=Buffer.alloc(UPLOAD_CHUNK,7);buffer.append('A',{upload_id:id,offset:0,base64:full.toString('base64')});
 assert.throws(()=>buffer.append('A',{upload_id:id,offset:UPLOAD_CHUNK,base64:'eA=='}));assert.deepEqual(buffer.finish('A',id).bytes,full);
 const expired=buffer.begin('A',{...args,size:1});now=120001;assert.throws(()=>buffer.finish('A',expired.upload_id));assert.equal(buffer.rows.size,0);
});
test('drag imports preserve JSON/PNG bytes and unknown metadata, associate only current Session, then support stable-ID local edits',()=>isolated(async root=>{
 const service=new CardService(root);await service.init();
 try{const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('tEXt',Buffer.from('chara\0'+bytes().toString('base64'))),pngChunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),pngChunk('vpAg',Buffer.from('opaque')),pngChunk('IEND',Buffer.alloc(0))]);
 for(const [source,name] of [[bytes(),'Synthetic.json'],[png,'Synthetic.png']]){
  const session='synthetic-import-'+name,d=await upload(service,source,name,'card',session),read=await service.read(d.id);assert.deepEqual(read.card,synthetic());assert.deepEqual(read.entryIds,['id:9']);
  assert.deepEqual(await service.selectedDocument(session),{document_id:d.id,type:'card'});assert.equal((await service.documents('synthetic-B')).total,0);
  assert.equal((await service.operation('upload_begin',{name,size:source.length,type:'card'},undefined,{sessionId:session})).error.code,'SESSION_CARD_BOUND');
  const imports=await service.listImports();assert.deepEqual(await fs.readFile(path.join(root,imports.find(file=>file.endsWith(name)))),source);
  await service.book(d.id,'patch',{entry_id:'id:9',expected_revision:0,changes:{content:'SYNTHETIC edited'}});const edited=await service.read(d.id);assert.equal(edited.card.data.character_book.scan_depth,null);assert.equal(edited.card.data.character_book.entries[0].opaque,'keep');assert.deepEqual(edited.entryIds,read.entryIds);
  if(name.endsWith('.png')){const exported=await service.export(d.id,1,'synthetic-edited.png',undefined,session);const after=decodeCard(await fs.readFile(path.join(root,exported.path))),before=decodeCard(png);assert.deepEqual(after.chunks.filter(c=>!c.text).map(c=>c.raw),before.chunks.filter(c=>!c.text).map(c=>c.raw));}
 }
 }finally{await service.close();assert.equal(service.uploads.rows.size,0);}
}));
test('cancelled or malformed upload writes no imports; ST worldbook import and local aliases preserve uid and opaque null',()=>isolated(async root=>{
 const service=new CardService(root);await service.init();try{
 const row=service.uploads.begin('synthetic-A',{name:'bad.json',size:1,type:'card'});service.uploads.append('synthetic-A',{upload_id:row.upload_id,offset:0,base64:'eA=='});
 const r=await service.operation('upload_finish',{upload_id:row.upload_id},undefined,{sessionId:'synthetic-A'});assert.equal(r.ok,false);assert.deepEqual(await service.listImports(),[]);
 const aborted=service.uploads.begin('synthetic-A',{name:'cancel.json',size:1,type:'card'});service.uploads.abort('synthetic-A',aborted.upload_id);assert.deepEqual(await service.listImports(),[]);
 const book={opaque:null,entries:{'7':{uid:7,key:['x'],content:'SYNTHETIC',disable:false,order:0,extensions:{retain:null},unknown:null}}};const d=await upload(service,Buffer.from(JSON.stringify(book)),'book.json','worldbook');
 await service.book(d.id,'patch',{entry_id:'uid:7',expected_revision:0,changes:{keys:['new'],enabled:false,content:'SYNTHETIC edited'}});const e=(await service.book(d.id,'read',{entry_id:'uid:7'})).entry;assert.equal(e.uid,7);assert.deepEqual(e.key,['new']);assert.equal(e.disable,true);assert.equal(e.unknown,null);assert.deepEqual(e.extensions,{retain:null});assert(!('keys'in e));
 }finally{await service.close();}
}));
test('native DSH prompt assembly receives only fixed Session ID/type; refuses switches, restores, isolates and disposes without inference',()=>isolated(async root=>{
 const old=process.env.DSH_HOME;process.env.DSH_HOME=root;const host=await nativeHost(root,plugin);
 try{const workspace=host.registry.list()[0],a=host.agent('synthetic-A',workspace.path),b=host.agent('synthetic-B',workspace.path),c=host.agent('synthetic-C',workspace.path);
 const claimA=(await host.request(a,{action:'acquire',page_id:'synthetic-page-a'})).value,claimB=(await host.request(b,{action:'acquire',page_id:'synthetic-page-b'})).value;
 const context=async agent=>(await host.ctx.systemPrompt.assemble({scope:agent})).contexts.find(x=>x.name==='cardstudio-selection')?.text;
 assert.match(await context(a),/no working copy/);await fs.writeFile(path.join(workspace.path,'imports/synthetic.json'),bytes());
 const d=await host.request(a,{action:'import',claim:claimA,args:{path:'imports/synthetic.json',type:'card'}});assert(d.ok,JSON.stringify(d));
 assert((await context(a)).includes(d.value.id));assert(!(await context(a)).includes('not_a_prompt_variable'));assert.match(await context(b),/no working copy/);
 const refused=await host.request(a,{action:'import',claim:claimA,args:{path:'imports/synthetic.json',type:'card'}});assert.equal(refused.error.code,'SESSION_CARD_BOUND');
 const claimC=(await host.request(c,{action:'acquire',page_id:'synthetic-page-c'})).value,second=await host.request(c,{action:'import',claim:claimC,args:{path:'imports/synthetic.json',type:'card'}});assert(second.ok);assert((await context(c)).includes(second.value.id));assert(!(await context(c)).includes(d.value.id));
 assert.equal((await host.request(a,{action:'open',claim:claimA,args:{document_id:second.value.id}})).error.code,'SESSION_CARD_BOUND');
 const shared=await host.request(b,{action:'open',claim:claimB,args:{document_id:d.value.id}});assert(shared.ok);assert((await context(b)).includes(d.value.id));assert((await context(a)).includes(d.value.id));assert(!(await context(a)).includes(second.value.id));
 await host.request(a,{action:'release',claim:claimA});assert.equal(await context(a),undefined);
 const restored=await host.request(a,{action:'acquire',page_id:'synthetic-page-restored'});assert(restored.ok);assert((await context(a)).includes(d.value.id));assert.equal(host.ctx.tools.schemas(a).length,29);
 }finally{await host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;}
}));
