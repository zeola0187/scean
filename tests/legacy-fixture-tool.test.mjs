import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {MaterialCardService} from '../sources/card-studio/cardstudio-bundle/lib/material-service.js';
import {prepareLegacyPlaybackFixture} from '../scripts/prepare-legacy-playback-fixture.mjs';

test('offline fixture downgrade rejects a live Host, changes only one exact binding and retains card/Run bytes',async t=>{
 const evidence=path.resolve(import.meta.dirname,'../evidence'),fixtureName='player-six-native-legacy-tool-'+randomUUID().slice(0,8),root=path.join(evidence,fixtureName),workspace=path.join(root,'home/card-studio-scean-test/workspace');
 await fs.mkdir(workspace,{recursive:true});const service=new MaterialCardService(workspace);await service.init();
 t.after(async()=>{await service.close();assert.equal(path.dirname(root),evidence);assert(path.basename(root).startsWith('player-six-native-legacy-tool-'));await fs.rm(root,{recursive:true,force:true});});
 const a=await service.operation('create',{name:'Synthetic old A',description:'Synthetic only',first_mes:'Opening.'},undefined,{sessionId:'old-A'}),b=await service.operation('create',{name:'Synthetic old B',description:'Synthetic only',first_mes:'Opening.'},undefined,{sessionId:'fixed-B'});assert(a.ok&&b.ok);
 const indexPath=path.join(workspace,'.cardstudio-scean/working-copy-sessions.json'),before=JSON.parse(await fs.readFile(indexPath)),card=path.join(workspace,'.cardstudio-scean/documents',a.value.id,'0.json'),cardBytes=await fs.readFile(card);
 const sentinel=path.join(root,'unchanged-run-fixture.json');await fs.writeFile(sentinel,'{"synthetic":"unchanged-old-run"}');const runBytes=await fs.readFile(sentinel);await service.close();
 const launch={workspace,pid:process.pid,isolated:true,productionWrites:0};await fs.writeFile(path.join(root,'launch.json'),JSON.stringify(launch));await fs.writeFile(path.join(root,'exit.json'),JSON.stringify({normalDisposeRequested:true,productionWrites:0}));
 await assert.rejects(prepareLegacyPlaybackFixture({fixtureName,sessionId:'old-A'}),{code:'STOP_SYNTHETIC_HOST_FIRST'});assert.deepEqual(JSON.parse(await fs.readFile(indexPath)),before);
 const child=spawn(process.execPath,['-e',''],{stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});launch.pid=child.pid;await fs.writeFile(path.join(root,'launch.json'),JSON.stringify(launch));
 const receipt=await prepareLegacyPlaybackFixture({fixtureName,sessionId:'old-A'});assert.equal(receipt.status,'converted_to_legacy_selection');assert.equal(receipt.cardAndRunWrites,0);
 const after=JSON.parse(await fs.readFile(indexPath));assert.deepEqual(after,{...before,bindings:before.bindings.filter(row=>row.sessionId!=='old-A')});assert.deepEqual(await fs.readFile(card),cardBytes);assert.deepEqual(await fs.readFile(sentinel),runBytes);
 assert.equal((await prepareLegacyPlaybackFixture({fixtureName,sessionId:'old-A'})).status,'already_legacy_selection');
 await assert.rejects(prepareLegacyPlaybackFixture({fixtureName,sessionId:'unknown'}),{code:'EXACT_SYNTHETIC_ASSOCIATION_REQUIRED'});
 await assert.rejects(prepareLegacyPlaybackFixture({fixtureName:'../formal',sessionId:'old-A'}),{code:'EXACT_SYNTHETIC_FIXTURE_REQUIRED'});
});
