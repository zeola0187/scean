import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePresentation,presentationTheme,loadPresentation,savePresentation,presentationKey,mountPresentation} from '../isolated/web/presentation.mjs';
const layoutDefaults={darkPalette:'forest',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false};
test('first use follows system and normal; saved large survives',()=>{
  assert.deepEqual(normalizePresentation(null),{schemaVersion:1,theme:'system',readingSize:'normal',...layoutDefaults});
  assert.equal(normalizePresentation({theme:'dark',readingSize:'normal'}).readingSize,'normal');
  assert.equal(normalizePresentation({theme:'dark',readingSize:'large'}).readingSize,'large');
  assert.deepEqual(normalizePresentation({theme:'host',readingSize:999,runId:'private'}),{schemaVersion:1,theme:'system',readingSize:'normal',...layoutDefaults});
  assert.equal(presentationTheme('system',true),'dark');assert.equal(presentationTheme('light',true),'light');
});
test('presentation persists only enums; load does not write; blocked storage is honest',async()=>{
  let saved,writes=0;const storage={getItem:key=>{assert.equal(key,presentationKey);return saved??null;},setItem:(key,value)=>{saved=value;writes++;}};
  await loadPresentation({storage});assert.equal(writes,0);
  await savePresentation({theme:'dark',readingSize:'normal',runId:'private',grantToken:'secret'},{storage});
  assert.equal(saved.includes('private'),false);assert.equal(saved.includes('secret'),false);
  assert.equal((await loadPresentation({storage})).readingSize,'normal');
  assert.equal((await savePresentation({theme:'dark'},{storage:{setItem(){throw Error('denied');}}})).persistence,'unavailable');
});
test('opaque native preferences use the existing dedicated parent channel only',async()=>{
  const calls=[];const native={request:async(action,payload)=>{calls.push({action,payload});return {theme:'light',readingSize:'normal',persistence:'saved'};}};
  assert.equal((await loadPresentation({native})).theme,'light');await savePresentation({theme:'dark',readingSize:'large',input:'not allowed'},{native});
  assert.equal(calls[0].action,'native.presentationGet');assert.equal(calls[1].action,'native.presentationSave');assert.equal(calls[1].payload.input,undefined);
});
test('both palettes maintain readable semantic text and visible focus/control boundaries',async()=>{
  const css=await readFile(new URL('../isolated/web/presentation.css',import.meta.url),'utf8');
  const palette=selector=>Object.fromEntries([...css.match(selector)[1].matchAll(/--([\w-]+):\s*(#[\da-f]{3,8})/gi)].map(m=>[m[1],m[2]]));
  const light=palette(/:root\{([^}]+)\}/),dark={...light,...palette(/:root\[data-theme=dark\]\{([^}]+)\}/)};
  const l=hex=>{const raw=hex.replace('#',''),parts=(raw.length===3?raw.split('').map(c=>c+c).join(''):raw).match(/../g).slice(0,3).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*parts[0]+.7152*parts[1]+.0722*parts[2];};
  const contrast=(a,b)=>(Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);
  for(const [name,p] of [['light',light],['dark',dark]]){
    for(const [front,back] of [['ink','surface'],['body-ink','surface'],['muted','surface'],['muted','page'],['accent','surface'],['on-accent','accent'],['gold','page'],['error','error-bg'],['warning','warning-bg']])assert.ok(contrast(p[front],p[back])>=4.5,`${name} ${front}/${back}: ${contrast(p[front],p[back])}`);
    assert.ok(contrast(p.focus,p.surface)>=3);assert.ok(contrast(p.focus,p.page)>=3);
    assert.ok(contrast(name==='dark'?'#7f9788':'#7d8d7e',p.field)>=3);
  }
});

// A delayed parent response must not undo a deliberate current-page choice.
test('late preference load and storage failure cannot overwrite a newer user choice',async()=>{
  const control=initial=>{const listeners=new Map();return {value:initial,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n),change(){listeners.get('change')();}};};
  const font=control('large'),theme=control('system'),status={},root={dataset:{},style:{}},body={dataset:{}},writes=[];
  let finishLoad;const loading=new Promise(resolve=>{finishLoad=resolve;});
  const native={request:async(action,value)=>action==='native.presentationGet'?loading:action==='native.presentationEnvironment'?{dark:false}:(writes.push(value),{...value,persistence:'saved'})};
  const mounted=mountPresentation({font,theme,status,root,body,native});
  font.value='normal';theme.value='dark';theme.change();
  finishLoad({schemaVersion:1,theme:'light',readingSize:'large'});await mounted.ready;await new Promise(setImmediate);
  assert.equal(root.dataset.theme,'dark');assert.equal(body.dataset.readingSize,'normal');assert.deepEqual(writes,[{schemaVersion:1,theme:'dark',readingSize:'normal',...layoutDefaults}]);mounted.dispose();
  assert.deepEqual(normalizePresentation({schemaVersion:2,theme:'light',readingSize:'normal'}),normalizePresentation(null));
  assert.equal((await loadPresentation({storage:{getItem(){return '{bad-json';}}})).persistence,'unavailable');
  assert.equal((await loadPresentation({storage:{getItem(){throw Error('blocked');}}})).persistence,'unavailable');
});
