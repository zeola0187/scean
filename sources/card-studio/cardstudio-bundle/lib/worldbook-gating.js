import { canonical,clone,sha,fail } from './codec.js';
import { assertNarrativeText } from './authoring-scope.js';
import { targetInputStamp } from './target-state.js';

export const GATE_VERSION=1;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safe=x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e9;
const hhmm=x=>typeof x==='string'&&/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(x);
const exact=(o,keys)=>object(o)&&Object.keys(o).every(k=>keys.includes(k));
const rows=card=>Array.isArray(card.data.character_book?.entries)?card.data.character_book.entries:[];
export const gateEntryHash=entry=>sha(canonical(entry));
const hasForeign=body=>/<%|(^|\n)\s*@@/.test(body);
const boundedDiagnostics=items=>items.length<=64?items:[...items.slice(0,64),{code:'GATE_DIAGNOSTICS_OMITTED',severity:'error',count:items.length-64,message:'Resolve listed issues and rerun to inspect the remaining diagnostics.'}];

export function validateGateRule(rule,fields) {
  if(!exact(rule,['schemaVersion','predicate','partition'])||rule.schemaVersion!==GATE_VERSION)fail('GATE_SCHEMA','Use gate schemaVersion 1 and predicate; permanent unlock and date/day rules are unsupported.');
  let count=0;const leaves=[];
  const walk=(n,depth)=>{
    if(++count>32||depth>4)fail('GATE_LIMIT','At most 32 nodes and 4 levels are allowed.');
    if(!object(n))fail('GATE_RULE','Expected a typed predicate.');
    if(['and','or'].includes(n.op)){
      if(!exact(n,['op','args'])||!Array.isArray(n.args)||n.args.length<2||n.args.length>8)fail('GATE_RULE','AND/OR require 2–8 predicates.');
      n.args.forEach(c=>walk(c,depth+1));return;
    }
    const m=typeof n.path==='string'&&/^values\.([a-z][a-z0-9_-]{0,63})$/.exec(n.path),key=m?.[1];
    if(!safe(key)||!Object.hasOwn(fields,key))fail('GATE_PATH','Only declared values.<field> paths in the target message snapshot are allowed.');
    const field=fields[key],scalar=v=>field.type==='number'?finite(v):field.type==='boolean'?typeof v==='boolean':field.type==='string'?typeof v==='string'&&v.length<=256&&(!field.enum||field.enum.includes(v)):false;
    if(n.op==='eq'){
      if(!exact(n,['op','path','value'])||!scalar(n.value))fail('GATE_TYPE','eq needs a matching number, boolean, or string/enum value.');
    }else if(['lt','lte','gt','gte'].includes(n.op)){
      if(!exact(n,['op','path','value'])||field.type!=='number'||!finite(n.value))fail('GATE_TYPE','Numeric comparison requires a number field and finite number.');
    }else if(n.op==='range'){
      if(!exact(n,['op','path','min','max','includeMin','includeMax'])||field.type!=='number'||!finite(n.min)||!finite(n.max)||n.min>=n.max||typeof n.includeMin!=='boolean'||typeof n.includeMax!=='boolean')fail('GATE_TYPE','range needs numeric min < max and explicit includeMin/includeMax.');
    }else if(n.op==='in'){
      if(!exact(n,['op','path','values'])||field.type!=='string'||!Array.isArray(n.values)||n.values.length<1||n.values.length>16||n.values.some(v=>!scalar(v))||new Set(n.values).size!==n.values.length)fail('GATE_TYPE','in needs 1–16 distinct matching strings/enum values.');
    }else if(n.op==='contains'){
      if(!exact(n,['op','path','value'])||field.type!=='array'||typeof n.value!=='string'||n.value.length>256)fail('GATE_TYPE','contains applies only to declared string arrays.');
    }else if(n.op==='time_window'){
      if(!exact(n,['op','path','start','end'])||field.type!=='string'||!hhmm(n.start)||!hhmm(n.end)||n.start===n.end)fail('GATE_TIME','time_window needs strict HH:mm and distinct start/end; [start,end), crossing midnight when start > end. Dates and story days are unsupported.');
    }else fail('GATE_OPERATOR','Unsupported operator. No arbitrary expressions, dates or permanent-unlock state.');
    leaves.push(n);
  };
  walk(rule.predicate,1);
  if(rule.partition!==undefined){
    const p=rule.partition,f=fields[p?.path?.slice(7)];
    if(!exact(p,['id','path'])||!safe(p.id)||!f||f.type!=='number'||!finite(f.min)||!finite(f.max)||f.min>=f.max||leaves.some(n=>n.path!==p.path||!['eq','lt','lte','gt','gte','range'].includes(n.op)))fail('GATE_PARTITION','A partition groups numeric predicates on one declared path with finite schema min/max.');
  }
  return clone(rule);
}

