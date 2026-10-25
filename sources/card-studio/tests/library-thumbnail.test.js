import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync,inflateSync} from 'node:zlib';
import {decodeCard,pngChunk,sha} from '../cardstudio-bundle/lib/codec.js';
import {projectLibraryImage,LibraryImages,libraryImageLimits} from '../cardstudio-bundle/lib/library-image.js';
import {validateRaster,thumbnailPng} from '../cardstudio-bundle/lib/asset-raster.js';
import {syntheticCard,metadataChunk} from './helpers/png-fixtures.js';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function cardPng({width=512,height=768,color=6,noise=false,extra=[],compressed}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color;
 const channels={0:1,2:3,3:1,4:2,6:4}[color],rows=Buffer.alloc((width*channels+1)*height);let random=17;
 for(let y=0;y<height;y++)for(let x=0;x<width*channels;x++){random=(Math.imul(random,1664525)+1013904223)>>>0;rows[y*(width*channels+1)+1+x]=noise?random>>>24:(x%channels===channels-1&&[4,6].includes(color)?255:80);}
 return Buffer.concat([signature,pngChunk('IHDR',header),...extra,pngChunk('IDAT',compressed??deflateSync(rows)),metadataChunk('ccv3',syntheticCard(3)),pngChunk('IEND',Buffer.alloc(0))]);
}
function inspect(bytes){let at=8;const chunks=[];while(at<bytes.length){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8);chunks.push({type,data:bytes.subarray(at+8,at+8+length)});at+=length+12;}return chunks;}
test('Ordinary 512x768 PNG with IDAT above old output budget becomes an actual bounded thumbnail',()=>{
 const source=cardPng({noise:true}),before=sha(source),decoded=decodeCard(source);assert(inspect(source).find(c=>c.type==='IDAT').data.length>512*1024);
 const image=projectLibraryImage(decoded);assert.equal(image.width,171);assert.equal(image.height,256);assert.equal(image.sourceWidth,512);assert.equal(image.sourceHeight,768);assert(image.data.length<=512*1024);assert.deepEqual(inspect(image.data).map(c=>c.type),['IHDR','IDAT','IEND']);assert.equal(validateRaster(image.data).validation,'decoded');assert.equal(sha(source),before);
});
test('Reasonable larger PNG decodes within existing raster bounds and shrinks instead of rejecting source dimensions',()=>{
 const source=cardPng({width:2048,height:1536,noise:true});assert(source.length>512*1024&&source.length<16*1024*1024);const image=projectLibraryImage(decodeCard(source));assert.equal(image.width,256);assert.equal(image.height,192);assert(image.data.length<=libraryImageLimits.bytes);assert.equal(validateRaster(image.data).width,256);
});
test('Large chara metadata is independent of the pixel-container and thumbnail-output budgets',()=>{
 const large=syntheticCard(2);large.data.description='metadata to preserve '.repeat(90000);const source=cardPng({width:32,height:48,extra:[metadataChunk('chara',large)]}),before=sha(source);
 assert(source.length>2*1024*1024);const image=projectLibraryImage(decodeCard(source));assert.equal(image.width,32);assert.equal(image.height,48);assert(image.data.length<1000);assert.deepEqual(inspect(image.data).map(c=>c.type),['IHDR','IDAT','IEND']);assert.equal(sha(source),before);
});
test('Thumbnail preserves RGBA, RGB/gray transparency and palette alpha through the shared row decoder',()=>{
 for(const [color,extra,expected] of [[6,[],[80,80,80,255]],[2,[pngChunk('tRNS',Buffer.from([0,80,0,80,0,80]))],[80,80,80,0]],[0,[pngChunk('tRNS',Buffer.from([0,80]))],[80,80,80,0]],[4,[],[80,80,80,255]],[3,[pngChunk('PLTE',Buffer.alloc(81*3,40)),pngChunk('tRNS',Buffer.alloc(81,90))],[40,40,40,90]]]){
  const image=projectLibraryImage(decodeCard(cardPng({width:2,height:2,color,extra}))),rows=inflateSync(inspect(image.data).find(c=>c.type==='IDAT').data);assert.deepEqual([...rows.subarray(1,5)],expected);assert.equal(validateRaster(image.data).height,2);
 }
});
test('Oversized decoded stream, bad unsampled scanline and trailing compressed bytes stay refused',()=>{
 const tooMuch=deflateSync(Buffer.alloc((512*4+1)*768+1));assert.throws(()=>projectLibraryImage(decodeCard(cardPng({compressed:tooMuch}))),{code:'ASSET_RASTER'});
 const rows=Buffer.alloc((512*4+1)*768);rows[0]=5;assert.throws(()=>projectLibraryImage(decodeCard(cardPng({compressed:deflateSync(rows)}))),{code:'ASSET_RASTER'});
 assert.throws(()=>projectLibraryImage(decodeCard(cardPng({compressed:Buffer.concat([deflateSync(Buffer.alloc((512*4+1)*768)),Buffer.from('trailing')])}))),{code:'ASSET_RASTER'});
 const header=Buffer.alloc(13);header.writeUInt32BE(4097);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 const bomb=Buffer.concat([signature,pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.alloc(4))),metadataChunk('ccv3',syntheticCard(3)),pngChunk('IEND',Buffer.alloc(0))]);assert.throws(()=>projectLibraryImage(decodeCard(bomb)),{code:'LIBRARY_IMAGE_LIMIT'});
 assert.throws(()=>thumbnailPng(Buffer.alloc(16*1024*1024+1)),{code:'ASSET_RASTER'});assert.throws(()=>thumbnailPng(projectLibraryImage(decodeCard(cardPng({width:1,height:1}))).data,{dimension:257}),{code:'ASSET_RASTER'});
});
test('Concurrent thumbnail jobs serialize source verification/decoding and cache only bounded projections',async()=>{
 const bytes=cardPng({noise:true}),decoded=decodeCard(bytes);let active=0,peak=0;
 const images=new LibraryImages({async verified(args){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return {decoded,row:{relative_path:'synthetic.png'}};}});
 try{const results=await Promise.all(Array.from({length:6},(_,i)=>images.read({item_id:'source-'+i,source_sha256:sha(bytes)})));assert.equal(peak,1);assert.equal(libraryImageLimits.concurrentDecodes,1);assert.equal(images.cache.size,4);assert(results.every(x=>x.width===171&&x.height===256&&x.bytes<=512*1024));assert([...images.cache.values()].reduce((n,x)=>n+x.data.length,0)<=2*1024*1024);}finally{await images.close();}
});
