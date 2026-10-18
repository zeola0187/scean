// Compatibility entry point for the canonical, source-only candidate builder.
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
export const runtimeAuthoringInputs=['authoring/compatibility-audit.mjs','authoring/skills/scean-compatibility-audit'];
const root=path.resolve(import.meta.dirname,'..');
const spec=JSON.parse(await fs.readFile(path.join(root,'BUILD-MAP.json'),'utf8'));
for(const input of runtimeAuthoringInputs)if(!spec.runtime.some(r=>r.source===input||r.source.startsWith(input+'/')))throw Error('AUDIT_INPUT_MISSING');
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){const result=spawnSync('python',['scripts/build-candidate.py','--stage=build-suite-source-package-'+process.pid],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;}
