import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverBaselineInstructionFiles,loadBaselineInstructions} from '@deepseek-ai/dsh-agent-instructions';
test('official SDK confines synthetic workspace instructions to its real marker instead of the enclosing private checkout',async t=>{
 const base=path.resolve(import.meta.dirname,'../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'instruction-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const cwd=path.join(root,'synthetic-workspace');await fs.mkdir(path.join(root,'.git'));await fs.mkdir(path.join(cwd,'.cardstudio-scean'),{recursive:true});await fs.writeFile(path.join(root,'AGENTS.md'),'PARENT_PRIVATE_CONTEXT_CANARY');await fs.writeFile(path.join(cwd,'AGENTS.md'),'Synthetic Card Studio instructions only.');
 const options={cwd,dshHome:path.join(root,'clean-home'),agentsHome:path.join(root,'clean-agents'),maxBytes:65536,maxSourceBytes:1048576};
 assert((await discoverBaselineInstructionFiles(options)).some(f=>f.absolutePath===path.join(root,'AGENTS.md')));
 const bounded={...options,projectRootMarkers:['.cardstudio-scean']};const files=await discoverBaselineInstructionFiles(bounded);assert.deepEqual(files.map(f=>f.absolutePath),[path.join(cwd,'AGENTS.md')]);
 const rendered=JSON.stringify(await loadBaselineInstructions(bounded));assert.match(rendered,/Synthetic Card Studio instructions only/);assert(!rendered.includes('PARENT_PRIVATE_CONTEXT_CANARY'));
});