/* This pure evaluator is also serialized into the native @@if expression. It
 * interprets a validated data tree, never user JavaScript. All referenced leaves
 * are checked before combining results: invalid data closes even a true OR. */
export function evaluateGate(rule,fields,snapshot,expected) {
  try {
    const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
    const unknown=reason=>({status:'unknown',eligible:false,reason});
    if(!obj(snapshot)||snapshot.profile!==expected.profile||snapshot.definition!==expected.digest||snapshot.error!==null||!obj(snapshot.state)||!obj(snapshot.state.values))return unknown('SNAPSHOT_MISSING_STALE_OR_ERROR');
    const values=snapshot.state.values,errors=[];
    let count=0;
    const walk=(n,depth)=>{
      if(++count>32||depth>4)throw Error('RULE_LIMIT');
      if(n.op==='and'||n.op==='or'){
        const results=n.args.map(c=>walk(c,depth+1));return n.op==='and'?results.every(Boolean):results.some(Boolean);
      }
      const key=n.path.slice(7),f=fields[key];
      if(!Object.prototype.hasOwnProperty.call(values,key)){errors.push('MISSING:'+n.path);return false;}
      const v=values[key];
      const valid=f.type==='number'?typeof v==='number'&&Number.isFinite(v)&&v>=(f.min??-1e9)&&v<=(f.max??1e9):f.type==='boolean'?typeof v==='boolean':f.type==='string'?typeof v==='string'&&v.length<=(f.maxLength??256)&&(!f.enum||f.enum.includes(v)):f.type==='array'?Array.isArray(v)&&v.length<=(f.maxItems??64)&&v.every(x=>typeof x==='string'&&x.length<=256):false;
      if(!valid){errors.push('TYPE_OR_BOUNDS:'+n.path);return false;}
      switch(n.op){
        case 'eq':return v===n.value;
        case 'lt':return v<n.value;
        case 'lte':return v<=n.value;
        case 'gt':return v>n.value;
        case 'gte':return v>=n.value;
        case 'range':return (n.includeMin?v>=n.min:v>n.min)&&(n.includeMax?v<=n.max:v<n.max);
        case 'in':return n.values.includes(v);
        case 'contains':return v.includes(n.value);
        case 'time_window':{
          if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(v)){errors.push('INVALID_HHMM:'+n.path);return false;}
          return n.start<n.end?v>=n.start&&v<n.end:v>=n.start||v<n.end;
        }
        default:throw Error('RULE_OPERATOR');
      }
    };
    const result=walk(rule.predicate,1);
    if(errors.length)return unknown([...new Set(errors)].join(';'));
    return {status:result?'pass':'fail',eligible:result,reason:result?'CONDITION_TRUE':'CONDITION_FALSE'};
  }catch{return {status:'unknown',eligible:false,reason:'EVALUATION_EXCEPTION'};}
}

const literal=v=>JSON.stringify(v).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('{{','\\u007b\\u007b').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
function expected(target){return {profile:target.config.profile,digest:target.definitionDigest};}
export function compileGate(rule,target) {
  validateGateRule(rule,target.config.fields);
  const fields={};const collect=n=>n.args?n.args.forEach(collect):fields[n.path.slice(7)]=target.config.fields[n.path.slice(7)];collect(rule.predicate);
  const fn=evaluateGate.toString().replace(/\r?\n/g,' ');
  const stamp=targetInputStamp.toString().replace(/\r?\n/g,' ');
  return '@@if (()=>{try{const snapshot=getvar('+literal(target.config.namespace)+',{scope:"message",withMsg:{id:-1},noCache:true,defaults:null});const chat=SillyTavern.chat,message=chat.at(-1),input=snapshot?.input,current=('+stamp+')(message?.mes);if(current===null||!input||input.schemaVersion!==1||input.messageId!==chat.length-1||input.swipeId!==(message.swipe_id??0)||input.stamp!==current)return false;return ('+fn+')('+literal(rule)+','+literal(fields)+',snapshot,'+literal(expected(target))+').status==="pass";}catch{return false;}})()';
}

function find(card,id){return rows(card).find(e=>e.id===id);}
function assertManaged(entry,record,target){
  if(!entry)fail('GATE_ENTRY_MISSING','Managed entry was removed; restore its revision before removing its gate.');
  if(record.compilerVersion!==GATE_VERSION||record.namespace!==target.config.namespace||record.definitionDigest!==target.definitionDigest)fail('GATE_STALE','Gate compiler/namespace/state definition changed. Read and explicitly patch/rebind the rule.');
  const prefix=compileGate(record.rule,target);
  if(!entry.content.startsWith(prefix+'\n')||hasForeign(entry.content.slice(prefix.length+1)))fail('GATE_SOURCE_CONFLICT','Managed gate source was changed or unknown EJS/decorators were added; read-only until restored.');
  return prefix;
}

