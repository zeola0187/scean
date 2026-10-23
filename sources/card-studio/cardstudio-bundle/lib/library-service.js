import { AuthoringCardService } from './authoring-service.js';
import { LibraryImages } from './library-image.js';
import { LibraryIndex } from './library-index.js';
import { errorResult,contained,atomicReplace } from './card-service.js';
import { assertScopeOperation } from './authoring-scope.js';
import { fail } from './codec.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
export class LibraryCardService extends AuthoringCardService {
  constructor(root,options){super(root,options);this.library=new LibraryIndex(root);this.libraryImages=new LibraryImages(this.library);this.libraryController=new AbortController();this.libraryRevision=0;this.retiredLibraries=new Set();}
  async init(){
    try{if((await fs.lstat(path.join(this.root,'.cardstudio-scean'))).isSymbolicLink())fail('LIBRARY_PATH','Workspace metadata must not be redirected.');}catch(error){if(error.code!=='ENOENT')throw error;}
    await super.init();
    try{
      let settings;try{settings=JSON.parse(await fs.readFile(await contained(this.root,'.cardstudio-scean/library-settings.json',{existing:true}),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(settings){if(settings.schema_version!==1||settings.path!==null&&(typeof settings.path!=='string'||!path.isAbsolute(settings.path)))fail('LIBRARY_PATH','Invalid saved Library path.');this.library=new LibraryIndex(this.root,{sourcePath:settings.path});this.libraryImages=new LibraryImages(this.library);}
      await this.library.init();
    }catch(error){this.libraryError=error;}
  }
  librarySettings(){return {path:this.library.sourceRoot??this.library.sourcePath??path.join(this.root,'library'),custom:!!this.library.sourcePath,revision:this.libraryRevision,...this.libraryError?{error:errorResult(this.libraryError).error}:{}};}
  async setLibraryRoot(request,signal,assertCurrent=()=>{},{allowedRoots}={}){
    return this.serial('#workspace-operations',async()=>{
      assertCurrent();signal?.throwIfAborted();if(this.closing)fail('CLOSING','Workspace is closing.');
      if(!request||Object.keys(request).some(k=>!['path','expected_revision'].includes(k))||request.expected_revision!==this.libraryRevision)fail('LIBRARY_CHANGED','Library changed; reload the current folder setting.');
      if(request.path!==null&&(typeof request.path!=='string'||!path.isAbsolute(request.path)||request.path.includes('\0')))fail('LIBRARY_PATH','Choose an absolute local Library directory.');
      const next=new LibraryIndex(this.root,{sourcePath:request.path});
      try{
        // Check before any cache creation: a source may not contain our writes.
        const metadata=await fs.realpath(path.join(this.root,'.cardstudio-scean')),sourceRoot=request.path===null?path.join(await fs.realpath(this.root),'library'):await fs.realpath(request.path),relative=path.relative(sourceRoot,metadata);
        if(allowedRoots&&!allowedRoots.some(root=>{const r=path.relative(root,sourceRoot);return r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);}))fail('LIBRARY_CAPABILITY','Library folder leaves the current remote capability.');
        if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))fail('LIBRARY_PATH','Library source cannot contain Card Studio metadata.');
        await next.init();await next.boundary();if(next.sourceRoot!==sourceRoot)fail('LIBRARY_CAPABILITY','Library folder changed while selecting.');assertCurrent();signal?.throwIfAborted();
        await atomicReplace(await contained(this.root,'.cardstudio-scean/library-settings.json'),Buffer.from(JSON.stringify({schema_version:1,path:request.path===null?null:next.sourceRoot})),signal);
      }catch(error){await next.close();throw error;}
      this.libraryController.abort(new DOMException('Library root changed','AbortError'));
      const old=this.library,images=this.libraryImages;const retired=Promise.allSettled([images.close(),old.close()]);this.retiredLibraries.add(retired);retired.finally(()=>this.retiredLibraries.delete(retired));
      this.library=next;this.libraryImages=new LibraryImages(next);this.libraryController=new AbortController();this.libraryRevision++;this.libraryError=null;
      return this.librarySettings();
    });
  }
  async operation(action,args,signal,context={}){
    if(!this.bindingContext.getStore())return this.withBindingOperation(action,args,context,()=>this.operation(action,args,signal,context));
    if(!['library','library_copy','library_folder','library_image'].includes(action))return super.operation(action,args,signal,context);
    try{
      assertScopeOperation(this.scopePolicy(),action,args);signal?.throwIfAborted();if(this.closing)fail('CLOSING','Workspace is closing.');
      if(typeof context.sessionId!=='string'||!context.sessionId.trim())fail('SESSION','A trusted DSH Session is required.');
      await this.lifecycle.assertReady(context.sessionId);
      const library=this.library,images=this.libraryImages;signal=AbortSignal.any([this.libraryController.signal,...signal?[signal]:[]]);
      const current=()=>{signal.throwIfAborted();if(library!==this.library)fail('LIBRARY_CHANGED','Library root changed.');};
      if(action==='library_folder'){if(!args||Object.keys(args).some(k=>k!=='status')||args.status!==undefined&&args.status!==true)fail('LIBRARY_ARGUMENT','Library folder accepts no paths.');if(args?.status===true)return {ok:true,value:this.librarySettings()};if(this.libraryError)throw this.libraryError;const folder=await fs.realpath(await library.boundary());current();return {ok:true,value:{...this.librarySettings(),path:folder,relative_path:'library',scope:'workspace'}};}
      if(this.libraryError)throw this.libraryError;
      if(action==='library_image'||action==='library'){const value=await (action==='library_image'?images.read(args,signal):library.operation(args,signal));current();return {ok:true,value:{...value,library_settings:this.librarySettings()}};}
      if(!args||Object.keys(args).some(k=>!['item_id','source_sha256'].includes(k)))fail('LIBRARY_ARGUMENT','Copy accepts only an observed ID and hash.');
      return await this.serial('#workspace-operations',async()=>{
        assertScopeOperation(this.scopePolicy(),action,args);await this.lifecycle.assertReady(context.sessionId);await this.associations();
        current();const source=await library.verified(args,signal);current();
        const value=await this.importBytes({bytes:source.bytes,name:source.row.relative_path.split('/').at(-1),type:'card',librarySource:{item_id:source.row.item_id,source_sha256:source.source_sha256,relative_path:'library/'+source.row.relative_path,source_name:source.row.name}},signal);
        await this.associate(context.sessionId,value.id,{selected:true,created:true,signal});
        return {ok:true,value:{...value,library_source:{item_id:args.item_id,source_sha256:args.source_sha256},synchronization:'Independent working copy. No automatic synchronization with library source.'}};
      });
    }catch(error){return errorResult(error);}
  }
  async close(){this.libraryController.abort();await Promise.allSettled(this.retiredLibraries);await this.libraryImages.close();await this.library.close();await super.close();}
}
