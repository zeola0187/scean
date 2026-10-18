import { randomUUID } from 'node:crypto';
import { clone, sha, fail } from './codec.js';

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script','style','textarea','title']);
const LIMIT = 256 * 1024;
export function boundedSource(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > LIMIT) fail('FRONTEND_LIMIT','Frontend source must be text of at most 256 KiB.');
  return source;
}
/** Conservative state machine, not a browser parser. Invalid syntax is never repaired or executed. */
export function tokenizeHtml(source) {
  boundedSource(source); const tokens=[]; let i=0;
  const text=(start,end)=>tokens.push({type:'text',start,end,value:source.slice(start,end)});
  while(i<source.length) {
    if(source[i]!=='<') { const start=i; while(i<source.length&&source[i]!=='<')i++;text(start,i);continue; }
    const start=i;
    if(source.startsWith('<!--',i)) {const end=source.indexOf('-->',i+4);if(end<0) return {tokens,valid:false,error:'Unclosed comment'};i=end+3;tokens.push({type:'comment',start,end:i});continue;}
    i++;let closing=false;if(source[i]==='/'){closing=true;i++;}
    const nameStart=i;while(i<source.length&&/[A-Za-z0-9-]/.test(source[i]))i++;
    const name=source.slice(nameStart,i).toLowerCase();
    if(!name||!/[A-Za-z]/.test(source[nameStart])||(!/[\s/>]/.test(source[i]??''))) {
      // '<' in prose is text; markup declarations and malformed opening names are refused.
      if(source[start+1]==='!'||source[start+1]==='?'||/[A-Za-z/]/.test(source[start+1]??''))return {tokens,valid:false,error:'Unsupported or malformed tag'};
      i=start+1;text(start,i);continue;
    }
    const attrs=[];let selfClosing=false;
    for(;;) {
      while(i<source.length&&/\s/.test(source[i]))i++;
      if(source[i]==='>'){i++;break;}
      if(source[i]==='/'&&source[i+1]==='>'){selfClosing=true;i+=2;break;}
      if(i>=source.length||closing)return {tokens,valid:false,error:'Malformed tag'};
      const a=i;while(i<source.length&&/[A-Za-z0-9_:-]/.test(source[i]))i++;
      if(a===i)return {tokens,valid:false,error:'Malformed attribute'};
      const key=source.slice(a,i).toLowerCase();while(i<source.length&&/\s/.test(source[i]))i++;
      let value='',valueStart=i;
      if(source[i]==='=') {
        i++;while(i<source.length&&/\s/.test(source[i]))i++;
        const quote=source[i];
        if(quote==='"'||quote==="'"){i++;const v=i;valueStart=v;while(i<source.length&&source[i]!==quote)i++;if(i===source.length)return {tokens,valid:false,error:'Unclosed attribute'};value=source.slice(v,i++);}
        else {const v=i;valueStart=v;while(i<source.length&&!/[\s>]/.test(source[i])){if(/["'<=`]/.test(source[i]))return {tokens,valid:false,error:'Malformed unquoted attribute'};i++;}if(v===i)return {tokens,valid:false,error:'Empty attribute'};value=source.slice(v,i);}
      }
      if(attrs.some(a=>a.name===key))return {tokens,valid:false,error:'Duplicate attribute'};
      attrs.push({name:key,value,valueStart});
    }
    tokens.push({type:closing?'close':'open',name,attrs,start,end:i,selfClosing:selfClosing||VOID.has(name)});
    if(!closing&&!selfClosing&&RAW.has(name)) {
      const lower=source.toLowerCase();let end=lower.indexOf('</'+name,i);
      while(end>=0&&!/[\s>]/.test(source[end+name.length+2]??''))end=lower.indexOf('</'+name,end+2);
      if(end<0)return {tokens,valid:false,error:'Unclosed raw-text element'};
      tokens.push({type:'raw',name,start:i,end,value:source.slice(i,end)});i=end;
    }
    if(tokens.length>20000)return {tokens:[],valid:false,error:'Too many tokens'};
  }
  return {tokens,valid:true};
}
function ranges(source) {
  const parsed=tokenizeHtml(source);if(!parsed.valid)return {ranges:[],diagnostics:[{code:'MALFORMED_HTML',message:parsed.error}]};
  const spans=[];const stack=[];let start;
  for(const t of parsed.tokens) {
    if(t.type==='open'){if(!stack.length)start=t.start;if(!t.selfClosing)stack.push(t.name);else if(!stack.length)spans.push({start,end:t.end});}
    if(t.type==='close'){if(stack.at(-1)!==t.name)return {ranges:[],diagnostics:[{code:'AMBIGUOUS_HTML',message:'Tag nesting is not safely identifiable.'}]};stack.pop();if(!stack.length)spans.push({start,end:t.end});}
  }
  if(stack.length)return {ranges:[],diagnostics:[{code:'AMBIGUOUS_HTML',message:'Unbalanced markup is preserved, not rewritten.'}]};
  const merged=[];for(const span of spans){const prev=merged.at(-1);if(prev&&/^\s*$/.test(source.slice(prev.end,span.start)))prev.end=span.end;else merged.push({...span});}
  return {ranges:merged,diagnostics:[]};
}
export function analyzeFrontend(source) {
  const {tokens,valid,error}=tokenizeHtml(source);const classes=new Set(),ids=new Set(),selectors=new Set();
  for(const t of tokens)if(t.type==='open')for(const a of t.attrs){if(a.name==='class')a.value.split(/\s+/).filter(Boolean).forEach(v=>classes.add(v));if(a.name==='id')ids.add(a.value);}
  for(const m of source.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g))selectors.add(m[1].trim().slice(0,300));
  const macros=[...new Set([...source.matchAll(/\{\{[\s\S]*?\}\}/g)].map(m=>m[0]))].slice(0,100);
  const externalResources=[...new Set([...source.matchAll(/(?:https?:\/\/|\/\/)[^\s"'<>]+/gi)].map(m=>m[0]))].slice(0,100);
  const javascript=tokens.some(t=>t.name==='script')||tokens.some(t=>t.attrs?.some(a=>a.name.startsWith('on')));
  const ejs=/<%/.test(source),mvu=/\b(?:MVU|Mvu|mvu|stat_data|updateVariables)\b/.test(source),tavernHelper=/\b(?:TavernHelper|SillyTavern|getChatMessages|setChatMessages|getVariables|eventOn)\b/.test(source);
  return {classes:[...classes],ids:[...ids],cssSelectors:[...selectors],macros,externalResources,javascript,ejs,mvu,tavernHelper,dynamicUnknown:javascript||ejs||mvu||tavernHelper||macros.some(x=>!/^\{\{(?:sample|sample_label)::[a-z][a-z0-9_.-]*\}\}$/i.test(x)),parseable:valid,...(!valid?{parseError:error}:{})};
}
function fields(card,entryIds=[]) {
  const result=[{target:'first_mes',path:['data','first_mes'],source:card.data?.first_mes}];
  const entries=card.data?.character_book?.entries;
  if(Array.isArray(entries))entries.forEach((e,i)=>result.push({target:'worldbook_entry',entry_id:entryIds[i]??e.id??String(i),path:['data','character_book','entries',i,'content'],source:e.content}));
  else if(entries&&typeof entries==='object')Object.entries(entries).forEach(([key,e],i)=>result.push({target:'worldbook_entry',entry_id:entryIds[i]??e.uid??key,path:['data','character_book','entries',key,'content'],source:e.content}));
  const scripts=card.data?.extensions?.regex_scripts;if(Array.isArray(scripts))scripts.forEach((e,i)=>result.push({target:'regex',regex_id:e.id,identity_safe:typeof e.id==='string'&&!!e.id&&scripts.filter(x=>x.id===e.id).length===1,path:['data','extensions','regex_scripts',i,'replaceString'],source:e.replaceString}));
  return result.filter(f=>typeof f.source==='string');
}
const samePath=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function sameField(component,field) {
  const locator=component.locator;
  if(locator?.target!==field.target)return false;
  if(field.target==='worldbook_entry'&&locator.entry_id!==undefined&&field.entry_id!==undefined)return locator.entry_id===field.entry_id;
  if(field.target==='regex'&&field.identity_safe&&locator.regex_id!==undefined)return locator.regex_id===field.regex_id;
  return samePath(locator?.path,field.path);
}
function getAt(card,path){let p=card;for(const key of path??[])p=p?.[key];return p;}
function setAt(card,path,text){let p=card;for(const key of path.slice(0,-1))p=p[key];p[path.at(-1)]=text;}
export function inspectFrontend(card,existingComponents=[],entryIds=[]) {
  const components=[],diagnostics=[];const used=new Set();
  for(const field of fields(card,entryIds)){
    const found=ranges(field.source);diagnostics.push(...found.diagnostics.map(d=>({...d,target:field.target,entry_id:field.entry_id})));
    if(field.target==='regex'&&!field.identity_safe)diagnostics.push({code:'REGEX_ID_UNSAFE',message:'Regex has no unique stable ID; create cannot select it.'});
    const known=existingComponents.filter(c=>sameField(c,field)&&Number.isSafeInteger(c.locator.start)&&Number.isSafeInteger(c.locator.end)&&c.locator.start>=0&&c.locator.end>c.locator.start&&c.locator.end<=field.source.length&&sha(field.source.slice(c.locator.start,c.locator.end))===c.sourceHash).sort((a,b)=>a.locator.start-b.locator.start);
    const spans=[];
    for(const range of found.ranges){const contained=known.filter(c=>c.locator.start>=range.start&&c.locator.end<=range.end);let cursor=range.start;
      for(const c of contained){if(c.locator.start<cursor)continue;const gap=field.source.slice(cursor,c.locator.start);for(const g of ranges(gap).ranges)spans.push({start:cursor+g.start,end:cursor+g.end});spans.push({start:c.locator.start,end:c.locator.end});cursor=c.locator.end;}
      for(const g of ranges(field.source.slice(cursor,range.end)).ranges)spans.push({start:cursor+g.start,end:cursor+g.end});
    }
    for(const range of spans){const source=field.source.slice(range.start,range.end),hash=sha(source);
      const prior=existingComponents.find(c=>!used.has(c.component_id)&&sameField(c,field)&&c.sourceHash===hash)
        ??existingComponents.find(c=>!used.has(c.component_id)&&sameField(c,field)&&c.locator?.start===range.start);
      const identity=field.target==='worldbook_entry'?{target:field.target,entry_id:field.entry_id}:field.target==='regex'&&field.identity_safe?{target:field.target,regex_id:field.regex_id}:{path:field.path};
      const component_id=prior?.component_id??'frontend_'+sha(JSON.stringify({identity,start:range.start,end:range.end,sourceHash:hash})).slice(0,32);used.add(component_id);
      const locator={target:field.target,path:field.path,start:range.start,end:range.end,...(field.entry_id!==undefined?{entry_id:field.entry_id}:{}),...(field.regex_id!==undefined?{regex_id:field.regex_id}:{})};
      components.push({component_id,locator,sourceHash:hash,sourceLength:source.length,revision:prior?(prior.revision??0)+(prior.sourceHash===hash?0:1):0,dependencies:analyzeFrontend(source)});
    }
  }
  return {components,diagnostics};
}
function resolve(card,componentId,components,entryIds=[]) {
  const component=components.find(c=>c.component_id===componentId);if(!component)fail('FRONTEND_NOT_FOUND','Unknown component ID.');
  const l=component.locator;const field=fields(card,entryIds).find(f=>samePath(f.path,l?.path));
  if(!field||!Number.isSafeInteger(l.start)||!Number.isSafeInteger(l.end)||l.start<0||l.end<=l.start||l.end>field.source.length)fail('FRONTEND_LOCATOR','Component locator is no longer valid.');
  if(l.target==='worldbook_entry'&&entryIds.length&&field.entry_id!==l.entry_id)fail('FRONTEND_LOCATOR','Worldbook stable entry identity changed.');
  const source=field.source.slice(l.start,l.end);if(sha(source)!==component.sourceHash)fail('FRONTEND_SOURCE_CONFLICT','Component source changed; inspect again before patching.');
  return {component,source,field};
}
export function readFrontend(card,componentId,components,entryIds=[]) {
  const {component,source}=resolve(card,componentId,components,entryIds);return {component_id:componentId,source,sourceHash:sha(source),locator:clone(component.locator),revision:component.revision,dependencies:analyzeFrontend(source)};
}
export function createFrontend(card,args,entryIds=[],components=[]) {
  if(args.component_id!==undefined)fail('FRONTEND_ID','The host assigns component IDs.');
  const source=boundedSource(args.source??'<section class="csscean-card-panel"><p>Character state</p></section>');const found=ranges(source);
  if(found.ranges.length!==1||source.slice(0,found.ranges[0]?.start).trim()||source.slice(found.ranges[0]?.end).trim())fail('FRONTEND_SOURCE','Provide one safely balanced HTML fragment.');
  const available=fields(card,entryIds);let field;
  if(args.target==='first_mes')field=available.find(f=>f.target==='first_mes');
  else if(args.target==='worldbook_entry')field=available.find(f=>f.target===args.target&&f.entry_id===args.entry_id);
  else if(args.target==='regex'){
    // Never create or select a regex by index guessed by the model. Select only an existing stable regex ID.
    field=available.find(f=>f.target==='regex'&&f.identity_safe&&f.regex_id===args.regex_id);
  }
  if(!field)fail('FRONTEND_TARGET','Target must be first_mes, an admitted stable worldbook entry, or an existing regex ID.');
  const next=clone(card),separator=field.source&&!field.source.endsWith('\n')?'\n':'';
  setAt(next,field.path,field.source+separator+source);
  const result=inspectFrontend(next,components,entryIds);const start=field.source.length+separator.length;
  // Separate identity for a newly appended fragment even when preceding HTML would otherwise merge.
  const component={component_id:'frontend_'+randomUUID(),locator:{target:field.target,path:field.path,start,end:start+source.length,...(field.entry_id!==undefined?{entry_id:field.entry_id}:{}),...(field.regex_id!==undefined?{regex_id:field.regex_id}:{})},sourceHash:sha(source),sourceLength:source.length,revision:0,dependencies:analyzeFrontend(source)};
  const preserved=components.filter(c=>samePath(c.locator?.path,field.path)?c.locator.end<=field.source.length:true);
  return {card:next,components:[...preserved,component],component,diagnostics:result.diagnostics};
}
export function patchFrontend(card,args,components,entryIds=[]) {
  const {component,source,field}=resolve(card,args.component_id,components,entryIds);
  if(args.expected_source_hash!==component.sourceHash)fail('FRONTEND_SOURCE_CONFLICT','Expected source hash does not match.');
  if(typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string')fail('FRONTEND_PATCH','Provide a nonempty exact old_text and a new_text string.');
  const at=source.indexOf(args.old_text);if(at<0||source.indexOf(args.old_text,at+1)>=0)fail('FRONTEND_PATCH','old_text must occur exactly once inside this component.');
  const updated=boundedSource(source.slice(0,at)+args.new_text+source.slice(at+args.old_text.length));
  const found=ranges(updated);if(found.ranges.length!==1||updated.slice(0,found.ranges[0]?.start).trim()||updated.slice(found.ranges[0]?.end).trim())fail('FRONTEND_PATCH','Patch must preserve one safely identifiable fragment.');
  const next=clone(card),l=component.locator,delta=updated.length-source.length;
  setAt(next,l.path,field.source.slice(0,l.start)+updated+field.source.slice(l.end));
  const nextComponents=clone(components);
  for(const c of nextComponents)if(samePath(c.locator.path,l.path)) {
    if(c.component_id===component.component_id){c.locator.end+=delta;c.sourceHash=sha(updated);c.sourceLength=updated.length;c.revision=(c.revision??0)+1;c.dependencies=analyzeFrontend(updated);}
    else if(c.locator.start>=l.end){c.locator.start+=delta;c.locator.end+=delta;}
    else if(c.locator.end>l.start)fail('FRONTEND_LOCATOR','Overlapping component locators require reinspection.');
  }
  return {card:next,components:nextComponents,component:nextComponents.find(c=>c.component_id===component.component_id),diagnostics:[],dependenciesBefore:analyzeFrontend(source),dependenciesAfter:analyzeFrontend(updated)};
}
