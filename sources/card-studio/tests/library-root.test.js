import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LibraryCardService} from '../cardstudio-bundle/lib/library-service.js';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';
import {restoreMethod} from '../cardstudio-bundle/lib/character-method.js';
import {syntheticCard,metadataChunk} from './helpers/png-fixtures.js';
import {pngChunk,sha} from '../cardstudio-bundle/lib/codec.js';
import {deflateSync} from 'node:zlib';
import {nativeHost} from './helpers/current-host.js';
import * as plugin from '../cardstudio-bundle/index.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import {SessionController} from '@deepseek-ai/dsh-api-session-controller';
const call=(s,a,args={})=>s.operation(a,args,undefined,{sessionId:'root-test'});
const ref=r=>({item_id:r.item_id,source_sha256:r.source_sha256});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function png(){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),metadataChunk('ccv3',syntheticCard(3)),pngChunk('IDAT',deflateSync(Buffer.from([0,50,60,70,255]))),pngChunk('IEND',Buffer.alloc(0))]);}
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-root-')),root=path.join(base,'Workspace'),a=path.join(base,'Cards A'),b=path.join(base,'Cards B');for(const d of [root,a,b])await fs.mkdir(d);const state={base,root,a,b,s:new LibraryCardService(root)};await state.s.init();t.after(async()=>{await state.s.close();assert.equal(path.dirname(base),os.tmpdir());assert(path.basename(base).startsWith('cardstudio-root-'));await fs.rm(base,{recursive:true,force:true});});return state;}
const choose=(s,p)=>s.setLibraryRoot({path:p,expected_revision:s.libraryRevision});
test('default compatibility; independent roots share list/search/image/copy/folder and restart setting; source bytes unchanged',async t=>{
 const f=await fixture(t),{root,a,b}=f,s=f.s,bytes=png();await fs.writeFile(path.join(root,'library','default.json'),JSON.stringify(syntheticCard(3)));await fs.writeFile(path.join(a,'same.png'),bytes);await fs.writeFile(path.join(b,'same.png'),bytes);
 assert.equal((await call(s,'library_folder')).value.path,await fs.realpath(path.join(root,'library')));assert.equal((await call(s,'library',{action:'list'})).value.total,1);
 await choose(s,a);const listed=await call(s,'library',{action:'list'});assert(listed.ok);const row=listed.value.items[0];assert.equal(listed.value.source_path,await fs.realpath(a));assert.equal((await call(s,'library',{action:'search',query:row.name})).value.items[0].item_id,row.item_id);assert((await call(s,'library_image',ref(row))).ok);
 const copy=await call(s,'library_copy',ref(row));assert(copy.ok,JSON.stringify(copy));assert.equal((await s.selectedDocument('root-test')).document_id,copy.value.id);assert((await call(s,'library_folder')).value.path===await fs.realpath(a));
 const oldIndex=s.library,cache=oldIndex.cacheRoot;await choose(s,b);assert.equal(s.libraryImages.cache.size,0);assert.notEqual(s.library.cacheRoot,cache);assert.equal((await call(s,'library',{action:'read',...ref(row)})).ok,false);const other=(await call(s,'library',{action:'list'})).value.items[0];assert.notEqual(row.item_id,other.item_id);
 await s.close();f.s=new LibraryCardService(root);await f.s.init();assert.equal((await call(f.s,'library_folder')).value.path,await fs.realpath(b));assert.equal((await call(f.s,'library',{action:'list'})).value.items[0].item_id,other.item_id);
 await choose(f.s,null);await f.s.close();f.s=new LibraryCardService(root);await f.s.init();assert.equal(f.s.librarySettings().custom,false);assert.equal((await call(f.s,'library',{action:'list'})).value.items[0].relative_path,'default.json');
 for(const dir of [a,b]){assert.deepEqual(await fs.readdir(dir),['same.png']);assert.equal(sha(await fs.readFile(path.join(dir,'same.png'))),sha(bytes));}
});
test('missing/file/relative/metadata-containing paths fail without changing persisted choice; missing saved root is recoverable',async t=>{
 const f=await fixture(t);await choose(f.s,f.a);const before=await fs.readFile(path.join(f.root,'.cardstudio-scean/library-settings.json'));await fs.writeFile(path.join(f.base,'file'),'x');
 for(const p of [path.join(f.base,'missing'),path.join(f.base,'file'),'relative',f.root])await assert.rejects(choose(f.s,p));assert.deepEqual(await fs.readFile(path.join(f.root,'.cardstudio-scean/library-settings.json')),before);assert.equal(f.s.librarySettings().path,await fs.realpath(f.a));
 await f.s.close();await fs.rename(f.a,f.a+'-moved');f.s=new LibraryCardService(f.root);await f.s.init();assert.equal(f.s.librarySettings().error.code,'ENOENT');assert.equal((await call(f.s,'library',{action:'list'})).ok,false);assert((await call(f.s,'library_folder',{status:true})).ok);await choose(f.s,f.b);assert.equal((await call(f.s,'library',{action:'list'})).value.total,0);
});
test('blocked old scan/image and concurrent switches cannot publish into new root or return successful old receipt',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.a,'a.png'),png());await choose(f.s,f.a);const row=(await call(f.s,'library',{action:'list'})).value.items[0],old=f.s.library,entered=deferred(),release=deferred(),read=old.stableRead.bind(old);let blocked=false;
 old.stableRead=async(...args)=>{if(!blocked){blocked=true;entered.resolve();await release.promise;}return read(...args);};
 const scan=call(f.s,'library',{action:'refresh'});await entered.promise;await choose(f.s,f.b);const second=await call(f.s,'library',{action:'list'});assert.equal(second.value.total,0);release.resolve();assert.equal((await scan).ok,false);assert.equal(f.s.library.rows.size,0);assert.equal((await call(f.s,'library_image',ref(row))).ok,false);
 const revision=f.s.libraryRevision,result=await Promise.allSettled([f.s.setLibraryRoot({path:f.a,expected_revision:revision}),f.s.setLibraryRoot({path:f.b,expected_revision:revision})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.find(x=>x.status==='rejected').reason.code,'LIBRARY_CHANGED');
});
test('human root bridge requires lease, is absent from generic actions and tools, and tools use selected root',async t=>{
 const f=await fixture(t),old=process.env.DSH_HOME;process.env.DSH_HOME=path.join(f.base,'home');const host=await nativeHost(process.env.DSH_HOME,plugin);t.after(async()=>{await host.close();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;});const root=host.registry.list()[0].path,agent=host.agent('root-host',root),claim=(await host.request(agent,{action:'acquire',page_id:'root-human-page-0001'})).value;
 await fs.writeFile(path.join(f.a,'one.json'),JSON.stringify(syntheticCard(3)));const bridge=host.ctx.get('cardstudioSceanBridge');assert.equal((await host.request(agent,{action:'setLibraryRoot',claim,args:{path:f.a}})).error.code,'ACTION');assert.equal((await bridge.setLibraryRoot(agent,{path:f.a,expected_revision:0,claim:{...claim,lease_id:'wrong'}})).ok,false);
 const deniedExternal=await bridge.setLibraryRoot(agent,{path:f.a,expected_revision:0,claim});assert.equal(deniedExternal.ok,false);assert.equal(deniedExternal.error.code,'LIBRARY_CAPABILITY');
 const allowed=path.join(root,'authorized-library');await fs.mkdir(allowed);await fs.copyFile(path.join(f.a,'one.json'),path.join(allowed,'one.json'));
 const savedRoot=await bridge.setLibraryRoot(agent,{path:allowed,expected_revision:0,claim});assert(savedRoot.ok,JSON.stringify(savedRoot));const tool=host.ctx.tools.get('cardstudio_scean_library',agent);const result=await tool.execute({action:'list'},{agent,signal:new AbortController().signal});assert(result.ok,JSON.stringify(result));assert.equal(result.value.items[0].relative_path,'one.json');assert.equal((await host.request(agent,{action:'library_folder',claim,args:{}})).value.path,await fs.realpath(allowed));assert.equal(host.ctx.tools.schemas(agent).length,29);
});
test('fresh default is installed character-authoring; explicit original and existing history keep their safety boundaries',()=>{
 const fresh={session:{snapshotEvents:()=>[]}},past={session:{snapshotEvents:()=>[{type:'user/message'}]}};assert.equal(restoreMethod(undefined,fresh).name,'character-authoring');assert.equal(restoreMethod(undefined,past).name,'character-authoring');assert(restoreMethod(undefined,past).locked);
 const saved={name:'palette-personality-reconstruction',epoch:7,locked:false,reason:'fresh'};assert.equal(restoreMethod(saved,fresh).name,null);assert.equal(restoreMethod(saved,past).name,null);assert(restoreMethod(saved,past).locked);
});
test('Client rejects late Library and folder-picker receipt after root or Session changes',async()=>{
 const gate=deferred(),changed=[];let slow=false;const c=new WorkspaceClient({root:'C:/Test',pageId:'root-client',show(){},hide(){},notify(){},setTimer:()=>1,clearTimer(){},send:async(id,r)=>slow?gate.promise:{ok:true,value:{lease_id:id}},sendLibrary:async()=>gate.promise});c.libraryChanged=x=>changed.push(x);await c.transition({id:'A',cwd:'C:/Test'});slow=true;const pending=c.call('library',{action:'list'});c.updateLibrary({path:'C:/New',revision:1});gate.resolve({ok:true,value:{items:['old']}});await assert.rejects(pending,/previous Library/);slow=false;
 const next=deferred();c.sendLibrary=()=>next.promise;const setting=c.setLibraryRoot('C:/Old');await c.transition({id:'B',cwd:'C:/Test'});next.resolve({ok:true,value:{path:'C:/Old',revision:2}});await assert.rejects(setting,/previous Session/);assert.equal(changed.length,1);await c.close();
});
test('unreadable source is rejected under a real Node filesystem permission fence without changing settings',async t=>{
 const f=await fixture(t),repo=fileURLToPath(new URL('..',import.meta.url)),worker=fileURLToPath(new URL('./library-root-permission-worker.js',import.meta.url));await f.s.close();
 const result=await promisify(execFile)(process.execPath,['--permission','--allow-fs-read='+repo,'--allow-fs-read='+f.root,'--allow-fs-write='+f.root,worker,f.root,f.a]);assert(result.stdout.includes('permission-denied-preserves-default'));
});
test('late lower-revision root metadata cannot roll back the Client root',()=>{
 const c=new WorkspaceClient({});c.updateLibrary({path:'C:/B',revision:2});c.updateLibrary({path:'C:/A',revision:1});assert.equal(c.librarySettings.path,'C:/B');
});
test('selected external folder is accepted by the actual Host Windows open-folder verifier',async t=>{
 const f=await fixture(t);await choose(f.s,f.a);const ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd:f.root});try{const desktop={ctx:{fs:ctx.fs},verifyDesktopPath:SessionController.prototype.verifyDesktopPath},folder=(await call(f.s,'library_folder')).value.path;assert.equal(await desktop.verifyDesktopPath(folder,new AbortController().signal),folder);}finally{await ctx.fiber.dispose();}
});
test('pending old image and direct index scan cannot populate the replacement root cache',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.a,'a.png'),png());await choose(f.s,f.a);const row=(await call(f.s,'library',{action:'list'})).value.items[0],index=f.s.library,images=f.s.libraryImages,entered=deferred(),release=deferred(),read=index.stableRead.bind(index);
 index.stableRead=async(...args)=>{entered.resolve();await release.promise;return read(...args);};const image=call(f.s,'library_image',ref(row)),scan=index.scan();const scanDone=scan.then(()=>false,()=>true);await entered.promise;await choose(f.s,f.b);release.resolve();assert.equal((await image).ok,false);assert(await scanDone);await images.close();assert.equal(images.cache.size,0);assert.equal(f.s.libraryImages.cache.size,0);assert.equal(f.s.library.rows.size,0);
});
test('Windows NTFS directory read denial is surfaced and leaves the current Library setting unchanged',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),principal=(process.env.USERDOMAIN?process.env.USERDOMAIN+'\\':'')+os.userInfo().username,run=promisify(execFile);
 await run('icacls.exe',[f.a,'/deny',principal+':(RD)']);
 try{await assert.rejects(choose(f.s,f.a),error=>['EACCES','EPERM'].includes(error.code));assert.equal(f.s.librarySettings().custom,false);assert.equal((await call(f.s,'library',{action:'list'})).ok,true);}
 finally{await run('icacls.exe',[f.a,'/remove:d',principal]);}
});
