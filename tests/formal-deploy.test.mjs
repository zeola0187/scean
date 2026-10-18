import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {deployment,tree,digest} from '../scripts/formal-deploy.mjs';
async function fixture(){
 const root=await fs.mkdtemp(path.join(tmpdir(),'scean-formal-deploy-')),profile=path.join(root,'profile'),source=path.join(root,'source'),evidence=path.join(root,'evidence'),prior=path.join(root,'prior.json');
 const old=path.join(profile,'.local-packages/scean-mvp-0.2.0'),link=path.join(profile,'node_modules/@local/dsh-scean');
 await fs.mkdir(old,{recursive:true});await fs.mkdir(path.dirname(link),{recursive:true});await fs.mkdir(source);await fs.writeFile(path.join(old,'package.json'),JSON.stringify({name:'@local/dsh-scean',version:'0.2.0'}));await fs.symlink(old,link,'junction');
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'@local/dsh-scean',version:'0.8.1-formal-play',engines:{dsh:'0.2.0-rc.2'},peerDependencies:{sdk:'0.2.0-rc.2'}}));await fs.writeFile(path.join(source,'index.js'),'// synthetic no model');
 const original=Buffer.from(JSON.stringify({dependencies:{'@local/dsh-scean':'link:./.local-packages/scean-mvp-0.2.0',original:'1.2.0'},dsh:{profile:{bundles:['original','@local/dsh-scean']}}})),patch=Buffer.from('# preserved DSH selection\n');await fs.writeFile(path.join(profile,'package.json'),original);await fs.writeFile(path.join(profile,'cordis.patch.yml'),patch);
 await fs.writeFile(prior,JSON.stringify({status:'installed',production:false,profile,afterHash:digest(original),updates:[{name:'@local/dsh-scean',newTarget:old,newFiles:await tree(old)}]}));
 const opts={root,profile,source,evidence,prior,dataRoot:path.join(root,'new-user-play'),testRoot:root,production:false};return {root,profile,source,evidence,prior,old,link,original,patch,api:deployment(opts)};
}
test('formal installer exact backup, switch, verify and restore preserve old data/config/receipt',async()=>{
 const f=await fixture(),prior=await fs.readFile(f.prior);assert.equal((await f.api.prepare()).status,'prepared');assert.equal((await f.api.install()).status,'installed_verified');assert.equal(JSON.parse(await fs.readFile(path.join(f.profile,'package.json'))).dependencies.original,'1.2.0');assert.match(await fs.readFile(path.join(f.profile,'cordis.patch.yml'),'utf8'),/summaryEnabled: false/);assert.equal((await f.api.restore()).status,'restored');assert.deepEqual(await fs.readFile(path.join(f.profile,'package.json')),f.original);assert.deepEqual(await fs.readFile(path.join(f.profile,'cordis.patch.yml')),f.patch);assert.deepEqual(await fs.readFile(f.prior),prior);assert.equal(path.resolve(await fs.readlink(f.link)),f.old);
});
test('formal installer refuses profile drift, leaving user changes and old link intact',async()=>{const f=await fixture();await f.api.prepare();await fs.appendFile(path.join(f.profile,'cordis.patch.yml'),'# concurrent edit');await assert.rejects(f.api.install(),/PROFILE_DRIFT/);assert.equal(path.resolve(await fs.readlink(f.link)),f.old);assert.match(await fs.readFile(path.join(f.profile,'cordis.patch.yml'),'utf8'),/concurrent edit/);});
test('formal installer refuses source drift before any switch',async()=>{const f=await fixture();await f.api.prepare();await fs.appendFile(path.join(f.source,'index.js'),'changed');await assert.rejects(f.api.install(),/SOURCE_PACKAGE_DRIFT/);assert.equal(path.resolve(await fs.readlink(f.link)),f.old);});
test('formal restore refuses changed installed package and retains new link',async()=>{const f=await fixture();await f.api.prepare();await f.api.install();const target=path.resolve(await fs.readlink(f.link));await fs.appendFile(path.join(target,'index.js'),'user change');await assert.rejects(f.api.restore(),/INSTALLED_PACKAGE_DRIFT/);assert.equal(path.resolve(await fs.readlink(f.link)),target);});
test('formal prepare refuses receipt mismatch and leaves profile exact',async()=>{const f=await fixture();await fs.writeFile(f.prior,'{}');await assert.rejects(f.api.prepare(),/PREVIOUS_RECEIPT_PROFILE_MISMATCH/);assert.deepEqual(await fs.readFile(path.join(f.profile,'package.json')),f.original);});
