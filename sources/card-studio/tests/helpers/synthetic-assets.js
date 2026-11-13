import { deflateSync } from 'node:zlib';
import { pngChunk } from '../../cardstudio-bundle/lib/codec.js';

export const SYNTHETIC_EXPRESSIONS = ['neutral','happy','angry','sad','embarrassed','surprised'];
/** Harmless solid-color raster fixtures generated locally, no private inputs. */
export function syntheticPng({width=32,height=48,color=[80,160,220,255],filter=0}={}) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++){const start=y*(width*4+1);pixels[start]=filter;for(let x=0;x<width;x++)for(let c=0;c<4;c++)pixels[start+1+x*4+c]=color[c];}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
}
export function sixSyntheticRasters() {
  const colors=[[115,140,175,255],[255,210,80,255],[220,60,65,255],[75,105,205,255],[250,145,165,255],[150,230,190,255]];
  return SYNTHETIC_EXPRESSIONS.map((expression,i)=>({expression,bytes:syntheticPng({color:colors[i]})}));
}
