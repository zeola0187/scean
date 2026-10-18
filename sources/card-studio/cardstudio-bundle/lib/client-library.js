// Embedded by the existing client build; only readonly text/pixel projections.
export function createLibraryComponents({React,h,ctx,t,controller,useUpdates,css,viewCache,isDirty,getFolderRemote}) {
  const cache=new Map();let imagesEnabled=false;
  const ref=row=>({item_id:row.item_id,source_sha256:row.source_sha256});
  function ReadonlyDocumentViewer({projection,onMore}){
    if(!projection)return null;
    return h('section',{'data-view':'readonly-document',className:'csscean-box csscean-readonly'},h('p',{className:'csscean-badge csscean-notice','data-coverage':projection.coverage},t('libraryCoverage')+' · '+projection.coverage),
      ...(projection.evidence??[]).map(row=>h('article',{key:row.locator,className:'csscean-section-space'},h('strong',null,t('field_'+row.field)===('field_'+row.field)?row.field:t('field_'+row.field)),h('p',{className:'csscean-muted csscean-path csscean-mono'},row.locator+' · '+row.raw_start+'–'+row.raw_end+' / '+row.total_characters),h('pre',{className:'csscean-prose','data-evidence':row.locator},row.text),onMore&&row.raw_end<row.total_characters?h('button',{className:'csscean-button',onClick:()=>onMore(row)},t('libraryMore')):null)),
      projection.omitted?h('p',{role:'note'},t('libraryOmitted')+' '+projection.omitted):null);
  }
  // Visible consumers own cache entries. Offscreen/unmounted consumers release
  // them; new visible/selected rows can evict LRU entries. Only one RPC runs,
  // and every late reply is guarded by generation, visibility and Session.
  function gallery(){
    const g={items:new Map(),visible:new Map(),listeners:new Set(),epoch:0,running:false,enabled:false};
    g.emit=()=>{for(const fn of g.listeners)fn();};
    g.clear=()=>{g.epoch++;g.items.clear();g.visible.clear();g.emit();};
    g.touch=key=>{const image=g.items.get(key);if(image){g.items.delete(key);g.items.set(key,image);}};
    g.pump=()=>{
      if(!g.enabled||g.running)return;
      const next=[...g.visible.entries()].reverse().find(([,view])=>view.want&&view.valid());
      if(!next)return;const [key,view]=next,epoch=g.epoch;view.want=false;g.running=true;
      (async()=>{
        let result;try{result=await view.call('library_image',ref(view.row));if(typeof result.data_url!=='string'||!result.data_url.startsWith('data:image/png;base64,')||result.bytes>524288||result.width>256||result.height>256)throw new Error(t('libraryImageUnavailable'));}
        catch(error){result={error:error.message};}
        if(g.enabled&&epoch===g.epoch&&g.visible.has(key)&&view.valid()){
          g.items.delete(key);g.items.set(key,result);
          while(g.items.size>4||[...g.items.values()].reduce((n,x)=>n+(x.bytes??0),0)>2097152)g.items.delete(g.items.keys().next().value);
          g.emit();
        }
      })().finally(()=>{g.running=false;g.pump();});
    };
    g.release=(key,token)=>{
      const view=g.visible.get(key);if(!view)return;view.tokens.delete(token);
      if(!view.tokens.size){g.visible.delete(key);if(g.items.delete(key))g.emit();}
      g.pump();
    };
    g.view=(row,token,visible,call,valid)=>{
      const key=row.item_id+':'+row.source_sha256;
      if(!visible){g.release(key,token);return;}
      if(!g.enabled||!valid())return;
      let view=g.visible.get(key);
      if(!view){view={row,call,valid,tokens:new Set(),want:!g.items.has(key)};g.visible.set(key,view);}
      if(!view.tokens.has(token)){view.tokens.add(token);if(!g.items.has(key))view.want=true;else g.touch(key);}
      g.pump();
    };
    return g;
  }
  function SourceImage({row,manager,call,valid,epoch}){
    const node=React.useRef(null),[,update]=React.useReducer(n=>n+1,0),key=row.item_id+':'+row.source_sha256;
    React.useEffect(()=>{let active=true;const token=Symbol('visible-image'),change=()=>{if(active)update();};manager.listeners.add(change);
      const root=node.current.closest('.csscean-panel');
      const measure=()=>{const bounds=node.current.getBoundingClientRect(),clip=root?.getBoundingClientRect();manager.view(row,token,bounds.width>0&&bounds.height>0&&bounds.bottom>Math.max(0,clip?.top??0)&&bounds.top<Math.min(window.innerHeight,clip?.bottom??window.innerHeight)&&bounds.right>Math.max(0,clip?.left??0)&&bounds.left<Math.min(window.innerWidth,clip?.right??window.innerWidth),call,valid);};
      const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(measure,{root}):null;
      if(observer)observer.observe(node.current);root?.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);measure();
      return()=>{active=false;observer?.disconnect();root?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);manager.listeners.delete(change);manager.release(key,token);};
    },[key,epoch]);
    const image=manager.items.get(key);
    return h('figure',{ref:node,className:'csscean-library-image','data-image-source':row.item_id},image?.data_url?h('img',{src:image.data_url,alt:row.relative_path,width:128,height:128,decoding:'async',loading:'lazy'}):h('span',{className:'csscean-muted'},image?.error??t('libraryImageWaiting')),h('figcaption',{className:'csscean-muted',title:row.relative_path},row.relative_path));
  }
  function LibraryPanel({sequence}){
    useUpdates();const sessionId=controller.current?.id,ready=controller.phase==='ready',rootEpoch=controller.librarySequence,cacheKey=sessionId+':'+rootEpoch;
    const [v,setView]=React.useState(()=>cache.get(cacheKey)??{list:null,query:'',selected:null,projection:null,versions:null,entries:null,entry:null,error:'',offset:0,sourceStale:false});
    const [busy,setBusy]=React.useState(false),[scanBusy,setScanBusy]=React.useState(false),[folderAvailable,setFolderAvailable]=React.useState(false),[showImages,setShowImages]=React.useState(imagesEnabled),[imageEpoch,setImageEpoch]=React.useState(0);
    const [libraryPath,setLibraryPath]=React.useState(controller.librarySettings?.path??controller.root+'/library');
    const state=React.useRef(v),live=React.useRef(true),lock=React.useRef(false),scanLock=React.useRef(false),selection=React.useRef(0),listing=React.useRef(0),images=React.useRef(null);state.current=v;
    if(!images.current)images.current=gallery();images.current.enabled=showImages;
    const call=controller.bind(sequence),valid=()=>live.current&&controller.sequence===sequence&&controller.librarySequence===rootEpoch;
    const setV=change=>{if(!valid())return;const next={...state.current,...change};state.current=next;cache.set(cacheKey,next);setView(next);};
    const run=async fn=>{if(!valid()||lock.current)return;lock.current=true;setBusy(true);setV({error:''});try{await fn();}catch(error){if(valid())setV({error:error.message});}finally{lock.current=false;if(valid())setBusy(false);}};
    const source=()=>ref(state.current.selected);
    const list=async(offset=0)=>{const ticket=++listing.current,query=state.current.query,value=await call('library',{action:query.trim()?'search':'list',...query.trim()?{query,limit:20}:{offset,limit:20}});if(ticket===listing.current&&query===state.current.query)setV({list:value,offset});};
    const open=async row=>{
      const ticket=++selection.current,args=ref(row),projection=await call('library',{action:'read',...args,budget:12000}),entries=await call('library',{action:'entries',...args,limit:20});
      if(ticket===selection.current)setV({selected:row,projection,entries,entry:null,versions:null,sourceStale:false,error:''});
    };
    const refresh=async(rebuild=false)=>{
      if(!valid()||scanLock.current)return;scanLock.current=true;setScanBusy(true);setV({error:''});
      try{
        await call('library',{action:rebuild?'rebuild':'refresh'});await list(state.current.offset);
        images.current.clear();if(valid())setImageEpoch(n=>n+1);
        const ticket=selection.current,row=state.current.selected;
        if(row)try{await call('library',{action:'read',...ref(row),fields:['name'],budget:256});if(ticket===selection.current)setV({sourceStale:false});}
        catch(error){if(ticket===selection.current&&!lock.current&&state.current.selected?.item_id===row.item_id&&state.current.selected?.source_sha256===row.source_sha256){setV({projection:null,entry:null,versions:null,entries:null,sourceStale:true});throw error;}}
      }catch(error){if(valid())setV({error:error.message});}
      finally{scanLock.current=false;if(valid())setScanBusy(false);}
    };
    React.useEffect(()=>{live.current=true;if(ready)refresh();return()=>{live.current=false;images.current.enabled=false;images.current.clear();};},[ready]);
    const remote=getFolderRemote?.();
    React.useEffect(()=>{let active=true;setFolderAvailable(false);if(remote?.canOpenWorkspacePath&&remote?.openWorkspacePath)remote.canOpenWorkspacePath().then(result=>{if(active)setFolderAvailable(result?.ok===true&&result.value===true);}).catch(()=>{});return()=>{active=false;};},[remote]);
    const button=(label,fn,disabled=false,className='')=>h('button',{className:'csscean-button '+className,disabled:busy||!ready||disabled,onClick:()=>run(fn)},t(label));
    const scanButton=(label,rebuild=false)=>h('button',{className:'csscean-button '+(rebuild?'csscean-maintenance':''),disabled:scanBusy||!ready,onClick:()=>refresh(rebuild)},t(label));
    const pages=(rows,load)=>rows?h('div',{className:'csscean-row'},h('span',null,rows.total??rows.items.length),button('previous',()=>load(Math.max(0,(rows.offset??0)-20)),!(rows.offset>0)),button('next',()=>load((rows.offset??0)+20),!(rows.total>(rows.offset??0)+20))):null;
    const image=row=>showImages&&row?.format==='png'?h(SourceImage,{row,manager:images.current,call,valid,epoch:imageEpoch}):null;
    return h('div',{className:'csscean-panel','data-page':'library'},h('style',null,css),h('div',{className:'csscean-shell'},
      h('div',{className:'csscean-row csscean-head csscean-toolbar'},h('h2',null,t('library')+' 1.2.0'),h('span',{className:'csscean-spacer'}),h('button',{className:'csscean-button',disabled:busy,onClick:()=>ctx.layout.selectPanel('local-cardstudio-scean-materials')},t('materials')),h('button',{className:'csscean-button',disabled:busy,onClick:()=>ctx.layout.selectPanel('local-cardstudio-scean')},t('title')),h('button',{className:'csscean-button',disabled:busy,onClick:()=>ctx.layout.selectPanel(null)},t('back'))),
      h('p',{className:'csscean-path csscean-mono'},controller.librarySettings?.path??controller.root+'/library/'),h('p',{role:'note',className:'csscean-notice csscean-readonly'},t('libraryHint')),
      h('p',{className:'csscean-muted'},t('libraryFolderHint')),h('div',{className:'csscean-row'},h('input',{'aria-label':t('libraryChooseFolder'),value:libraryPath,maxLength:1024,onChange:event=>setLibraryPath(event.target.value)}),button('libraryChooseFolder',()=>controller.setLibraryRoot(libraryPath,sequence),!libraryPath.trim()),button('libraryDefaultFolder',()=>controller.setLibraryRoot(null,sequence),!controller.librarySettings?.custom)),
      controller.librarySettings?.error?h('p',{role:'alert',className:'csscean-error'},controller.librarySettings.error.code+': '+controller.librarySettings.error.message):null,
      h('details',null,h('summary',null,t('libraryAgent')),h('p',null,t('libraryAgentHint')),h('code',null,'cardstudio_scean_library · search → read / entries / entry')),
      h('div',{className:'csscean-row'},h('input',{'aria-label':t('librarySearch'),placeholder:t('librarySearch'),value:v.query,onChange:e=>setV({query:e.target.value}),onKeyDown:e=>{if(e.key==='Enter')run(()=>list());}}),button('search',()=>list()),scanButton('refresh'),scanButton('libraryRebuild',true),button('libraryOpenFolder',async()=>{const folder=await call('library_folder',{});if(typeof folder.path!=='string'||!remote?.openWorkspacePath)throw new Error(t('folderUnavailable'));const result=await remote.openWorkspacePath({path:folder.path});if(result?.ok!==true)throw new Error(result?.error?.message??t('folderUnavailable'));},!folderAvailable)),
      h('label',{className:'csscean-library-toggle'},h('input',{type:'checkbox',checked:showImages,onChange:e=>{imagesEnabled=e.target.checked;images.current.clear();setShowImages(imagesEnabled);setImageEpoch(n=>n+1);}}),' '+t('libraryImages')),
      showImages?h('p',{className:'csscean-muted'},t('libraryImageHint')):null,
      h('p',{role:v.error?'alert':'status','aria-live':'polite','aria-busy':busy||scanBusy,className:'csscean-muted csscean-library-status'+(v.error?' csscean-error':''),'data-error':!!v.error,title:v.error||undefined},v.error||(busy?t('working'):scanBusy?t('libraryScanning'):t('libraryIdle'))),
      v.list?h('p',{className:'csscean-notice','data-complete':v.list.complete},t(v.list.complete?'libraryComplete':'libraryIncomplete')+' · '+v.list.source_count+' · '+v.list.index_generation):null,
      v.list?.diagnostics?.length?h('details',null,h('summary',null,t('diagnostics')),h('pre',null,JSON.stringify(v.list.diagnostics,null,2))):null,
      h('div',{className:'csscean-grid'},h('aside',{className:'csscean-side'},h('section',{className:'csscean-box'},h('div',{className:'csscean-list'},...(v.list?.items??[]).map(row=>h('article',{key:row.item_id},image(row.image_source?{...row.image_source,format:'png'}:row),buttonRow(row),...(row.evidence??[]).map(e=>h('p',{key:e.locator,className:'csscean-summary'},e.field+' · '+e.text))))),!v.query.trim()?pages(v.list,list):null)),
        v.selected?h('section',{className:'csscean-view csscean-box csscean-library-selection','data-stale':v.sourceStale},h('h3',null,v.selected.name),h('p',{className:'csscean-muted csscean-path csscean-mono'},v.selected.relative_path+' · '+v.selected.source_sha256),h('p',{className:'csscean-notice csscean-readonly'},t('libraryReadonly')),!v.sourceStale?image(v.selected):null,
          h('div',{className:'csscean-row'},button('libraryCopy',async()=>{
            if(isDirty(viewCache.get(sessionId)??{}))throw new Error(t('libraryDraft'));
            await call('library_copy',source());viewCache.delete(sessionId);ctx.layout.selectPanel('local-cardstudio-scean');
          },v.sourceStale,'csscean-primary'),button('libraryVersions',async()=>setV({versions:await call('library',{action:'variants',...source(),limit:20})}),v.sourceStale)),
          v.versions?h('section',{className:'csscean-box'},h('p',null,t('libraryIdentity')),h('div',{className:'csscean-list'},...v.versions.items.map(buttonRow)),pages(v.versions,async offset=>setV({versions:await call('library',{action:'variants',...source(),offset,limit:20})}))):null,
          v.projection?.warnings?.length?h('details',null,h('summary',null,t('diagnostics')),h('pre',null,JSON.stringify(v.projection.warnings,null,2))):null,
          h('div',{className:'csscean-row'},...['description','personality','scenario','first_mes','alternate_greetings','mes_example','creator_notes','system_prompt','post_history_instructions','tags','creator'].map(field=>button('field_'+field,async()=>setV({projection:await call('library',{action:'read',...source(),fields:[field],budget:12000}),entry:null}),v.sourceStale))),
          h(ReadonlyDocumentViewer,{projection:v.entry??v.projection,onMore:row=>run(async()=>setV({entry:null,projection:await call('library',{action:'read',...source(),locators:[row.locator],offset:row.raw_end,budget:12000})}))}),
          h('section',{className:'csscean-box csscean-section-space'},h('h3',null,t('book')),h('div',{className:'csscean-list'},...(v.entries?.items??[]).map(entry=>h('button',{key:entry.index,className:'csscean-button',disabled:busy||v.sourceStale,onClick:()=>run(async()=>setV({entry:await call('library',{action:'entry',...source(),entry_index:entry.index,budget:12000})}))},entry.comment||entry.keys.join(', ')||String(entry.index),h('small',{className:'csscean-muted'},' · '+t(entry.enabled?'enabled':'disabled'))))),pages(v.entries,async offset=>setV({entries:await call('library',{action:'entries',...source(),offset,limit:20})})))):h('p',null,t('libraryChoose')))));
    function buttonRow(row){return h('button',{key:row.item_id,className:'csscean-button csscean-tile','data-selected':v.selected?.item_id===row.item_id&&v.selected?.source_sha256===row.source_sha256,disabled:busy||!ready||row.state!=='ready'||row.freshness&&row.freshness!=='verified',onClick:()=>run(()=>open(row))},h('strong',null,row.name),h('span',{className:'csscean-muted csscean-path'},(row.format??row.relative_path?.split('.').pop()?.toLowerCase()??'')+' · '+row.relative_path),h('span',{className:'csscean-muted'},(row.tags??[]).join(' · ')),h('small',null,row.error?.code??row.freshness??row.coverage),row.source_count>1?h('small',null,t('libraryVersions')+' · '+row.source_count):null);}
  }
  return {LibraryPanel,ReadonlyDocumentViewer};
}
