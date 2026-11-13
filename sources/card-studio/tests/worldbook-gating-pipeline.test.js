import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { compileGate } from '../cardstudio-bundle/lib/worldbook-gating.js';
import { targetInputStamp } from '../cardstudio-bundle/lib/target-state.js';

// Pinned official handler/decorator + TT scanner. No installed application,
// real chats, accounts, model calls, card JS or network are used by this harness.
// EJS interpolation is restricted to the compiler's single known expression.
// Timed effects, groups and host tokenization are explicit test doubles; this
// is not a claim that the entire ST prompt pipeline/runtime has been emulated.
const base=new URL('./fixtures/gating-primary/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,base),'utf8');
const manifest=JSON.parse(read('manifest.json'));
for(const file of manifest)assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file.file,base))).digest('hex'),file.sha256);
const declaration=(text,start)=>{const at=text.indexOf(start);assert.ok(at>=0,start);const end=text.indexOf('\n}',at);assert.ok(end>at);return text.slice(at,end+2).replace(/^export /,'');};
const wi=read('pt-worldinfo.ts'),handler=read('pt-handler.ts'),evaluate=read('pt-evaluate.ts'),tt=read('tt-world-info.js.txt');
const known=wi.slice(wi.indexOf('const KNOWN_DECORATORS'),wi.indexOf(']);',wi.indexOf('const KNOWN_DECORATORS'))+3);
const plugin=stripTypeScriptTypes([known,declaration(wi,'export class WorldInfoDecorators'),declaration(wi,'export function parseDecorators'),declaration(evaluate,'export async function evalTemplateHandler'),declaration(handler,'async function handleWorldInfoLoaded')].join('\n'),{mode:'strip'});
const native=[declaration(tt,'class WorldInfoBuffer'),declaration(tt,'function parseDecorators'),declaration(tt,'export async function getSortedEntries'),declaration(tt,'async function checkWorldInfoInternal')].join('\n');
const field={quest_stage:{type:'number',min:0,max:100}};
const target={config:{profile:'tauritavern-helper-ejs-v1',namespace:'quest_state',fields:field},definitionDigest:'synthetic-definition'};
const rule={schemaVersion:1,predicate:{op:'gte',path:'values.quest_stage',value:30}};
const prefix=compileGate(rule,target);
const entry=(uid,content,extra={})=>({uid,world:'synthetic',comment:'synthetic entry',content,key:[],keysecondary:[],constant:true,disable:false,selective:false,order:100,position:0,decorators:[],useProbability:false,probability:100,...extra});

