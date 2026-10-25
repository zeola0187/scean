import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {bindCharacterSources} from '../core/character-sources.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';

async function fixture(t){
  const base=resolve(import.meta.dirname,'../.test-data');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'script-save-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const card={data:{name:'Synthetic source card',description:'Synthetic actor source.',extensions:{scean:{}}}},worldbook={entries:[]};
  const actor=bindCharacterSources({id:'actor',name:'Actor',description:'Synthetic actor.'},[{kind:'card_field',path:'/data/description'}],{card,worldbook});card.data.extensions.scean.characters=[structuredClone(actor)];
  const engine=new SceanEngine({store:new DurableStore({root}),memory:new Memory(),model:{generate(){assert.fail('No model in save validation');}}});
  return engine.createRun({snapshot:{schemaVersion:1,cardId:'synthetic-card',revision:1,card,worldbook,preset:{},characters:[actor],source:{script:{scriptId:'synthetic-script',scriptHash:'a'.repeat(64),sourceSessionId:'synthetic-publication-session'},authoring:{sessionId:'synthetic-entry-session',generation:1}}}});
}

test('verified canonical character JSON pointers roundtrip with immutable Script and source Session provenance',async t=>{
  const run=await fixture(t),before=structuredClone(run),imported=validateRunBundle(JSON.stringify(encodeRunBundle(run)));
  assert.deepEqual(imported.snapshot,run.snapshot);assert.equal(imported.snapshot.characters[0].sourceBindings.sources[0].path,'/data/description');
  assert.equal(imported.snapshot.card.data.extensions.scean.characters[0].sourceBindings.sources[0].path,'/data/description');
  assert.equal(imported.snapshot.source.script.scriptId,'synthetic-script');assert.equal(imported.snapshot.source.authoring.sessionId,'synthetic-entry-session');assert.deepEqual(run,before);
});

test('source selector exception cannot admit OS paths, traversal, corrupt bindings or other path fields',async t=>{
  const original=await fixture(t);
  for(const pointer of ['C:/fixture/secret.json','/../etc/passwd','/data/../etc','\\\\server\\private']){
    const run=structuredClone(original);run.snapshot.characters[0].sourceBindings.sources[0].path=pointer;
    assert.throws(()=>encodeRunBundle(run),{code:'SAVE_ENVIRONMENT_PATH'});
  }
  for(const mutate of [
    run=>run.snapshot.card.data.extensions.unrelated={path:'/data/description'},
    run=>run.snapshot.card.data.extensions.unrelated={kind:'card_field',path:'/data/description',sha256:run.snapshot.characters[0].sourceBindings.sources[0].sha256},
    run=>run.snapshot.source.fake={sourceBindings:structuredClone(run.snapshot.characters[0].sourceBindings)},
    run=>run.snapshot.characters[0].sourceBindings.sources[0].sha256='0'.repeat(64),
    run=>run.snapshot.card.data.extensions.scean.characters[0].sourceBindings.descriptionHash='0'.repeat(64),
    run=>run.snapshot.card.data.extensions.privatePath='C:/fixture/private',
  ]){const run=structuredClone(original);mutate(run);assert.throws(()=>encodeRunBundle(run),{code:'SAVE_ENVIRONMENT_PATH'});}
});

test('data-only validation precedes source selector inspection and never invokes a path getter',async t=>{
  const run=await fixture(t),bundle=encodeRunBundle(run);let invoked=false;
  Object.defineProperty(bundle.run.snapshot.characters[0].sourceBindings.sources[0],'path',{enumerable:true,get(){invoked=true;return '/data/description';}});
  assert.throws(()=>validateRunBundle(bundle),{code:'SAVE_JSON'});assert.equal(invoked,false);
});
