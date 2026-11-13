import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Local, ignored AGPL source + LICENSE, pinned to upstream 1.19.0. No network,
// application startup, third-party imports, private cards or UI simulation.
const root=new URL('../../evidence/sillytavern-1.19.0/',import.meta.url);
async function source(file,hash) {
  const raw=await fs.readFile(new URL(file,root));
  assert.equal(createHash('sha256').update(raw).digest('hex'),hash,'Pinned upstream source changed; review contract before updating');
  return raw.toString('utf8');
}
const world=await source('public/scripts/world-info.js','111c7f47945839e75b021e09bdbb112a54f0a9b7857d2b95435f573efc7cd9a5');
const characters=await source('src/endpoints/characters.js','3235555529e9ff17ecc2ebe9168b0af77fe6ef5947f3d1f7de3df6d5f2567d89');
await source('LICENSE','8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef');
function extract(text,name) {
  const start=text.indexOf('function '+name+'(');assert(start>=0);
  const end=text.indexOf('\n}',start);assert(end>start);
  return text.slice(start,end+2);
}
const convert=extract(world,'convertCharacterBook');
const normalize=extract(characters,'readFromV2');
export function convertBookWithUpstream(book) {
  // Only harmless globals referenced by this exact audited function. The empty
  // template leaves upstream's explicit field mappings intact; unrelated UI
  // template defaults are outside this test's scope.
  return vm.runInNewContext(convert+'; convertCharacterBook(input)',{
    input:structuredClone(book),newWorldInfoEntryTemplate:{},world_info_position:{before:0,after:1},
    DEFAULT_DEPTH:4,DEFAULT_WEIGHT:100,world_info_logic:{AND_ANY:0},extension_prompt_roles:{SYSTEM:0},
  },{timeout:1000});
}
export function normalizeCardWithUpstream(card) {
  // Minimal lodash-compatible data operations, not a reimplementation of the
  // mapping under test. No logger output or filesystem access is provided.
  const _={isUndefined:x=>x===undefined,unset:(o,k)=>delete o[k],
    get:(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o),forEach:(o,fn)=>Object.entries(o).forEach(([k,v])=>fn(v,k))};
  return vm.runInNewContext(normalize+'; readFromV2(input)',{input:structuredClone(card),_,console:{warn(){}},humanizedDateTime:()=> 'synthetic-date'},{timeout:1000});
}

const pngParser=await source('src/character-card-parser.js','b74541cd54bb3fe3ab39b3e040f6dba824b263ed9344e4dcf98363e4e148e07c');
const pngReadStart=pngParser.indexOf('export const read = (image) => {');
const pngReadEnd=pngParser.indexOf('\n};',pngReadStart);assert(pngReadStart>=0&&pngReadEnd>pngReadStart);
const pngRead=pngParser.slice(pngReadStart,pngReadEnd+3).replace('export const read','const read');
export function readPngWithUpstream(bytes){
  // The exact pinned upstream selection/decoding function; minimal independent
  // binary/text adapters replace package imports. No app, scripts or network.
  const extract=input=>{const b=Buffer.from(input),rows=[];let offset=8;while(offset+12<=b.length){const size=b.readUInt32BE(offset),name=b.subarray(offset+4,offset+8).toString('ascii');assert(offset+12+size<=b.length);rows.push({name,data:b.subarray(offset+8,offset+8+size)});offset+=size+12;if(name==='IEND')break;}return rows;};
  const PNGtext={decode:data=>{const end=data.indexOf(0);assert(end>0);return {keyword:data.subarray(0,end).toString('latin1'),text:data.subarray(end+1).toString('latin1')};}};
  return vm.runInNewContext(pngRead+'; read(input)',{input:Buffer.from(bytes),Buffer,Uint8Array,extract,PNGtext,console:{error(){}}},{timeout:1000});
}
