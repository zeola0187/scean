import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeCss,sanitizeDeclarations} from '../cardstudio-bundle/lib/preview-css.js';
import {buildPreview} from '../cardstudio-bundle/lib/preview-projection.js';

test('safe gradient, background shorthand, quoted fonts and width media queries survive together',()=>{
  const diagnostics=[],source=`/* static theme */
  .panel{background:linear-gradient(135deg, #eef, rgba(255,255,255,.8));font-family:"Noto Sans TC", 'Microsoft JhengHei', sans-serif;padding:16px}
  @media screen and (max-width: 390px){.panel{padding:8px;background:#fff}}
  @media (min-width:768px) and (max-width:1024px){.panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  const result=sanitizeCss(source,diagnostics);
  assert.match(result,/background:linear-gradient/);assert.match(result,/font-family:"Noto Sans TC", 'Microsoft JhengHei', sans-serif/);
  assert.match(result,/@media screen and \(max-width: 390px\)\{.panel\{padding:8px;background:#fff\}\}/);
  assert.match(result,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.deepEqual(diagnostics,[]);
});
test('unsupported at-rules and values drop only their own units with diagnostics',()=>{
  const diagnostics=[],result=sanitizeCss('.before{color:red}@import "https://evil.invalid/x";@supports(display:grid){.nested{color:pink}}.after{--tone:blue;color:var(--tone);background:#fff;font-size:18px}',diagnostics);
  assert.equal(result,'.before{color:red}\n.after{background:#fff;font-size:18px}');
  assert.equal(diagnostics.filter(d=>d.code==='CSS_AT_RULE_UNSUPPORTED').length,2);
  assert.deepEqual(diagnostics.filter(d=>d.details?.property).map(d=>d.details.property),['--tone','color']);
});
test('comments and literal @ in strings do not destroy neighboring declarations or rules',()=>{
  const diagnostics=[],result=sanitizeCss('.a{padding:/* note */8px;font-family:"name@example";color:red}/* @note */.b{color:blue}',diagnostics);
  assert.equal(result,'.a{padding:8px;color:red}\n.b{color:blue}');assert(diagnostics.some(d=>d.details?.property==='font-family'));
  assert.equal(sanitizeDeclarations('font-family:"Name;color:red";padding:4px',[]),'padding:4px');
});
test('malformed tails, nested declarations and escaped values retain independent safe rules',()=>{
  for(const bad of ['.bad{color:red', '@media (max-width:390px){.bad{color:red}', '/* incomplete']){
    const diagnostics=[];assert.equal(sanitizeCss('.safe{color:blue}'+bad,diagnostics),'.safe{color:blue}');assert(diagnostics.some(d=>d.code==='CSS_MALFORMED'));
  }
  const diagnostics=[];assert.equal(sanitizeCss('.bad{.nested{color:red}}.safe{color:r\\65 d;background:#fff}',diagnostics),'.safe{background:#fff}');assert.equal(diagnostics.length,2);
});
test('media query grammar does not admit arbitrary conditions, escapes, imports or nested bypasses',()=>{
  for(const header of ['@supports(display:grid)','@font-face','@media print','@media (min-width:9999px)','@media (width > 390px)','@media (max-width:30em)','@media (max-width:390px), screen','@media (max-width:390px) or (min-width:768px)','@media (max-width:390px)\\','@MEDIA (prefers-color-scheme:dark)']){
    const diagnostics=[];assert.equal(sanitizeCss(header+'{.bad{color:red}}.safe{color:blue}',diagnostics),'.safe{color:blue}',header);assert(diagnostics.some(d=>d.code==='CSS_AT_RULE_UNSUPPORTED'));
  }
  const diagnostics=[],safe=sanitizeCss('@media (max-width:390px){@import "https://evil.invalid/x";.safe{color:blue}}',diagnostics);
  assert.equal(safe,'@media (max-width:390px){.safe{color:blue}}');assert.equal(diagnostics[0].code,'CSS_AT_RULE_UNSUPPORTED');
});
test('resource/JS functions, escapes and variable indirection fail closed in expanded backgrounds',()=>{
  const attacks=['url(https://evil.invalid/x)','URL(//evil.invalid/x)','image-set("https://evil.invalid/x" 1x)','image(url(x))','cross-fade(url(x),red,20%)','expression(alert(1))','var(--remote, url(x))','var(--tone,red)','attr(data-src url)','paint(remote)','-webkit-image-set(url(x) 1x)','u\\72l(x)','u/**/rl(x)','linear-gradient(red,url(x))','linear-gradient(red,env(secret))','linear-gradient(red,evil_min(1px))','linear-gradient(red,my2rgb(1,2,3))','linear-gradient(red,min/**/(1px))'];
  for(const value of attacks){
    const diagnostics=[],result=sanitizeCss('.x{background:'+value+';color:blue}.after{padding:8px}',diagnostics);
    // A comment before a whitelisted function is valid CSS whitespace.
    if(value==='linear-gradient(red,min/**/(1px))'){assert.match(result,/min\s+\(1px\)/);continue;}
    assert.equal(result,'.x{color:blue}\n.after{padding:8px}',value);assert(diagnostics.length>0,value);
  }
  assert.equal(sanitizeCss('.x{--remote:url(x);background:var(--remote);position:fixed;color:blue}'),'.x{color:blue}');
});
test('font names accept quoted local families but reject escapes and resource syntax',()=>{
  assert.equal(sanitizeDeclarations('font-family:"思源黑體", sans-serif'), 'font-family:"思源黑體", sans-serif');
  for(const value of ['"evil</style><script>bad()</script>"','"name\\22"','url(x)','"https://evil.invalid"','"name; color:red"']){
    const diagnostics=[];assert.equal(sanitizeDeclarations('font-family:'+value+';color:blue',diagnostics),'color:blue');assert(diagnostics.length>0);
  }
});
test('CSS limits are bounded and reported for size, rule count and nesting',()=>{
  let diagnostics=[];assert.equal(sanitizeCss(' '.repeat(64001),diagnostics),'');assert.equal(diagnostics[0].code,'CSS_LIMIT');
  diagnostics=[];const many=sanitizeCss('.x{color:red}'.repeat(300),diagnostics);assert.equal(many.split('\n').length,250);assert(diagnostics.some(d=>d.code==='CSS_LIMIT'));
  diagnostics=[];const deep='@media (max-width:390px){'.repeat(8)+'.x{color:red}'+'}'.repeat(8);assert.equal(sanitizeCss(deep,diagnostics),'');assert(diagnostics.some(d=>d.code==='CSS_AT_RULE_UNSUPPORTED'));
});
test('projection keeps exact supported desktop widths and its JS/network/iframe boundary',()=>{
  for(const viewport of [360,390,768,1024]){
    const diagnostics=buildPreview('<style>.x{background:linear-gradient(red,blue)}@media (min-width:768px){.x{padding:20px}}@import "https://evil.invalid";</style><div class="x" style="background:var(--x);color:blue">Test</div>',{viewport});
    assert.equal(diagnostics.viewport,viewport);assert.match(diagnostics.html,new RegExp('max-width:'+viewport+'px'));
    assert.equal(diagnostics.sandbox,'');assert.equal(diagnostics.network,false);assert.equal(diagnostics.javascript,false);
    assert(diagnostics.diagnostics.some(d=>d.code==='CSS_AT_RULE_UNSUPPORTED'));assert(diagnostics.diagnostics.some(d=>d.details?.property==='background'));
    assert(!diagnostics.html.includes('evil.invalid'));assert(!diagnostics.html.includes('var(--x)'));assert(diagnostics.html.includes('frame-src &#39;none&#39;'));
  }
});