async function pipeline(entries,value,{text='hello',budget=100000,recursive=false,lookupError=false}={}){
  const message={mes:'Completed synthetic message',swipe_id:0},snapshot={profile:target.config.profile,definition:target.definitionDigest,state:{values:{quest_stage:value}},error:null,input:{schemaVersion:1,messageId:0,swipeId:0,stamp:targetInputStamp(message.mes)}};
  const env={SillyTavern:{chat:[message]},getvar:()=>{if(lookupError)throw Error('synthetic failure');return snapshot;}};
  const errors=[],context=vm.createContext({structuredClone,console:{debug(){},log(){},error:e=>errors.push(String(e)),warn(){}},settings:{enabled:true,sandbox:false},STATE:{isInPlace:false},runID:0,generateType:'normal',prepareContext:async()=>env,getActivatedWIEntries:()=>[],activateWorldInfo:async()=>{throw Error('not used');},toastr:{error:()=>{},success:()=>{}},getSyntaxErrorInfo:()=>'',evalTemplate:async(source)=>{assert.ok(source.startsWith('<%- !!(')&&source.endsWith(') %>'));return String(vm.runInNewContext(source.slice(4,-3).trim(),env,{timeout:100}));}});
  vm.runInContext(plugin+'\nglobalThis.loaded=handleWorldInfoLoaded;',context);
  const data={globalLore:[],characterLore:structuredClone(entries),personaLore:[],chatLore:[]};
  await context.loaded(data);
  const afterLoaded=data.characterLore.map(e=>e.uid),tokenInputs=[];
  const silent={debug(){},log(){},warn(){},error:e=>{throw e;}};
  const nativeContext=vm.createContext({structuredClone,console:silent,Math:Object.assign(Object.create(Math),{random:()=>0.5}),KNOWN_DECORATORS:['@@activate','@@dont_activate'],scan_state:{NONE:0,INITIAL:1,RECURSION:2,MIN_ACTIVATIONS:3},world_info_insertion_strategy:{evenly:0,character_first:1,global_first:2},world_info_character_strategy:0,sortFn:(a,b)=>b.order-a.order,collectWorldInfoEntries:async()=>data,prepareWorldInfoEntries:(entries,parse)=>entries.map(e=>{const [decorators,content]=parse(e.content);return {...e,decorators,content,hash:e.uid};}),getStringHash:()=>1,world_info_budget:100,world_info_budget_cap:budget,world_info_depth:2,world_info_case_sensitive:false,world_info_match_whole_words:false,world_info_recursive:recursive,world_info_max_recursion_steps:8,world_info_min_activations:0,world_info_min_activations_depth_max:0,world_info_overflow_alert:false,world_info_logic:{AND_ANY:0,NOT_ALL:1,NOT_ANY:2,AND_ALL:3},world_info_position:{before:0,after:1},MAX_SCAN_DEPTH:1000,DEFAULT_DEPTH:4,getContext:()=>({extensionPrompts:{}}),WorldInfoTimedEffects:class{checkTimedEffects(){}isEffectActive(){return false;}setTimedEffects(){}cleanUp(){}},filterByInclusionGroups:entries=>{assert.ok(entries.every(e=>!e.group),'groups not emulated');},getTokenCountAsync:async text=>{tokenInputs.push(text);return text.length;},canPrefetchWorldInfoTokenCount:()=>false,substituteParams:x=>x,parseRegexFromString:()=>null,escapeRegex:s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),getRegexedString:x=>x,regex_placement:{WORLD_INFO:5},shouldWIAddPrompt:false,eventSource:{emit:async()=>{}},event_types:{WORLDINFO_SCAN_DONE:'WORLDINFO_SCAN_DONE'}});
  vm.runInContext(native+'\nglobalThis.scan=checkWorldInfoInternal;',nativeContext);
  const result=await nativeContext.scan([text],100000,true,{trigger:'normal'});
  return {afterLoaded,activated:[...result.allActivatedEntries].map(e=>e.uid),prompt:result.worldInfoBefore,tokenInputs,errors};
}

test('official WORLDINFO_ENTRIES_LOADED handler removes false gates before native scan/token budget',async()=>{
  const e=entry(1,prefix+'\nHidden quest lore');
  const closed=await pipeline([e],29);assert.deepEqual(closed.afterLoaded,[]);assert.deepEqual(closed.activated,[]);assert.equal(closed.tokenInputs.length,0);
  const open=await pipeline([e],30);assert.deepEqual(open.afterLoaded,[1]);assert.deepEqual(open.activated,[1]);assert.equal(open.prompt,'Hidden quest lore');assert.ok(open.tokenInputs.some(x=>x.includes('Hidden quest lore')));
  const failed=await pipeline([e],70,{lookupError:true});assert.deepEqual(failed.afterLoaded,[]);assert.equal(failed.errors.length,0,'generated catch returns false, never plugin null-on-error');
  const wrong=await pipeline([e],'70');assert.deepEqual(wrong.afterLoaded,[]);
});

test('passing gates still require native keywords/probability/budget and permit ordinary recursion',async()=>{
  const keyed=entry(1,prefix+'\nQuest lore',{constant:false,key:['quest']});
  assert.deepEqual((await pipeline([keyed],70)).activated,[]);
  assert.deepEqual((await pipeline([keyed],70,{text:'quest'})).activated,[1]);
  assert.deepEqual((await pipeline([entry(1,prefix+'\nQuest lore',{useProbability:true,probability:0})],70)).activated,[]);
  assert.deepEqual((await pipeline([entry(1,prefix+'\nLong quest lore')],70,{budget:3})).activated,[]);
  const recursive=[entry(1,prefix+'\nRECURSION_KEY'),entry(2,'Dependent lore',{constant:false,key:['RECURSION_KEY']})];
  assert.deepEqual((await pipeline(recursive,29,{recursive:true})).activated,[]);
  assert.deepEqual((await pipeline(recursive,70,{recursive:true})).activated,[1,2]);
});

test('display hiding and late inline EJS are not scan-time exclusion',async()=>{
  const result=await pipeline([entry(1,'<span hidden>Display hidden lore</span>'),entry(2,'<% if(false){ %>Late template lore<% } %>')],0);
  assert.deepEqual(result.afterLoaded,[1,2]);assert.deepEqual(result.activated,[1,2]);
  assert.ok(result.tokenInputs.some(x=>x.includes('Late template lore')));
});
