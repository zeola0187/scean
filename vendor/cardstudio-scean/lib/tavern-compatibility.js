// Independently authored compatibility checks. No SillyTavern source is bundled.
// Contract and pinned upstream evidence: docs/SILLYTAVERN-COMPATIBILITY.md.
export const legacyTextFields = ['name','description','personality','scenario','first_mes','mes_example'];

export function tavernEntryKey(entry,index) {
  return String(entry.id === undefined ? index : entry.id);
}

export function tavernBookIssues(book) {
  if(!Array.isArray(book?.entries))return [];
  const seen=new Map(),issues=[];
  book.entries.forEach((entry,index)=>{
    const key=tavernEntryKey(entry,index);
    if(key==='__proto__')issues.push({code:'ST_ENTRY_UNSAFE_KEY',indices:[index]});
    if(seen.has(key))issues.push({code:'ST_ENTRY_KEY_COLLISION',indices:[seen.get(key),index]});
    else seen.set(key,index);
  });
  return issues;
}

export function nextTavernEntryId(entries,{dictionary=false}={}) {
  const used=new Set(entries.map((entry,index)=>dictionary?String(entry.uid):tavernEntryKey(entry,index)));
  // Reserve array positions too: omitted IDs use indices, which can shift after deletion.
  if(!dictionary)for(let index=0;index<entries.length;index++)used.add(String(index));
  let next=0;while(used.has(String(next)))next++;
  return next;
}

export function legacyAliasWarnings(card) {
  return legacyTextFields.filter(key=>typeof card[key]==='string' && card[key]!==card.data?.[key])
    .map(key=>({code:'LEGACY_ALIAS_DIFFERS',path:'/'+key,authoritativePath:'/data/'+key}));
}

// Only mirror a field that this normal edit actually changed, and only where an
// existing string is a known V1 alias. Do not normalize imports, history, or
// unrelated fields. The caller records the resulting delta in a new revision.
export function mirrorEditedLegacyAliases(before,next,fields=legacyTextFields) {
  for(const key of fields) {
    if(typeof before[key]==='string' && typeof next[key]==='string' && before.data?.[key]!==next.data?.[key])next[key]=next.data[key];
  }
}
