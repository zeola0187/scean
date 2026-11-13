import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { CardService, contained } from '../cardstudio-bundle/lib/card-service.js';
import { WorkspaceLoader } from '../cardstudio-bundle/lib/loader.js';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';
import { decodeCard, encodeCard, pngChunk, strictJson, canonical, sha } from '../cardstudio-bundle/lib/codec.js';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Commands from '@deepseek-ai/dsh-commands';
import Typert from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { deriveEventMessage } from '@deepseek-ai/dsh-session';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as plugin from '../cardstudio-bundle/index.js';
import { convertBookWithUpstream, normalizeCardWithUpstream } from './helpers/sillytavern-oracle.js';
import { legacyTextFields } from '../cardstudio-bundle/lib/tavern-compatibility.js';

const workspace=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const root=path.join(workspace,'test-run-'+randomUUID());await fs.mkdir(root);
after(async()=>{const final=path.resolve(root);assert.equal(path.dirname(final),workspace);assert.match(path.basename(final),/^test-run-[a-f0-9-]+$/);await fs.rm(final,{recursive:true,force:true});});
const fixtures=path.join(root,'cards');await fs.mkdir(fixtures);
let counter=0;
// Unit fixtures supply an explicit synthetic Session; production identity comes from WorkspaceLoader.
async function service(options){const folder=path.join(fixtures,String(counter++));await fs.mkdir(folder);const s=new CardService(folder,options);await s.init();const run=s.export.bind(s);s.export=(id,revision,name,signal,sessionId='synthetic-unit-session')=>run(id,revision,name,signal,sessionId);return s;}
function card(v=2){return {spec:`chara_card_v${v}`,spec_version:v===2?'2.0':'3.0',unknownRoot:{retained:'opaque',number:1.2345},data:{name:'Synthetic {{char}}',description:'原始 {{user}} <script src="https://example.invalid/mvu.js"></script>',personality:'Given traits',scenario:'Scenario',first_mes:'Hello {{user}}',mes_example:'<START>\n{{char}}: Hello',creator_notes:'Synthetic only',system_prompt:'',post_history_instructions:'',alternate_greetings:['Alternate {{user}}'],tags:['synthetic'],creator:'test',character_version:'1',extensions:{regex:{find:'(a+)',replacement:'$1'},privateUnknown:{keep:true}},character_book:{name:'Book',scan_depth:2,token_budget:1024,recursive_scanning:false,extensions:{unknownBook:'preserve'},entries:[{id:7,keys:[],content:'Known {{char}} facts',enabled:true,insertion_order:10,constant:true,extensions:{unknownEntry:9},unknownEntryRoot:{keep:'yes'}},{keys:['place'],content:'Location',enabled:true,insertion_order:20,extensions:{}}]},...(v===3?{assets:[{type:'icon',uri:'embeded://unknown.asset',name:'main',ext:'png'}],nickname:'v3 retained',group_only_greetings:[],creation_date:1,modification_date:2}: {})}};}
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
function text(type,key,value){const b64=Buffer.from(JSON.stringify(value)).toString('base64');return pngChunk(type, type==='zTXt'?Buffer.concat([Buffer.from(key+'\0\0'),deflateSync(Buffer.from(b64))]):type==='iTXt'?Buffer.concat([Buffer.from(key+'\0\0\0\0\0'),Buffer.from(b64)]):Buffer.from(key+'\0'+b64));}
function png(primary=card(3),fallback=card(2),types=['tEXt','tEXt']){
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 return Buffer.concat([sig,pngChunk('IHDR',header),pngChunk('vpAg',Buffer.from('opaque asset')),text(types[0],'chara',fallback),pngChunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),text(types[1],'ccv3',primary),pngChunk('tEXt',Buffer.from('unknown\0do not touch')),pngChunk('IEND',Buffer.alloc(0)),Buffer.from('opaque-trailer')]);
}
async function imported(s,bytes,type='card'){await fs.writeFile(path.join(s.root,'imports','source.'+(bytes.subarray(0,8).equals(sig)?'png':'json')),bytes);return s.import('imports/source.'+(bytes.subarray(0,8).equals(sig)?'png':'json'),type);}
const bytes=c=>Buffer.from(JSON.stringify(c));

function mixedIdCard(version=3) {
 const c=card(version);c.data.character_book.entries=['alpha','1','2','3'].map((id,i)=>({id,keys:[],content:'Synthetic original '+i,enabled:i!==2,constant:true,insertion_order:10+i,position:'after_char',extensions:{position:i===1?4:1,depth:4,opaque:{keep:i}}}));return c;
}
test('pinned SillyTavern converter reproduces typed ID overwrite; new allocator keeps every old/new entry in JSON and PNG',async()=>{
 const lost=mixedIdCard();for(const id of [0,1,2])lost.data.character_book.entries.push({id,keys:['synthetic'],content:'Synthetic addition '+id,enabled:true,insertion_order:20,extensions:{}});
 assert.equal(lost.data.character_book.entries.length,7);assert.equal(Object.keys(convertBookWithUpstream(lost.data.character_book).entries).length,5);
 for(const format of ['json','png']){
  const c=mixedIdCard(),source=format==='json'?bytes(c):png(c,c),s=await service(),d=await imported(s,source),ids=(await s.read(d.id)).entryIds;
  for(let i=0;i<3;i++)await s.book(d.id,'upsert',{expected_revision:i,entry:{keys:['new'],content:'Synthetic addition '+i,enabled:true,insertion_order:20+i,extensions:{opaque:{new:i}}}});
  const edited=await s.read(d.id);assert.deepEqual(edited.card.data.character_book.entries.slice(0,4),c.data.character_book.entries);assert.deepEqual(edited.entryIds.slice(0,4),ids);
  assert.deepEqual(edited.card.data.character_book.entries.slice(4).map(e=>e.id),[4,5,6]);
  const saved=await s.export(d.id,3,'roundtrip.'+format);const exported=await fs.readFile(path.join(s.root,saved.path)),again=decodeCard(exported),converted=convertBookWithUpstream(again.card.data.character_book);
  assert.equal(Object.keys(converted.entries).length,7);
  for(const e of again.card.data.character_book.entries){const out=converted.entries[String(e.id)];assert.equal(out.content,e.content);assert.equal(out.disable,!e.enabled);assert.equal(out.order,e.insertion_order);assert.equal(out.position,e.extensions.position??1);assert.equal(JSON.stringify(out.extensions),JSON.stringify(e.extensions));}
  const round=await imported(await service(),exported);assert.equal(round.entryCount,7);
  assert.deepEqual(await fs.readFile(path.join(s.root,'imports/source.'+format)),source);
  if(format==='png'){const original=decodeCard(source);assert.deepEqual(again.chunks.filter(c=>!c.text).map(c=>c.raw),original.chunks.filter(c=>!c.text).map(c=>c.raw));assert.deepEqual(again.trailer,original.trailer);}
 }
});

