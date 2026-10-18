import { PRESENTATION_BASE_CSS } from './presentation-base.js';
import { boundedSource, tokenizeHtml, analyzeFrontend } from './frontend-authoring.js';
import { sanitizeCss, sanitizeDeclarations as declarations } from './preview-css.js';
export { sanitizeCss } from './preview-css.js';

const ALLOWED=new Set('div section article aside header footer main p span strong b em i small br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr th td caption blockquote pre code figure figcaption img details summary'.split(' '));
const VOID=new Set(['br','hr','img']);
const BLOCKED=new Set('script iframe object embed form input button select option textarea link meta base svg math audio video source template noscript title xmp plaintext'.split(' '));
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function entities(value){return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos);/gi,(all,key)=>{if(key[0]==='#'){const cp=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):'\ufffd';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key.toLowerCase()];});}
function add(diagnostics,code,message,details){if(diagnostics.length<150)diagnostics.push({code,message,...(details?{details}:{})});}
function sampleValue(fixture,key,wantLabel,diagnostics){
  const rows=fixture?.fields??fixture?.values??fixture??{};let row=rows&&typeof rows==='object'&&Object.hasOwn(rows,key)?rows[key]:undefined;
  if(row===undefined){add(diagnostics,'FIXTURE_MISSING','Sample value missing.',{key});return '—';}
  if(!row||typeof row!=='object'||Array.isArray(row))row={type:Array.isArray(row)?'string[]':typeof row,value:row};
  const value=row.value,type=row.type;
  const valid=type==='number'?Number.isFinite(value)&&(!Number.isFinite(row.min)||value>=row.min)&&(!Number.isFinite(row.max)||value<=row.max)
    :type==='integer'?Number.isSafeInteger(value)&&(!Number.isFinite(row.min)||value>=row.min)&&(!Number.isFinite(row.max)||value<=row.max)
    :type==='string'?typeof value==='string'&&value.length<=4096
    :type==='boolean'?typeof value==='boolean'
    :['string[]','array','list'].includes(type)?Array.isArray(value)&&value.length<=200&&value.every(v=>typeof v==='string'&&v.length<=512):false;
  if(!valid||row.missing){add(diagnostics,'FIXTURE_INVALID','Sample value failed its type or range check.',{key});return '—';}
  if(row.display==='hidden')return '';
  wantLabel=wantLabel||row.display==='label';
  if(wantLabel&&typeof row.label==='string')return row.label.slice(0,4096);
  if(wantLabel&&row.labels&&typeof row.labels==='object'&&Object.hasOwn(row.labels,String(value))&&typeof row.labels[String(value)]==='string')return row.labels[String(value)].slice(0,4096);
  return Array.isArray(value)?value.join(' · '):String(value);
}
function bind(text,fixture,diagnostics){return text.replace(/\{\{(sample|sample_label)::([a-z][a-z0-9_.-]*)\}\}/gi,(_,mode,key)=>sampleValue(fixture,key,mode==='sample_label',diagnostics));}
function projectBindings(text,fixture,diagnostics){
  let result='',at=0;
  for(const m of text.matchAll(/\{\{(sample|sample_label)::([a-z][a-z0-9_.-]*)\}\}/gi)){
    result+=escape(text.slice(at,m.index))+'<span data-state-field="'+m[2]+'" data-state-display="'+(m[1].toLowerCase()==='sample_label'?'label':'value')+'">'+escape(sampleValue(fixture,m[2],m[1].toLowerCase()==='sample_label',diagnostics))+'</span>';at=m.index+m[0].length;
  }
  return result+escape(text.slice(at));
}
function raster(asset,diagnostics){
  // The service owns admission. Do not accept raw strings, URLs, paths, SVG, or an unmarked data URI from card text.
  if(!asset||asset.validated!==true||typeof asset.dataUrl!=='string'){add(diagnostics,'ASSET_UNAVAILABLE','Asset is absent or not admitted by the host.');return undefined;}
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl);if(!match||match[2].length>12*1024*1024){add(diagnostics,'ASSET_INVALID','Asset projection must be a bounded raster data URI.');return undefined;}
  const bytes=Buffer.from(match[2],'base64');if(bytes.toString('base64')!==match[2])return undefined;
  const magic=match[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='image/jpeg'?bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!magic){add(diagnostics,'ASSET_INVALID','Raster MIME and bytes do not agree.');return undefined;}return asset.dataUrl;
}
export function buildPreview(source,{fixture={},visual,assets={},viewport='desktop',targetProfile='cardstudio-static-v1'}={}) {
  boundedSource(source);const diagnostics=[];const parsed=tokenizeHtml(source);const dependencies=analyzeFrontend(source);const css=[];let body='';
  const stack=[],blocked=[];
  if(!parsed.valid){add(diagnostics,'MALFORMED_HTML','Source is displayed as escaped text; markup could not be safely parsed.');body='<pre>'+escape(source)+'</pre>';}
  else for(const t of parsed.tokens){
    if(t.type==='comment')continue;
    if(t.type==='open') {
      if(blocked.length){if(!t.selfClosing)blocked.push(t.name);continue;}
      if(t.name==='style'){blocked.push(t.name);continue;}
      if(BLOCKED.has(t.name)||!ALLOWED.has(t.name)){add(diagnostics,'HTML_UNSUPPORTED','Element omitted from the static projection.',{element:t.name});if(!t.selfClosing)blocked.push(t.name);continue;}
      const attrs=[];let assetId,characterId;
      for(const a of t.attrs){const name=a.name,value=entities(a.value);
        if(name==='data-asset-id'){assetId=value;continue;}if(name==='data-character-id'){characterId=value;continue;}
        if(name==='style'){const style=declarations(value,diagnostics);if(style)attrs.push('style="'+escape(style)+'"');continue;}
        if(['class','id'].includes(name)){if(/^[A-Za-z][A-Za-z0-9 _.-]{0,500}$/.test(value))attrs.push(name+'="'+escape(value)+'"');else add(diagnostics,'ATTRIBUTE_UNSUPPORTED','Invalid class or ID omitted.');continue;}
        if(['title','alt','aria-label'].includes(name)){attrs.push(name+'="'+escape(bind(value,fixture,diagnostics).slice(0,4096))+'"');continue;}
        if(name==='role'&&['img','group','status','note','presentation'].includes(value)){attrs.push('role="'+value+'"');continue;}
        if(['colspan','rowspan'].includes(name)&&/^[1-9][0-9]?$/.test(value)){attrs.push(name+'="'+value+'"');continue;}
        if(name==='open'&&t.name==='details'){attrs.push('open');continue;}
        add(diagnostics,'ATTRIBUTE_UNSUPPORTED','Attribute omitted.',{attribute:name});
      }
      if(t.name==='img') {
        if(!assetId&&characterId){const state=visual?.characters?.[characterId]??visual?.[characterId];assetId=typeof state==='string'?state:state?.assetId??state?.asset_id;}
        const asset=/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(assetId??'')?assets[assetId]:undefined;const src=raster(asset,diagnostics);
        if(src)attrs.push('src="'+escape(src)+'"');else {body+='<span class="csscean-preview-placeholder" role="img" aria-label="Asset unavailable">Image unavailable</span>';continue;}
        attrs.push('loading="eager"','decoding="sync"');
      }
      body+='<'+t.name+(attrs.length?' '+attrs.join(' '):'')+'>';if(!VOID.has(t.name)&&!t.selfClosing)stack.push(t.name);else if(t.selfClosing&&!VOID.has(t.name))body+='</'+t.name+'>';
    } else if(t.type==='raw') {
      if(t.name==='style'&&blocked.length===1&&blocked[0]==='style')css.push(sanitizeCss(t.value,diagnostics));
    } else if(t.type==='close') {
      if(blocked.length){if(blocked.at(-1)===t.name)blocked.pop();continue;}
      if(stack.at(-1)!==t.name){add(diagnostics,'HTML_NESTING','Misnested close tag omitted.');continue;}stack.pop();body+='</'+t.name+'>';
    } else if(t.type==='text'&&!blocked.length)body+=projectBindings(entities(t.value),fixture,diagnostics);
  }
  while(stack.length)body+='</'+stack.pop()+'>';
  if(dependencies.javascript)add(diagnostics,'JAVASCRIPT_DISABLED','Card JavaScript and event handlers are not executed.');
  if(dependencies.ejs||dependencies.mvu||dependencies.tavernHelper)add(diagnostics,'RUNTIME_UNSUPPORTED','EJS/MVU/TavernHelper dependencies require a target runtime; they are not simulated.');
  if(dependencies.macros.some(m=>!/^\{\{(?:sample|sample_label)::[a-z][a-z0-9_.-]*\}\}$/i.test(m)))add(diagnostics,'MACRO_UNSUPPORTED','Unknown card macros are displayed literally; only explicit sample binders are substituted.');
  if(dependencies.externalResources.length)add(diagnostics,'NETWORK_DISABLED','External resource references are excluded from Preview.');
  const width=[360,390,768,1024].includes(Number(viewport))?Number(viewport):960;
  const csp="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const base=PRESENTATION_BASE_CSS+'.csscean-preview-root{max-width:'+width+'px}.csscean-preview-placeholder{display:flex;align-items:center;justify-content:center;min-height:120px;border:1px dashed #8492a6;background:#e9eef5;color:#4b5563}';
  const html='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'+escape(csp)+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+base+'\n'+css.filter(Boolean).join('\n')+'</style></head><body><div class="csscean-preview-root csscean-card-content">'+body+'</div></body></html>';
  return {html,diagnostics,dependencies,viewport:width,targetProfile,sandbox:'',javascript:false,network:false,projectionVersion:1,limitations:['Static authoring projection; not SillyTavern runtime validation.','Only explicit sample/sample_label bindings are resolved.','Restricted HTML/CSS subset; no arbitrary scripts, external resources, custom properties/var(), or active controls; only bounded width media queries.']};
}