export function partitionDiagnostics(card,authoring){
  const groups=new Map(),diagnostics=[],target=authoring.target;if(!target)return diagnostics;
  for(const g of authoring.gating?.entries??[]){if(!g.rule.partition)continue;const k=g.rule.partition.id;groups.set(k,[...(groups.get(k)??[]),g]);}
  for(const [group,entries] of groups){
    const path=entries[0].rule.partition.path,f=target.config.fields[path.slice(7)];
    if(entries.some(g=>g.rule.partition.path!==path)){diagnostics.push({code:'GATE_PARTITION_PATH',severity:'error',group});continue;}
    const cuts=new Set([f.min,f.max]);
    const collect=n=>{if(n.args)n.args.forEach(collect);else for(const k of ['value','min','max'])if(typeof n[k]==='number'&&n[k]>=f.min&&n[k]<=f.max)cuts.add(n[k]);};
    entries.forEach(g=>collect(g.rule.predicate));const points=[...cuts].sort((a,b)=>a-b),samples=points.map(value=>({value,kind:'boundary'}));
    for(let i=1;i<points.length;i++){const value=points[i-1]+(points[i]-points[i-1])/2;if(value>points[i-1]&&value<points[i])samples.push({value,kind:'interval',from:points[i-1],to:points[i]});}
    for(const sample of samples){
      const snapshot={...expected(target),definition:target.definitionDigest,state:{values:{[path.slice(7)]:sample.value}},error:null};
      const matches=entries.filter(g=>find(card,g.cardEntryId)?.enabled&&evaluateGate(g.rule,target.config.fields,snapshot,expected(target)).eligible).map(g=>g.entryId);
      if(matches.length!==1)diagnostics.push({code:matches.length?'GATE_PARTITION_OVERLAP':'GATE_PARTITION_GAP',severity:'error',group,path,...sample,entries:matches});
    }
  }
  return boundedDiagnostics(diagnostics);
}

export function checkGates(card,authoring){
  const diagnostics=[],managed=authoring.gating?.entries??[],target=authoring.target;
  if(authoring.gating&&(authoring.gating.schemaVersion!==GATE_VERSION||!Array.isArray(managed)||managed.length>64))return [{code:'GATE_SCHEMA',severity:'error'}];
  const ids=new Set();
  for(const g of managed){
    try{
      if(ids.has(g.cardEntryId))fail('GATE_ID','Duplicate gate entry');ids.add(g.cardEntryId);
      if(!target)fail('GATE_TARGET','Managed gates require the supported target state writer.');
      validateGateRule(g.rule,target.config.fields);assertManaged(find(card,g.cardEntryId),g,target);
    }catch(e){diagnostics.push({code:e.code??'GATE_INVALID',severity:'error',entry_id:g.entryId,message:e.message});}
  }
  for(const e of rows(card))if(!ids.has(e.id)&&/(^|\n)\s*@@if\b/.test(e.content))diagnostics.push({code:'GATE_UNMANAGED',severity:'error',card_entry_id:e.id,message:'Handwritten @@if is preserved, not validated. Use a raw backup; do not certify target export.'});
  if(!diagnostics.some(d=>d.code!=='GATE_UNMANAGED'))diagnostics.push(...partitionDiagnostics(card,authoring));
  return boundedDiagnostics(diagnostics);
}

export function gateRead(card,ids,authoring,entryId){
  const index=ids.indexOf(entryId),entry=rows(card)[index];if(!entry)fail('ENTRY_NOT_FOUND','Choose an existing stable worldbook entry ID.');
  const managed=(authoring.gating?.entries??[]).find(g=>g.entryId===entryId);
  let readOnly=hasForeign(entry.content);
  if(managed)try{assertManaged(entry,managed,authoring.target);readOnly=false;}catch{readOnly=true;}
  return {entry_id:entryId,entry:clone(entry),source_hash:gateEntryHash(entry),gate:managed??null,readOnly};
}

