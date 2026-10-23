import test from 'node:test';
import assert from 'node:assert/strict';
import {pageHistory} from '../core/history-recall.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';
import {hash} from '../core/contracts.mjs';
import {makeDialoguePresentation} from '../core/dialogue.mjs';

test('chapter-start is forward; legacy end-anchor remains unchanged',()=>{
 const run=syntheticLongrun({turns:9}),first=run.turns[0].commitId;
 assert.deepEqual(pageHistory(run,{anchorCommitId:first}).turns.map(t=>t.turn),[1]);
 const page=pageHistory(run,{anchorCommitId:first,anchorPosition:'start',expectedHead:run.head});
 assert.deepEqual(page.turns.map(t=>t.turn),[1,2,3,4,5,6,7,8,9]);
 assert.deepEqual(pageHistory(run,{anchorCommitId:run.turns[5].commitId,anchorPosition:'start'}).turns.map(t=>t.turn),[6,7,8,9]);
});
test('long colored UTF8 forward pages keep chapter start, whole prose, identity and byte bounds without gaps',()=>{
 const run=syntheticLongrun({turns:123,bodyRepeats:150});for(const turn of run.turns){turn.body='海'.repeat(6000)+turn.body;turn.bodyHash=hash(turn.body);}const before=structuredClone(run);
 for(const turn of run.turns)turn.dialoguePresentation=makeDialoguePresentation({body:turn.body,bodyHash:turn.bodyHash,runId:run.runId,snapshotHash:run.snapshot.hash,commitId:turn.commitId,actors:run.snapshot.characters,entries:[{kind:'speech',speakerId:'kalt',text:'Research log '+String(turn.turn).padStart(4,'0'),occurrence:1}]});
 const ids=[];let page=pageHistory(run,{anchorCommitId:run.turns[0].commitId,anchorPosition:'start',limit:20,presentation:true}),count=0;
 assert.equal(page.turns[0].commitId,run.turns[0].commitId);assert(page.turns.length<20);
 for(;;){assert(Buffer.byteLength(JSON.stringify(page))<=131072);for(const t of page.turns){assert.equal(t.body,before.turns[t.turn-1].body);assert.equal(t.dialoguePresentation.spans[0].speakerId,'kalt');ids.push(t.commitId);}count++;if(!page.afterCursor)break;page=pageHistory(run,{afterCursor:page.afterCursor,limit:20,presentation:true});}
 assert(count>2);assert.deepEqual(ids,run.turns.map(t=>t.commitId));assert.equal(new Set(ids).size,123);
});
test('forward cursors reject wrong direction, changed head, cross-run and malformed requests; metadata-only changes stay valid',()=>{
 const run=syntheticLongrun({turns:30}),page=pageHistory(run,{anchorCommitId:run.turns[0].commitId,anchorPosition:'start'}),cursor=page.afterCursor;
 assert.throws(()=>pageHistory(run,{cursor}),{code:'HISTORY_CURSOR_INVALID'});
 assert.throws(()=>pageHistory(run,{afterCursor:cursor,anchorCommitId:run.head}),{code:'HISTORY_PAGE_ARGUMENTS'});
 assert.throws(()=>pageHistory(run,{anchorPosition:'start'}),{code:'HISTORY_PAGE_ARGUMENTS'});
 assert.throws(()=>pageHistory(run,{expectedHead:'stale'}),{code:'HISTORY_CURSOR_STALE'});
 assert.throws(()=>pageHistory({...run,runId:'other'},{afterCursor:cursor}),{code:'HISTORY_CROSS_RUN'});
 run.version++;assert.equal(pageHistory(run,{afterCursor:cursor}).turns[0].turn,11);
 const old=run.turns.pop();run.head=run.turns.at(-1).commitId;run.retired.push({commitId:old.commitId});
 assert.throws(()=>pageHistory(run,{afterCursor:cursor}),{code:'HISTORY_CURSOR_STALE'});
 assert.throws(()=>pageHistory(run,{anchorCommitId:old.commitId,anchorPosition:'start'}),{code:'HISTORY_COMMIT_RETIRED'});
 run.turns.push({...old,commitId:'replacement'});run.head='replacement';assert.throws(()=>pageHistory(run,{afterCursor:cursor}),{code:'HISTORY_CURSOR_STALE'});
});
