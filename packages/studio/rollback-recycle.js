// Explicit local maintenance only; never registered as a model tool or RPC.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CardService,contained} from './lib/card-service.js';
import {strictJson,fail} from './lib/codec.js';

const args=process.argv.slice(2),rootAt=args.indexOf('--root');
if(rootAt<0||!args[rootAt+1]||args.length!==3||!['--plan','--apply'].some(mode=>args.includes(mode)))throw new Error('Use: node rollback-recycle.js --root <absolute workspace> --plan|--apply');
const root=args[rootAt+1];if(!path.isAbsolute(root))throw new Error('The workspace root must be absolute.');
const manifest=strictJson(await fs.readFile(await contained(root,'.cardstudio-scean/workspace.json',{existing:true}),'utf8'));
if(manifest.schemaVersion!==1||manifest.capability!=='card-studio-scean-test')fail('CONFIG','This is not a configured Card Studio workspace.');
const service=new CardService(root);
if(args.includes('--plan')){
  const state=await service.lifecycle.read();if(!state)fail('RECYCLE_JOURNAL','No lifecycle journal; do not guess recycled ownership.');
  const associations=await service.associations();
  console.log(JSON.stringify({action:'restore-and-protect-before-plugin-rollback',managedCopies:associations.documents.filter(d=>d.origin==='import').length,recycled:state.copies.filter(d=>d.location==='recycled').length,pending:state.copies.filter(d=>d.pending).length,requiresNormalExit:true}));
}else{
  const status=strictJson(await fs.readFile(await contained(root,'.cardstudio-scean/runtime-status.json',{existing:true}),'utf8'));
  if(status.plugin!=='@local/dsh-card-studio-scean-test'||status.host!=='inactive')fail('RUNNING','Exit DSH normally and verify Host inactive before rollback.');
  if(process.platform!=='win32')fail('PLATFORM','This guarded rollback command is validated for the installed Windows desktop only.');
  const count=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  if(count!=='0')fail('RUNNING','DSH is still running. No files were moved.');
  await service.init();try{console.log(JSON.stringify(await service.prepareRecycleRollback()));}finally{await service.close();}
}
