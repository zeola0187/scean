import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePresentation,savePresentation,mountPresentation} from '../isolated/web/presentation.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

test('legacy preferences migrate additively, invalid values and private data stay out',()=>{
  assert.deepEqual(normalizePresentation({schemaVersion:1,theme:'dark',readingSize:'normal'}),{schemaVersion:1,theme:'dark',readingSize:'normal',darkPalette:'forest',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false});
  assert.deepEqual(normalizePresentation({darkPalette:'url(secret)',readingWidth:'unbounded',leftCollapsed:'true',rightCollapsed:1,run:'PRIVATE'}),normalizePresentation(null));
});

test('both transports preserve all new preferences and native rejects malformed settings without Host calls',async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let data;
  const storage={getItem:()=>data,setItem:(_key,value)=>{data=value;}};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  const safe=normalizePresentation({theme:'dark',darkPalette:'wine',readingWidth:'comfortable',leftCollapsed:true,rightCollapsed:false});
  try{
    const bridge=createNativeBridge({call:()=>assert.fail('appearance must never call Host')});
    await savePresentation({...safe,runId:'PRIVATE'},{native:bridge});assert.deepEqual(JSON.parse(data),safe);
    assert.deepEqual(await bridge.request('native.presentationGet'),{...safe,persistence:'saved'});
    for(const bad of [{darkPalette:'red'},{readingWidth:'unlimited'},{leftCollapsed:'true'},{rightCollapsed:1}])await assert.rejects(bridge.request('native.presentationSave',{...safe,...bad}),{code:'NATIVE_PRESENTATION_INVALID'});
    await savePresentation({...safe,rightCollapsed:true},{storage});assert.equal(JSON.parse(data).rightCollapsed,true);assert(!data.includes('PRIVATE'));
  }finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});

test('independent toggle changes survive font/theme saves, late loads and unavailable storage',async()=>{
  const control=value=>{const handlers={};return {value,handlers,addEventListener:(k,f)=>handlers[k]=f,removeEventListener:k=>delete handlers[k],setAttribute(k,v){this[k]=v;}};};
  const font=control('large'),theme=control('dark'),palette=control('forest'),width=control('wide'),left=control(),right=control(),root={dataset:{},style:{}},body={dataset:{}},status={};
  let finishLoad;const load=new Promise(resolve=>finishLoad=resolve),writes=[];
  const native={request:async(action,value)=>action==='native.presentationGet'?load:action==='native.presentationEnvironment'?{dark:true}:(writes.push(value),{...value,persistence:'unavailable'})};
  const mounted=mountPresentation({font,theme,palette,width,left,right,root,body,status,native});
  left.handlers.click();right.handlers.click();left.handlers.click();palette.value='black';font.value='normal';palette.handlers.change();
  finishLoad({theme:'light',leftCollapsed:true});await mounted.ready;await new Promise(setImmediate);
  assert.equal(body.dataset.leftCollapsed,'false');assert.equal(body.dataset.rightCollapsed,'true');assert.equal(right['aria-expanded'],'false');assert.equal(right.textContent,'此刻');assert.equal(right['aria-label'],'展開此刻');assert.equal(root.dataset.darkPalette,'black');assert.equal(body.dataset.readingSize,'normal');assert.equal(writes.at(-1).rightCollapsed,true);assert(status.textContent.includes('無法保存'));mounted.dispose();
});

test('new dark palettes preserve readable semantic colors, field edges and focus',async()=>{
  const css=await readFile(new URL('../isolated/web/presentation.css',import.meta.url),'utf8');
  const tokens=s=>Object.fromEntries([...s.matchAll(/--([\w-]+):(#[\da-f]{3,8})/gi)].map(m=>[m[1],m[2]]));
  const base=tokens(css.match(/:root\{([^}]+)\}/)[1]),dark={...base,...tokens(css.match(/:root\[data-theme=dark\]\{([^}]+)\}/)[1])};
  const luminance=hex=>{let h=hex.slice(1);if(h.length===3)h=[...h].map(x=>x+x).join('');const v=h.match(/../g).slice(0,3).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
  const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  for(const name of ['black','wine']){
    const specific=tokens(css.match(new RegExp(':root\\[data-theme=dark\\]\\[data-dark-palette='+name+'\\]\\{([^}]+)\\}'))[1]),p={...dark,...specific};
    for(const [a,b] of [['body-ink','surface'],['muted','surface'],['muted','page'],['accent','surface'],['on-accent','accent'],['error','error-bg'],['warning','warning-bg'],['banner-ink','banner']])assert(ratio(p[a],p[b])>=4.5,name+' '+a+'/'+b);
    for(const [a,b] of [['focus','page'],['focus','surface'],['control-line','field']])assert(ratio(p[a],p[b])>=3,name+' '+a+'/'+b);
    for(const semantic of ['error','error-bg','warning','warning-bg','focus'])assert.equal(specific[semantic],undefined,'preset must not replace '+semantic);
  }
});

test('saved Studio appearance reaches a mounted native player without changing reading choices or calling Host',async()=>{
  const priorStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),priorDispatch=Object.getOwnPropertyDescriptor(globalThis,'dispatchEvent');
  let data=JSON.stringify(normalizePresentation({theme:'dark',darkPalette:'forest',readingWidth:'comfortable',readingSize:'large',leftCollapsed:true})),environment;
  const storage={getItem:()=>data,setItem:(_key,v)=>{data=v;}},events=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'dispatchEvent',{configurable:true,value:event=>{events.push(event);return true;}});
  const control=()=>({value:'',addEventListener(){},removeEventListener(){},setAttribute(){}}),font=control(),theme=control(),palette=control(),width=control(),root={dataset:{},style:{}},body={dataset:{}},status={};
  try{
    const bridge=createNativeBridge({call:()=>assert.fail('appearance must never call Host')});
    const mounted=mountPresentation({font,theme,palette,width,root,body,status,native:{request:bridge.request,onPresentation:fn=>{environment=fn;return()=>environment=null;}}});await mounted.ready;
    const before=JSON.parse(data);await savePresentation({...before,theme:'dark',darkPalette:'wine'},{storage});
    assert.equal(events.at(-1).type,'scean:presentation');environment({dark:false,preferences:await bridge.request('native.presentationGet')});
    assert.equal(root.dataset.theme,'dark');assert.equal(root.dataset.darkPalette,'wine');assert.equal(palette.value,'wine');assert.equal(body.dataset.leftCollapsed,'true');assert.equal(body.dataset.readingWidth,'comfortable');assert.equal(font.value,'large');
    await bridge.request('native.presentationSave',{...JSON.parse(data),theme:'light'});assert.equal(events.at(-1).detail.theme,'light');mounted.dispose();assert.equal(environment,null);
  }finally{for(const [key,prior]of [['localStorage',priorStorage],['dispatchEvent',priorDispatch]])if(prior)Object.defineProperty(globalThis,key,prior);else delete globalThis[key];}
});
