// Synthetic platform cases. No facts, conditions or art from a private card.
import {frontendPackage} from '../core/frontend.mjs';
const target=(key,category='facts')=>({scope:'world',category,key});
const ref=ref=>({ref}),literal=literal=>({literal});
export function w01Fixture(theme='indicator'){
  const fantasy=theme==='fantasy';
  const variables=fantasy?[
    {...target('mana','resources'),displayName:'魔力',type:'number',min:0,max:100,visibility:'public'},
    {...target('stance'),displayName:'姿態',type:'enum',enumValues:['rest','ready'],visibility:'public'},
    {...target('hero'),displayName:'英雄',type:'string',visibility:'public'}
  ]:[1,2,3,4].map(i=>({...target('check_'+i),displayName:'合成條件 '+i,type:'boolean',visibility:'public'}));
  variables.push({...target('secret'),displayName:'RESTRICTED_LABEL_CANARY',type:'string',visibility:'restricted'});
  const bp={schemaVersion:1,id:'w01-'+theme,version:1,extensionPolicy:'deny',variables};
  const initial={schemaVersion:1,blueprintId:bp.id,blueprintVersion:1,values:variables.map(v=>({...target(v.key,v.category),value:v.key==='secret'?'RESTRICTED_VALUE_CANARY':fantasy?(v.key==='mana'?75:v.key==='stance'?'ready':'蕨之旅人'):true,source:{id:'synthetic-author',version:1}}))};
  const bindings=variables.filter(v=>v.visibility==='public').map(v=>({alias:v.key,target:target(v.key,v.category),type:v.type}));
  const conditions=fantasy?{canCast:{op:'and',args:[{op:'gte',args:[ref('mana'),literal(30)]},{op:'eq',args:[ref('stance'),literal('ready')]}]},resting:{op:'not',args:[{op:'eq',args:[ref('stance'),literal('ready')]}]}}:{safe:{op:'and',args:[1,2,3,4].map(i=>ref('check_'+i))}};
  const html=fantasy?'<article class="grimoire"><header><h2 data-scean-text="hero"></h2><p>旅人手札</p></header><section class="stats"><p>魔力 <strong data-scean-text="mana"></strong></p><progress max="100" data-scean-progress="mana"></progress><p data-scean-when="canCast">術式可用</p><p data-scean-when="resting">休息中</p></section><details><summary>旅途筆記</summary><p>這是另一題材的合成卡，同一平台機制。</p></details></article>':'<section class="console"><h2>四條件合成觀測站</h2><p>合成條件 1–4，全數成立才顯示安全；與原卡未明條件無關。</p><div id="lamp" class="lamp" data-scean-state="safe"><strong>狀態</strong><span data-scean-text="safe"></span></div><details><summary>各項讀值</summary>'+[1,2,3,4].map(i=>'<p>條件 '+i+'：<b data-scean-text="check_'+i+'"></b></p>').join('')+'</details></section>';
  const css=fantasy?'.grimoire{background:#fff4d5;color:#392724;padding:24px;border:3px solid #987335;border-radius:18px}.stats{display:grid;gap:12px}h2{font-family:serif;font-size:30px}':'.console{background:#102030;color:#d6efff;padding:20px;border-radius:12px}.lamp{padding:24px;background:#6d3030;border-radius:20px;display:flex;gap:16px}.scean-true{background:#17613d}.scean-false{background:#6d3030}.scean-unknown,.scean-unavailable,.scean-stale{background:#665522}';
  const frontend=frontendPackage({schemaVersion:1,id:'w01-'+theme,runtime:{profile:'scean-html-bindings-v1',apiMajor:1},html,css,bindings,conditions,capabilities:{network:'none',worldActions:[],derivedDisplays:[]}},bp,[]);
  const characters=[{id:'archivist',name:'合成紀錄員',description:'僅供隔離工程驗收的虛構紀錄員。'}];
  const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'W01 '+theme,description:'全合成的跨題材平台驗收卡。',personality:'紀錄事實',scenario:'隔離測試',first_mes:'合成紀錄員等候玩家觀察。',mes_example:'',creator_notes:'無私人卡資料',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:['synthetic','W01'],creator:'offline fixture',character_version:'1',extensions:{scean:{characters,stateBlueprint:bp,initialState:initial,frontend}},character_book:{entries:[],extensions:{}}}};
  const snapshot={schemaVersion:1,cardId:'w01-'+theme,revision:1,card,worldbook:{entries:[]},preset:{instructions:'Synthetic only'},characters,stateBlueprint:bp,initialState:initial,frontend};
  return {bp,initial,frontend,card,snapshot};
}
