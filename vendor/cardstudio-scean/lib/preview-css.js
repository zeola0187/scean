// A bounded CSS subset, not a browser CSS parser. Never passes resource functions,
// escapes, custom properties, var(), or arbitrary at-rules to the projection.
const PROPERTIES=new Set('display position box-sizing width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-width border-style border-color border-radius border-top border-bottom border-left border-right color background background-image background-color opacity font-size font-weight font-family font-style line-height letter-spacing text-align text-decoration text-transform white-space overflow overflow-x overflow-y overflow-wrap word-break text-overflow vertical-align flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content gap row-gap column-gap order grid-template-columns grid-template-rows grid-column grid-row object-fit object-position aspect-ratio list-style-type border-collapse border-spacing box-shadow'.split(' '));
const FUNCTIONS=new Set('rgb rgba hsl hsla calc clamp min max repeat minmax fit-content linear-gradient'.split(' '));
function warn(diagnostics,code,message,details){if(diagnostics.length<150)diagnostics.push({code,message,...(details?{details}:{})});}

// Comments become whitespace so u/**/rl never turns into a resource function.
// Quotes are retained here and admitted only by the font-family value grammar.
function comments(text,diagnostics){
  let out='',quote='';
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='\\'){out+=c+(text[++i]??'');continue;}
    if(quote){out+=c;if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;out+=c;continue;}
    if(c==='/'&&text[i+1]==='*'){
      const end=text.indexOf('*/',i+2);
      if(end<0){warn(diagnostics,'CSS_MALFORMED','Unclosed CSS comment; remaining text omitted.');break;}
      out+=' '.repeat(end+2-i);i=end+1;
    }else out+=c;
  }
  return out;
}
function valueAllowed(value,property){
  if(!value||value.length>1000||/[<>@\\{};\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(value)||/\/\*|\*\/|(?:javascript|https?|data|file):/i.test(value))return false;
  if(property==='font-family')return value.split(',').every(part=>{
    const s=part.trim();return /^[a-z][a-z0-9 _-]*$/i.test(s)||/^"[\p{L}\p{N} _-]+"$/u.test(s)||/^'[\p{L}\p{N} _-]+'$/u.test(s);
  });
  if(!/^[a-z0-9\s#.,%+*/()_-]+$/i.test(value))return false;
  let depth=0;for(const c of value){if(c==='('&&++depth>16)return false;if(c===')'&&--depth<0)return false;}if(depth)return false;
  // Whitelist the entire identifier (including digits/_), not a safe suffix of
  // an unknown function. Bare anonymous parentheses are not admitted either.
  for(let i=0;i<value.length;i++)if(value[i]==='('){
    const name=value.slice(0,i).match(/([a-z0-9_-]+)\s*$/i)?.[1]?.toLowerCase();
    if(!FUNCTIONS.has(name))return false;
    if(name==='linear-gradient'&&!['background','background-image'].includes(property))return false;
  }
  return property!=='position'||['static','relative'].includes(value);
}
export function sanitizeDeclarations(source,diagnostics=[]){
  if(source.length>32000){warn(diagnostics,'CSS_LIMIT','CSS declaration block exceeds 32000 characters; block omitted.');return '';}
  const text=comments(source,diagnostics),result=[];
  if(/[{}]/.test(text)){warn(diagnostics,'CSS_UNSUPPORTED','Nested declarations are unsupported; rule omitted.');return '';}
  const rows=[],offsets=[];let start=0,quote='';
  for(let i=0;i<=text.length;i++){
    const c=text[i];if(c==='\\'){i++;continue;}
    if(quote){if(c===quote)quote='';}
    else if(c==='"'||c==="'")quote=c;
    if(i===text.length||c===';'&&!quote){rows.push(text.slice(start,i));offsets.push(start);start=i+1;}
  }
  for(const [index,row] of rows.entries()){
    if(!row.trim())continue;const at=row.indexOf(':');
    if(at<=0){warn(diagnostics,'CSS_MALFORMED','Malformed CSS declaration omitted.',{offset:offsets[index]+Math.max(0,row.search(/\S/))});continue;}
    const property=row.slice(0,at).trim().toLowerCase(),value=row.slice(at+1).trim();
    if(!PROPERTIES.has(property)||!valueAllowed(value,property)){
      warn(diagnostics,'CSS_UNSUPPORTED','Unsupported CSS property/value omitted; other declarations retained.',{property:property.slice(0,80),offset:offsets[index]+Math.max(0,row.search(/\S/))});continue;
    }
    result.push(property+':'+value);
  }
  return result.join(';');
}
function mediaAllowed(header){
  // Width queries only: no device, preference, URL, range syntax, or comma OR.
  let query=header.replace(/^@media\s+/i,'').trim();
  query=query.replace(/^(?:only\s+)?(?:screen|all)\s+and\s+/i,'');
  const clauses=query.split(/\s+and\s+/i);
  return clauses.length<=4&&clauses.every(clause=>{
    const m=/^\(\s*(?:min|max)-width\s*:\s*(\d{1,4})px\s*\)$/i.exec(clause);
    return !!m&&Number(m[1])<=4096;
  });
}
// Scanning is quote/escape/parenthesis aware only to find bounded rule units;
// admission below remains stricter than this scanner.
function boundary(text,start){
  let quote='',parens=0;
  for(let i=start;i<text.length;i++){
    const c=text[i];if(c==='\\'){i++;continue;}
    if(quote){if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')parens++;if(c===')')parens=Math.max(0,parens-1);
    if(!parens&&'{};'.includes(c))return i;
  }
  return text.length;
}
function blockEnd(text,start){
  let quote='',depth=1;
  for(let i=start;i<text.length;i++){
    const c=text[i];if(c==='\\'){i++;continue;}
    if(quote){if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')depth++;if(c==='}'&&!--depth)return i;
  }
  return -1;
}
export function sanitizeCss(source,diagnostics=[]){
  if(source.length>64000){warn(diagnostics,'CSS_LIMIT','Stylesheet exceeds 64000 characters; stylesheet omitted.');return '';}
  const text=comments(source,diagnostics),budget={rules:0,stopped:false};
  function parse(text,depth=0,base=0){
    const output=[];let i=0;
    while(i<text.length){
      while(i<text.length&&/\s/.test(text[i]))i++;if(i===text.length)break;
      if(budget.stopped)break;
      if(++budget.rules>250){warn(diagnostics,'CSS_LIMIT','Extra CSS rules omitted (250 rule limit).');budget.stopped=true;break;}
      const headerOffset=base+i,end=boundary(text,i),header=text.slice(i,end).trim(),delimiter=text[end];
      if(delimiter!=='{'){
        warn(diagnostics,header.startsWith('@')?'CSS_AT_RULE_UNSUPPORTED':'CSS_MALFORMED','Unsupported or incomplete CSS rule omitted; preceding rules retained.');i=end+1;continue;
      }
      const close=blockEnd(text,end+1);
      if(close<0){warn(diagnostics,'CSS_MALFORMED','Unclosed CSS block; remaining text omitted, preceding rules retained.');break;}
      const body=text.slice(end+1,close);i=close+1;
      if(header.startsWith('@')){
        if(!/^@media\s/i.test(header)||!mediaAllowed(header)||depth>=3){warn(diagnostics,'CSS_AT_RULE_UNSUPPORTED','Only bounded min/max-width px media queries (up to 3 levels) are supported; rule omitted.');continue;}
        const safe=parse(body,depth+1,base+end+1);if(safe)output.push(header+'{'+safe+'}');continue;
      }
      if(header.length>1000||!header||!header.split(',').every(s=>/^[A-Za-z0-9_.#*\s>+~-]+$/.test(s)&&s.trim())){warn(diagnostics,'CSS_SELECTOR_UNSUPPORTED','Unsupported CSS selector omitted.',{selector:header.slice(0,160),offset:headerOffset});continue;}
      const diagnosticsStart=diagnostics.length,safe=sanitizeDeclarations(body,diagnostics);for(const d of diagnostics.slice(diagnosticsStart))if(d.details?.offset!==undefined)d.details.offset+=base+end+1;if(safe)output.push(header+'{'+safe+'}');
    }
    return output.join('\n');
  }
  return parse(text);
}
