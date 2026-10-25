import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

test('actual installed LocaleRuntime with zh-tw -> en resolves every owned CardStudio key in Traditional Chinese',async()=>{
  const source=await fs.readFile(new URL('../evidence/app-asar/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js',import.meta.url),'utf8');let registration;
  assert.equal(createHash('sha256').update(source).digest('hex'),'8a0470449ce8ceb5efdd031eaefc1c37f20f84060c6a49338fe8cd654f847933');
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:r=>registration=r}},console});
  const exports=registration.factory(()=>({}));const locale=new exports.LocaleRuntime({emit(){},effect(){}},undefined,{languages:['zh-TW'],preference:'zh-tw'});
  locale.addLanguage({id:'zh-tw',label:'繁體中文',fallback:'en'});
  const client=await fs.readFile(new URL('../cardstudio-bundle/client-template.js',import.meta.url),'utf8');
  const block=client.slice(client.indexOf('const translations='),client.indexOf('function start(ctx)'));
  const dictionaries=vm.runInNewContext(block+';translations');locale.register('cardstudio',dictionaries);
  assert.equal(locale.getLocale().active,'zh-tw');const t=locale.bind('cardstudio');
  assert.deepEqual(Object.keys(dictionaries['zh-tw']).sort(),Object.keys(dictionaries.en).sort());
  for(const key of Object.keys(dictionaries.en)){assert.equal(t(key),dictionaries.zh[key]);assert.ok(key==='title'||/[\u3400-\u9fff]/.test(t(key)),key);}
  for(const key of ['authoring','targetCheck','targetExport','generatedArm','diagnosticTarget'])assert.notEqual(t(key),dictionaries.en[key]);
});
