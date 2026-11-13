// Synthetic scheduler only: never changes tickets or the lock decision.
// Reproduce a legal nonblocking bakery interleaving with real immutable files:
// low sees high choosing; high then sees low ready before low releases.
export function forceBothBusy(stores){
 if(stores.length!==2)throw Error('TWO_SYNTHETIC_STORES_REQUIRED');
 const pending=[];
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);const timer=setTimeout(()=>resolve('timeout'),5000);pending.push(timer);return{promise,resolve};};
 const choosing=deferred(),lowRejected=deferred(),highScanned=deferred();
 const tokens=new Map(),reads=new Map(),trace=[],restores=[];
 const wait=async gate=>{if(await gate.promise==='timeout')throw Error('SYNTHETIC_INTERLEAVING_TIMEOUT');};
 const low=()=>[...tokens.values()].sort()[0];
 for(const store of stores){
  const atomic=store.atomic,active=store.activeTickets;
  store.atomic=async function(file,data,options){
   if(data.phase==='choosing'){
    tokens.set(store,data.token);const result=await atomic.call(this,file,data,options);
    trace.push({event:'choosing-published',token:data.token});if(tokens.size===2)choosing.resolve();await wait(choosing);return result;
   }
   if(data.phase==='ready'&&data.token!==low())await wait(lowRejected);
   if(data.phase==='released'&&data.token===low()){trace.push({event:'low-busy-before-release',token:data.token});lowRejected.resolve();await wait(highScanned);}
   return atomic.call(this,file,data,options);
  };
  store.activeTickets=async function(dir){
   const rows=await active.call(this,dir),count=(reads.get(store)??0)+1;reads.set(store,count);
   trace.push({event:'real-ticket-snapshot',self:tokens.get(store),scan:count,tickets:rows.map(row=>({token:row.token,ticket:row.ticket,phase:row.phase}))});
   if(count===2&&tokens.get(store)!==low())highScanned.resolve();
   return rows;
  };
  restores.push(()=>{store.atomic=atomic;store.activeTickets=active;});
 }
 return {trace,restore(){for(const restore of restores)restore();for(const timer of pending)clearTimeout(timer);}};
}
