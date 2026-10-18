// Original invented UI-only fixture. Never load production cards or model providers.
export const playerStory = `窗外的港灣漸漸亮起。卡爾特將銅製羅盤放在星圖旁，指尖停在尚未標記的航線上。

「先把觀測結果記下來吧。」她說。希歐將筆記本轉向你，留下一整頁空白，等你決定下一步。

船艙傳來規律而輕微的引擎聲。桌面上的茶仍冒著熱氣，遠處的訊號燈一明一暗。這段平靜的時間，足夠讓你仔細讀完星圖上的註記，也可以先問問兩人的看法。`;
export function playerUiModel(control) {
  return {
    async describe(){return {capabilities:{contextWindow:32768,outputLimit:2048}};},
    async generate(p){
      control.calls.push({stage:p.stage});
      if(p.stage==='director'){
        if(control.mode==='delay'){control.started=true;await new Promise(resolve=>{control.release=resolve;});}
        if(control.mode==='fail'){control.mode='normal';throw Object.assign(Error('Synthetic model transport failure'),{code:'MODEL_TRANSPORT_ERROR'});}
        return {text:'Continue the synthetic public ship watch, preserving player agency.'};
      }
      if(p.stage==='draft')return {text:control.mode==='regenerate'?'卡爾特把羅盤移到桌邊，讓你有更多空間查看星圖。希歐安靜地等候你的決定。':playerStory};
      if(p.stage==='prose')return {text:p.input.draft};
      if(p.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'compass',operation:'set',value:'星圖桌上的銅製羅盤'}],memories:[]})};
      if(p.stage==='summary')return {text:'船員在港內檢查星圖與羅盤，等待玩家決定下一步。'};
      if(p.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:p.input.turns.at(-1).turn,suggestedTitle:'港灣的觀測',keywords:['羅盤'],characters:['卡爾特','希歐'],locations:['港灣'],plotThreads:['觀測'],emotionalTone:'平靜',significantEvents:['完成觀測']})};
      if(p.stage==='chapter_summary')return {text:JSON.stringify({title:'港灣的觀測',summary:'船員完成這一輪觀測，銅製羅盤留在星圖旁。',keywords:['羅盤','星圖'],characters:['卡爾特','希歐'],locations:['港灣'],plotThreads:['下一段航程'],emotionalTone:'平靜'})};
      throw Error('Unexpected UI synthetic stage '+p.stage);
    }
  };
}
