import { clone,fail,sha } from './codec.js';
import { boundedSource } from './frontend-authoring.js';

// Source editing only. These functions never interpret JS, EJS, regex or macros.
export function targetContent(card,args) {
  if(!['script','regex','alternate_greeting'].includes(args.kind))fail('TARGET_CONTENT','Choose script, regex or alternate_greeting.');
  if(!['list','read','create','patch'].includes(args.action))fail('ACTION','Choose list/read/create/patch.');
  const ext=card.data.extensions??{};
  const scripts=ext.tavern_helper?.scripts;
  const rows=[];
  const collect=list=>{for(const x of list??[])if(x.type==='folder')collect(x.scripts);else rows.push(x);};
  if(args.kind==='script'){if(scripts!==undefined&&!Array.isArray(scripts))fail('TARGET_METADATA','Preserve incompatible helper metadata.');collect(scripts);}
  else if(args.kind==='regex'){if(ext.regex_scripts!==undefined&&!Array.isArray(ext.regex_scripts))fail('TARGET_METADATA','Preserve incompatible regex metadata.');rows.push(...ext.regex_scripts??[]);}
  else rows.push(...(card.data.alternate_greetings??[]).map((text,i)=>({id:String(i),content:text})));
  const field=args.kind==='regex'?'replaceString':'content';
  if(args.action==='list')return rows.map(x=>({id:x.id,name:x.name??x.scriptName??'',source_hash:sha(x[field]??''),bytes:Buffer.byteLength(x[field]??'')}));
  const matches=rows.filter(x=>x.id===args.content_id);
  if(args.action==='create') {
    if(args.kind==='alternate_greeting')fail('TARGET_CONTENT','Use bounded alternate_greetings field patches to add greetings.');
    if(typeof args.content_id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(args.content_id)||matches.length)fail('TARGET_ID','Use an unused stable script ID.');
    const source=boundedSource(args.source),id=args.content_id;
    card.data.extensions??={};
    if(args.kind==='script') {
      if(ext.tavern_helper!==undefined&&(!ext.tavern_helper||typeof ext.tavern_helper!=='object'||Array.isArray(ext.tavern_helper)))fail('TARGET_METADATA','Preserve legacy helper metadata; adapt it explicitly.');
      card.data.extensions.tavern_helper??={};card.data.extensions.tavern_helper.scripts??=[];
      card.data.extensions.tavern_helper.scripts.push({type:'script',id,name:id,enabled:false,content:source,info:'',button:{enabled:false,buttons:[]},data:{},export_with:{data:false,button:false}});
    }else {
      if(typeof args.find_regex!=='string'||args.find_regex.length>4096)fail('TARGET_REGEX','Provide a bounded regex string.');
      card.data.extensions.regex_scripts??=[];card.data.extensions.regex_scripts.push({id,scriptName:id,findRegex:args.find_regex,replaceString:source,trimStrings:[],placement:[2],disabled:true,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null});
    }
    return {id,source_hash:sha(source),enabled:false};
  }
  if(matches.length!==1)fail('TARGET_ID','Select a unique existing source ID.');
  const row=matches[0],source=boundedSource(row[field]);
  if(args.action==='read')return {id:row.id,source,source_hash:sha(source),metadata:clone(Object.fromEntries(Object.entries(row).filter(([k])=>k!==field)))};
  if(args.expected_source_hash!==sha(source))fail('TARGET_SOURCE_CONFLICT','Read the current source before editing.');
  if(typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string'||source.split(args.old_text).length!==2)fail('TARGET_PATCH','The exact old text must occur once.');
  const next=boundedSource(source.replace(args.old_text,()=>args.new_text));
  if(args.kind==='alternate_greeting')card.data.alternate_greetings[Number(row.id)]=next;else row[field]=next;
  return {id:row.id,source_hash:sha(next)};
}
