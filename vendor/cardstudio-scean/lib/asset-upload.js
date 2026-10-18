import { UploadBuffer } from './upload-buffer.js';
import { fail } from './codec.js';
export class AssetUploadBuffer extends UploadBuffer {
  begin(session,{name,size,document_id,expected_revision}){
    if(typeof name!=='string'||name.length>255||!/^.+\.(png|jpe?g|webp)$/i.test(name)||/[\\/\0:]/.test(name))fail('ASSET_UPLOAD','Select one PNG, JPEG or WebP image.');
    if(!Number.isSafeInteger(size)||size<1||size>16*1024*1024)fail('ASSET_LIMIT','Image must be at most 16 MiB.');
    const result=super.begin(session,{name:'selected-asset.png',size,type:'card'});
    Object.assign(this.rows.get(result.upload_id),{document_id,expected_revision,originalName:name});return result;
  }
}
