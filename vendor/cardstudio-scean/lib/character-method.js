// One built-in authoring method after retirement of the supplied Palette. No user-defined providers or modules.
export const characterMethods = Object.freeze([
  {name:'character-authoring',label:'角色塑造（試用草稿 α1）',skills:['character-authoring']},
]);
export const methodSkillNames = new Set([...characterMethods.flatMap(x=>x.skills),'character-design-deepener']);
export const methodByName = name=>characterMethods.find(x=>x.name===name);

// The real Host pins these configuration facts before publishing a blank
// Session. They do not deliver a message or character-method body.
const configurationEvents = new Set(['permission/preset','sandbox/mode','approval/policy','model/selection','agent-preset/selected']);

export function hasDialogue(agent) {
  try {
    const events=agent.session.snapshotEvents();
    // Unknown history must not be treated as a fresh, empty conversation.
    if(!Array.isArray(events))return true;
    return events.some(event=>{
      if(configurationEvents.has(event?.type))return false;
      // A cold, unseeded blank Session may acquire a restore marker. An
      // inherited marker/history is still a started dialogue.
      if(event?.type==='session/end-seed'&&!event.data?.inherited&&!agent.session.header?.isSeeded&&!agent.session.header?.parentSession)return false;
      // Input enters the inbox before user/message is committed. Treat it,
      // actual turns/reads, and unknown events conservatively as started.
      return true;
    });
  } catch { return true; }
}

export function restoreMethod(value,agent) {
  if(value===undefined||value===null)return {name:hasDialogue(agent)?characterMethods[0].name:'character-authoring',epoch:0,locked:hasDialogue(agent),reason:hasDialogue(agent)?'history':'fresh'};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['name','epoch','locked','reason'].includes(k))||!methodByName(value.name)||!Number.isSafeInteger(value.epoch)||value.epoch<0||typeof value.locked!=='boolean'||!['fresh','history','read','inherited'].includes(value.reason))return {name:null,epoch:0,locked:true,reason:'invalid'};
  return {...value,...hasDialogue(agent)&&!value.locked?{locked:true,reason:'history',epoch:value.epoch+1}:{}};
}

export function methodInfo(r,skills) {
  const choice=methodByName(r.method.name),locked=r.method.locked||hasDialogue(r.agent);
  const options=characterMethods.map(x=>({name:x.name,label:x.label,available:x.skills.every(name=>skills.some(s=>s.name===name&&!s.unavailable))}));
  return {name:r.method.name,label:choice?.label??'角色設計方法設定無效',epoch:r.method.epoch,locked,available:!!choice&&options.find(x=>x.name===choice.name).available,options,
    notice:!choice?'角色設計方法設定無效；請開新對話，不會自動改用另一方法。':locked?'本對話已開始或讀入方法；切換需開新對話並重新選擇。舊對話內容仍保留。':'只作用於本對話。開始對話或首次讀入後固定；切換需開新對話。',
    boundary:'Card Studio native Skill discovery/read and human UI only; generic DSH filesystem/shell are outside this control.'};
}

export function methodSkills(r,skills) {
  const selected=methodByName(r.method.name);
  return skills.filter(s=>!s.unavailable&&(!methodSkillNames.has(s.name)||selected?.skills.includes(s.name)));
}
