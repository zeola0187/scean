import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deflateSync } from 'node:zlib';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { SessionController } from '@deepseek-ai/dsh-api-session-controller';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';
import { LibraryCardService } from '../cardstudio-bundle/lib/library-service.js';
import { projectLibraryImage,libraryImageLimits } from '../cardstudio-bundle/lib/library-image.js';
import { pngChunk,decodeCard,sha } from '../cardstudio-bundle/lib/codec.js';
import { syntheticCard,metadataChunk } from './helpers/png-fixtures.js';
import * as plugin from '../cardstudio-bundle/index.js';
import { nativeHost } from './helpers/current-host.js';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function png({width=32,height=48,depth=8,interlace=0,extras=[],compressed,trailer=Buffer.alloc(0)}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=6;header[12]=interlace;
 const pixels=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;pixels.set([10,40,90,255],i);}
 return Buffer.concat([signature,pngChunk('IHDR',header),...extras,pngChunk('IDAT',compressed??deflateSync(pixels)),metadataChunk('ccv3',syntheticCard(3)),pngChunk('IEND',Buffer.alloc(0)),trailer]);
}
async function fixture(fn){const base=await fs.mkdtemp(path.join(os.tmpdir(),'CardStudio-Library-Usability-')),root=path.join(base,'MixedCase Workspace');await fs.mkdir(root);const service=new LibraryCardService(root);await service.init();try{await fn(service,root,base);}finally{await service.close();assert.equal(path.dirname(base),os.tmpdir());assert(path.basename(base).startsWith('CardStudio-Library-Usability-'));await fs.rm(base,{recursive:true,force:true});}}
const call=(s,a,args={})=>s.operation(a,args,undefined,{sessionId:'synthetic-usability-session'});
const id=row=>({item_id:row.item_id,source_sha256:row.source_sha256});
async function source(s,root,name='image.png',bytes=png()){await fs.writeFile(path.join(root,'library',name),bytes);await s.library.scan();return [...s.library.rows.values()].find(x=>x.relative_path===name);}

