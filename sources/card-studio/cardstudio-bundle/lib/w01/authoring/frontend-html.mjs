const fail=code=>{throw Object.assign(new Error(code),{code});};
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
