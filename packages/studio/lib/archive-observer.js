import {archiveIds} from './archive-lifecycle.js';

/** Mirrors the installed WorkspaceFeed's committed domain/changed contract.
 * The event payload is authoritative: WorkspaceRegistry's cache is updated only
 * after global.set returns, so reading its getter inside the event can be stale. */
export function observeSessionArchives(ctx,loader,onState=()=>{}){
  let poll=null,generation=0;
  const report=facts=>Promise.resolve(onState(facts)).catch(()=>{});
  ctx.inject(['workspaceRegistry'],function cardstudioArchiveLifecycle(scope){
    const own=++generation;let tail=Promise.resolve(),settledKey=null,inflight=null;
    function accept(value){
      let ids,key;
      try{ids=archiveIds(value);key=JSON.stringify([...ids].sort());}
      catch(error){settledKey=null;void report({state:'error',code:'ARCHIVE_STATE'});return Promise.resolve();}
      if(key===settledKey&&!inflight)return tail;
      if(inflight?.key===key)return inflight.promise;
      const work=loader.setArchiveState(ids);
      const promise=work.then(()=>{settledKey=key;if(own===generation)return report({state:'ready'});},error=>{
        settledKey=null;if(own===generation)return report({state:'error',code:['ARCHIVE_STATE','RECYCLE_PATH','RECYCLE_JOURNAL','RECYCLE_CONFLICT','RECYCLE_MISSING','RECYCLE_ASSOCIATION'].includes(error.code)?error.code:'RECYCLE_IO'});
      }).finally(()=>{if(inflight?.promise===promise)inflight=null;});
      inflight={key,promise};tail=promise;return promise;
    }
    scope.on('domain/changed',change=>{
      if(change?.domain==='workspace'&&change.table===''&&change.key===''&&change.operation==='put')void accept(change.value?.archivedSessionIds);
    });
    const sync=()=>{
      try{return accept([...scope.workspaceRegistry.archivedSessionIds]);}
      catch(error){return report({state:'error',code:'ARCHIVE_STATE'});}
    };
    poll=sync;void sync();
    scope.effect(()=>async()=>{if(own===generation){++generation;poll=null;await report({state:'unavailable'});}await tail;},'cardstudio archive lifecycle cleanup');
  });
  return {sync:()=>poll?.()??Promise.resolve()};
}
