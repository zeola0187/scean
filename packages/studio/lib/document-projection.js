import { strictJson, decodeCard, validateBook, fail, clone } from './codec.js';

// One decoder and one document/entry shape for working copies and readonly sources.
export const stBook = book => !!book?.entries && typeof book.entries==='object' && !Array.isArray(book.entries);
export const rawEntries = book => book ? (stBook(book)?Object.values(book.entries):book.entries) : [];
export function decodeDocument(bytes,type) {
  if(type!=='worldbook')return decodeCard(bytes);
  const raw=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const book=raw.spec==='lorebook_v3'?raw.data:raw;
  validateStandaloneBook(book);
  return {kind:'worldbook',card:{data:{character_book:book}},original:bytes,...raw.spec==='lorebook_v3'?{envelope:raw}:{}};
}
export function validateStandaloneBook(book){
  if(!stBook(book))validateBook(book);
  else {
    const ids=new Set();
    for(const [key,e] of Object.entries(book.entries)){
      if(!e||typeof e!=='object'||Array.isArray(e)||!Number.isSafeInteger(e.uid)||key!==String(e.uid))fail('ENTRY_ID','ST worldbook dictionary keys must agree with integer uid.');
      if(ids.has(e.uid))fail('DUPLICATE_ID','Duplicate ST uid.');ids.add(e.uid);
      if(!Array.isArray(e.key)||e.key.some(k=>typeof k!=='string')||typeof e.content!=='string'||typeof e.disable!=='boolean'||!Number.isFinite(e.order))fail('ENTRY','ST entry requires key, content, disable, order.');
      if(e.keysecondary!==undefined&&(!Array.isArray(e.keysecondary)||e.keysecondary.some(k=>typeof k!=='string')))fail('ENTRY','ST keysecondary must be string array.');
    }
  }
}
export function entrySummary(book,entry,entry_id) {
  return {entry_id,keys:stBook(book)?entry.key:entry.keys,comment:entry.comment??'',enabled:stBook(book)?!entry.disable:entry.enabled,contentLength:entry.content.length};
}
export const documentFields=['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','tags','creator','alternate_greetings','group_only_greetings'];
const escape=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
export function sourceEntryLocator(entry,index,book){
  const id=entry.id;
  return {index,...id!==undefined?{id:typeof id==='string'?id.slice(0,100):id,...typeof id==='string'&&id.length>100?{id_truncated:true}:{}}:{},...entry.uid!==undefined?{uid:entry.uid}:{},enabled:stBook(book)?!entry.disable:entry.enabled};
}
export function* documentSegments(decoded,{prompts=false}={}) {
  const data=decoded.card.data;
  for(const field of documentFields){
    if(!prompts&&['mes_example','creator_notes','system_prompt','post_history_instructions'].includes(field))continue;
    const value=data[field];
    if(typeof value==='string')yield {field,locator:'/data/'+field,text:value};
    else if(Array.isArray(value))for(let i=0;i<value.length;i++)if(typeof value[i]==='string')yield {field,locator:'/data/'+field+'/'+i,text:value[i]};
  }
  const book=data.character_book;
  for(const [index,entry] of rawEntries(book).entries()){
    const base='/data/character_book/entries/'+escape(stBook(book)?entry.uid:index);
    const entry_locator=sourceEntryLocator(entry,index,book);
    for(const key of ['name','comment','content'])if(typeof entry[key]==='string')yield {field:'worldbook.'+key,locator:base+'/'+key,entry_locator,text:entry[key]};
    for(const key of ['keys','secondary_keys','key','keysecondary'])if(Array.isArray(entry[key]))for(let i=0;i<entry[key].length;i++)yield {field:'worldbook.'+key,locator:base+'/'+key+'/'+i,entry_locator,text:entry[key][i]};
  }
}
export function projectDocument(decoded,{fields=['name','description','personality','scenario','first_mes'],locators,offset=0,budget=8000}={}) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(budget)||budget<1||budget>12000)fail('BUDGET','Read budget is 1..12000 characters; offset must be nonnegative.');
  if(!Array.isArray(fields)||fields.length>16||fields.some(x=>!documentFields.includes(x)))fail('FIELD','Choose bounded known document fields.');
  if(locators!==undefined&&(!Array.isArray(locators)||locators.length>16||locators.some(x=>typeof x!=='string'||x.length>240)))fail('LOCATOR','Choose at most 16 source field locators.');
  const wanted=locators?new Set(locators):null,evidence=[],seen=new Set();let remaining=budget,omitted=0;
  for(const row of documentSegments(decoded,{prompts:true})){
    if(wanted?!wanted.has(row.locator):!fields.includes(row.field))continue;
    seen.add(row.locator);
    if(evidence.length>=16){omitted++;continue;}
    const start=Math.min(offset,row.text.length),text=row.text.slice(start,start+remaining);
    if(row.text.length>start&&!text){omitted++;continue;}
    evidence.push({...row,text,raw_start:start,raw_end:start+text.length,total_characters:row.text.length,text_complete:start===0&&text.length===row.text.length});remaining-=text.length;
  }
  if(wanted&&[...wanted].some(x=>!seen.has(x)))fail('LOCATOR','Source locator not found.');
  return {evidence:clone(evidence),coverage:'partial',scope:'Requested fields/locators only; unrequested fields, extensions and runtime conditions are unverified.',omitted,budget,offset};
}
