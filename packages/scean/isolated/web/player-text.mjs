// Shared with the opaque UI. No parser, DOM, code or recursive macro evaluation.
export function resolvePlayerText(value,name){
  return typeof value==='string'&&typeof name==='string'&&name ? value.replace(/\{\{user\}\}/g,()=>name) : value;
}
export function resolveTemplateSegments(value,name,segments){
  if(segments===null||typeof value!=='string'||!name)return value;
  if(segments===undefined)return resolvePlayerText(value,name);
  const escaped=name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  let result=value;
  for(const {start,end} of [...segments].reverse())result=result.slice(0,start)+resolvePlayerText(value.slice(start,end),escaped)+result.slice(end);
  return result;
}