test('explicit, implicit-index and prototype ID collisions are refused before new revision/export without renumbering inputs',async()=>{
 const s=await service(),d=await imported(s,bytes(mixedIdCard()));
 await assert.rejects(()=>s.book(d.id,'upsert',{expected_revision:0,entry:{id:1,keys:[],content:'New',enabled:true,insertion_order:0,extensions:{}}}),e=>e.code==='ST_COMPATIBILITY');assert.equal((await s.read(d.id)).revision,0);
 for(const type of ['mixed','implicit','prototype']){
  const c=card(3),es=c.data.character_book.entries;
  if(type==='mixed'){es[0].id='1';es[1].id=1;}
  if(type==='implicit'){es[0].id=1;delete es[1].id;}
  if(type==='prototype')es[0].id='__proto__';
  const t=await service(),original=bytes(c),r=await imported(t,original);assert(r.compatibilityWarnings.some(w=>w.exportBlocked));
  await assert.rejects(()=>t.export(r.id,0,'blocked.json'),e=>e.code==='ST_COMPATIBILITY');assert.deepEqual(await fs.readdir(path.join(t.root,'exports')),[]);
  assert.equal((await t.read(r.id)).revision,0);assert.deepEqual(await fs.readFile(path.join(t.root,'imports/source.json')),original);
 }
});

test('implicit indices are reserved when allocating IDs and rechecked after deletion; whole-book patch cannot bypass entry tools',async()=>{
 const c=card(3);c.data.character_book.entries[0].id=5;delete c.data.character_book.entries[1].id;
 const s=await service(),d=await imported(s,bytes(c));await s.book(d.id,'upsert',{expected_revision:0,entry:{keys:[],content:'New',enabled:true,insertion_order:0,extensions:{}}});
 assert.equal((await s.read(d.id)).card.data.character_book.entries[2].id,2);
 await s.book(d.id,'upsert',{expected_revision:1,entry:{id:0,keys:[],content:'Explicit id',enabled:true,insertion_order:0,extensions:{}}});
 await assert.rejects(()=>s.book(d.id,'delete',{expected_revision:2,entry_id:'id:5'}),e=>e.code==='ST_COMPATIBILITY');assert.equal((await s.read(d.id)).revision,2);
 await assert.rejects(()=>s.patch(d.id,2,[{op:'replace',path:'/data/character_book',value:{entries:[],extensions:{}}}]),e=>e.code==='ENTRY_TOOL');assert.equal((await s.read(d.id)).card.data.character_book.entries.length,4);
});

test('standalone CC lorebooks use the same collision-safe allocator and export check; ST dictionaries retain uid',async()=>{
 for(const envelope of [false,true]){
  const book=mixedIdCard().data.character_book,s=await service(),source=envelope?{spec:'lorebook_v3',data:book,opaque:9}:book,d=await imported(s,bytes(source),'worldbook');
  await s.book(d.id,'upsert',{expected_revision:0,entry:{keys:[],content:'New',enabled:true,insertion_order:1,extensions:{}}});const saved=await s.export(d.id,1,'book.json');
  const output=JSON.parse(await fs.readFile(path.join(s.root,saved.path),'utf8')),converted=convertBookWithUpstream(envelope?output.data:output);assert.equal(Object.keys(converted.entries).length,5);if(envelope)assert.equal(output.opaque,9);
 }
});

test('data is authoritative on import/read; future edits mirror only touched existing V1 aliases in a new revision',async()=>{
 for(const format of ['json','png']){
  const c=card(3);for(const field of legacyTextFields)c[field]='Synthetic stale '+field;c.tags=['opaque root tags'];c.unknownRoot={keep:1};
  const fallback=structuredClone(c);fallback.spec='chara_card_v2';fallback.spec_version='2.0';fallback.unknownRoot={fallbackOnly:true};
  const original=format==='json'?bytes(c):png(c,fallback),s=await service(),d=await imported(s,original);const initial=await s.read(d.id);
  assert.equal(initial.card.data.description,c.data.description);assert.equal(initial.card.description,c.description);assert(initial.compatibilityWarnings.some(w=>w.code==='LEGACY_ALIAS_DIFFERS'));
  const unchanged=await s.export(d.id,0,'original.'+format);assert.deepEqual(await fs.readFile(path.join(s.root,unchanged.path)),original);
  await s.patch(d.id,0,legacyTextFields.map(field=>({op:'replace',path:'/data/'+field,value:'Synthetic edited '+field})));
  const updated=await s.read(d.id);for(const field of legacyTextFields)assert.equal(updated.card[field],updated.card.data[field]);assert.deepEqual(updated.card.tags,c.tags);assert.deepEqual(updated.card.unknownRoot,c.unknownRoot);
  const edited=await s.export(d.id,1,'updated.'+format);const out=decodeCard(await fs.readFile(path.join(s.root,edited.path)));
  for(const field of legacyTextFields)assert.equal(normalizeCardWithUpstream(out.card)[field],updated.card.data[field]);
  if(format==='png'){for(const field of legacyTextFields)assert.equal(out.card[field],out.card.data[field]);assert.deepEqual(out.chunks[2].raw,decodeCard(original).chunks[2].raw);}
  assert.deepEqual((await s.load(d.id,0)).decoded.card,c);assert.deepEqual((await s.read(d.id)).card,out.card);
  await s.rollback(d.id,1,0);assert.deepEqual((await s.read(d.id)).card,c);
 }
});