export function mutateGate(card,ids,authoring,args){
  const read=gateRead(card,ids,authoring,args.entry_id),entry=rows(card)[ids.indexOf(args.entry_id)],target=authoring.target;
  if(!target)fail('GATE_TARGET','Configure the supported target writer before creating a gate.');
  if(entry.id===target.bookId)fail('GATE_OWNED_STATE','The target state-rules entry must remain ungated. Choose a separate lore entry.');
  if(args.expected_source_hash!==read.source_hash)fail('GATE_SOURCE_CONFLICT','Read the current entry and supply its source_hash.');
  let body=entry.content;
  if(read.gate){
    if(args.action==='create')fail('GATE_EXISTS','Use patch for an existing gate.');
    /* Verify the old compiler against its old digest before an explicit rebind. */
    const oldTarget={...target,definitionDigest:read.gate.definitionDigest,config:{...target.config,namespace:read.gate.namespace}};
    const prefix=assertManaged(entry,read.gate,oldTarget);body=entry.content.slice(prefix.length+1);
  }else{
    if(args.action!=='create')fail('GATE_MISSING','No managed condition on this entry.');
    if(hasForeign(body))fail('GATE_FOREIGN_SOURCE','Existing EJS/decorators are read-only; no automatic rewrite or wrapping.');
  }
  if(args.action==='edit_body'){
    if(!read.gate)fail('GATE_MISSING','Choose an existing managed Gate.');
    const prefix=assertManaged(entry,read.gate,target);
    if(args.rule!==undefined||typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string'||args.new_text.length>16384||body.split(args.old_text).length!==2)fail('GATE_BODY_PATCH','Provide one exact old_text and bounded new_text; rules cannot be changed by edit_body.');
    assertNarrativeText(body,'worldbook/'+args.entry_id+'/content');
    const nextBody=body.replace(args.old_text,()=>args.new_text);assertNarrativeText(nextBody,'worldbook/'+args.entry_id+'/content');
    if(nextBody.length>65536||hasForeign(nextBody))fail('GATE_BODY_PATCH','Mixed/oversize Gate body stays readonly.');
    entry.content=prefix+'\n'+nextBody;return;
  }
  const list=authoring.gating??={schemaVersion:GATE_VERSION,entries:[]};
  if(args.action==='remove'){
    entry.content=body;list.entries=list.entries.filter(g=>g.entryId!==args.entry_id);return;
  }
  if(!read.gate&&list.entries.length>=64)fail('GATE_LIMIT','At most 64 managed gates.');
  const rule=validateGateRule(args.rule,target.config.fields);
  entry.content=compileGate(rule,target)+'\n'+body;
  const record={entryId:args.entry_id,cardEntryId:entry.id,compilerVersion:GATE_VERSION,namespace:target.config.namespace,definitionDigest:target.definitionDigest,rule};
  const at=list.entries.findIndex(g=>g.entryId===args.entry_id);if(at<0)list.entries.push(record);else list.entries[at]=record;
}

export function inspectGates(card,ids,authoring){
  const managed=authoring.gating?.entries??[];
  const entries=rows(card).slice(0,128).map((e,i)=>({entry_id:ids[i],source_hash:gateEntryHash(e),managed:managed.some(g=>g.entryId===ids[i]),readOnly:hasForeign(e.content)&&!managed.some(g=>g.entryId===ids[i]),enabled:e.enabled,constant:e.constant??false,keywordCount:e.keys.length}));
  return {schemaVersion:GATE_VERSION,scope:'message',namespace:authoring.target?.config.namespace??null,paths:Object.entries(authoring.target?.config.fields??{}).map(([key,f])=>({path:'values.'+key,type:f.type,...f})),entries,entriesOmitted:Math.max(0,rows(card).length-128),diagnostics:checkGates(card,authoring),coverage:'gating eligibility only; not final prompt injection'};
}

export function simulateGates(card,ids,authoring,args){
  const target=authoring.target;if(!target)fail('GATE_TARGET','Configure target state first.');
  if(args.snapshot!==undefined&&args.values!==undefined)fail('GATE_FIXTURE','Provide values OR a synthetic snapshot.');
  if(Buffer.byteLength(JSON.stringify(args.snapshot??args.values??null))>16384)fail('GATE_LIMIT','Fixture must fit 16 KiB.');
  const snapshot=args.snapshot??{profile:target.config.profile,definition:target.definitionDigest,error:null,state:{values:args.values??{}}};
  const diagnostics=checkGates(card,authoring),gates=authoring.gating?.entries??[];
  const entries=rows(card).slice(0,128).map((entry,i)=>{
    const g=gates.find(g=>g.entryId===ids[i]);let result;
    try{
      if(g){assertManaged(entry,g,target);result=evaluateGate(g.rule,target.config.fields,snapshot,expected(target));}
      else result=entry.id!==target.bookId&&hasForeign(entry.content)?{status:'unknown',eligible:false,reason:'UNMANAGED_EJS_OR_DECORATOR'}:{status:'pass',eligible:true,reason:'NO_CONDITION'};
    }catch(e){result={status:'unknown',eligible:false,reason:e.code??'GATE_INVALID'};}
    return {entry_id:ids[i],...result,entryEnabled:entry.enabled,constant:entry.constant??false,keywordCount:entry.keys.length};
  });
  return {entries,entriesOmitted:Math.max(0,rows(card).length-128),diagnostics,fixtureOnly:true,runtimeVerified:false,coverage:'gating eligibility only; keywords, probability, groups, scan depth, recursion and token budget still apply',timing:'Completed message snapshot before generation; updates from that reply affect a later prompt. Missing/stale snapshots close the gate.'};
}
