import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {loadSkills,readSkill,bundledSkillsRoot,withheldSkillNames} from '../packages/studio/lib/workspace-setup.js';

test('withheld opening guidance stays unavailable in a retained legacy catalog without changing local files',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'candidate-withheld-'));
 const body='Synthetic legacy guidance sentinel; must never be discovered or overwritten.';
 const row={name:'opening-narrative-crafter',description:'Synthetic old catalog entry'};
 await fs.mkdir(path.join(dir,row.name));await fs.writeFile(path.join(dir,row.name,'SKILL.md'),body);
 await fs.writeFile(path.join(dir,'catalog.json'),JSON.stringify([row]));
 const before=await fs.readFile(path.join(dir,'catalog.json'));
 const skills=await loadSkills(dir,{includeAuthoring:true,tolerantMethods:true});
 assert(withheldSkillNames.includes(row.name));assert(!skills.some(s=>s.name===row.name));
 await assert.rejects(readSkill(dir,row),{code:'SKILL_WITHHELD'});
 assert.deepEqual(await fs.readFile(path.join(dir,'catalog.json')),before);
 assert.equal(await fs.readFile(path.join(dir,row.name,'SKILL.md'),'utf8'),body);
});

test('runtime catalog and file set omit withheld opening and removed Palette after rebuild',async()=>{
 const list=await loadSkills(bundledSkillsRoot,{includeAuthoring:true});
 assert.equal(list.length,9);
 for(const name of ['opening-narrative-crafter','palette-personality-reconstruction']){
  assert(!list.some(s=>s.name===name));
  await assert.rejects(fs.access(path.join(bundledSkillsRoot,name)),{code:'ENOENT'});
 }
});
