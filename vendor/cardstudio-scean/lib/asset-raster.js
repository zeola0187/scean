import { inflateSync, deflateSync } from 'node:zlib';
import { crc32, fail, sha, pngChunk } from './codec.js';

export const RASTER_LIMITS = Object.freeze({maxBytes:16*1024*1024,maxDimension:4096,maxPixels:16*1024*1024,maxDecodedBytes:68*1024*1024});
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
function invalid(message) { fail('ASSET_RASTER',message); }
function dimensions(width,height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1 || width>RASTER_LIMITS.maxDimension || height>RASTER_LIMITS.maxDimension || width*height>RASTER_LIMITS.maxPixels) invalid('Raster dimensions exceed the supported bounds.');
  return {width,height};
}
function png(bytes,{onHeader,onRow}={}) {
  let offset=8, header, palette, transparency, ended=false, idatEnded=false, seenIDAT=false, count=0; const chunks=[],singletons=new Set();
  while (offset<bytes.length) {
    if (++count>4096 || offset+12>bytes.length) invalid('Truncated or excessive PNG chunks.');
    const n=bytes.readUInt32BE(offset), end=offset+12+n;
    if (end>bytes.length || n>RASTER_LIMITS.maxBytes) invalid('Invalid PNG chunk size.');
    const type=bytes.subarray(offset+4,offset+8).toString('ascii'), data=bytes.subarray(offset+8,end-4);
    if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset+6]&32)!==0) invalid('Invalid PNG chunk type.');
    if (crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4)) invalid('PNG chunk CRC failed.');
    if (count===1 && type!=='IHDR') invalid('PNG IHDR must be first.');
    if (type==='IHDR') {
      if (header || n!==13) invalid('Invalid PNG IHDR.');
      const width=data.readUInt32BE(0),height=data.readUInt32BE(4),depth=data[8],color=data[9]; dimensions(width,height);
      if (depth!==8 || ![0,2,3,4,6].includes(color) || data[10]!==0 || data[11]!==0 || data[12]!==0) invalid('Only noninterlaced 8-bit PNG is supported.');
      header={width,height,color,channels:{0:1,2:3,3:1,4:2,6:4}[color]};
    } else if (type==='PLTE') {
      if (palette || seenIDAT || !n || n%3 || n>768 || [0,4].includes(header.color)) invalid('Invalid PNG palette.'); palette=data;
    } else if (type==='IDAT') {
      if (idatEnded || (header.color===3 && !palette)) invalid('Invalid PNG IDAT order.'); seenIDAT=true; chunks.push(data);
    } else if (type==='IEND') {
      if (n || !seenIDAT || end!==bytes.length) invalid('Invalid PNG end or trailing bytes.'); ended=true; offset=end; break;
    } else {
      if (seenIDAT) idatEnded=true;
      if (['acTL','fcTL','fdAT'].includes(type)) invalid('Animated PNG assets are unsupported.');
      if (!(bytes[offset+4]&32)) invalid('Unsupported critical PNG chunk.');
      if (['tRNS','cHRM','gAMA','iCCP','sBIT','sRGB','bKGD','hIST','pHYs','tIME'].includes(type)) { if(singletons.has(type))invalid('Duplicate PNG singleton chunk.');singletons.add(type); }
      if (type==='tRNS' && (seenIDAT || (header.color===3 ? !palette || n>palette.length/3 : header.color===0 ? n!==2 : header.color===2 ? n!==6 : true))) invalid('Invalid PNG transparency.');
      if (type==='tRNS' && header.color!==3) for(let p=0;p<n;p+=2) if(data.readUInt16BE(p)>255)invalid('PNG transparency is outside the 8-bit range.');
      if (type==='tRNS') transparency=data;
      // Compressed metadata is not pixel data; still bound its expansion before
      // admitting bytes that a browser image decoder may inspect.
      if (type==='iCCP' || type==='zTXt' || type==='iTXt') {
        const nul=data.indexOf(0);if(nul<1 || nul>79)invalid('Invalid PNG metadata keyword.');let body,limit=64*1024;
        if(type==='iCCP'||type==='zTXt'){if(data[nul+1]!==0)invalid('Invalid PNG metadata compression.');body=data.subarray(nul+2);if(type==='iCCP')limit=1024*1024;}
        else {const flag=data[nul+1],method=data[nul+2],language=data.indexOf(0,nul+3),translated=language<0?-1:data.indexOf(0,language+1);if(![0,1].includes(flag)||method!==0||language<0||translated<0)invalid('Invalid PNG international metadata.');if(flag)body=data.subarray(translated+1);}
        if(body){try{const result=inflateSync(body,{maxOutputLength:limit,info:true});if(result.engine.bytesWritten!==body.length)invalid('Trailing compressed PNG metadata.');}catch{invalid('Invalid or excessive compressed PNG metadata.');}}
      }
    }
    offset=end;
  }
  if (!ended || !header) invalid('Missing PNG end.');
  onHeader?.(header);
  const row=header.width*header.channels,expected=(row+1)*header.height;
  if (expected>RASTER_LIMITS.maxDecodedBytes) invalid('PNG decoded bytes exceed the bound.');
  let decoded;
  try {
    const compressed=Buffer.concat(chunks),result=inflateSync(compressed,{maxOutputLength:expected,info:true});
    if (result.engine.bytesWritten!==compressed.length) invalid('PNG has trailing compressed data.'); decoded=result.buffer;
  } catch { invalid('PNG compressed pixels are invalid or exceed the bound.'); }
  if (decoded.length!==expected) invalid('PNG scanline byte count is invalid.');
  const previous=Buffer.alloc(row),current=Buffer.alloc(row),bpp=header.channels;
  for (let y=0;y<header.height;y++) {
    const start=y*(row+1),filter=decoded[start]; if (filter>4) invalid('Invalid PNG scanline filter.');
    for (let x=0;x<row;x++) {
      const a=x>=bpp?current[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0;
      let predictor=0;
      if (filter===1) predictor=a; else if (filter===2) predictor=b; else if (filter===3) predictor=(a+b)>>1;
      else if (filter===4) { const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c); predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c; }
      current[x]=(decoded[start+1+x]+predictor)&255;
      if (header.color===3 && current[x]>=palette.length/3) invalid('PNG palette index is invalid.');
    }
    onRow?.(y,current,header,palette,transparency);
    current.copy(previous);
  }
  return {...dimensions(header.width,header.height),validation:'decoded'};
}
/** Reuse the strict PNG decoder with row consumers; never retain a full RGBA
 * frame. Source limits stay identical to existing raster admission. */
