// Acceptance-only durable shared call reservation. No monetary ceiling.
import fs from 'node:fs/promises';import path from 'node:path';
export function createPaidGate(root){
 const dir=path.join(root,'private'),file=path.join(dir,'paid-counter.json'),lockPath=path.join(dir,'paid-counter.lock');
 let queue=Promise.resolve();
 const reserve=async request=>{
  await fs.mkdir(dir,{recursive:true});let lock;
  for(let n=0;n<1000;n++){try{lock=await fs.open(lockPath,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,10));}}
  if(!lock)throw Object.assign(Error('Counter contention'),{code:'PAID_COUNTER_LOCKED'});
  try{
   let counter;try{counter=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;counter={schemaVersion:1,limit:60,reservations:[]};}
   if(counter.schemaVersion!==1||counter.limit!==60||!Array.isArray(counter.reservations)||counter.reservations.length>60)throw Object.assign(Error('Counter invalid'),{code:'PAID_COUNTER_CORRUPT'});
   if(counter.reservations.length>=60)throw Object.assign(Error('Call limit'),{code:'GENERATION_LIMIT_REACHED'});
   const row={sequence:counter.reservations.length+1,id:request.requestId,stage:request.meta.stage,requestId:request.meta.requestId,attemptId:request.meta.attemptId,requestedModel:request.meta.provider+'/'+request.meta.model,status:'reserved',at:new Date().toISOString()};
   if(counter.reservations.some(r=>r.id===row.id))throw Object.assign(Error('Reservation duplicate'),{code:'PAID_RESERVATION_CONFLICT'});
   counter.reservations.push(row);const h=await fs.open(file+'.tmp','w');try{await h.writeFile(JSON.stringify(counter,null,2));await h.sync();}finally{await h.close();}await fs.rename(file+'.tmp',file);return row.id;
  }finally{await lock.close();await fs.unlink(lockPath);}
 };
 return {reserve(request){const work=queue.then(()=>reserve(request));queue=work.catch(()=>{});return work;},async settle(id,result){await fs.appendFile(path.join(dir,'paid-settlements.jsonl'),JSON.stringify({id,...result,at:new Date().toISOString()})+'\n');}};
}
