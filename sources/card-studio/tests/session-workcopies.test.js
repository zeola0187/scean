import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CardService} from '../cardstudio-bundle/lib/card-service.js';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';

const workspace=fileURLToPath(new URL('..',import.meta.url));
const root=await fs.mkdtemp(path.join(workspace,'test-run-session-'));
after(async()=>{assert.equal(path.dirname(root),path.resolve(workspace));assert(path.basename(root).startsWith('test-run-session-'));await fs.rm(root,{recursive:true,force:true});});
const source=JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic session fixture',description:'Original',personality:'',scenario:'',first_mes:'Hello',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{opaque:{keep:true}}}});
async function setup(){const dir=path.join(root,randomUUID());await fs.mkdir(dir);const s=new CardService(dir);await s.init();await fs.writeFile(path.join(dir,'imports/synthetic.json'),source);return s;}
async function operation(s,sessionId,action,args={}){const result=await s.operation(action,args,undefined,{sessionId});assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
const importFor=(s,id)=>operation(s,id,'import',{path:'imports/synthetic.json',type:'card'});
const ids=value=>value.items.map(d=>d.id);
async function hashes(dir){const value={};for(const row of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,row.name);if(row.isDirectory()){for(const [key,hash] of Object.entries(await hashes(file)))value[row.name+'/'+key]=hash;}else value[row.name]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}return value;}

