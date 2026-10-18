import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { contained } from './card-service.js';
import { strictJson, fail } from './codec.js';
import { methodSkillNames } from './character-method.js';

export const bundledSkillsRoot = fileURLToPath(new URL('../skills/', import.meta.url));
// Retired names are never registered, including a retained legacy workspace.
// Do not delete or rewrite user-local skill files during plugin activation.
export const retiredSkillNames = Object.freeze(['palette-personality-reconstruction','character-design-deepener','lorebook-architect','dialogue-and-prompt-tuner','frontend-presentation-optimizer']);
export const withheldSkillNames = Object.freeze(['opening-narrative-crafter']);
export const nativeAuthoringSkillNames = Object.freeze(['scean-worldbook-authoring','scean-dialogue-authoring','scean-frontend-authoring','scean-opening-authoring']);
const defaultManifest = {schemaVersion:1,capability:'card-studio-scean-test',title:'DSH Card Studio'};

// Fixed plugin-owned descendants only; never follow a junction beneath the
// selected root, and never store mutable data in the installed package.
async function directory(parent, name) {
  const target = path.join(parent, name);
  try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('CONFIG','Card Studio data directories must be regular directories, not links.');
  return target;
}
async function readManifest(root) {
  const file = await contained(root,'.cardstudio-scean/workspace.json',{existing:true});
  if ((await fs.lstat(file)).isSymbolicLink()) fail('CONFIG','Workspace manifest must not be a link.');
  const manifest = strictJson(await fs.readFile(file,'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.capability !== 'card-studio-scean-test' || Object.keys(manifest).some(k=>!['schemaVersion','capability','title'].includes(k))) fail('CONFIG','Workspace configuration supports data only.');
}

export async function prepareWorkspace(config = {}, registry) {
  const explicit = config.projectRoot !== undefined;
  let root;
  if (explicit) {
    if (typeof config.projectRoot !== 'string' || !path.isAbsolute(config.projectRoot)) fail('CONFIG','projectRoot must be an absolute path.');
    root = await fs.realpath(config.projectRoot);
    // Retaining projectRoot explicitly keeps an existing installation's data
    // and skill files. No adoption, replacement or migration happens here.
    await readManifest(root);
  } else {
    if (!registry || typeof registry.create !== 'function') fail('CONFIG','Portable Card Studio requires the DSH workspaceRegistry service.');
    const home = resolveDshHome();
    await fs.mkdir(home,{recursive:true});
    const namespace = await directory(await fs.realpath(home),'card-studio-scean-test');
    root = await directory(namespace,'workspace');
    const state = await directory(root,'.cardstudio-scean');
    const file = path.join(state,'workspace.json');
    try { await fs.writeFile(file,JSON.stringify(defaultManifest,null,2)+'\n',{flag:'wx'}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await readManifest(root);
  }
  // Validate each parent before creating children, including in legacy mode.
  for (const name of ['imports','exports','.cardstudio-scean']) await directory(root,name);
  await directory(path.join(root,'.cardstudio-scean'),'documents');
  if (!explicit) await registry.create(root,'Card Studio SCEAN Test'); // native deduplication; no Session/model call
  return {root,skillsRoot:explicit ? await contained(root,'.cardstudio-scean/skills',{existing:true}) : bundledSkillsRoot,portable:!explicit};
}

export async function readSkill(skillsRoot,row) {
  if(withheldSkillNames.includes(row.name))fail('SKILL_WITHHELD','Retired opening guidance is withheld; use scean-opening-authoring. Saved openings remain editable.');
  if(retiredSkillNames.includes(row.name))fail('SKILL_RETIRED','This Skill has retired from the SCEAN Studio loader.');
  const file = await contained(skillsRoot,`${row.name}/SKILL.md`,{existing:true});
  const raw = (await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''), end = raw.indexOf('\n---',4);
  if (!/^---\r?\n/.test(raw) || end < 0) fail('SKILL','Missing skill frontmatter.');
  if(!new RegExp('^name: '+row.name+'\\r?$','m').test(raw.slice(0,end)))fail('SKILL','Skill name does not match its catalog entry.');
  const resourceRoot = path.dirname(file);
  for (const reference of new Set(raw.match(/references\/[A-Za-z0-9_.-]+\.md/g) ?? [])) {
    const resource=await contained(resourceRoot,reference,{existing:true});
    if(!(await fs.stat(resource)).isFile())fail('SKILL','Skill reference must be a readable regular file.');
    const handle=await fs.open(resource,'r');await handle.close();
  }
  return {name:row.name,description:row.description,path:file,source:'runtime',provider:'cardstudio-workspace',resourceBase:{kind:'directory',path:resourceRoot},content:raw.slice(raw.indexOf('\n',end+1)+1).trim()};
}

export async function loadSkills(skillsRoot,{includeAuthoring=false,tolerantMethods=false}={}) {
  const catalog = strictJson(await fs.readFile(await contained(skillsRoot,'catalog.json',{existing:true}),'utf8'));
  if (!Array.isArray(catalog)) fail('SKILL','Invalid skill catalog.');
  const skills = [], names = new Set();
  for (const row of catalog) {
    if (!row || typeof row.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.name) || names.has(row.name) || typeof row.description !== 'string' || !row.description.trim()) fail('SKILL','Invalid or duplicate skill catalog entry.');
    names.add(row.name);
    if(retiredSkillNames.includes(row.name)||withheldSkillNames.includes(row.name))continue;
    try{skills.push(await readSkill(skillsRoot,row));}
    catch(error){if(!tolerantMethods||!methodSkillNames.has(row.name))throw error;skills.push({name:row.name,description:row.description,unavailable:true});}
  }
  if(includeAuthoring&&['advanced-tavern-card-authoring',...nativeAuthoringSkillNames].some(name=>!names.has(name))){
    const bundled=await loadSkills(bundledSkillsRoot);
    for(const name of ['advanced-tavern-card-authoring',...nativeAuthoringSkillNames])if(!names.has(name)){
      const authoring=bundled.find(x=>x.name===name);
      if(!authoring)fail('SKILL','Bundled authoring guidance is missing: '+name);
      skills.push(authoring);
    }
  }
  return skills;
}
