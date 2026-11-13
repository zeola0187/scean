// Invented prototype-fidelity material for isolated real DSH. Never packaged or user RP.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {w01Fixture} from './w01-frontends.mjs';
import {frontendPackage} from '../core/frontend.mjs';
import {seedStudioA} from './studio-a.mjs';

export function playerSixCard(){
  const f=w01Fixture('fantasy'),card=structuredClone(f.card);
  Object.assign(card.data,{name:'六項驗收・合成觀測站',description:'完全虛構的公開觀測站。值班員整理天氣表，旅人可以自由選擇下一步。',scenario:'合成港口的觀測站',first_mes:'觀測站的窗戶開著，值班員將空白天氣表放在桌上。'});
  card.data.character_book={name:'合成港口設定',extensions:{visibility:'public'},entries:[
    {id:1,keys:['港口'],comment:'合成港口',content:'公開設定：港口每天早上整理天氣表。<script>window.__sixXss=true</script>',enabled:true,insertion_order:0,extensions:{visibility:'public'}},
    {id:2,keys:['秘密'],comment:'READER_PRIVATE_CANARY',content:'READER_PRIVATE_BODY_CANARY',enabled:true,insertion_order:1,extensions:{visibility:'private'}}
  ]};
  const frontend=frontendPackage({schemaVersion:1,id:'six-replacement',runtime:{profile:'scean-html-bindings-v1',apiMajor:1},html:'<section class="six"><h2>合成旅人狀態</h2><p>既有魔力 <strong data-scean-text="mana"></strong></p><progress max="100" data-scean-progress="mana"></progress><p data-scean-text="hero"></p></section>',css:'.six{padding:20px;background:#163d34;color:#fff;border-radius:16px}h2{font-size:24px}',bindings:f.frontend.bindings,conditions:{},capabilities:{network:'none',worldActions:[],derivedDisplays:[]}},f.bp,f.card.data.extensions.scean.characters);
  return {card,frontend};
}
export async function seedPlayerSixStudio(workspace){
  await seedStudioA(workspace);await fs.writeFile(path.join(workspace,'imports/qa-six.json'),JSON.stringify(playerSixCard().card));
  const empty=structuredClone(playerSixCard().card);empty.data.name='六項驗收・空資料觀測站';empty.data.character_book={entries:[]};delete empty.data.extensions.scean.frontend;delete empty.data.extensions.scean.stateBlueprint;delete empty.data.extensions.scean.initialState;
  await fs.writeFile(path.join(workspace,'imports/qa-six-empty.json'),JSON.stringify(empty));
}
export const inject=['llm'];
export async function apply(ctx){
  const home=process.env.DSH_HOME;if(!home||!home.includes('player-six-native'))throw Error('SIX_ISOLATED_HOME_REQUIRED');
  const out=path.dirname(home),file=path.join(out,'adapter-calls.json');let calls=[];try{calls=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  class Offline extends LlmAdapter{
    async listModels(provider){return [await this.resolveModel(provider,'offline')];}
    async resolveModel(provider,id){if(provider!=='six-scripted'||id!=='offline')throw Error('NON_SYNTHETIC_MODEL_REFUSED');return {provider,id,name:'Six-item scripted UI only',toolUpdate:'addition-only',defaultMaxTokens:8192,context:{contextWindow:131072},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
    async *stream(options){
      if(options.provider!=='six-scripted'||options.model!=='offline')throw Error('SIX_NON_SCRIPTED_REFUSED');
      if(options.purpose!=='scean'){
        const plan=JSON.parse(await fs.readFile(path.join(out,'fidelity-chat-plan.json'),'utf8').catch(()=>'{"phase":"welcome","steps":[]}'));
        const prefix='fidelity-'+plan.phase+'-',done=new Set((options.messages??[]).flatMap(m=>(m.content??[]).filter(b=>b.type==='tool-call').map(b=>b.id)));
        const next=plan.steps.findIndex((_s,i)=>!done.has(prefix+i));
        if(next>=0){const step=plan.steps[next];if(!options.tools?.some(t=>t.name===step.name))throw Error('Fidelity expected registered scoped authoring tool');
          await fs.appendFile(path.join(out,'chat-events.jsonl'),JSON.stringify({kind:'tool',phase:plan.phase,name:step.name,synthetic:true})+'\n');
          yield{type:'block-end',index:0,block:{type:'tool-call',id:prefix+next,name:step.name,arguments:JSON.stringify(step.args)}};yield{type:'finish',reason:{kind:'tool-calls'}};return;
        }
        const reply=plan.reply??'這是本機合成創作對話。可以描述想修改的世界；沒有呼叫付費模型。';
        await fs.appendFile(path.join(out,'chat-events.jsonl'),JSON.stringify({kind:'stream-start',phase:plan.phase,synthetic:true})+'\n');
        const chunks=[...reply.matchAll(/[\s\S]{1,16}/g)].map(m=>m[0]);
        try{
          for(const chunk of chunks){options.signal?.throwIfAborted();yield{type:'text-delta',index:0,text:chunk};await new Promise(r=>setTimeout(r,80));}
          for(let i=0;i<600&&await fs.stat(path.join(out,'hold-chat')).catch(()=>null);i++){options.signal?.throwIfAborted();await new Promise(r=>setTimeout(r,100));}
          options.signal?.throwIfAborted();yield{type:'block-end',index:0,block:{type:'text',text:reply}};yield{type:'usage',usage:{inputTokens:20,outputTokens:40,totalTokens:60}};yield{type:'finish',reason:{kind:'stop'}};
          await fs.appendFile(path.join(out,'chat-events.jsonl'),JSON.stringify({kind:'stream-end',phase:plan.phase,synthetic:true})+'\n');
        }catch(error){await fs.appendFile(path.join(out,'chat-events.jsonl'),JSON.stringify({kind:'stream-abort',phase:plan.phase,synthetic:true})+'\n');throw error;}
        return;
      }
      const text=options.messages?.flatMap(m=>m.content??[]).find(c=>c.type==='text')?.text;let input;try{input=JSON.parse(text);}catch{throw Error('SIX_STRUCTURED_INPUT_REQUIRED');}
      let stage,answer;
      if(Array.isArray(input.directions)&&Array.isArray(input.turns)){stage='ideas';answer=JSON.stringify({ideas:['玩家行動','角色自主','場景展開','世界自然運轉','意外與轉折'].map((category,i)=>({category,text:['我走到窗邊，詢問今天的天氣記錄。','請讓值班員自行決定怎樣整理桌上的表格。','我暫時安靜地觀察房間裡的光線與聲音。','讓港口居民按自己的日常繼續工作。','一封送錯地方的普通信件帶來意外話題。'][i]}))});}
      else if(input.range&&Array.isArray(input.turns)){stage=input.detail?'chapter_summary':'chapter_analysis';answer=JSON.stringify(stage==='chapter_analysis'?{shouldCreateChapter:true,optimalEndTurn:input.range.endTurn,suggestedTitle:'觀測站的值班記錄',keywords:['天氣表'],characters:['值班員'],locations:['觀測站'],plotThreads:['下一份記錄'],emotionalTone:'平靜',significantEvents:[]}:{title:'觀測站的值班記錄',summary:'值班員與旅人整理了公開天氣表，仍可自由決定下一步。',keywords:['天氣表'],characters:['值班員'],locations:['觀測站'],plotThreads:['下一份記錄'],emotionalTone:'平靜'});}
      else if(input.handoffContract){stage='director';answer=JSON.stringify({handoffVersion:1,sceneIntent:'Continue an ordinary synthetic observation task without deciding the player next action.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]});}
      else if(input.directorHandoff&&input.context){stage='writer';const number=calls.filter(c=>c.stage==='writer').length+1;answer=`SIX_WRITER_BODY_${number}\n\n`+Array.from({length:34},(_,i)=>`第${i+1}段。窗外的船隻隨潮水輕晃，值班員把天氣表放到桌邊。這是隔離測試的合成日常，沒有真實卡片、私人設定或模型生成品質主張。旅人可以自行決定要說什麼，這段敘述不替玩家決定下一步。`).join('\n\n');await new Promise(r=>setTimeout(r,650));}
      else if(typeof input.finalBody==='string'&&input.bodyHash){stage='post_stat';answer=JSON.stringify({contractVersion:2,stateChanges:[],memories:[]});}
      else throw Error('SIX_UNEXPECTED_SCRIPTED_STAGE');
      // The real Director still receives its existing tool declarations; this
      // ordinary scripted scene needs none and never emits a tool-call block.
      if(stage!=='director'&&options.tools?.length)throw Error('SIX_UNEXPECTED_TOOL_CAPABILITY');
      calls.push({index:calls.length+1,stage,at:new Date().toISOString(),toolDefinitions:options.tools?.length??0,toolCalls:0,synthetic:true,...(['director','writer'].includes(stage)?{chapterPacket:input.assembly?.chapterContext??input.context?.chapterContext,originalCount:(input.assembly?.recentDialogue??input.context?.recentDialogue??[]).length}:{})});await fs.writeFile(file,JSON.stringify(calls,null,2)+'\n');
      options.signal?.throwIfAborted();yield {type:'text-delta',index:0,text:answer};yield {type:'block-end',index:0,block:{type:'text',text:answer}};yield {type:'usage',usage:{inputTokens:20,outputTokens:40,totalTokens:60}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['six-scripted'],new Offline());
}
