import { clone,fail,canonical } from './codec.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const key=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
export const defaultFixture=()=>({schemaVersion:1,fixtureId:'default',values:{affection:42,time:'18:30',location:'courtyard',outfit:'casual',mood:'embarrassed',inventory:['notebook']},bindings:{affection:{type:'number',min:0,max:100,display:'value'},time:{type:'string',maxLength:64},location:{type:'string',maxLength:120},outfit:{type:'string',maxLength:120},mood:{type:'string',maxLength:120},inventory:{type:'array',maxItems:64}}});
export function validateFixture(input){
  if(!object(input)||Object.keys(input).some(k=>!['schemaVersion','fixtureId','values','bindings'].includes(k))||input.schemaVersion!==1||!key(input.fixtureId)||!object(input.values)||!object(input.bindings))fail('FIXTURE','Expected a versioned authoring sample with values and typed bindings.');
  if(Buffer.byteLength(canonical(input))>65536||Object.keys(input.values).length>64||Object.keys(input.bindings).length>64)fail('FIXTURE_LIMIT','Sample is too large.');
  const f=clone(input);
  for(const [name,b] of Object.entries(f.bindings)){
    if(!key(name)||!object(b)||Object.keys(b).some(k=>!['type','min','max','enum','maxLength','maxItems','display','label','bands','sourcePath'].includes(k))||!['number','string','boolean','array'].includes(b.type))fail('FIXTURE_BINDING','Use bounded typed sample bindings.');
    if(b.min!==undefined&&!Number.isFinite(b.min)||b.max!==undefined&&!Number.isFinite(b.max)||b.min!==undefined&&b.max!==undefined&&b.min>b.max)fail('FIXTURE_RANGE','Invalid sample bounds.');
    if(b.enum!==undefined&&(!Array.isArray(b.enum)||b.enum.length>64||b.enum.some(x=>typeof x!=='string'||x.length>120)))fail('FIXTURE_BINDING','Invalid sample enum.');
    for(const n of ['maxLength','maxItems'])if(b[n]!==undefined&&(!Number.isSafeInteger(b[n])||b[n]<0||b[n]>(n==='maxLength'?4096:256)))fail('FIXTURE_BINDING','Invalid sample limit.');
    if(b.display!==undefined&&!['value','label','hidden'].includes(b.display))fail('FIXTURE_BINDING','Invalid display mode.');
    if(b.label!==undefined&&(typeof b.label!=='string'||b.label.length>256))fail('FIXTURE_BINDING','Invalid display label.');
    if(b.sourcePath!==undefined&&(typeof b.sourcePath!=='string'||b.sourcePath.length>256))fail('FIXTURE_BINDING','A source path is inert descriptive data.');
    if(b.bands!==undefined&&(!Array.isArray(b.bands)||b.bands.length>16||b.bands.some(x=>!object(x)||Object.keys(x).some(k=>!['min','label'].includes(k))||!Number.isFinite(x.min)||typeof x.label!=='string'||x.label.length>128)))fail('FIXTURE_BINDING','Invalid label bands.');
  }
  for(const [name,value] of Object.entries(f.values)){
    if(!key(name)||!Object.hasOwn(f.bindings,name))fail('FIXTURE_BINDING','Every sample value needs a declared binding.');
    const b=f.bindings[name];
    if(b.type==='number'&&(!Number.isFinite(value)||b.min!==undefined&&value<b.min||b.max!==undefined&&value>b.max))fail('FIXTURE_VALUE','Number is outside its sample bounds.');
    if(b.type==='string'&&(typeof value!=='string'||value.length>(b.maxLength??4096)||b.enum&&!b.enum.includes(value)))fail('FIXTURE_VALUE','Invalid sample string.');
    if(b.type==='boolean'&&typeof value!=='boolean')fail('FIXTURE_VALUE','Invalid sample boolean.');
    if(b.type==='array'&&(!Array.isArray(value)||value.length>(b.maxItems??64)||value.some(x=>typeof x!=='string'||x.length>256)))fail('FIXTURE_VALUE','Use a bounded string list for this sample.');
  }
  return f;
}
export function bindFixture(input){
  const fixture=validateFixture(input),fields={},diagnostics=[];
  for(const [name,b] of Object.entries(fixture.bindings)){
    const present=Object.hasOwn(fixture.values,name),value=fixture.values[name];
    if(!present)diagnostics.push({code:'SAMPLE_MISSING',field:name,message:'This authoring sample has no value for this binding.'});
    let label=b.label;
    if(b.bands&&typeof value==='number')for(const band of [...b.bands].sort((a,z)=>a.min-z.min))if(value>=band.min)label=band.label;
    fields[name]={...b,value:present?clone(value):null,label:label??(present?(Array.isArray(value)?value.join('、'):String(value)):'—'),display:b.display??'value',missing:!present};
  }
  return {...fixture,fields,diagnostics};
}
