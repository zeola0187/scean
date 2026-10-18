import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePlan} from '../scripts/validate-plan.mjs';
import {validatePlan as legacyPlan} from '../scripts/validate-plan-v1.0.0.mjs';
import {bindCharacterSources} from '../../core/character-sources.mjs';
const read=async file=>JSON.parse(await readFile(new URL('../fixtures/'+file,import.meta.url),'utf8'));
test('1.1.0 accepts omniscient author notes while preserving archived 1.0.0 failure rule',async()=>{
 const card=await read('ship.native.json'),plan=await read('ship.plan.json'),source=await read('ship.source.json');
 card.data.extensions.characterSourceText={};
 const roster=card.data.extensions.scean.characters;
 for(const actor of roster)card.data.extensions.characterSourceText[actor.id]=actor.description;
 card.data.extensions.scean.characters=roster.map(actor=>bindCharacterSources(actor,[{kind:'card_field',path:'/data/extensions/characterSourceText/'+actor.id}],{card,worldbook:card.data.character_book}));
 card.data.creator_notes='Omniscient author note: '+plan.classifiedPrivateLiterals[0];
 assert.equal(validatePlan(plan,card,source).skillVersion,'1.1.0');
 assert.throws(()=>legacyPlan(plan,card,source),{code:'AUTHORING_PUBLIC_LEAK'});
 delete card.data.extensions.scean.characters[0].sourceBindings;
 assert.throws(()=>validatePlan(plan,card,source),{code:'AUTHORING_BINDINGS_REQUIRED'});
});
