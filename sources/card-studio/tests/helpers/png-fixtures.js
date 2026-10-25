import { deflateSync } from 'node:zlib';
import { pngChunk } from '../../cardstudio-bundle/lib/codec.js';

export const signature=Buffer.from([137,80,78,71,13,10,26,10]);
export function syntheticCard(version=2){return {spec:`chara_card_v${version}`,spec_version:version===2?'2.0':'3.0',opaqueRoot:{keep:null},data:{name:'Synthetic PNG',description:'Synthetic only',personality:'',scenario:'',first_mes:'Original {{char}}',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{opaque:null,regex:{find:'(x)',replace:'$1'},script:'<script src="https://example.invalid/never-run.js"></script>'},character_book:{entries:[{id:7,keys:[],content:'Original book text',enabled:true,insertion_order:0,extensions:{opaque:null}}],extensions:{retain:1}}}};}
export function metadataChunk(key,value,{type='tEXt',payload,compressed=false}={}){
 const body=payload??Buffer.from(Buffer.from(JSON.stringify(value)).toString('base64'));
 const data=type==='zTXt'?Buffer.concat([Buffer.from(key+'\0\0'),deflateSync(body)]):type==='iTXt'?Buffer.concat([Buffer.from(key+'\0'),Buffer.from([compressed?1:0,0,0,0]),compressed?deflateSync(body):body]):Buffer.concat([Buffer.from(key+'\0'),body]);
 return pngChunk(type,data);
}
export function syntheticPng(metadata,{trailer=Buffer.from('synthetic opaque trailer')}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 return Buffer.concat([signature,pngChunk('IHDR',header),...metadata,pngChunk('vpAg',Buffer.from('synthetic opaque asset')),pngChunk('tEXt',Buffer.from('unrelated\0opaque text')),pngChunk('IDAT',deflateSync(Buffer.from([0,7,11,23,255]))),pngChunk('IEND',Buffer.alloc(0)),trailer]);
}
