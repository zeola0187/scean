import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,symlink,readlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'scean-r2-upgrade-')),profile=join(root,'profile'),old=join(root,'old');
 for(const p of ['scripts','evidence','profile/node_modules/@local','profile/.local-packages','old/evidence'])await mkdir(join(root,p),{recursive:true});
 await cp(resolve('scripts/upgrade-coexist.mjs'),join(root,'scripts/upgrade-coexist.mjs'));
 const defs=[['@local/dsh-scean','dsh-scean','scean-mvp-0.1.0','0.2.0'],['@local/dsh-card-studio-scean-test','dsh-card-studio-scean-test','cardstudio-scean-test-1.2.0-scean.1','1.2.0-scean.2']];
 const pkg={dependencies:{original:'1.2.0'},dsh:{profile:{bundles:['original']}}},additions=[];
 for(const[name,sub,dir,version]of defs){const source='dist/'+sub,target=join(profile,'.local-packages',dir),link=join(profile,'node_modules',name);
  await mkdir(join(old,source),{recursive:true});await writeFile(join(old,source,'package.json'),JSON.stringify({name,version:'old',engines:{dsh:'0.2.0-rc.2'}}));await cp(join(old,source),target,{recursive:true});await symlink(target,link,'junction');
  await mkdir(join(root,source),{recursive:true});await writeFile(join(root,source,'package.json'),JSON.stringify({name,version,engines:{dsh:'0.2.0-rc.2'}}));await writeFile(join(root,source,'index.js'),'// new isolated version');
  pkg.dependencies[name]='link:./.local-packages/'+dir;pkg.dsh.profile.bundles.push(name);additions.push({name,source,dir,target,link});
 }
 const original=Buffer.from(JSON.stringify(pkg)+'\n');await writeFile(join(profile,'package.json'),original);
 await writeFile(join(old,'evidence/coexist-install.json'),JSON.stringify({status:'installed',production:false,profile,afterHash:sha(original),additions}));
 const receiptBefore=await readFile(join(old,'evidence/coexist-install.json'));
 const run=action=>spawnSync(process.execPath,[join(root,'scripts/upgrade-coexist.mjs'),action],{cwd:root,env:{...process.env,SCEAN_INSTALL_TEST_PROFILE:profile,SCEAN_INSTALL_TEST_PREVIOUS:old},encoding:'utf8'});
 return {root,profile,old,original,additions,receiptBefore,run};
}
test('R2 reversible upgrade keeps original registration and old receipt; exact rollback restores bytes',async()=>{
 const f=await fixture();let r=f.run('upgrade');assert.equal(r.status,0,r.stderr);const pkg=JSON.parse(await readFile(join(f.profile,'package.json')));assert.equal(pkg.dependencies.original,'1.2.0');assert(pkg.dependencies['@local/dsh-scean'].endsWith('0.2.0'));
 assert.deepEqual(await readFile(join(f.old,'evidence/coexist-install.json')),f.receiptBefore);
 r=f.run('rollback');assert.equal(r.status,0,r.stderr);assert.deepEqual(await readFile(join(f.profile,'package.json')),f.original);
 for(const d of f.additions)assert.equal(resolve(await readlink(d.link)),resolve(d.target));
});
test('R2 upgrade rejects source/profile drift before switching links',async()=>{
 const f=await fixture();await writeFile(join(f.additions[0].target,'package.json'),'{}');const r=f.run('upgrade');assert.notEqual(r.status,0);assert.match(r.stderr,/PREVIOUS_PACKAGE_DRIFT/);assert.deepEqual(await readFile(join(f.profile,'package.json')),f.original);
});
test('R2 rollback rejects later profile change without overwriting it',async()=>{
 const f=await fixture();const r=f.run('upgrade');assert.equal(r.status,0,r.stderr);await writeFile(join(f.profile,'package.json'),'{}');const refused=f.run('rollback');assert.notEqual(refused.status,0);assert.match(refused.stderr,/ROLLBACK_PROFILE_DRIFT/);assert.equal(await readFile(join(f.profile,'package.json'),'utf8'),'{}');
});
