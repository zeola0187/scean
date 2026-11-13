import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {evaluatePluginCompatibility} from '@deepseek-ai/dsh-app-boot';
const root=path.resolve(import.meta.dirname,'..'),read=async n=>JSON.parse(await fs.readFile(path.join(root,n),'utf8'));
for(const n of ['package.json','sources/manifests/scean-package.json','sources/card-studio/cardstudio-bundle/package.json'])test('RC3 exact reviewed manifest admission and peer consistency: '+n,async()=>{
 const m=await read(n);for(const version of ['0.2.0-rc.2','0.2.1-rc.1','0.2.1-rc.2','0.2.1-rc.3'])assert.equal(evaluatePluginCompatibility(m,{},version),undefined);
 for(const version of ['0.2.1-rc.4','0.2.2','1.0.0']){const issue=evaluatePluginCompatibility(m,{},version);assert(issue&&!issue.exempted);}
 for(const [k,v]of Object.entries(m.peerDependencies??{}))if(k.startsWith('@deepseek-ai/dsh'))assert.equal(v,m.engines.dsh);
});
test('RC3 original sealed bundle is rejected without exemption and newly admitted bytes match normal build',async()=>{
 const before=JSON.parse(await fs.readFile(path.resolve(root,'fixtures/rc3-before-package.json'),'utf8'));assert(evaluatePluginCompatibility(before,{},'0.2.1-rc.3'));const compatibility=await read('dsh-compatibility.json');assert.equal(compatibility.reviewedAsarSHA256['0.2.1-rc.3'],'04b32e3a872826ba15cfb2081c6a929a8d4ecaa65e09a2543e5a6b30e2eff1f0');
 for(const [a,b]of[['sources/manifests/scean-package.json','packages/scean/package.json'],['sources/card-studio/cardstudio-bundle/package.json','packages/studio/package.json']])assert.deepEqual(await read(a),await read(b));
});
