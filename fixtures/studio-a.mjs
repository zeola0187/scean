import fs from 'node:fs/promises';
import path from 'node:path';
const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'霧港檔案 · 合成驗收',description:'原創合成工作卡 A；僅用於隔離驗收。',personality:'沉著',scenario:'合成港口',first_mes:'主開場：你在港口遇見守門人。',mes_example:'「歡迎。」守門人說。',creator_notes:'Synthetic only',system_prompt:'',post_history_instructions:'',alternate_greetings:['替代開場：燈塔在夜色中亮起。'],tags:[],creator:'Synthetic QA',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'守門人',description:'原創合成角色，負責看守港口。'}]}},character_book:{entries:[]}}};
export async function seedStudioA(workspace){
for(const folder of ['imports','library'])await fs.mkdir(path.join(workspace,folder),{recursive:true});
await fs.writeFile(path.join(workspace,'imports/qa-a.json'),JSON.stringify(card));
await fs.writeFile(path.join(workspace,'imports/qa-b.json'),JSON.stringify({...card,data:{...card.data,description:'同名不同身份的合成工作卡 B。'}}));
await fs.writeFile(path.join(workspace,'library/qa-external.json'),JSON.stringify({...card,data:{...card.data,name:'外部卡庫合成原卡'}}));
}
