import {tokenizeHtml} from '../authoring/frontend-html.mjs';
import {resolvePlayerText,resolveTemplateSegments} from './player-literal.mjs';
export {resolvePlayerText} from './player-literal.mjs';
// Preserve tags/attributes/comments/raw script/style bytes. Only tokenizer-approved
// text segments can receive a name; malformed/oversize markup remains literal.
export function playerTemplateSpans(value){
  if(typeof value!=='string'||!/<(?:[!?]|\/?[A-Za-z])/.test(value))return undefined;
  try{const parsed=tokenizeHtml(value);return parsed.valid?parsed.tokens.filter(t=>t.type==='text').map(({start,end})=>({start,end})):null;}catch{return null;}
}
export function projectTemplateText(value,name){return resolveTemplateSegments(value,name,playerTemplateSpans(value));}
export const PLAYER_CARD_TEXT_FIELDS=Object.freeze(['description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions']);
export function projectPlayerCard(card,name){
  const copy=structuredClone(card),data=copy?.data??copy;
  if(!data||typeof data!=='object')return copy;
  for(const key of PLAYER_CARD_TEXT_FIELDS)if(typeof data[key]==='string')data[key]=projectTemplateText(data[key],name);
  for(const key of ['alternate_greetings','group_only_greetings'])if(Array.isArray(data[key]))data[key]=data[key].map(v=>projectTemplateText(v,name));
  const roster=data.extensions?.scean?.characters;
  if(Array.isArray(roster))data.extensions.scean.characters=roster.map(actor=>projectPlayerCharacter(actor,name));
  return copy;
}
export function projectPlayerCharacter(actor,name){
  const copy=structuredClone(actor);
  for(const key of ['description','publicDescription','relationships'])if(typeof copy?.[key]==='string')copy[key]=projectTemplateText(copy[key],name);
  return copy;
}
export function projectPlayerPreset(preset,name){
  const copy=structuredClone(preset);
  for(const key of ['instructions','description','style','prompt','systemPrompt'])if(typeof copy?.[key]==='string')copy[key]=projectTemplateText(copy[key],name);
  return copy;
}