test('trusted Session default lists and selections are isolated; request arguments cannot impersonate another Session',async()=>{
 const s=await setup(),a=await importFor(s,'session-A'),b=await importFor(s,'session-B');
 const listA=await operation(s,'session-A','documents',{sessionId:'session-B'}),listB=await operation(s,'session-B','documents');
 assert.deepEqual(ids(listA),[a.id]);assert.equal(listA.selectedId,a.id);assert.deepEqual(ids(listB),[b.id]);assert.equal(listB.selectedId,b.id);
 const all=await operation(s,'session-A','documents',{scope:'all'});assert.equal(all.total,1);assert.equal(all.selectedId,a.id);
 assert.equal((await operation(s,'unbound-chooser','documents',{scope:'all'})).total,2);
 assert.equal((await s.operation('documents',{sessionId:'session-A'})).error.code,'SESSION');
 assert.equal((await s.operation('open',{document_id:a.id,sessionId:'session-A'})).error.code,'SESSION');
 assert.equal((await s.operation('patch',{document_id:a.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Forbidden'}]})).error.code,'SESSION');
 assert.equal((await s.read(a.id)).card.data.description,'Original');await s.close();
});

test('legacy copies stay in All without inferred ownership; explicit reuse records both Sessions and keeps legacy provenance',async()=>{
 const s=await setup(),legacy=await s.import('imports/synthetic.json','card');
 const before=await hashes(path.join(s.root,'.cardstudio-scean/documents'));
 assert.equal((await operation(s,'session-A','documents')).total,0);
 const all=await operation(s,'session-A','documents',{scope:'all'});assert.equal(all.items[0].legacy,true);
 await assert.rejects(fs.stat(path.join(s.root,'.cardstudio-scean/working-copy-sessions.json')),e=>e.code==='ENOENT');
 await operation(s,'session-A','open',{document_id:legacy.id});
 await operation(s,'session-B','open',{document_id:legacy.id});
 const state=await s.associations();assert.deepEqual(state.documents,[{id:legacy.id,origin:'legacy',sessions:['session-A','session-B']}]);
 for(const session of ['session-A','session-B']){const list=await operation(s,session,'documents');assert.equal(list.selectedId,legacy.id);assert.equal(list.items[0].shared,true);assert.equal(list.items[0].legacy,true);}
 assert.deepEqual(await hashes(path.join(s.root,'.cardstudio-scean/documents')),before);await s.close();
});

test('explicit initial open permits a shared card; fixed Sessions reject switching and cross-card reads without new associations',async()=>{
 const s=await setup(),a=await importFor(s,'session-A'),b=await importFor(s,'session-B');
 await operation(s,'session-shared','open',{document_id:a.id});
 assert.equal((await s.operation('open',{document_id:a.id},undefined,{sessionId:'session-B'})).error.code,'SESSION_CARD_BOUND');
 assert.equal((await operation(s,'session-A','documents')).selectedId,a.id);
 assert.equal((await operation(s,'session-B','documents')).selectedId,b.id);
 assert.equal((await s.operation('read',{document_id:b.id,fields:['description']},undefined,{sessionId:'session-A'})).error.code,'SESSION_CARD_MISMATCH');
 assert.equal((await operation(s,'session-A','documents')).selectedId,a.id);
 assert.deepEqual((await s.associations()).documents.find(d=>d.id===b.id).sessions,['session-B']);
 assert.deepEqual(new Set((await s.associations()).documents.find(d=>d.id===a.id).sessions),new Set(['session-A','session-shared']));
 await s.close();const reopened=new CardService(s.root);await reopened.init();
 assert.equal((await operation(reopened,'session-A','documents')).selectedId,a.id);assert.equal((await operation(reopened,'session-B','documents')).selectedId,b.id);await reopened.close();
});

test('two window clients share the service but persist by Session; close, agent disposal and lease expiry preserve histories and exports',async()=>{
 const s=await setup();await s.close();let now=0;
 const agents=new Map(['session-A','session-B'].map(id=>[id,{id,status:'idle',session:{header:{cwd:s.root}},whenIdle:async()=>{},cancel(){throw new Error('Idle synthetic agent cannot cancel');}}]));
 const loader=new WorkspaceLoader({root:s.root,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose:async()=>{}}),now:()=>now});await loader.init();
 function windowClient(pageId){return new WorkspaceClient({root:s.root,pageId,show(){},hide(){},notify(error){throw error;},setTimer:()=>1,clearTimer(){},send:async(id,r)=>{
  const a=agents.get(id);
  if(r.action==='acquire')return {ok:true,value:await loader.acquire(a,r.page_id)};
  if(r.action==='capabilities')return {ok:true,value:{skills:[],tools:[]}};
  if(r.action==='release')return {ok:true,value:await loader.release(a,r.claim)};
  return loader.call(a,loader.records.get(id),r.claim,r.action,r.args??{});
 }});}
 const first=windowClient('synthetic-window-one'),second=windowClient('synthetic-window-two');
 await Promise.all([first.transition({id:'session-A',cwd:s.root}),second.transition({id:'session-B',cwd:s.root})]);
 const [a,b]=await Promise.all([first.call('import',{path:'imports/synthetic.json'}),second.call('import',{path:'imports/synthetic.json'})]);
 await first.call('patch_text',{document_id:a.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Edited'});
 await first.call('export',{document_id:a.id,expected_revision:1,name:'synthetic.json'});
 assert.deepEqual(ids(await first.call('documents')),[a.id]);assert.deepEqual(ids(await second.call('documents')),[b.id]);
 const before=await hashes(path.join(s.root,'.cardstudio-scean/documents')),exportsBefore=await hashes(path.join(s.root,'exports'));
 await first.close();await loader.disposed(agents.get('session-A'));assert.equal(loader.records.has('session-B'),true);
 now=100000;await loader.sweep();await second.close();await loader.close();
 assert.deepEqual(await hashes(path.join(s.root,'.cardstudio-scean/documents')),before);assert.deepEqual(await hashes(path.join(s.root,'exports')),exportsBefore);
 const reopened=new CardService(s.root);await reopened.init();assert.equal((await operation(reopened,'session-A','documents')).selectedId,a.id);assert.equal((await operation(reopened,'session-B','documents')).selectedId,b.id);
 const metadata=JSON.stringify(await reopened.associations());assert(!metadata.includes('synthetic-window'));assert(!metadata.includes('lease'));await reopened.close();
});

test('bounded pages expose every legacy copy beyond the old 100-copy cap, without associating the whole library',async()=>{
 const s=await setup();for(let i=0;i<107;i++)await s.import('imports/synthetic.json','card');
 const found=[];for(const offset of [0,50,100]){const page=await operation(s,'session-A','documents',{scope:'all',offset});assert.equal(page.total,107);assert(page.items.length<=50);found.push(...ids(page));}
 assert.equal(new Set(found).size,107);assert.equal((await operation(s,'session-A','documents')).total,0);
 for(const args of [{scope:'unknown'},{limit:1000},{offset:-1}])assert.equal((await s.operation('documents',args,undefined,{sessionId:'session-A'})).error.code,'LIST');
 await s.close();
});

test('simultaneous association writes retain both sessions; corrupt index fails without replacement',async()=>{
 const s=await setup(),d=await importFor(s,'session-A');await Promise.all(['session-B','session-C'].map(id=>operation(s,id,'open',{document_id:d.id})));
 assert.equal((await s.associations()).documents[0].sessions.length,3);
 const file=path.join(s.root,'.cardstudio-scean/working-copy-sessions.json');await fs.writeFile(file,'{"schemaVersion":77}');
 assert.equal((await s.operation('documents',{},undefined,{sessionId:'session-A'})).error.code,'ASSOCIATIONS');
 assert.equal((await s.operation('patch_text',{document_id:d.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Forbidden'},undefined,{sessionId:'session-A'})).error.code,'ASSOCIATIONS');
 assert.equal((await s.read(d.id)).revision,0);assert.equal(await fs.readFile(file,'utf8'),'{"schemaVersion":77}');await s.close();
});

test('captured Panel generation rejects late responses and chained requests after fast Session switches',async()=>{
 const calls=[];let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const client=new WorkspaceClient({root:'E:/synthetic',pageId:'synthetic-page',show(){},hide(){},notify(error){throw error;},setTimer:()=>1,clearTimer(){},send:async(id,request)=>{
  calls.push([id,request.action]);return request.action==='read'?pending:{ok:true,value:{}};
 }});
 await client.transition({id:'session-A',cwd:'E:/synthetic'});const old=client.bind(),read=old('read',{document_id:'synthetic-old'});
 await client.transition({id:'session-B',cwd:'E:/synthetic'});finish({ok:true,value:{id:'synthetic-old'}});await assert.rejects(read,/previous workspace\/session/);
 const count=calls.length;await assert.rejects(old('book_list',{document_id:'synthetic-old'}),/previous workspace\/session/);assert.equal(calls.length,count);
 await client.transition({id:'session-A',cwd:'E:/synthetic'});await assert.rejects(old('open',{document_id:'synthetic-old'}),/previous workspace\/session/);await client.close();
});