test('legacy mirror does not add missing aliases, overwrite non-string roots, or normalize untouched stale text',async()=>{
 const c=card();c.description={unknown:'keep'};c.scenario='Old scenario';const s=await service(),d=await imported(s,bytes(c));await s.patchText(d.id,0,'first_mes','Hello','Edited');const out=(await s.read(d.id)).card;
 assert(!Object.hasOwn(out,'first_mes'));assert.deepEqual(out.description,c.description);assert.equal(out.scenario,c.scenario);assert.deepEqual(out.data.extensions,c.data.extensions);
});

test('SillyTavern export rejects compressed-only PNG metadata without converting or deleting anything',async()=>{
 const original=png(card(3),card(2),['zTXt','iTXt']),s=await service(),d=await imported(s,original);
 await assert.rejects(()=>s.export(d.id,0,'unsupported.png'),e=>e.code==='ST_PNG_ENCODING');assert.deepEqual(await fs.readdir(path.join(s.root,'exports')),[]);assert.deepEqual(await fs.readFile(path.join(s.root,'imports/source.png')),original);
});

test('optional null book settings survive JSON/dual PNG import, local edits and export without interpretation',async()=>{
 for(const format of ['json','png']){
  const v2=card(2),v3=card(3);for(const c of [v2,v3])Object.assign(c.data.character_book,{scan_depth:null,token_budget:null,recursive_scanning:null});
  const original=format==='png'?png(v3,v2):bytes(v3),s=await service(),d=await imported(s,original);
  assert.equal(d.compatibilityWarnings.filter(w=>w.code==='PRESERVED_NULL_BOOK_SETTING').length,3);
  const untouched=await s.export(d.id,0,'untouched.'+format);assert.deepEqual(await fs.readFile(path.join(s.root,untouched.path)),original);
  await s.patchText(d.id,0,'first_mes','Hello','Edited');
  await s.book(d.id,'patch_config',{expected_revision:1,changes:{scan_depth:null,token_budget:null,recursive_scanning:null,extensions:{added:true}}});
  const saved=await s.export(d.id,2,'edited.'+format),decoded=decodeCard(await fs.readFile(path.join(s.root,saved.path)));
  for(const key of ['scan_depth','token_budget','recursive_scanning'])assert.equal(decoded.card.data.character_book[key],null);
  assert.equal(decoded.card.data.first_mes,'Edited {{user}}');assert.deepEqual(decoded.card.data.extensions,v3.data.extensions);assert.deepEqual(decoded.card.unknownRoot,v3.unknownRoot);
  if(format==='png'){const before=decodeCard(original);assert.deepEqual(decoded.chunks.filter(c=>!c.text).map(c=>c.raw),before.chunks.filter(c=>!c.text).map(c=>c.raw));assert.deepEqual(decoded.trailer,before.trailer);assert.deepEqual(decoded.chunks[2].raw,before.chunks[2].raw);}
  assert.deepEqual(await fs.readFile(path.join(s.root,'imports/source.'+format)),original);
  await s.book(d.id,'patch_config',{expected_revision:2,changes:{scan_depth:3,token_budget:512,recursive_scanning:false}});
  await s.rollback(d.id,3,0);assert.equal((await s.read(d.id)).card.data.character_book.scan_depth,null);assert.equal((await s.read(d.id)).revision,4);
 }
});

test('null compatibility is limited to three optional settings; invalid values and newly authored nulls are rejected',async()=>{
 for(const key of ['scan_depth','token_budget'])for(const value of [-1,1.5,'2',false,[],{}]){const c=card();c.data.character_book[key]=value;assert.throws(()=>decodeCard(bytes(c)),e=>e.code==='BOOK_CONFIG');}
 for(const value of [0,1,'false',[],{}]){const c=card();c.data.character_book.recursive_scanning=value;assert.throws(()=>decodeCard(bytes(c)),e=>e.code==='BOOK_CONFIG');}
 for(const key of ['scan_depth','token_budget','recursive_scanning']){const s=await service(),d=await imported(s,bytes(card()));await assert.rejects(()=>s.book(d.id,'patch_config',{expected_revision:0,changes:{[key]:null}}),e=>e.code==='BOOK_CONFIG');assert.equal((await s.read(d.id)).revision,0);}
 const c=card();c.data.character_book.entries[0].keys=null;assert.throws(()=>decodeCard(bytes(c)),e=>e.code==='ENTRY');
});


