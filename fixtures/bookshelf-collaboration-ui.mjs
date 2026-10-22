// Opt-in synthetic adapter for the isolated official-DSH bookshelf UI fixture.
// No provider/network access, private profile or user-story material.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import fs from 'node:fs/promises';
import path from 'node:path';
export const inject=['llm'];
export async function apply(ctx){
 const home=process.env.DSH_HOME;if(!home||!home.includes('player-six-native'))throw Error('BOOKSHELF_ISOLATED_HOME_REQUIRED');
 const file=path.join(path.dirname(home),'adapter-calls.json');let calls=[];try{calls=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
 class Offline extends LlmAdapter{
  async listModels(provider){return[await this.resolveModel(provider,'offline')];}
  async resolveModel(provider,id){if(provider!=='six-scripted'||id!=='offline')throw Error('NON_SYNTHETIC_MODEL_REFUSED');return{provider,id,name:'Bookshelf scripted UI only',toolUpdate:'addition-only',defaultMaxTokens:8192,context:{contextWindow:131072},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
  async *stream(options){
   if(options.provider!=='six-scripted'||options.model!=='offline')throw Error('BOOKSHELF_NON_SCRIPTED_REFUSED');
   const text=options.messages?.flatMap(m=>m.content??[]).find(c=>c.type==='text')?.text;let input;try{input=JSON.parse(text);}catch{throw Error('BOOKSHELF_STRUCTURED_INPUT_REQUIRED');}
   let stage,answer,tools=[];
   if(input.handoffContract){stage='director';if(!input.conversation?.length&&!JSON.stringify(input.assembly??{}).includes('NO_TOOLS'))tools=[{id:'bookshelf-character',name:'consult_character',arguments:{characterId:'archivist',question:'合成紀錄員對整理天氣表有甚麼公開反應？'}},{id:'bookshelf-stat',name:'adjudicate_action',arguments:{mode:'query',action:'公開規則是否允許只閱讀桌上的合成天氣表？'}}];else answer=JSON.stringify({handoffVersion:1,sceneIntent:'Continue the ordinary synthetic weather-record task; advice is not a performed event.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]});}
   else if(input.character&&input.question){stage='character';answer=JSON.stringify({adviceVersion:1,characterId:input.character.id,observable:{attitude:'平靜地看向桌面',intent:'提出整理記錄的公開建議'},publicUtterances:['可以先看標有日期的那一頁。'],withheld:['BOOKSHELF_WITHHELD_CANARY'],internal:{notes:['BOOKSHELF_INTERNAL_CANARY']},intendedDisclosures:[]});}
   else if(input.action&&input.mode&&input.state){stage='adjudicate';answer='BOOKSHELF_STAT_PUBLIC：公開規則允許閱讀桌上記錄；這是唯讀查詢，未改變 State，也未替玩家執行。';}
   else if(input.directorHandoff&&input.context){stage='writer';answer='BOOKSHELF_WRITER_BODY\n\n'+Array.from({length:18},(_,i)=>`第${i+1}段。合成紀錄員把天氣表留在桌面，窗外的光照亮日期欄。旅人仍可自行決定下一步。這是離線工程驗收的虛構內容。`).join('\n\n');}
   else if(typeof input.finalBody==='string'&&input.bodyHash){stage='post_stat';answer=JSON.stringify({contractVersion:2,stateChanges:[],memories:[]});}
   else throw Error('BOOKSHELF_UNEXPECTED_SCRIPTED_STAGE');
   if(stage!=='director'&&options.tools?.length)throw Error('BOOKSHELF_UNEXPECTED_TOOL_CAPABILITY');
   calls.push({index:calls.length+1,stage,at:new Date().toISOString(),toolDefinitions:options.tools?.length??0,toolCalls:tools.length,synthetic:true});await fs.writeFile(file,JSON.stringify(calls,null,2)+'\n');
   options.signal?.throwIfAborted();for(const[index,t]of tools.entries())yield{type:'block-end',index,block:{type:'tool-call',id:t.id,name:t.name,arguments:JSON.stringify(t.arguments)}};
   if(answer){yield{type:'text-delta',index:100,text:answer};yield{type:'block-end',index:100,block:{type:'text',text:answer}};}
   yield{type:'usage',usage:{inputTokens:20,outputTokens:40,totalTokens:60}};yield{type:'finish',reason:{kind:tools.length?'tool-calls':'stop'}};
  }
 }
 ctx.llm.registerAdapter(['six-scripted'],new Offline());
}
