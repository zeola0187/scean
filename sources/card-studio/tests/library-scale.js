import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { LibraryCardService } from '../cardstudio-bundle/lib/library-service.js';
import { syntheticCard } from './helpers/png-fixtures.js';
const checkout=path.resolve(fileURLToPath(new URL('..',import.meta.url))),root=await fs.mkdtemp(path.join(checkout,'library-scale-'));
const service=new LibraryCardService(root);await service.init();
try{
  const start=performance.now();for(let i=0;i<120;i++){const card=syntheticCard(3);card.data.name='SYNTHETIC-'+i;card.data.scenario='Four apprentices in a mage tower '+i;await fs.writeFile(path.join(root,'library',i+'.json'),JSON.stringify(card));}
  const large=syntheticCard(3);large.data.name='SYNTHETIC LARGE';large.data.description='字'.repeat(1024*1024);await fs.writeFile(path.join(root,'library/large.json'),JSON.stringify(large));
  const scanStart=performance.now(),scan=await service.library.scan(),scanMs=performance.now()-scanStart;assert.equal(scan.complete,true);assert.equal(scan.source_count,121);
  const searchStart=performance.now(),search=await service.library.search({query:'mage tower',limit:20}),searchMs=performance.now()-searchStart;assert.equal(search.items.length,20);assert(search.items.every(x=>x.evidence.length<=4&&x.evidence.every(e=>e.text.length<=240)));
  const report={scope:'Synthetic local data only; no model or live UI; timing is one run, not p95.',sources:scan.source_count,largeDescriptionCharacters:large.data.description.length,scanMs,searchMs,elapsedMs:performance.now()-start,indexBytes:(await fs.stat(path.join(root,'.cardstudio/library/index.json'))).size,searchResultBytes:Buffer.byteLength(JSON.stringify(search)),largeCardCoverage:[...service.library.rows.values()].find(x=>x.name==='SYNTHETIC LARGE').coverage};
  await fs.writeFile(path.join(checkout,'test-evidence/library-scale.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await service.close();assert.equal(path.dirname(root),checkout);assert(path.basename(root).startsWith('library-scale-'));await fs.rm(root,{recursive:true,force:true});}
