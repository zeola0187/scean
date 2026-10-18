// Explicit round-two update of only the two independently named test plugins.
// Original receipt is immutable. New receipt owns rollback to the previous installed version.
import {readFile,writeFile,readdir,mkdir,copyFile,lstat,readlink,symlink,unlink,rename} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hostname,tmpdir} from 'node:os';
import {dirname,basename} from 'node:path';
// Retained only for original offline installer regression. R3 deployment needs a new authorization.
const testProfile=process.env.SCEAN_INSTALL_TEST_PROFILE;
if(!testProfile||resolve(dirname(dirname(testProfile)))!==resolve(tmpdir())||!basename(dirname(testProfile)).startsWith('scean-r2-upgrade-'))throw Error('R3_DEPLOYMENT_NOT_AUTHORIZED');
const project=resolve(import.meta.dirname,'..'),production=!process.env.SCEAN_INSTALL_TEST_PROFILE;
const profile=production?process.env.SCEAN_PROFILE:resolve(process.env.SCEAN_INSTALL_TEST_PROFILE);
const previous=production?process.env.SCEAN_PREVIOUS_SUITE:resolve(process.env.SCEAN_INSTALL_TEST_PREVIOUS);
const receiptFile=join(project,'evidence/upgrade-receipt.json'),profileFile=join(profile,'package.json');
const definitions=[{name:'@local/dsh-scean',source:'dist/dsh-scean',oldDir:'scean-mvp-0.1.0',newDir:'scean-mvp-0.2.0',version:'0.2.0'},
 {name:'@local/dsh-card-studio-scean-test',source:'dist/dsh-card-studio-scean-test',oldDir:'cardstudio-scean-test-1.2.0-scean.1',newDir:'cardstudio-scean-test-1.2.0-scean.2',version:'1.2.0-scean.2'}];
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function tree(dir){const out=[];async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){const q=join(p,e.name);if(e.isSymbolicLink())throw Error('PACKAGE_SYMLINK_REFUSED');if(e.isDirectory())await walk(q);else if(e.isFile())out.push([relative(dir,q).replaceAll('\\','/'),sha(await readFile(q))]);}}await walk(dir);return out.sort((a,b)=>a[0].localeCompare(b[0]));}
async function copy(from,to){await mkdir(to);for(const e of await readdir(from,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('PACKAGE_SYMLINK_REFUSED');if(e.isDirectory())await copy(join(from,e.name),join(to,e.name));else if(e.isFile())await copyFile(join(from,e.name),join(to,e.name),1);}}
function desktopClosed(){if(!production)return [];if(hostname()!==process.env.SCEAN_PRIMARY_MACHINE)throw Error('WRONG_HOST');const p=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process | Where-Object {$_.ProcessName -eq 'DeepSeek Harness'} | Select-Object Id,ProcessName) | ConvertTo-Json -Compress"],{encoding:'utf8'}).trim()||'[]');if(!Array.isArray(p)||p.length)throw Error('DESKTOP_RUNNING_STOP');return p;}
async function exactLink(link,target){if(!(await lstat(link)).isSymbolicLink()||resolve(await readlink(link))!==resolve(target))throw Error('LINK_DRIFT_STOP');}
async function atomic(bytes){const tmp=profileFile+'.scean-r2-new';await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,profileFile);}
function targets(d){return {...d,link:join(profile,'node_modules',d.name),oldTarget:join(profile,'.local-packages',d.oldDir),newTarget:join(profile,'.local-packages',d.newDir)};}
export async function upgrade(){
 desktopClosed();if(await exists(receiptFile))throw Error('UPGRADE_RECEIPT_EXISTS');
 const oldReceiptPath=join(previous,'evidence/coexist-install.json'),oldReceiptBytes=await readFile(oldReceiptPath),old=JSON.parse(oldReceiptBytes),before=await readFile(profileFile),pkg=JSON.parse(before);
 if(old.status!=='installed'||old.production!==production||resolve(old.profile)!==resolve(profile)||old.afterHash!==sha(before)||old.additions?.length!==2)throw Error('PREVIOUS_RECEIPT_OR_PROFILE_DRIFT');
 const updates=[];
 for(const def of definitions){const d=targets(def),prior=old.additions.find(p=>p.name===d.name);if(!prior||prior.dir!==d.oldDir||resolve(prior.target)!==resolve(d.oldTarget)||resolve(prior.link)!==resolve(d.link))throw Error('PREVIOUS_IDENTITY_MISMATCH');
  if(pkg.dependencies?.[d.name]!=='link:./.local-packages/'+d.oldDir||pkg.dsh?.profile?.bundles?.filter(x=>x===d.name).length!==1)throw Error('PREVIOUS_REGISTRATION_MISMATCH');
  await exactLink(d.link,d.oldTarget);const oldFiles=await tree(d.oldTarget);if(JSON.stringify(oldFiles)!==JSON.stringify(await tree(join(previous,d.source))))throw Error('PREVIOUS_PACKAGE_DRIFT');
  if(await exists(d.newTarget))throw Error('NEW_TARGET_EXISTS');const meta=await json(join(project,d.source,'package.json'));if(meta.name!==d.name||meta.version!==d.version||meta.engines?.dsh!=='0.2.0-rc.2')throw Error('NEW_PACKAGE_IDENTITY');updates.push({...d,oldFiles,newFiles:await tree(join(project,d.source))});
 }
 const backup=join(project,'evidence/upgrade-before-package.json');await writeFile(backup,before,{flag:'wx'});
 const r={schemaVersion:1,status:'preparing',at:new Date().toISOString(),production,host:hostname(),profile,previousReceipt:oldReceiptPath,previousReceiptHash:sha(oldReceiptBytes),beforeHash:sha(before),backup,updates,desktopClosed:true,oldRuntimeDataMigrated:false};
 await writeFile(receiptFile,JSON.stringify(r,null,2),{flag:'wx'});
 for(const d of updates){await copy(join(project,d.source),d.newTarget);if(JSON.stringify(await tree(d.newTarget))!==JSON.stringify(d.newFiles))throw Error('COPY_VERIFY_FAILED');}
 desktopClosed();if(sha(await readFile(profileFile))!==r.beforeHash||sha(await readFile(oldReceiptPath))!==r.previousReceiptHash)throw Error('PRE_SWITCH_DRIFT');
 const switched=[];
 try{
  for(const d of updates){await exactLink(d.link,d.oldTarget);await unlink(d.link);switched.push(d);await symlink(d.newTarget,d.link,'junction');pkg.dependencies[d.name]='link:./.local-packages/'+d.newDir;}
  if(sha(await readFile(profileFile))!==r.beforeHash)throw Error('PROFILE_DRIFT_DURING_SWITCH');
  const next=Buffer.from(JSON.stringify(pkg,null,2)+'\n');r.afterHash=sha(next);await atomic(next);
  r.status='installed';r.installedAt=new Date().toISOString();await writeFile(receiptFile,JSON.stringify(r,null,2));
 }catch(e){
  const current=sha(await readFile(profileFile));
  if(current===r.beforeHash){for(const d of switched.reverse()){if(await exists(d.link)){await exactLink(d.link,d.newTarget);await unlink(d.link);}await symlink(d.oldTarget,d.link,'junction');}r.status='failed_restored';}
  else r.status='needs_recovery';
  r.failure={code:e.code??'UPGRADE_FAILED',message:String(e.message).slice(0,160)};await writeFile(receiptFile,JSON.stringify(r,null,2));throw e;
 }
 return {status:r.status,profileHash:r.afterHash,versions:updates.map(d=>({name:d.name,version:d.version})),receipt:receiptFile};
}
export async function rollback(){
 desktopClosed();const r=await json(receiptFile);if(r.status!=='installed'||r.production!==production||resolve(r.profile)!==resolve(profile)||r.updates.length!==2)throw Error('ROLLBACK_RECEIPT');
 const before=await readFile(join(project,'evidence/upgrade-before-package.json'));if(sha(before)!==r.beforeHash||sha(await readFile(profileFile))!==r.afterHash)throw Error('ROLLBACK_PROFILE_DRIFT');
 for(const d of r.updates){const expected=targets(definitions.find(x=>x.name===d.name)??{});if(!expected.name||['link','oldTarget','newTarget'].some(k=>resolve(expected[k])!==resolve(d[k])))throw Error('ROLLBACK_TARGET_MISMATCH');await exactLink(d.link,d.newTarget);if(JSON.stringify(await tree(d.oldTarget))!==JSON.stringify(d.oldFiles)||JSON.stringify(await tree(d.newTarget))!==JSON.stringify(d.newFiles))throw Error('ROLLBACK_PACKAGE_DRIFT');}
 desktopClosed();const switched=[];
 try{for(const d of r.updates){await exactLink(d.link,d.newTarget);await unlink(d.link);switched.push(d);await symlink(d.oldTarget,d.link,'junction');}
  if(sha(await readFile(profileFile))!==r.afterHash)throw Error('ROLLBACK_PROFILE_DRIFT_DURING_SWITCH');
  await atomic(before);r.status='rolled_back';r.rolledBackAt=new Date().toISOString();await writeFile(receiptFile,JSON.stringify(r,null,2));
 }catch(e){
  if(sha(await readFile(profileFile))===r.afterHash){for(const d of switched.reverse()){if(await exists(d.link)){await exactLink(d.link,d.oldTarget);await unlink(d.link);}await symlink(d.newTarget,d.link,'junction');}r.rollbackFailure={code:e.code??'ROLLBACK_FAILED',at:new Date().toISOString()};}
  else if(sha(await readFile(profileFile))===r.beforeHash){r.status='rolled_back';r.rolledBackAt=new Date().toISOString();}
  else r.status='needs_recovery';
  await writeFile(receiptFile,JSON.stringify(r,null,2));throw e;
 }
 return {status:r.status,profileHash:sha(await readFile(profileFile)),retainedNewPackageDirs:true};
}
if(process.argv[1]===import.meta.filename){const action=process.argv[2];if(!['upgrade','rollback'].includes(action))throw Error('Usage: upgrade-coexist.mjs upgrade|rollback');console.log(JSON.stringify(await({upgrade,rollback}[action]())));}
