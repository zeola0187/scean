import assert from 'node:assert/strict';
import {LibraryCardService} from '../cardstudio-bundle/lib/library-service.js';
const [root,denied]=process.argv.slice(2),service=new LibraryCardService(root);
await service.init();
await assert.rejects(service.setLibraryRoot({path:denied,expected_revision:0}),{code:'ERR_ACCESS_DENIED'});
assert.equal(service.librarySettings().custom,false);
await service.close();
console.log('permission-denied-preserves-default');
