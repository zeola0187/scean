import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStudioFile,studioUploadLimit,studioCardData,studioOpenings,studioSavedRoster,studioSingleRoleDraft,validateStudioRoster,studioHandoffAllowed,studioHandoffPayload} from '../isolated/web/studio-view-model.mjs';

const card={id:'saved-card',type:'card',revision:0,rosterAvailable:false,card:{data:{name:'合成角色',description:'合成描述',first_mes:'主開場',alternate_greetings:['替代開場']}}};
const savedCard={...card,rosterAvailable:true,roster:[{id:'kalt',name:'卡爾特',description:'完整合成角色背景。',identity:{gender:'female',pronouns:'她',source:'user-explicit'}}]};
test('Studio upload validates explicit file types and original byte limit before reading content',()=>{
  assert.equal(validateStudioFile({name:'Card.JSON',size:512},'card'),true);
  assert.equal(validateStudioFile({name:'Card.png',size:studioUploadLimit},'card'),true);
  assert.throws(()=>validateStudioFile({name:'Card.png',size:studioUploadLimit+1},'card'),/512 KiB/);
  assert.throws(()=>validateStudioFile({name:'book.png',size:1},'worldbook'),/JSON/);
  assert.throws(()=>validateStudioFile({name:'empty.json',size:0},'card'),/非空白/);
});
test('Studio retains actual zero-based saved revision and selected opening, book revision, explicit preset',()=>{
  assert.equal(studioCardData(card).name,'合成角色');
  assert.equal(studioOpenings(card)[1].text,'替代開場');
  const payload=studioHandoffPayload(savedCard,{openingIndex:1,worldbook:{id:'book',revision:7}});
  assert.deepEqual(payload,{documentId:'saved-card',expectedRevision:0,presetId:'scean-default',openingIndex:1,worldbookDocumentId:'book',worldbookRevision:7});
  assert.throws(()=>studioHandoffPayload(savedCard,{openingIndex:2}),/保存版本/);
});
test('Studio never silently infers missing roster and refuses handoff of unsaved edits',()=>{
  assert.equal(studioHandoffAllowed(card),false);
  assert.throws(()=>studioHandoffPayload(card),/名冊/);
  assert.equal(studioHandoffAllowed(card,{singleCharacter:true}),false,'old transient single-role flag cannot bypass saved roster');
  assert.equal(studioHandoffAllowed(card,{singleCharacter:true,dirty:true}),false);
  assert.equal(studioHandoffAllowed(card,{singleCharacter:true,busy:true}),false);
  assert.equal(studioHandoffAllowed({...card,rosterAvailable:true}),false,'availability flag alone is not actual roster');
  assert.equal(studioHandoffAllowed(savedCard),true);
});
test('Studio roster editing preserves full backgrounds, explicit identities, relationships and unknown metadata',()=>{
  const original={...card,card:{data:{...card.card.data,extensions:{scean:{characters:[
    {id:'kalt',name:'卡爾特',description:'完整背景。'.repeat(500),identity:{gender:'female',pronouns:'她',source:'user-explicit'},relationships:[{characterId:'sio',kind:'同僚',notes:'原始關係'}],custom:{author:'synthetic'}},
    {id:'sio',name:'希歐',description:'另一位角色獨有背景。',relationships:'與卡爾特共事。'}
  ]}}}}};
  const draft=studioSavedRoster(original);draft[0].name='卡爾特新版';
  const validated=validateStudioRoster(draft);
  assert.equal(validated[0].description.length,2500);
  assert.equal(validated[0].identity.pronouns,'她');
  assert.deepEqual(validated[0].relationships,[{characterId:'sio',kind:'同僚',notes:'原始關係'}]);
  assert.deepEqual(validated[0].custom,{author:'synthetic'});
  assert.equal(studioSavedRoster(original)[0].name,'卡爾特');
});
test('Roster rejects duplicate or reserved ids, absent backgrounds and identities without provenance',()=>{
  assert.throws(()=>validateStudioRoster([{id:'x',name:'A',description:'背景'},{id:'x',name:'B',description:'背景'}]),/重複/);
  assert.throws(()=>validateStudioRoster([{id:'player',name:'A',description:'背景'}]),/保留/);
  assert.throws(()=>validateStudioRoster([{id:123,name:'A',description:'背景'}]),/ID/);
  assert.throws(()=>validateStudioRoster([null]),/ID/);
  assert.throws(()=>validateStudioRoster([{id:'x',name:'A',description:''}]),/完整/);
  assert.throws(()=>validateStudioRoster([{id:'x',name:'A',description:'背景',identity:{pronouns:'她'}}]),/來源/);
  assert.equal(validateStudioRoster([{id:'x',name:'A',description:'背景未知，來源尚未提供。'}]).length,1);
});
test('Single-role shortcut is only an explicit editable draft; it does not infer identity or authorize handoff',()=>{
  const draft=studioSingleRoleDraft(card);
  assert.deepEqual(draft,[{id:'card-main',name:'合成角色',description:'合成描述'}]);
  assert.equal(draft[0].identity,undefined);
  assert.equal(studioHandoffAllowed(card),false);
  assert.equal(studioHandoffAllowed({...card,revision:1,roster:draft}),true);
});
