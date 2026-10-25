import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { decodeCard,encodeCard,pngChunk,canonical } from '../cardstudio-bundle/lib/codec.js';
import { CardService } from '../cardstudio-bundle/lib/card-service.js';
import { syntheticCard,syntheticPng,metadataChunk,signature } from './helpers/png-fixtures.js';
import { readPngWithUpstream } from './helpers/sillytavern-oracle.js';
import { nativeHost } from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';
import { UPLOAD_CHUNK } from '../cardstudio-bundle/lib/upload-buffer.js';

const upstream=bytes=>JSON.parse(readPngWithUpstream(bytes));
function preserved(before,after,index){assert.equal(after.chunks.length,before.chunks.length);for(let i=0;i<before.chunks.length;i++)if(i!==index)assert.deepEqual(after.chunks[i].raw,before.chunks[i].raw,`Unselected chunk ${i}`);assert.deepEqual(after.trailer,before.trailer);}
async function isolated(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-png-compat-')),service=new CardService(root);await service.init();try{await run(service);}finally{await service.close();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('cardstudio-png-compat-'));await fs.rm(root,{recursive:true,force:true});}}

test('different and identical duplicate chara use first upstream version; only selected chunk changes',()=>{
 for(const different of [false,true]){const first=syntheticCard(),second=structuredClone(first);if(different){second.data.first_mes='SECOND VERSION';second.data.extensions.secondaryOnly=true;}
  const source=syntheticPng([metadataChunk('chara',first),metadataChunk('chara',second)]),before=decodeCard(source);assert.deepEqual(before.card,upstream(source));assert.equal(before.primaryIndex,1);assert.equal(before.warnings.some(w=>w.code==='PNG_ALTERNATE_METADATA'),different);
  const changed=structuredClone(before.card);changed.data.first_mes='LOCAL EDIT';const bytes=encodeCard(before,changed),after=decodeCard(bytes);assert.deepEqual(upstream(bytes),changed);assert.deepEqual(after.card,changed);preserved(before,after,1);
 }
});
test('first ccv3 tEXt wins over chara, later ccv3 and compressed metadata, with case-insensitive keys',()=>{
 const a=syntheticCard(),b=syntheticCard(3),c=syntheticCard(3);a.data.first_mes='CHARA';b.data.first_mes='FIRST V3';c.data.first_mes='SECOND V3';
 const bytes=syntheticPng([metadataChunk('ccv3',c,{type:'zTXt'}),metadataChunk('CHARA',a),metadataChunk('CCV3',b),metadataChunk('ccv3',c)]),before=decodeCard(bytes);assert.equal(before.primaryIndex,3);assert.deepEqual(before.card,upstream(bytes));const next=structuredClone(before.card);next.data.personality='Edited';const output=encodeCard(before,next);preserved(before,decodeCard(output),3);assert.deepEqual(upstream(output),next);
});
test('invalid inactive metadata is retained with a warning; invalid selected metadata never falls through',()=>{
 const good=syntheticCard(),bad=Buffer.from('not base64!'),bytes=syntheticPng([metadataChunk('chara',good),metadataChunk('chara',null,{payload:bad})]),before=decodeCard(bytes);assert.equal(before.card.data.name,good.data.name);assert(before.warnings.some(w=>w.code==='PNG_ALTERNATE_METADATA'));assert.equal(before.pngMetadata.invalidSecondaryCount,1);const next=structuredClone(before.card);next.data.name='Edited';preserved(before,decodeCard(encodeCard(before,next)),1);
 assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',null,{payload:bad}),metadataChunk('chara',good)])),e=>e.code==='PNG');
 assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',good),metadataChunk('ccv3',null,{payload:bad})])),e=>e.code==='PNG');
 const invalidBook=syntheticCard();invalidBook.data.character_book={entries:{}};assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',invalidBook)])),e=>e.code==='BOOK');
});
test('CRC failures on inactive chunks, invalid PNG lengths and decoded metadata limits remain enforced',()=>{
 const good=syntheticCard(),chunk=metadataChunk('chara',good),bad=Buffer.from(chunk);bad[bad.length-1]^=1;assert.throws(()=>decodeCard(syntheticPng([chunk,bad])),e=>e.code==='PNG_CRC');
 const bytes=syntheticPng([chunk]),broken=Buffer.from(bytes);broken.writeUInt32BE(0x7fffffff,8);assert.throws(()=>decodeCard(broken),e=>e.code==='PNG');
 assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',null,{type:'zTXt',payload:Buffer.alloc(12*1024*1024+1,65)})])));
 assert.throws(()=>decodeCard(Buffer.alloc(32*1024*1024+1)),e=>e.code==='LIMIT');
});
test('multi-megabyte metadata does not exhaust RegExp stack; malformed base64 remains rejected',()=>{
 const card=syntheticCard();card.data.description='x'.repeat(4*1024*1024);
 for(const type of ['tEXt','zTXt','iTXt']){const source=syntheticPng([metadataChunk('chara',card,{type})]);assert.equal(decodeCard(source).card.data.description.length,card.data.description.length);}
 for(const payload of [Buffer.from('eA'),Buffer.from('eA==='),Buffer.from('eB=='),Buffer.from('eA==\n'),Buffer.from([0xe5,0x41,0x3d,0x3d])])assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',null,{payload})])),e=>e.code==='PNG');
});
test('compressed metadata accepts the exact existing 12 MiB output boundary and rejects one byte beyond it',()=>{
 const card=syntheticCard(),json=Buffer.from(JSON.stringify(card)),decodedLimit=9*1024*1024,body=Buffer.alloc(decodedLimit,32);json.copy(body);
 const payload=Buffer.from(body.toString('base64'));assert.equal(payload.length,12*1024*1024);
 const source=syntheticPng([metadataChunk('chara',null,{type:'zTXt',payload})]);assert.deepEqual(decodeCard(source).card,card);
 assert.throws(()=>decodeCard(syntheticPng([metadataChunk('chara',null,{type:'zTXt',payload:Buffer.concat([payload,Buffer.from('A')])})])),e=>e.code==='ERR_BUFFER_TOO_LARGE');
});
test('null worldbook survives imports, card edits, PNG/JSON exports and exact-byte rollback; upsert explicitly creates a book',()=>isolated(async service=>{
 const first=syntheticCard(),second=syntheticCard();first.data.character_book=null;delete second.data.character_book;second.data.creator='Secondary';const original=syntheticPng([metadataChunk('chara',first),metadataChunk('chara',second)]);
 await fs.writeFile(path.join(service.root,'imports/synthetic.png'),original);const doc=await service.import('imports/synthetic.png','card');assert.equal((await service.read(doc.id)).card.data.character_book,null);assert.deepEqual((await service.book(doc.id,'list',{})).entries,[]);
 await service.patchText(doc.id,0,'first_mes','Original','Edited');const current=await service.read(doc.id);assert.equal(current.card.data.character_book,null);assert.deepEqual(current.entryIds,[]);
 const png=await service.export(doc.id,1,'edited.png',undefined,'S'),json=await service.export(doc.id,1,'edited.json',undefined,'S'),pngBytes=await fs.readFile(path.join(service.root,png.path)),jsonCard=JSON.parse(await fs.readFile(path.join(service.root,json.path),'utf8'));
 assert.deepEqual(upstream(pngBytes),jsonCard);assert.deepEqual(jsonCard,current.card);preserved(decodeCard(original),decodeCard(pngBytes),1);
 await service.book(doc.id,'upsert',{expected_revision:1,entry:{keys:[],content:'Explicit new entry',enabled:true,insertion_order:0,extensions:{}}});assert.equal((await service.read(doc.id)).entryIds.length,1);
 await service.rollback(doc.id,2,0);const rolled=await service.load(doc.id);assert.deepEqual(Buffer.from(rolled.record.bytes,'base64'),original);assert.equal(rolled.decoded.card.data.character_book,null);assert.deepEqual(rolled.record.entryIds,[]);assert.deepEqual(await fs.readFile(path.join(service.root,'imports/synthetic.png')),original);
}));
test('present worldbook IDs, omitted metadata and image bytes survive local entry edits and PNG/JSON export',()=>isolated(async service=>{
 const first=syntheticCard(3),second=syntheticCard();second.data.first_mes='Secondary';const source=syntheticPng([metadataChunk('chara',second),metadataChunk('ccv3',first)]);await fs.writeFile(path.join(service.root,'imports/synthetic.png'),source);const d=await service.import('imports/synthetic.png','card');
 await service.book(d.id,'patch',{expected_revision:0,entry_id:'id:7',changes:{content:'Edited book text'}});const current=await service.read(d.id);assert.deepEqual(current.entryIds,['id:7']);assert.deepEqual(current.card.data.extensions,first.data.extensions);assert.deepEqual(current.card.data.character_book.entries[0].extensions,{opaque:null});
 const output=await service.export(d.id,1,'result.png',undefined,'S'),bytes=await fs.readFile(path.join(service.root,output.path));assert.deepEqual(upstream(bytes),current.card);preserved(decodeCard(source),decodeCard(bytes),2);
 const json=await service.export(d.id,1,'result.json',undefined,'S');assert.equal(canonical(JSON.parse(await fs.readFile(path.join(service.root,json.path),'utf8'))),canonical(current.card));
}));

test('native Host bridge transfers multi-chunk binary PNG and retains duplicate metadata through edit/export without inference',()=>isolated(async service=>{
 const previous=process.env.DSH_HOME;process.env.DSH_HOME=path.join(service.root,'Synthetic Host');const host=await nativeHost(process.env.DSH_HOME,plugin);
 try{
  const workspace=host.registry.list()[0],agent=host.agent('png-upload-session',workspace.path),claim=(await host.request(agent,{action:'acquire',page_id:'png-upload-page'})).value;
  const call=async(action,args={})=>{const result=await host.request(agent,{action,claim,args});assert(result.ok,JSON.stringify(result));return result.value;};
  const first=syntheticCard(),second=syntheticCard();second.data.creator_notes='Distinct inactive version';const binary=Buffer.alloc(600000);for(let i=0;i<binary.length;i++)binary[i]=i%256;
  const bytes=syntheticPng([metadataChunk('chara',first),pngChunk('vpAg',binary),metadataChunk('chara',second)]),begin=await call('upload_begin',{name:'synthetic.png',size:bytes.length,type:'card'});let parts=0;
  for(let offset=0;offset<bytes.length;offset+=UPLOAD_CHUNK){await call('upload_chunk',{upload_id:begin.upload_id,offset,base64:bytes.subarray(offset,offset+UPLOAD_CHUNK).toString('base64')});parts++;}
  assert(parts>=3);const doc=await call('upload_finish',{upload_id:begin.upload_id}),initial=await call('read',{document_id:doc.id});assert.deepEqual(initial.card,first);assert(initial.compatibilityWarnings.some(w=>w.code==='PNG_ALTERNATE_METADATA'));
  await call('patch_text',{document_id:doc.id,expected_revision:0,field:'first_mes',old_text:'Original',new_text:'Edited'});const saved=await call('export',{document_id:doc.id,expected_revision:1,name:'synthetic.png'}),output=await fs.readFile(path.join(workspace.path,saved.path));preserved(decodeCard(bytes),decodeCard(output),1);assert.equal(upstream(output).data.first_mes,'Edited {{char}}');assert.equal(host.ctx.tools.schemas(agent).length,28);
 }finally{await host.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;}
}));
