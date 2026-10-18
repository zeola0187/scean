import { thumbnailPng,RASTER_LIMITS } from './asset-raster.js';
import { fail,sha } from './codec.js';

// A GUI-only pixel projection. Never return source PNG/card metadata or use a
// path/URL supplied by the renderer. The existing raster decoder is reused.
export const libraryImageLimits=Object.freeze({bytes:512*1024,dimension:256,pixels:256*256,sourceBytes:RASTER_LIMITS.maxBytes,sourceDimension:RASTER_LIMITS.maxDimension,sourcePixels:RASTER_LIMITS.maxPixels,decodedBytes:RASTER_LIMITS.maxDecodedBytes,cacheEntries:4,cacheBytes:2*1024*1024,concurrentDecodes:1});
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const pixels=new Set(['IHDR','PLTE','tRNS','IDAT','IEND']);
export function projectLibraryImage(decoded){
  if(decoded.kind!=='png')fail('LIBRARY_IMAGE','This source has no PNG image.');
  const header=decoded.chunks[0].raw.subarray(8,-4),width=header.readUInt32BE(0),height=header.readUInt32BE(4);
  if(width<1||height<1||width>libraryImageLimits.sourceDimension||height>libraryImageLimits.sourceDimension||width*height>libraryImageLimits.sourcePixels)fail('LIBRARY_IMAGE_LIMIT','Source pixels exceed the safe 4096-side / 16-Mpixel decode budget; text remains readable.');
  const chunks=[];let bytes=signature.length;
  for(const chunk of decoded.chunks){
    if(chunk.raw.subarray(4,8).some(byte=>byte>127)||!/^[A-Za-z]{4}$/.test(chunk.type)||['acTL','fcTL','fdAT'].includes(chunk.type)||!pixels.has(chunk.type)&&!(chunk.type.charCodeAt(0)&32))fail('LIBRARY_IMAGE','Animated/unknown critical PNG content has no image preview.');
    if(pixels.has(chunk.type)){bytes+=chunk.raw.length;if(bytes>libraryImageLimits.sourceBytes)fail('LIBRARY_IMAGE_LIMIT','Source pixel container exceeds the safe 16-MiB decode budget; text remains readable.');chunks.push(chunk.raw);}
  }
  // Strip all ancillary metadata, profiles, unknown chunks and trailers in this
  // disposable projection only. Original source bytes are never rewritten.
  const image=thumbnailPng(Buffer.concat([signature,...chunks]),{dimension:libraryImageLimits.dimension});
  if(image.data.length>libraryImageLimits.bytes||image.width*image.height>libraryImageLimits.pixels)fail('LIBRARY_IMAGE_LIMIT','Thumbnail output exceeds its 512-KiB / 256-side budget; text remains readable.');
  return {...image,image_sha256:sha(image.data)};
}
export class LibraryImages {
  constructor(index){this.index=index;this.queue=Promise.resolve();this.cache=new Map();this.closed=false;}
  read(args,signal){
    const job=this.queue.catch(()=>{}).then(async()=>{
      signal?.throwIfAborted();if(this.closed)fail('CLOSING','Image previews are closed.');
      if(!args||Object.keys(args).some(k=>!['item_id','source_sha256'].includes(k)))fail('LIBRARY_ARGUMENT','Image preview accepts only an observed source ID and hash.');
      // A cache hit must still verify current bytes and the Library boundary.
      const source=await this.index.verified(args,signal),key=args.item_id+':'+args.source_sha256;
      let image=this.cache.get(key);
      if(image)this.cache.delete(key);else image=projectLibraryImage(source.decoded);
      signal?.throwIfAborted();this.cache.set(key,image);
      while(this.cache.size>libraryImageLimits.cacheEntries||[...this.cache.values()].reduce((n,x)=>n+x.data.length,0)>libraryImageLimits.cacheBytes)this.cache.delete(this.cache.keys().next().value);
      return {item_id:args.item_id,source_sha256:args.source_sha256,relative_path:source.row.relative_path,media_type:'image/png',width:image.width,height:image.height,source_width:image.sourceWidth,source_height:image.sourceHeight,bytes:image.data.length,image_sha256:image.image_sha256,data_url:'data:image/png;base64,'+image.data.toString('base64'),projection:'Bounded pixel-only readonly thumbnail; metadata/profiles removed. Text/source bytes remain intact.'};
    });this.queue=job;return job;
  }
  async close(){this.closed=true;await this.queue.catch(()=>{});this.cache.clear();}
}