export function thumbnailPng(input,{dimension=256}={}) {
  if (!(Buffer.isBuffer(input)||input instanceof Uint8Array)) invalid('Thumbnail admission requires PNG bytes.');
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  if(!bytes.length||bytes.length>RASTER_LIMITS.maxBytes||!bytes.subarray(0,8).equals(PNG))invalid('Thumbnail PNG source exceeds the raster byte bound.');
  if(!Number.isSafeInteger(dimension)||dimension<1||dimension>256)invalid('Thumbnail dimension exceeds the output bound.');
  let width,height,rows,nextY=0;
  const facts=png(bytes,{
    onHeader(header){
      const scale=Math.min(1,dimension/Math.max(header.width,header.height));
      width=Math.max(1,Math.round(header.width*scale));height=Math.max(1,Math.round(header.height*scale));
      rows=Buffer.alloc((width*4+1)*height);
    },
    onRow(y,row,header,palette,transparency){
      // Centre-sampled nearest-neighbour resize. Decode validates every source
      // row/palette index, including rows not sampled for the thumbnail.
      if(nextY>=height||y!==Math.min(header.height-1,Math.floor((nextY+.5)*header.height/height)))return;
      for(let x=0;x<width;x++){
        const sourceX=Math.min(header.width-1,Math.floor((x+.5)*header.width/width)),at=sourceX*header.channels,to=nextY*(width*4+1)+1+x*4;
        let red,green,blue,alpha=255;
        if(header.color===3){const index=row[at];red=palette[index*3];green=palette[index*3+1];blue=palette[index*3+2];alpha=transparency?.[index]??255;}
        else if(header.color===0||header.color===4){red=green=blue=row[at];if(header.color===4)alpha=row[at+1];else if(transparency&&red===transparency.readUInt16BE(0))alpha=0;}
        else {red=row[at];green=row[at+1];blue=row[at+2];if(header.color===6)alpha=row[at+3];else if(transparency&&red===transparency.readUInt16BE(0)&&green===transparency.readUInt16BE(2)&&blue===transparency.readUInt16BE(4))alpha=0;}
        rows[to]=red;rows[to+1]=green;rows[to+2]=blue;rows[to+3]=alpha;
      }
      nextY++;
    }
  });
  if(nextY!==height)invalid('Thumbnail did not sample the expected rows.');
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const data=Buffer.concat([PNG,pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(rows,{level:6})),pngChunk('IEND',Buffer.alloc(0))]);
  return {data,width,height,sourceWidth:facts.width,sourceHeight:facts.height};
}
// Container validation never claims entropy decoding. A display admission must
// additionally decode JPEG/WebP in an isolated browser and verify dimensions.
function jpeg(bytes) {
  let offset=2,frame,scans=0,segments=0,quant=false,huffman=false;
  while (offset<bytes.length) {
    if (++segments>4096 || bytes[offset++]!==255) invalid('Invalid JPEG marker boundary.');
    while (bytes[offset]===255) offset++;
    const marker=bytes[offset++]; if (marker===undefined || marker===0 || marker===0xd8) invalid('Invalid JPEG marker.');
    if (marker===0xd9) { if (!frame || !scans || offset!==bytes.length) invalid('Invalid JPEG end or trailing data.'); return {...dimensions(frame.width,frame.height),validation:'structural'}; }
    if (marker>=0xd0&&marker<=0xd7 || marker===0x01) invalid('Unexpected standalone JPEG marker.');
    if (offset+2>bytes.length) invalid('Truncated JPEG segment.'); const length=bytes.readUInt16BE(offset),end=offset+length;
    if (length<2 || end>bytes.length) invalid('Invalid JPEG segment size.'); const data=bytes.subarray(offset+2,end);
    if ([0xc0,0xc2].includes(marker)) {
      if (frame || data.length<6 || data[0]!==8 || ![1,3].includes(data[5]) || data.length!==6+3*data[5]) invalid('Only 8-bit baseline/progressive JPEG is supported.');
      const height=data.readUInt16BE(1),width=data.readUInt16BE(3); dimensions(width,height); const ids=new Set();
      for (let i=6;i<data.length;i+=3) { if (ids.has(data[i]) || (data[i+1]>>4)<1 || (data[i+1]>>4)>4 || (data[i+1]&15)<1 || (data[i+1]&15)>4 || data[i+2]>3) invalid('Invalid JPEG frame component.'); ids.add(data[i]); }
      frame={width,height,ids,progressive:marker===0xc2};
    } else if (marker>=0xc0 && marker<=0xcf && ![0xc4].includes(marker)) invalid('Unsupported JPEG coding mode.');
    else if (marker===0xdb) {
      let p=0; while(p<data.length) { const descriptor=data[p++],precision=descriptor>>4; if (precision>1 || (descriptor&15)>3 || p+64*(precision+1)>data.length) invalid('Invalid JPEG quantization table.'); for(let j=0;j<64;j++) { const v=precision?data.readUInt16BE(p+j*2):data[p+j]; if(!v) invalid('JPEG quantization coefficient is zero.'); } p+=64*(precision+1); } if(!p)invalid('Empty JPEG quantization table.'); quant=true;
    } else if (marker===0xc4) {
      let p=0; while(p<data.length) { const descriptor=data[p++]; if ((descriptor>>4)>1 || (descriptor&15)>3 || p+16>data.length) invalid('Invalid JPEG Huffman table.'); let total=0,capacity=1; for(let j=0;j<16;j++) { capacity=capacity*2-data[p+j]; if(capacity<0)invalid('Oversubscribed JPEG Huffman table.'); total+=data[p+j]; } p+=16;if(!total || total>256 || p+total>data.length)invalid('Truncated JPEG Huffman table.');p+=total; } if(!p)invalid('Empty JPEG Huffman table.'); huffman=true;
    } else if (marker===0xdd && data.length!==2) invalid('Invalid JPEG restart interval.');
    else if (marker===0xda) {
      if (!frame || !quant || !huffman || data.length<6 || !data[0] || data[0]>frame.ids.size || data.length!==1+2*data[0]+3) invalid('Invalid JPEG scan header.');
      const seen=new Set(); for(let p=1;p<1+2*data[0];p+=2) { if(!frame.ids.has(data[p])||seen.has(data[p])||(data[p+1]>>4)>3||(data[p+1]&15)>3)invalid('Invalid JPEG scan component.');seen.add(data[p]); }
      const tail=data.subarray(-3);if(!frame.progressive && (tail[0]!==0||tail[1]!==63||tail[2]!==0))invalid('Invalid baseline JPEG spectral selection.');
      if(frame.progressive && (tail[0]>tail[1]||tail[1]>63||(tail[2]>>4)>13||(tail[2]&15)>13))invalid('Invalid progressive JPEG scan.');
      scans++; offset=end; let entropy=0;
      while(offset<bytes.length) { if(bytes[offset]!==255){offset++;entropy++;continue;} const start=offset++;while(bytes[offset]===255)offset++;const next=bytes[offset];if(next===0 || next>=0xd0&&next<=0xd7){offset++;entropy++;continue;}offset=start;break; }
      if(!entropy)invalid('Empty JPEG entropy stream.');continue;
    } else if (!(marker>=0xe0&&marker<=0xef) && marker!==0xfe) invalid('Unsupported JPEG segment.');
    offset=end;
  }
  invalid('Missing JPEG end.');
}
function webp(bytes) {
  if(bytes.length<20 || bytes.toString('ascii',8,12)!=='WEBP' || bytes.readUInt32LE(4)+8!==bytes.length)invalid('Invalid WebP RIFF container.');
  let offset=12,canvas,frame,alpha=false,count=0;
  while(offset<bytes.length) {
    if(++count>32 || offset+8>bytes.length)invalid('Truncated WebP chunk.');const type=bytes.toString('ascii',offset,offset+4),n=bytes.readUInt32LE(offset+4),end=offset+8+n,padded=end+(n&1);
    if(padded>bytes.length || ((n&1)&&bytes[end]!==0))invalid('Invalid WebP chunk size or padding.');const data=bytes.subarray(offset+8,end);
    if(type==='VP8X') {
      if(count!==1 || canvas || n!==10 || data[0]&0xc3 || data[1]||data[2]||data[3] || data[0]&2)invalid('Invalid or animated WebP extended header.');
      canvas=dimensions(1+data.readUIntLE(4,3),1+data.readUIntLE(7,3));
    } else if(type==='VP8 ') {
      if(frame || n<11 || (data[0]&1) || data.toString('hex',3,6)!=='9d012a')invalid('Invalid WebP VP8 key frame.');
      const tag=data.readUIntLE(0,3),partition=tag>>5;if(!(tag&16)||((tag>>1)&7)>3 || partition>n-10 || !partition)invalid('Invalid WebP VP8 partition.');
      frame=dimensions(data.readUInt16LE(6)&0x3fff,data.readUInt16LE(8)&0x3fff);
    } else if(type==='VP8L') {
      if(frame || n<6 || data[0]!==0x2f)invalid('Invalid WebP lossless header.');const bits=data.readUInt32LE(1);if(bits>>>29)invalid('Unsupported WebP lossless version.');frame=dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);
    } else if(type==='ALPH') { if(!canvas || frame || alpha || n<2 || data[0]&0xc0 || (data[0]&3)>1 || ((data[0]>>4)&3)>1)invalid('Invalid WebP alpha chunk.');alpha=true; }
    else if(['ANIM','ANMF'].includes(type))invalid('Animated WebP assets are unsupported.');
    else if(!['ICCP','EXIF','XMP '].includes(type) || !canvas || frame && type==='ICCP')invalid('Unsupported WebP chunk.');
    offset=padded;
  }
  if(!frame || canvas && (canvas.width!==frame.width||canvas.height!==frame.height))invalid('WebP canvas/frame mismatch or missing frame.');
  return {...frame,validation:'structural'};
}
export function validateRaster(input,{declaredType}={}) {
  if (!(Buffer.isBuffer(input)||input instanceof Uint8Array)) invalid('Asset admission requires raster bytes, never a path or URL.');
  const bytes=Buffer.from(input);if(!bytes.length||bytes.length>RASTER_LIMITS.maxBytes)invalid('Raster bytes exceed the supported bound.');
  let mediaType,result;
  if(bytes.subarray(0,8).equals(PNG)) { mediaType='image/png';result=png(bytes); }
  else if(bytes[0]===255&&bytes[1]===216) { mediaType='image/jpeg';result=jpeg(bytes); }
  else if(bytes.toString('ascii',0,4)==='RIFF') { mediaType='image/webp';result=webp(bytes); }
  else invalid('Only supported PNG/JPEG/WebP raster bytes are admitted.');
  if(declaredType!==undefined&&declaredType!==mediaType)invalid('Declared asset type does not match the bytes.');
  return {mediaType,...result,bytes:bytes.length,sha256:sha(bytes)};
}