test('Library queries use an explicit index snapshot; reads still detect new bytes',()=>fixture(async(s,root)=>{
 const row=await source(s,root,'a.json',Buffer.from(JSON.stringify(syntheticCard(3)))),generation=s.library.generation;s.library.lastScan=1;
 await fs.writeFile(path.join(root,'library','new.json'),JSON.stringify({...syntheticCard(3),opaqueRoot:{keep:'new'}}));
 await s.library.list({});await s.library.search({query:'Original'});assert.equal(s.library.generation,generation);assert.equal(s.library.rows.size,1);
 await fs.writeFile(path.join(root,'library','a.json'),JSON.stringify(syntheticCard(2)));assert.equal((await call(s,'library',{action:'read',...id(row)})).error.code,'SOURCE_CHANGED');
 await s.library.scan();assert.equal(s.library.rows.size,2);
}));
test('Existing indexed cards remain readable while a scan is awaiting source IO',()=>fixture(async(s,root)=>{
 const row=await source(s,root),original=s.library.stableRead.bind(s.library);let started,release;
 const entered=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;});let blocked=false;
 s.library.stableRead=async(...args)=>{if(!blocked){blocked=true;started();await gate;}return original(...args);};
 const scanning=s.library.scan();await entered;const result=await s.library.read(id(row));assert.equal(result.name,row.name);release();await scanning;
}));
test('Library folder uses canonical Host case accepted by the official Windows desktop verifier',()=>fixture(async(s,root)=>{
 const result=await call(s,'library_folder');assert(result.ok);assert.equal(result.value.path,await fs.realpath(path.join(root,'library')));
 const ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd:root});try{const desktop={ctx:{fs:ctx.fs},verifyDesktopPath:SessionController.prototype.verifyDesktopPath},signal=new AbortController().signal,client=new WorkspaceClient({root,hide(){}});
  await assert.rejects(desktop.verifyDesktopPath(client.root+'/library',signal),/Path has no verified Host path/);assert.equal(await desktop.verifyDesktopPath(result.value.path,signal),result.value.path);
 }finally{await ctx.fiber.dispose();}
 assert.equal((await call(s,'library_folder',{path:'../escape'})).error.code,'LIBRARY_ARGUMENT');assert.equal((await s.operation('library_folder',{},undefined,{})).error.code,'SESSION');
}));
test('Library folder and image fail closed after root replacement/junction redirection',()=>fixture(async(s,root,base)=>{
 const row=await source(s,root);await fs.rename(path.join(root,'library'),path.join(root,'original-library'));const outside=path.join(base,'Outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(root,'library'),'junction');
 assert.equal((await call(s,'library_folder')).ok,false);assert.equal((await call(s,'library_image',id(row))).ok,false);await fs.unlink(path.join(root,'library'));
}));
test('GUI image is pixel-only, fully decoded, bounded and source/card/trailer bytes are preserved',()=>fixture(async(s,root)=>{
 const bytes=png({extras:[pngChunk('tEXt',Buffer.from('prompt\0<script>doNotRun()</script>')),pngChunk('iCCP',Buffer.from('untrusted profile')),pngChunk('vpAg',Buffer.from('unknown'))],trailer:Buffer.from('retained source trailer')}),row=await source(s,root,'image.png',bytes),before=await fs.readdir(path.join(root,'.cardstudio-scean/documents'));
 const result=await call(s,'library_image',id(row));assert(result.ok,JSON.stringify(result));const preview=Buffer.from(result.value.data_url.split(',')[1],'base64');
 assert.equal(result.value.width,32);assert.equal(result.value.height,48);assert.equal(result.value.image_sha256,sha(preview));assert(result.value.bytes<=libraryImageLimits.bytes);
 for(const text of ['ccv3','chara','doNotRun','untrusted','unknown','trailer'])assert(!preview.includes(Buffer.from(text)));
 await assert.rejects(async()=>decodeCard(preview),{code:'PNG_CARD'});assert.deepEqual(await fs.readFile(path.join(root,'library/image.png')),bytes);assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/documents')),before);
 assert.equal((await call(s,'library_image',{...id(row),path:'E:/secret'})).error.code,'LIBRARY_ARGUMENT');assert.equal((await s.operation('library_image',id(row),undefined,{})).error.code,'SESSION');
}));
test('Cached images reverify source hash and never disguise modified/deleted source as current',()=>fixture(async(s,root)=>{
 const row=await source(s,root);assert((await call(s,'library_image',id(row))).ok);await fs.writeFile(path.join(root,'library/image.png'),png({trailer:Buffer.from('changed')}));assert.equal((await call(s,'library_image',id(row))).error.code,'SOURCE_CHANGED');await fs.unlink(path.join(root,'library/image.png'));assert.equal((await call(s,'library_image',id(row))).error.code,'SOURCE_DELETED');
}));
test('Bad/oversize/animated image previews are isolated from text reading',()=>fixture(async(s,root)=>{
 for(const [name,options,code] of [['dimension',{width:4097},'LIBRARY_IMAGE_LIMIT'],['depth',{depth:16},'ASSET_RASTER'],['interlace',{interlace:1},'ASSET_RASTER'],['animated',{extras:[pngChunk('acTL',Buffer.alloc(8))]},'LIBRARY_IMAGE'],['critical',{extras:[pngChunk('ABCD',Buffer.alloc(0))]},'LIBRARY_IMAGE'],['bad-pixels',{compressed:Buffer.from([1,2,3])},'ASSET_RASTER'],['bytes',{compressed:Buffer.alloc(16*1024*1024)},'LIBRARY_IMAGE_LIMIT']]){
  const row=await source(s,root,name+'.png',png(options)),result=await call(s,'library_image',id(row));assert.equal(result.error.code,code,name);assert((await call(s,'library',{action:'read',...id(row)})).ok,name);
 }
 const json=await source(s,root,'a.json',Buffer.from(JSON.stringify(syntheticCard(3))));assert.equal((await call(s,'library_image',id(json))).error.code,'LIBRARY_IMAGE');
}));
test('Image cache is bounded and cancelled jobs publish no image',()=>fixture(async(s,root)=>{
 for(let i=0;i<6;i++){const row=await source(s,root,'image'+i+'.png',png({trailer:Buffer.from(String(i))}));assert((await call(s,'library_image',id(row))).ok);}
 assert.equal(s.libraryImages.cache.size,4);assert([...s.libraryImages.cache.values()].reduce((n,x)=>n+x.data.length,0)<=libraryImageLimits.cacheBytes);
 const row=[...s.library.rows.values()][0],controller=new AbortController();controller.abort();await assert.rejects(s.libraryImages.read(id(row),controller.signal),{name:'AbortError'});
}));
test('Merged JSON/PNG tiles advertise the distinct PNG hash with deterministic source selection',()=>fixture(async(s,root)=>{
 await source(s,root,'b.png');await fs.writeFile(path.join(root,'library','a.json'),JSON.stringify(syntheticCard(3)));await s.library.scan();const row=(await s.library.list({})).items[0];assert.equal(row.format,'json');assert.equal(row.source_count,2);assert.equal(row.image_source.relative_path,'b.png');assert.notEqual(row.image_source.source_sha256,row.source_sha256);assert((await call(s,'library_image',row.image_source)).ok===false);assert((await call(s,'library_image',id(row.image_source))).ok);
}));
test('Native bridge exposes trusted GUI folder/image routes with 25 model tools including material station',()=>fixture(async(s,root,base)=>{
 const old=process.env.DSH_HOME;process.env.DSH_HOME=path.join(base,'Host Home');const host=await nativeHost(process.env.DSH_HOME,plugin);try{const workspace=host.registry.list()[0],agent=host.agent('usability-session',workspace.path),claim=(await host.request(agent,{action:'acquire',page_id:'usability-page-001'})).value;
  const folder=await host.request(agent,{action:'library_folder',claim,args:{}});assert(folder.ok);assert.equal(folder.value.path,await fs.realpath(path.join(workspace.path,'library')));assert.equal(host.ctx.tools.schemas(agent).length,29);assert(!host.ctx.tools.schemas(agent).some(x=>/library_image|library_folder/.test(x.name)));
  const wrong=await host.request(agent,{action:'library_image',claim:{...claim,lease_id:'wrong'},args:{}});assert.equal(wrong.error.code,'STALE_LEASE');
 }finally{await host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;}
}));

test('Pixel preview rejects non-ASCII PNG chunk types even when the card parser reads them',()=>{const original=decodeCard(png()),raw=pngChunk(String.fromCharCode(201)+'HDR',original.chunks[0].raw.subarray(8,-4)),source=Buffer.concat([signature,raw,...original.chunks.slice(1).map(x=>x.raw)]);assert.throws(()=>projectLibraryImage(decodeCard(source)),{code:'LIBRARY_IMAGE'});});

test('Six PNG sources cycle through bounded LRU reads with exact source bytes intact',()=>fixture(async(s,root)=>{
 const rows=[],originals=new Map();
 for(let i=0;i<6;i++){const bytes=png({trailer:Buffer.from('source-'+i)});const row=await source(s,root,'six-'+i+'.png',bytes);rows.push(row);originals.set(row.relative_path,bytes);}
 for(const i of [0,1,2,3,4,5,0,5,1]){const result=await call(s,'library_image',id(rows[i]));assert(result.ok);assert(s.libraryImages.cache.size<=4);assert([...s.libraryImages.cache.values()].reduce((n,x)=>n+x.data.length,0)<=libraryImageLimits.cacheBytes);}
 for(const [name,bytes] of originals)assert.deepEqual(await fs.readFile(path.join(root,'library',name)),bytes);
}));