test('strict JSON rejects duplicate keys and precision loss; preserves exact safe numbers',()=>{
 assert.throws(()=>strictJson('{"a":1,"a":2}'),e=>e.code==='DUPLICATE_KEY');assert.throws(()=>strictJson('{"a":9007199254740993}'),e=>e.code==='NUMBER_PRECISION');assert.equal(strictJson('{"a":1.2345}').a,1.2345);
});
test('JSON local patch preserves unknown roots, metadata, macros, regex and scripts; source untouched',async()=>{
 const s=await service(),original=bytes(card()),d=await imported(s,original);const r=await s.patchText(d.id,0,'first_mes','Hello','Greetings');assert.equal(r.revision,1);
 const c=(await s.read(d.id)).card;assert.deepEqual(c.unknownRoot,card().unknownRoot);assert.deepEqual(c.data.extensions,card().data.extensions);assert.equal(c.data.description,card().data.description);assert.equal(c.data.first_mes,'Greetings {{user}}');assert.deepEqual(await fs.readFile(path.join(s.root,'imports/source.json')),original);
});
test('dual PNG updates only the Tavern primary and preserves fallback/image/unknown chunks and trailer bytes',()=>{
 const input=png(),doc=decodeCard(input),next=structuredClone(doc.card);next.data.first_mes='Changed {{char}}';const out=encodeCard(doc,next),again=decodeCard(out);
 assert.deepEqual(again.chunks[2].raw,doc.chunks[2].raw);assert.equal(again.card.data.first_mes,next.data.first_mes);assert.deepEqual(again.card.data.assets,doc.card.data.assets);
 assert.deepEqual(again.chunks.filter(c=>!c.text).map(c=>c.raw),doc.chunks.filter(c=>!c.text).map(c=>c.raw));assert.deepEqual(again.trailer,doc.trailer);assert.deepEqual(again.card.unknownRoot,doc.card.unknownRoot);
});
test('zTXt and iTXt card metadata survive local edits',()=>{const doc=decodeCard(png(card(3),card(2),['zTXt','iTXt']));const next=structuredClone(doc.card);next.data.personality='Adjusted';assert.equal(decodeCard(encodeCard(doc,next)).card.data.personality,'Adjusted');});
test('different or duplicate metadata follows Tavern primary while corrupt CRC still fails',()=>{
 const fallback=card(2);fallback.data.first_mes='Conflict';const conflict=decodeCard(png(card(3),fallback));assert.equal(conflict.card.data.first_mes,card(3).data.first_mes);assert(conflict.warnings.some(w=>w.code==='PNG_ALTERNATE_METADATA'));
 const input=png(),doc=decodeCard(input),duplicate=Buffer.concat([sig,...doc.chunks.slice(0,-1).map(c=>c.raw),text('tEXt','chara',card(2)),doc.chunks.at(-1).raw]);assert.equal(decodeCard(duplicate).card.spec,'chara_card_v3');assert.equal(decodeCard(duplicate).pngMetadata.secondaryCount,2);
 const corrupt=Buffer.from(input);corrupt[20]^=1;assert.throws(()=>decodeCard(corrupt),e=>e.code==='PNG_CRC');
});
test('single CCv2 and CCv3 PNG chunks remain in original version',()=>{
 for(const version of [2,3]){const c=card(version),key=version===2?'chara':'ccv3',header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;const source=Buffer.concat([sig,pngChunk('IHDR',header),text('tEXt',key,c),pngChunk('IDAT',deflateSync(Buffer.from([0,0,0,0,0]))),pngChunk('IEND',Buffer.alloc(0))]);const doc=decodeCard(source),next=structuredClone(doc.card);next.data.name='New';assert.equal(decodeCard(encodeCard(doc,next)).card.spec,c.spec);}
});
test('duplicate entry ids and invalid config are refused without revision advancement',async()=>{
 const s=await service(),d=await imported(s,bytes(card()));await assert.rejects(()=>s.book(d.id,'upsert',{expected_revision:0,entry:{id:7,keys:[],content:'duplicate',enabled:true,insertion_order:0,extensions:{}}}),e=>e.code==='DUPLICATE_ID');
 await assert.rejects(()=>s.book(d.id,'patch_config',{expected_revision:0,changes:{token_budget:-1}}),e=>e.code==='BOOK_CONFIG');assert.equal((await s.read(d.id)).revision,0);
});
test('worldbook stable IDs survive patch/upsert/delete/reopen; unknown fields and extensions retained',async()=>{
 const s=await service(),d=await imported(s,bytes(card()));const start=await s.book(d.id,'list',{}),stable=start.entries[1].entry_id;
 await s.book(d.id,'patch',{expected_revision:0,entry_id:stable,changes:{content:'Updated',extensions:{added:1}}});
 await s.book(d.id,'upsert',{expected_revision:1,entry_id:'id:7',entry:{content:'Merged',extensions:{new:2}}});
 const e=(await s.book(d.id,'read',{entry_id:'id:7'})).entry;assert.equal(e.unknownEntryRoot.keep,'yes');assert.deepEqual(e.extensions,{unknownEntry:9,new:2});assert.equal((await s.book(d.id,'read',{entry_id:stable})).entry.content,'Updated');
 await s.book(d.id,'upsert',{expected_revision:2,entry:{keys:['new'],content:'New',enabled:true,insertion_order:0,extensions:{}}});
 await s.book(d.id,'delete',{expected_revision:3,entry_id:'id:7'});const reopened=new CardService(s.root);await reopened.init();assert.equal((await reopened.book(d.id,'read',{entry_id:stable})).entry.content,'Updated');assert.equal((await reopened.book(d.id,'list',{})).entries.length,2);
});
test('worldbook config merge and declared reference validation retain unknown settings',async()=>{
 const s=await service(),d=await imported(s,bytes(card()));await s.book(d.id,'patch_config',{expected_revision:0,changes:{token_budget:2048,extensions:{newSetting:true}}});
 assert.deepEqual((await s.book(d.id,'config',{})).config.extensions,{unknownBook:'preserve',newSetting:true});
 await assert.rejects(()=>s.book(d.id,'patch',{expected_revision:1,entry_id:'id:7',changes:{content:'test'},references:[{source_entry_id:'id:7',target_entry_id:'missing'}]}),e=>e.code==='REFERENCE');assert.equal((await s.read(d.id)).revision,1);
 const ids=(await s.book(d.id,'list',{})).entries.map(e=>e.entry_id);await assert.rejects(()=>s.book(d.id,'delete',{expected_revision:1,entry_id:'id:7',references:[{source_entry_id:ids[1],target_entry_id:'id:7'}]}),e=>e.code==='ENTRY_REFERENCED');
});
test('nested unknown metadata survives entry and config merge',async()=>{
 const s=await service(),c=card();c.data.character_book.entries[0].extensions.nested={known:1,opaque:{keep:9}};c.data.character_book.extensions.nested={known:1,opaque:9};const d=await imported(s,bytes(c));
 await s.book(d.id,'patch',{expected_revision:0,entry_id:'id:7',changes:{extensions:{nested:{known:2}}}});await s.book(d.id,'patch_config',{expected_revision:1,changes:{extensions:{nested:{known:2}}}});const r=await s.read(d.id);assert.deepEqual(r.card.data.character_book.entries[0].extensions.nested,{known:2,opaque:{keep:9}});assert.deepEqual(r.card.data.character_book.extensions.nested,{known:2,opaque:9});
});
test('standalone CC worldbook preserves root metadata during local changes',async()=>{
 const s=await service(),book={...card().data.character_book,unknownRoot:'retain'},d=await imported(s,bytes(book),'worldbook');await s.book(d.id,'patch',{expected_revision:0,entry_id:'id:7',changes:{content:'Worldbook edit'}});assert.equal((await s.read(d.id)).card.data.character_book.unknownRoot,'retain');
});
test('standalone SillyTavern dictionary worldbook preserves uid, fields and original container format',async()=>{
 const s=await service(),book={name:'ST synthetic',unknownRoot:{retain:true},entries:{'3':{uid:3,key:[],keysecondary:['secondary'],content:'Given facts',disable:false,order:10,constant:true,position:4,unknownEntry:{keep:true},extensions:{opaque:1}}}},d=await imported(s,bytes(book),'worldbook');
 assert.equal((await s.book(d.id,'list',{})).entries[0].entry_id,'uid:3');await s.book(d.id,'patch',{expected_revision:0,entry_id:'uid:3',changes:{content:'Changed',enabled:false,extensions:{added:2}}});
 await s.book(d.id,'upsert',{expected_revision:1,entry:{keys:['new'],content:'New',enabled:true,insertion_order:20,extensions:{}}});const r=await s.read(d.id),entries=r.card.data.character_book.entries;assert(!Array.isArray(entries));assert.deepEqual(entries['3'].unknownEntry,{keep:true});assert.deepEqual(entries['3'].extensions,{opaque:1,added:2});assert.equal(entries['3'].position,4);assert.equal(entries['3'].disable,true);assert.deepEqual(r.card.data.character_book.unknownRoot,book.unknownRoot);
 await assert.rejects(()=>s.book(d.id,'upsert',{expected_revision:2,entry:{uid:3,key:[],content:'duplicate',disable:false,order:0}}),e=>e.code==='DUPLICATE_ID');await s.book(d.id,'delete',{expected_revision:2,entry_id:'uid:3'});assert(!Object.hasOwn((await s.read(d.id)).card.data.character_book.entries,'3'));
});
test('CCv3 string entry IDs and lorebook_v3 envelope are preserved without conversion',async()=>{
 const s=await service(),c=card(3);c.data.character_book.entries[0].id='entry-七';const d=await imported(s,bytes(c));await s.book(d.id,'patch',{expected_revision:0,entry_id:'id-string:entry-七',changes:{content:'Changed'}});assert.equal((await s.read(d.id)).card.data.character_book.entries[0].id,'entry-七');
 const t=await service(),envelope={spec:'lorebook_v3',unknownEnvelope:{retain:true},data:c.data.character_book},w=await imported(t,bytes(envelope),'worldbook');await t.book(w.id,'patch',{expected_revision:0,entry_id:'id-string:entry-七',changes:{content:'Envelope edit'}});const saved=await t.export(w.id,1,'worldbook.json');const exported=JSON.parse(await fs.readFile(path.join(t.root,saved.path),'utf8'));assert.equal(exported.spec,'lorebook_v3');assert.deepEqual(exported.unknownEnvelope,{retain:true});assert.equal(exported.data.entries[0].content,'Envelope edit');
});
test('path traversal, absolute paths, ADS and external junction are refused',async()=>{
 const s=await service();for(const p of ['../private.json','imports/../../private.json','C:\\private.json','imports/source.json:stream'])await assert.rejects(()=>contained(s.root,p),e=>e.code==='PATH');
 const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'file.json'),bytes(card()));const link=path.join(s.root,'imports','external');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>contained(s.root,'imports/external/file.json',{existing:true}),e=>e.code==='PATH');await fs.unlink(link);
});
test('interruption before commit leaves previous revision, no temp/snapshot; rollback creates a new revision',async()=>{
 const controller=new AbortController(),s=await service({beforeCommit:()=>controller.abort(new DOMException('Synthetic interruption','AbortError'))}),d=await imported(s,bytes(card()));
 await assert.rejects(()=>s.patchText(d.id,0,'first_mes','Hello','Change',controller.signal));assert.equal((await s.read(d.id)).revision,0);assert.deepEqual((await fs.readdir(path.join(s.root,'.cardstudio-scean/documents',d.id))).sort(),['0.json','current.json']);
 s.beforeCommit=null;await s.patchText(d.id,0,'first_mes','Hello','Changed');const diff=await s.compare(d.id,0,1);assert.equal(diff.changes.length,1);await s.rollback(d.id,1,0);assert.equal((await s.read(d.id)).revision,2);assert.equal((await s.read(d.id)).card.data.first_mes,'Hello {{user}}');
});
test('same-revision concurrent edits serialize; stale edit returns conflict; export refuses overwrite',async()=>{
 const s=await service(),d=await imported(s,bytes(card()));const r=await Promise.allSettled([s.patchText(d.id,0,'first_mes','Hello','A'),s.patchText(d.id,0,'first_mes','Hello','B')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'REVISION_CONFLICT');
 const saved=await s.export(d.id,1,'synthetic.json');assert.equal(sha(await fs.readFile(path.join(s.root,saved.path))),saved.sha256);await assert.rejects(()=>s.export(d.id,1,'synthetic.json'),e=>e.code==='EEXIST');
});

function agent(id,cwd){return {id,session:{header:{cwd}},status:'idle',cancel(){this.cancelled=true;},async whenIdle(){}};}
async function loaderFixture(factory){
 const directory=path.join(root,'loader-'+randomUUID());await fs.mkdir(directory);const a=agent('a',directory),b=agent('b',directory),other=agent('other',root),agents=new Map([['a',a],['b',b],['other',other]]),visible=new Set();let now=0,created=0,closed=0;
 const loader=new WorkspaceLoader({root:directory,agentLookup:id=>agents.get(id),skills:[{name:'test-skill',description:'Test'}],now:()=>now,leaseMs:100,serviceFactory:()=>{created++;const s=factory?.()??{async init(){},async operation(){return {ok:true,value:'ok'};},async close(){closed++;}};return s;},activateAddon:async r=>{visible.add(r.agent.id);return {async dispose(){visible.delete(r.agent.id);}};}});await loader.init();
 return {loader,a,b,other,agents,visible,advance:x=>now+=x,created:()=>created,closed:()=>closed};
}
test('Card -> Other -> Card changes visibility and generations; stale tool closure and RPC rejected',async()=>{
 const f=await loaderFixture(),claim=await f.loader.acquire(f.a,'page-card-001');const r=f.loader.records.get('a');assert(f.visible.has('a'));
 await assert.rejects(()=>f.loader.acquire(f.other,'page-other-001'),e=>e.code==='WORKSPACE');assert.equal((await f.loader.call(f.other,r,null,'read',{})).ok,false);
 await f.loader.release(f.a,claim);assert(!f.visible.has('a'));assert.equal((await f.loader.call(f.a,r,null,'read',{})).ok,false);
 const next=await f.loader.acquire(f.a,'page-card-001');assert.notEqual(next.agent_generation,claim.agent_generation);assert.notEqual(next.workspace_generation,claim.workspace_generation);await assert.rejects(()=>f.loader.renew(f.a,claim),e=>e.code==='STALE_LEASE');assert(f.visible.has('a'));await f.loader.close();assert.equal(f.closed(),2);
});
test('two pages and two sessions retain workspace service until the last page leaves',async()=>{
 const f=await loaderFixture(),one=await f.loader.acquire(f.a,'page-one-001'),two=await f.loader.acquire(f.a,'page-two-001'),three=await f.loader.acquire(f.b,'page-three-001');assert.equal(f.created(),1);
 await f.loader.release(f.a,one);assert(f.visible.has('a'));await f.loader.release(f.a,two);assert(!f.visible.has('a'));assert(f.visible.has('b'));assert.equal(f.closed(),0);await f.loader.release(f.b,three);assert.equal(f.closed(),1);await f.loader.close();
});
test('late RPC is aborted/drained on release and cannot return as current state',async()=>{
 let start;const entered=new Promise(r=>start=r);const f=await loaderFixture(()=>({async init(){},async operation(action,args,signal){start();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {ok:true,value:'late'};},async close(){}}));
 const claim=await f.loader.acquire(f.a,'page-late-001'),r=f.loader.records.get('a'),job=f.loader.call(f.a,r,claim,'read',{});await entered;await f.loader.release(f.a,claim);const result=await job;assert.equal(result.ok,false);assert(!f.visible.size);assert.equal(f.loader.workspace,null);await f.loader.close();
});
test('renewed page acquisition invalidates late old release and cancels its operations',async()=>{
 const f=await loaderFixture(),old=await f.loader.acquire(f.a,'page-same-001'),next=await f.loader.acquire(f.a,'page-same-001');assert.notEqual(old.lease_id,next.lease_id);await assert.rejects(()=>f.loader.release(f.a,old),e=>e.code==='STALE_LEASE');assert(f.visible.has('a'));await f.loader.release(f.a,next);await f.loader.close();
});
test('owner object identity, canonical cwd and expired leases are checked at dispatch',async()=>{
 const f=await loaderFixture(),claim=await f.loader.acquire(f.a,'page-owner-001'),r=f.loader.records.get('a');f.agents.set('a',agent('a',f.a.session.header.cwd));assert.equal((await f.loader.call(f.a,r,null,'read',{})).ok,false);f.agents.set('a',f.a);
 const cwd=f.a.session.header.cwd;f.a.session.header.cwd=root;assert.equal((await f.loader.call(f.a,r,claim,'read',{})).ok,false);f.a.session.header.cwd=cwd;
 f.advance(101);assert.equal((await f.loader.call(f.a,r,null,'read',{})).ok,false);await f.loader.sweep();assert(!f.visible.size);await f.loader.close();
});
test('client lifetime discards late callbacks and releases late acquire; does not cross sessions',async()=>{
 let resolveAcquire;const deferred=new Promise(r=>resolveAcquire=r),events=[],requests=[];
 const client=new WorkspaceClient({root:'C:\\Synthetic\\Card Studio',pageId:'test-page-001',send:async(id,r)=>{requests.push({id,...r});if(r.action==='acquire')return deferred;return {ok:true,value:{skills:[],tools:[]}};},show:()=>events.push('show'),hide:()=>events.push('hide'),notify:()=>{},setTimer:()=>1,clearTimer:()=>{}});
 const opening=client.transition({id:'card-session',cwd:'C:\\Synthetic\\Card Studio'});await client.transition({id:'other-session',cwd:'E:\\Other'});resolveAcquire({ok:true,value:{lease_id:'old'}});await opening;assert(!events.includes('show'));assert(requests.some(r=>r.action==='release'&&r.id==='card-session'));await client.close();
});
test('actual DSH 0.2.0-rc.2 Cordis tools/skills: native discovery, full skill body, dispatch refusal and cleanup',async()=>{
 const directory=path.join(root,'actual-runtime');await fs.mkdir(path.join(directory,'.cardstudio-scean'),{recursive:true});await fs.writeFile(path.join(directory,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Synthetic Card Studio'}));await fs.cp(path.join(workspace,'cardstudio-bundle/skills'),path.join(directory,'.cardstudio-scean/skills'),{recursive:true});
 const ctx=new Context();ctx.provide('workspaceRegistry',{});await ctx.plugin(Typert);await ctx.plugin(SystemPrompt);await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(Skills);
 const agents=new Map();ctx.provide('agents',{get:id=>agents.get(id)});await ctx.plugin(Commands);
 const a=agent('native-card',directory),b=agent('native-other',root);a.ctx=createScope(ctx,a).ctx;b.ctx=createScope(ctx,b).ctx;agents.set(a.id,a);agents.set(b.id,b);
 const fiber=ctx.plugin(plugin,{projectRoot:directory});await fiber;
 const events=[];a.session.append=(type,data)=>{events.push({type,data});return events.length;};b.session.append=a.session.append;
 const invoke=async(agent,request)=>JSON.parse((await ctx.commands.execute(agent,'/cardstudio '+JSON.stringify(request),[],new AbortController().signal)).result.text);
 assert(!ctx.tools.get('card_read',a));assert.equal((await ctx.skills.list({cwd:directory,scope:a})).length,0);
 const claim=(await invoke(a,{action:'acquire',page_id:'native-page-001'})).value;
 const schemas=ctx.tools.schemas(a);assert(schemas.some(t=>t.name==='card_read'));assert(!ctx.tools.get('card_read',b));
 const catalog=await ctx.skills.list({cwd:directory,scope:a});assert.equal(catalog.length,9);assert.equal((await ctx.skills.list({cwd:root,scope:b})).length,0);
 const method=await ctx.skills.get('character-authoring',{cwd:directory,scope:a});assert(method.content.includes('七個**思考階段**'));assert.equal(await ctx.skills.get('palette-personality-reconstruction',{cwd:directory,scope:a}),undefined);assert.equal(method.resourceBase.path,path.join(directory,'.cardstudio-scean/skills/character-authoring'));
 await fs.writeFile(path.join(directory,'imports/native.json'),bytes(card()));const imported=await invoke(a,{action:'import',claim,args:{path:'imports/native.json',type:'card'}});assert(imported.ok);
 const tool=ctx.tools.get('card_read',a),value=await tool.execute({document_id:imported.value.id,fields:['name']},{agent:a,signal:new AbortController().signal});assert(value.ok);assert.deepEqual(Object.keys(value.value.card.data),['name']);
 const throughRuntime=await ctx.tools.execute({agent:a,name:'card_read',arguments:{document_id:imported.value.id,fields:['name']},callId:'synthetic-call',signal:new AbortController().signal});assert.equal(throughRuntime.isError,false);
 const badArgs=await ctx.tools.execute({agent:a,name:'card_read',arguments:{document_id:imported.value.id,fields:'invalid'},callId:'invalid-call',signal:new AbortController().signal});assert(badArgs.isError);
 const rpc=await invoke(a,{action:'read',claim,args:{document_id:imported.value.id,fields:['name']}});assert.deepEqual(rpc,value);
 await invoke(a,{action:'release',claim});assert(!ctx.tools.get('card_read',a));assert.equal((await ctx.skills.list({cwd:directory,scope:a})).length,0);assert.equal((await tool.execute({document_id:imported.value.id},{agent:a,signal:new AbortController().signal})).ok,false);
 const refusal=await ctx.tools.execute({agent:a,name:'card_read',arguments:{document_id:imported.value.id},callId:'stale-call',signal:new AbortController().signal});assert(refusal.isError);
 const status=JSON.parse(await fs.readFile(path.join(directory,'.cardstudio-scean/runtime-status.json'),'utf8'));assert.equal(status.host,'ready');assert.equal(status.skillCount,8);assert.equal(status.toolCount,26);
 await fiber.dispose();assert.equal(JSON.parse(await fs.readFile(path.join(directory,'.cardstudio-scean/runtime-status.json'),'utf8')).host,'inactive');assert(!ctx.commands.find(a,'cardstudio'));assert(events.some(e=>e.type==='command/run'));assert(events.some(e=>e.type==='command/done'));assert(events.filter(e=>e.type==='command/run').every(e=>e.data.args===undefined));await ctx.fiber.dispose();
});

test('native Host RPC renews idle leases without command/session/model events; boundaries and disposal remain enforced',async()=>{
 const directory=path.join(root,'native-rpc');await fs.mkdir(path.join(directory,'.cardstudio-scean'),{recursive:true});await fs.writeFile(path.join(directory,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test',title:'Synthetic Card Studio'}));await fs.cp(path.join(workspace,'cardstudio-bundle/skills'),path.join(directory,'.cardstudio-scean/skills'),{recursive:true});
 const ctx=new Context(),events=[];ctx.provide('workspaceRegistry',{});await ctx.plugin(Typert);await ctx.plugin(SystemPrompt);await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(Skills);
 const agents=new Map();ctx.provide('agents',{get:id=>agents.get(id)});await ctx.plugin(Commands);
 const a=agent('rpc-card',directory),other=agent('rpc-other',root);
 for(const row of [a,other]){row.ctx=createScope(ctx,row).ctx;row.session.append=(type,data)=>{events.push({type,data});return events.length;};row.prompt=()=>assert.fail('No model request is authorized');agents.set(row.id,row);}
 ctx.typert.lookups.register('agent',{parameter:'agent',wire:'agentId',hostTypeSymbol:'@deepseek-ai/dsh-agent#Agent',wireTypeSymbol:'@deepseek-ai/dsh-session/types#SessionId',resolve:id=>agents.get(id)});
 const gateway=new TypertGatewayService(ctx,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 const invoke=(request,agentId=a.id)=>gateway.invokeRpc('cardstudio/request',{args:{agentId,request}},new AbortController().signal);
 const fiber=ctx.plugin(plugin,{projectRoot:directory});await fiber;
 try{
  const acquired=await invoke({action:'acquire',page_id:'native-rpc-page-001'});assert(acquired.ok,JSON.stringify(acquired));assert(acquired.value.ok,JSON.stringify(acquired));const claim=acquired.value.value;
  assert((await invoke({action:'capabilities',claim})).value.ok);
  for(let i=0;i<12;i++)assert((await invoke({action:'renew',claim})).value.value.active);
  assert.deepEqual(events,[]);assert(ctx.tools.get('card_read',a));
  await fs.writeFile(path.join(directory,'imports/export.json'),bytes(card()));const document=(await invoke({action:'import',claim,args:{path:'imports/export.json',type:'card'}})).value.value;
  const gui=(await invoke({action:'export',claim,args:{document_id:document.id,expected_revision:0,name:'gui.json',sessionId:'forged'}})).value;assert(gui.ok);
  const tool=await ctx.tools.get('cardstudio_scean_document',a).execute({action:'export',document_id:document.id,expected_revision:0,name:'tool.json',sessionId:'different-forgery'},{agent:a,signal:new AbortController().signal});assert(tool.ok);assert.equal(path.dirname(gui.value.path),path.dirname(tool.value.path));assert.equal(gui.value.path,'exports/Synthetic {{char}}/gui.json');
  assert.deepEqual(await fs.readFile(path.join(directory,gui.value.path)),await fs.readFile(path.join(directory,tool.value.path)));assert.deepEqual(events,[]);
  const guiWrite=(await invoke({action:'book_patch',claim,args:{document_id:document.id,expected_revision:0,entry_id:'id:7',changes:{enabled:false}}})).value;
  assert(guiWrite.ok);assert.equal(guiWrite.value.entry_id,'id:7');assert.deepEqual(guiWrite.value.changes,[{path:'/data/character_book/entries/0/enabled',op:'replace',entry_id:'id:7'}]);
  const patchTool=ctx.tools.get('lorebook_patch_entry',a),toolArgs={document_id:document.id,expected_revision:1,entry_id:'id:7',changes:{enabled:true}};
  const toolWrite=await patchTool.execute(toolArgs,{agent:a,signal:new AbortController().signal});assert(toolWrite.ok);assert.equal(toolWrite.value.revision,2);
  const rendered=patchTool.output.render(toolArgs,toolWrite);assert.deepEqual(JSON.parse(rendered[0].text),toolWrite);assert(Buffer.byteLength(rendered[0].text)<8192);
  const refreshed=(await invoke({action:'read',claim,args:{document_id:document.id}})).value.value;assert.equal(refreshed.revision,2);assert.equal(refreshed.card.data.character_book.entries[0].enabled,true);assert.deepEqual(events,[]);
  assert.equal((await invoke({action:'acquire',page_id:'native-other-page'},other.id)).value.error.code,'WORKSPACE');
  assert.equal((await invoke({action:'renew',claim:{...claim,lease_id:'stale'}})).value.error.code,'STALE_LEASE');
  assert.equal((await invoke([])).error.code,'gateway/input-invalid');assert.equal((await invoke({action:'renew'},'')).error.code,'gateway/input-invalid');
  const explicit=await ctx.commands.execute(a,'/cardstudio '+JSON.stringify({action:'renew',claim}),[],new AbortController().signal);assert.equal(explicit.result.kind,'success');
  assert.deepEqual(events.map(e=>e.type),['command/run','command/done']);assert.equal(events[0].data.args,undefined);assert.match(events[1].data.text,/"active":true/);
  assert(events.every(e=>deriveEventMessage(e)===null));const message={role:'user',content:[{type:'text',text:'Synthetic next turn'}]};assert.deepEqual(deriveEventMessage({type:'user/message',data:message}),message);
  events.length=0;assert((await invoke({action:'release',claim})).value.ok);assert(!ctx.tools.get('card_read',a));assert.equal((await invoke({action:'renew',claim})).value.error.code,'STALE_WORKSPACE');
  assert.deepEqual(events,[]);await fiber.dispose();assert.equal((await invoke({action:'renew',claim})).error.code,'gateway/definition-unavailable');
 }finally{await ctx.fiber.dispose();}
});

test('export folder identity survives rename/restart and isolates conversations and multiple working copies',async()=>{
 const s=await service(),c=card();c.data.name='Synthetic card';const original=bytes(c),d=await imported(s,original);
 await fs.writeFile(path.join(s.root,'exports/old-flat.json'),Buffer.from('existing file'));
 const first=await s.export(d.id,0,'first.json',undefined,'session-A');assert.equal(first.path,'exports/Synthetic card/first.json');
 const second=await s.export(d.id,0,'first.json',undefined,'session-B');assert.equal(second.path,'exports/Synthetic card (2)/first.json');
 await s.patch(d.id,0,[{op:'replace',path:'/data/name',value:'Renamed'}]);await s.close();
 const restarted=new CardService(s.root);await restarted.init();const again=await restarted.export(d.id,1,'second.json',undefined,'session-A');assert.equal(path.dirname(again.path),path.dirname(first.path));
 const next=await imported(restarted,original);const different=await restarted.export(next.id,0,'first.json',undefined,'session-A');assert.equal(different.path,'exports/Synthetic card (3)/first.json');
 await assert.rejects(()=>restarted.export(d.id,1,'first.json',undefined,'session-A'),e=>e.code==='EEXIST');
 assert.equal((await restarted.operation('export',{document_id:d.id,expected_revision:1,name:'spoof.json',sessionId:'session-A'})).error.code,'EXPORT_SESSION');
 assert.equal(await fs.readFile(path.join(s.root,'exports/old-flat.json'),'utf8'),'existing file');assert.deepEqual(await fs.readFile(path.join(s.root,first.path)),original);assert.equal((await restarted.load(d.id,0)).record.sha256,sha(original));await restarted.close();
});

test('export folder names handle Windows reserved/illegal/blank/long names and existing paths without traversal',async()=>{
 for(const [name,expected] of [['CON','_CON'],['nul.txt','_nul.txt'],['COM¹','_COM¹'],['LPT9.txt','_LPT9.txt'],['CONOUT$','_CONOUT$'],['  .. ','Unnamed card'],['','Unnamed card'],['../A\\B:<C>?*|"','.._A_B__C_____'],['卡片 名稱. ','卡片 名稱'],['x'.repeat(180),'x'.repeat(64)]]){
  const s=await service(),c=card();c.data.name=name;const d=await imported(s,bytes(c));const saved=await s.export(d.id,0,'out.json');assert.equal(saved.path,'exports/'+expected+'/out.json');assert.deepEqual(decodeCard(await fs.readFile(path.join(s.root,saved.path))).card,c);
 }
 const s=await service(),c=card();c.data.name='Taken';const d=await imported(s,bytes(c));await fs.mkdir(path.join(s.root,'exports/Taken'));await fs.writeFile(path.join(s.root,'exports/Taken (2)'),Buffer.from('file occupant'));
 const [a,b]=await Promise.all([s.export(d.id,0,'a.json',undefined,'session-A'),s.export(d.id,0,'b.json',undefined,'session-B')]);assert.equal(a.path,'exports/Taken (3)/a.json');assert.equal(b.path,'exports/Taken (4)/b.json');
 for(const name of ['../escape.json','sub/out.json','C:\\escape.json','CON.json','nul.json','COM1.json','out:ads.json'])await assert.rejects(()=>s.export(d.id,0,name),e=>e.code==='EXPORT_NAME');
});

test('saved export binding cannot redirect through a junction, traversal or a missing folder',async()=>{
 const s=await service(),d=await imported(s,bytes(card())),saved=await s.export(d.id,0,'first.json');
 const directory=path.join(s.root,path.dirname(saved.path)),elsewhere=path.join(s.root,'elsewhere');await fs.mkdir(elsewhere);await fs.rename(directory,directory+'-backup');
 await assert.rejects(()=>s.export(d.id,0,'missing.json'),e=>e.code==='EXPORT_FOLDER');
 await fs.symlink(elsewhere,directory,'junction');await assert.rejects(()=>s.export(d.id,0,'redirect.json'),e=>e.code==='PATH');assert.deepEqual(await fs.readdir(elsewhere),[]);
 await fs.unlink(directory);await fs.rename(directory+'-backup',directory);
 const state=path.join(s.root,'.cardstudio-scean/export-folders'),binding=path.join(state,(await fs.readdir(state))[0]),row=JSON.parse(await fs.readFile(binding,'utf8'));row.directory='../elsewhere';await fs.writeFile(binding,JSON.stringify(row));
 await assert.rejects(()=>s.export(d.id,0,'traversal.json'),e=>e.code==='EXPORT_FOLDER');assert.deepEqual(await fs.readdir(elsewhere),[]);
});
