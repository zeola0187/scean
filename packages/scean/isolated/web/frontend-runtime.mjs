import {evaluateCondition} from './condition-ast.mjs';
export function evaluateDisplay(expr,values,freshness='current'){return evaluateCondition(expr,values,freshness);}
// W01 v1 presentation ABI. Browser/Node shared, no Host, filesystem or model access.
export const FRONTEND_API = 1;
export const frontendError = code => Object.assign(new Error(code), {code});
export const escapeHtml = v => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const own = (o,k) => Object.hasOwn(o??{},k);
export function displayValues(frontend,projection) {
  const values={...projection.values};
  for(const [name,expr] of Object.entries(frontend.conditions))values[name]=evaluateDisplay(expr,projection.values,projection.freshness);
  return values;
}
export function renderFrontendDocument(frontend,projection,{authoringInitial=false}={}) {
  let emitted=0;
  const values=displayValues(frontend,projection),status=v=>projection.freshness!=='current'?'stale':v?.status??'unavailable';
  const show=v=>status(v)==='known'?(typeof v.value==='object'?JSON.stringify(v.value):String(v.value)):{unknown:'未知',unavailable:'不可取得',stale:'資料過期'}[status(v)];
  function render(n){
    if(own(n,'text'))return escapeHtml(n.text);
    const attrs={...n.attrs},textAlias=attrs['data-scean-text'],stateAlias=attrs['data-scean-state'],when=attrs['data-scean-when'],progress=attrs['data-scean-progress'];
    if(stateAlias){const v=values[stateAlias],s=status(v);attrs['data-state']=s==='known'?String(v.value):s;attrs.class=((attrs.class??'')+' scean-'+attrs['data-state']).trim();}
    if(when){const v=values[when];if(status(v)!=='known'||v.value!==true)attrs.hidden='';}
    if(progress){const v=values[progress];if(status(v)==='known')attrs.value=String(Math.max(0,Math.min(Number(attrs.max??100),v.value)));else delete attrs.value;attrs['aria-label']=show(v);}
    if(n.tag==='progress'&&!progress)delete attrs.value;
    const attr=Object.entries(attrs).map(([k,v])=>' '+k+'="'+escapeHtml(v)+'"').join('');
    const result='<'+n.tag+attr+'>'+(['br','hr'].includes(n.tag)?'':(textAlias?escapeHtml(show(values[textAlias])):n.children.map(render).join(''))+'</'+n.tag+'>');
    emitted+=result.length;if(emitted>1024*1024)throw frontendError('FRONTEND_RENDER_LIMIT');return result;
  }
  // No scripts, network, forms, navigation, embedded documents, or Host bridge.
  // Future isolated JS needs a different, explicitly admitted runtime profile.
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; connect-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:18px system-ui;overflow-wrap:anywhere}*{box-sizing:border-box;max-width:100%}[hidden]{display:none!important}progress{width:100%}'+frontend.safeCss+'</style></head><body><div role="status">'+escapeHtml(authoringInitial?'作者設定初值（非遊玩狀態）':projection.freshness==='current'?'已提交狀態 v'+projection.canonical.version:'資料過期／同步中')+'</div>'+frontend.tree.map(render).join('')+'</body></html>';
}
