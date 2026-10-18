// Shared bounded predicates. No UI, Host, I/O, model, or State writes.
const own=(o,k)=>Object.hasOwn(o??{},k);
const fail=(prefix,suffix,details)=>{throw Object.assign(new Error(prefix+'_'+suffix),{code:prefix+'_'+suffix,...(details?{details}:{})});};
const fields=(v,keys,prefix)=>{if(!v||typeof v!=='object'||Array.isArray(v)||keys.some(k=>!own(v,k))||Object.keys(v).some(k=>!keys.includes(k)))fail(prefix,'FIELDS');};
export function boundedConditionJSON(value,{prefix='FRONTEND',nodes=20000,depth=32}={}){
 let n=0;const active=new Set();
 function visit(v,d){
  if(++n>nodes||d>depth)fail(prefix,'JSON_LIMIT');
  if(v===null||['boolean','string'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v))return;
  if(!v||typeof v!=='object'||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))||active.has(v)||Object.getOwnPropertySymbols(v).length)fail(prefix,'JSON');
  active.add(v);for(const [k,x] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(Array.isArray(v)&&k==='length')continue;if(['__proto__','constructor','prototype'].includes(k)||!own(x,'value')||!x.enumerable)fail(prefix,'JSON');visit(x.value,d+1);}active.delete(v);
 }
 visit(value,0);
}
export function validateConditionExpression(e,types,budget={n:0},depth=0,prefix='FRONTEND'){
 if(++budget.n>512||depth>12)fail(prefix,'EXPRESSION_LIMIT');
 if(own(e,'ref')){fields(e,['ref'],prefix);if(!types.has(e.ref))fail(prefix,'REFERENCE_MISSING',{alias:e.ref});return types.get(e.ref);}
 if(own(e,'literal')){fields(e,['literal'],prefix);if(!['boolean','string','number'].includes(typeof e.literal)||typeof e.literal==='number'&&!Number.isFinite(e.literal)||typeof e.literal==='string'&&e.literal.length>500)fail(prefix,'LITERAL');return typeof e.literal;}
 fields(e,['op','args'],prefix);if(!Array.isArray(e.args)||!['and','or','not','eq','ne','lt','lte','gt','gte'].includes(e.op))fail(prefix,'OPERATOR');
 if(['and','or'].includes(e.op)?e.args.length<1||e.args.length>32:e.args.length!==(e.op==='not'?1:2))fail(prefix,'ARITY');
 const t=e.args.map(x=>validateConditionExpression(x,types,budget,depth+1,prefix));
 if(['and','or','not'].includes(e.op)?t.some(x=>x!=='boolean'):['lt','lte','gt','gte'].includes(e.op)?t.some(x=>x!=='number'):t[0]!==t[1]||t[0]==='json')fail(prefix,'EXPRESSION_TYPE');
 return 'boolean';
}
export function evaluateCondition(expr,values,freshness='current',budget={n:0},depth=0){
 if(freshness!=='current')return {status:'stale'};
 if(++budget.n>512||depth>12||!expr||typeof expr!=='object')return {status:'unavailable'};
 if(own(expr,'ref'))return values[expr.ref]??{status:'unavailable'};
 if(own(expr,'literal'))return {status:'known',value:expr.literal};
 if(!Array.isArray(expr.args)||!['and','or','not','eq','ne','lt','lte','gt','gte'].includes(expr.op))return {status:'unavailable'};
 if(['and','or'].includes(expr.op)?expr.args.length<1||expr.args.length>32:expr.args.length!==(expr.op==='not'?1:2))return {status:'unavailable'};
 const args=expr.args.map(e=>evaluateCondition(e,values,freshness,budget,depth+1));
 const known=args.filter(x=>x.status==='known'),numeric=['lt','lte','gt','gte'].includes(expr.op),logical=['and','or','not'].includes(expr.op);
 if(known.some(x=>logical?typeof x.value!=='boolean':numeric?typeof x.value!=='number'||!Number.isFinite(x.value):!['number','string','boolean'].includes(typeof x.value))||!logical&&!numeric&&known.length===2&&typeof known[0].value!==typeof known[1].value)return {status:'unavailable'};
 const absent=()=>({status:args.some(x=>x.status==='unavailable')?'unavailable':args.some(x=>x.status==='stale')?'stale':'unknown'});
 if(expr.op==='and')return args.some(x=>x.status==='known'&&x.value===false)?{status:'known',value:false}:args.every(x=>x.status==='known')?{status:'known',value:true}:absent();
 if(expr.op==='or')return args.some(x=>x.status==='known'&&x.value===true)?{status:'known',value:true}:args.every(x=>x.status==='known')?{status:'known',value:false}:absent();
 if(args.some(x=>x.status!=='known'))return absent();const [a,b]=args.map(x=>x.value);
 return {status:'known',value:expr.op==='not'?!a:expr.op==='eq'?a===b:expr.op==='ne'?a!==b:expr.op==='lt'?a<b:expr.op==='lte'?a<=b:expr.op==='gt'?a>b:a>=b};
}
