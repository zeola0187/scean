// Original synthetic fixture. No production card, chat, or personal data.
export function syntheticCatalog() {
  const characters = [
    {id:'kalt',name:'卡爾特',description:'合成角色。研究船的工程師，擅長低負載設備檢查。',identity:{source:'card-explicit',gender:'女性',pronouns:'她'}},
    {id:'sio',name:'希歐',description:'合成角色。研究船的領航員，負責記錄與觀測。'},
  ];
  return {source:'bundled-synthetic',studioBridge:'not_connected',cards:[{id:'synthetic-observatory',title:'星港研究船（安全合成卡）',revisions:['r1','r2'].map(revision=>({
    id:revision,revision,label:revision,title:revision+' · '+(revision==='r1'?'港邊午休':'夜間觀測'),
    snapshot:{schemaVersion:1,cardId:'synthetic-observatory',revision,card:{spec:'chara_card_v2',data:{name:'星港研究船',description:'完全合成的研究船。卡爾特與希歐陪同玩家在星港進行日常研究。',first_mes:''}},worldbook:{entries:[{id:1,content:'星港是安全、平靜的補給站。研究船目前停泊港內。',constant:true}]},preset:{style:'繁體中文，第三人稱，保留玩家決定權。'},characters,chapterSummary:'安全合成新局；沒有引用任何私人對話。',fixtureProvenance:'SCEAN milestone A original synthetic fixture v1'},
    openings:[{id:'cabin',label:'共用艙室',title:'共用艙室',text:'午後的星光穿過舷窗。卡爾特把工具箱放在桌邊，希歐抬起頭，等候你的下一句話。',initialState:{world:{locations:{kalt:'common_cabin',sio:'common_cabin'},tasks:{inspection:{status:'not_started'}},resources:{fuel:{amount:72,unit:'percent'}},time:{elapsedSeconds:0}},characters:{kalt:{public:{role:'engineer'}},sio:{public:{role:'navigator'}}}}},
      {id:'deck',label:'觀測甲板',title:'觀測甲板',text:'觀測甲板的燈光逐一亮起。卡爾特正在整理設備，希歐指著遠處的星群，留出你發言的空間。',initialState:{world:{locations:{kalt:'observation_deck',sio:'observation_deck'},tasks:{inspection:{status:'not_started'}},time:{elapsedSeconds:0}},characters:{kalt:{public:{role:'engineer'}},sio:{public:{role:'navigator'}}}}}]
  }))}]};
}

export function resolveSyntheticCreate(request) {
  const card=syntheticCatalog().cards.find(c=>c.id===request.cardId);
  const revision=card?.revisions.find(r=>r.id===request.revisionId);
  const opening=revision?.openings.find(o=>o.id===request.openingId);
  if(!opening)throw Object.assign(Error('CATALOG_SELECTION_INVALID'),{code:'CATALOG_SELECTION_INVALID'});
  const snapshot=structuredClone(revision.snapshot);
  snapshot.opening={id:opening.id,title:opening.title,text:opening.text};
  snapshot.card.data.first_mes=opening.text;
  return {action:'create',...(request.playerName!==undefined?{playerName:request.playerName}:{}),snapshot,initialState:structuredClone(opening.initialState),openingId:opening.id};
}

export function createScriptedModel({delayMs=50}={}) {
  const failedOnce=new Set();
  return {async generate({stage,input,signal,context={}}) {
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delayMs);const aborted=()=>{clearTimeout(timer);reject(Object.assign(Error('CANCELLED'),{code:'CANCELLED'}));};if(signal?.aborted)return aborted();signal?.addEventListener('abort',aborted,{once:true});});
    const playerInput=input.assembly?.playerInput??input.context?.playerInput??input.playerInput??'';
    if(stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:input.range.endTurn,suggestedTitle:'合成：星圖旁的約定',keywords:['銀色鑰匙'],characters:['卡爾特','希歐'],locations:['艙室'],plotThreads:['等待玩家回答'],emotionalTone:'平靜',significantEvents:['鑰匙放在星圖旁']}),model:'synthetic-chapter-v1'};
    if(stage==='chapter_summary')return {text:JSON.stringify({title:'合成：星圖旁的約定',summary:'卡爾特把銀色鑰匙放在星圖旁，希歐點頭。他們仍在等待玩家回答。',keywords:['銀色鑰匙','星圖'],characters:['卡爾特','希歐'],locations:['艙室'],plotThreads:['等待玩家回答'],emotionalTone:'平靜'}),model:'synthetic-chapter-v1'};
    if(stage==='summary')return {text:((input.previousSummary?.text??'')+' '+input.turns.map(t=>`Turn ${t.turn}: ${t.input} ${t.body}`).join(' ')).slice(-15000),model:'synthetic-summary-v1'};
    if(stage==='director'){
      if(playerInput.includes('[test:fail]'))throw Object.assign(Error('MODEL_TRANSPORT_ERROR'),{code:'MODEL_TRANSPORT_ERROR'});
      if(playerInput.includes('[test:fail-once]')&&!failedOnce.has(context.requestId)){failedOnce.add(context.requestId);throw Object.assign(Error('MODEL_TRANSPORT_ERROR'),{code:'MODEL_TRANSPORT_ERROR'});}
      if(/諮詢.*卡爾特|consult.*kalt/i.test(playerInput)&&!input.conversation?.length)return {text:'',toolCalls:[{id:'synthetic-consult-kalt',name:'consult_character',arguments:{characterId:'kalt',question:'如何安排低負載檢查？'}}]};
      if(input.handoffContract)return {text:JSON.stringify({handoffVersion:1,sceneIntent:'A synthetic ordinary exchange; no new player decision is invented.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]})};
      return {text:'在艙室給出簡短的日常回應，保留玩家決定。'};
    }
    if(stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:input.character.id,observable:{attitude:'謹慎',intent:'建議先確認設備的低負載讀數'},publicUtterances:['先確認低負載讀數吧。'],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
    if(stage==='adjudicate')return {text:'這是日常檢查，不需要擲骰。'};
    if(stage==='writer')return {text:'卡爾特把銀色鑰匙放在桌上的星圖旁。希歐點頭，兩人等待你的回答。'};
    if(stage==='draft')return {text:'卡爾特把銀色鑰匙放在桌上的星圖旁。希歐點頭，兩人等待你的回答。'};
    if(stage==='prose')return {text:input.draft};
    if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'silverKey',operation:'set',value:'星圖旁'}],memories:[{schemaVersion:2,text:'卡爾特把銀色鑰匙放在星圖旁。',characterIds:['kalt','sio'],visibility:'characters',access:{kind:'known_event'},knowers:['kalt','sio'],epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:['kalt'],decisionMakers:['kalt']}}]})};
    throw Object.assign(Error('SCRIPTED_STAGE_UNSUPPORTED'),{code:'SCRIPTED_STAGE_UNSUPPORTED'});
  }};
}
