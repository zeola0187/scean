// Stage v2 prose layout: a paragraph mixing a quote with narration is shown as separate pieces,
// so a speaker line only ever contains what that character says. The body text is never altered.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDialoguePresentation} from '../core/dialogue.mjs';
import {hash} from '../core/contracts.mjs';

class El { constructor(tag) { this.tag = tag; this.kids = []; this.dataset = {}; this.style = {setProperty() {}}; this.className = ''; }
  append(...k) { for (const x of k.flat(Infinity)) if (x != null && x !== false) this.kids.push(typeof x === 'string' ? new Txt(x) : x); }
  appendChild(x) { this.append(x); return x; } setAttribute() {} addEventListener() {}
  get textContent() { return this.kids.map(k => k.textContent).join(''); } set textContent(v) { this.kids = [new Txt(v)]; } }
class Txt { constructor(t) { this.textContent = t; } }
globalThis.Node = El; globalThis.document = {createElement: t => new El(t), createTextNode: t => new Txt(t)};
const {proseNodes} = await import('../isolated/web/s2-render.mjs');

const actors = [{id: 'kalt', name: '卡爾特'}, {id: 'ael', name: '艾兒'}];
function turnOf(body, entries) {
  const run = {runId: 'run-1', snapshot: {hash: 'a'.repeat(64), characters: actors}}, bodyHash = hash(body);
  const turn = {body, bodyHash, commitId: 'c-1'};
  turn.dialoguePresentation = makeDialoguePresentation({body, bodyHash, runId: run.runId, snapshotHash: run.snapshot.hash, commitId: turn.commitId, actors, entries: entries.map(([speakerId, text]) => ({kind: 'speech', speakerId, text, occurrence: 1}))});
  assert(turn.dialoguePresentation, 'fixture presentation must validate');
  return {run, turn};
}
const view = nodes => nodes.map(p => p.className.startsWith('line') ? `[${p.kids[0].textContent}] ${p.kids[1].textContent}` : p.textContent);

test('quote + narration in one paragraph becomes a speaker line and a narration paragraph', () => {
  const {run, turn} = turnOf('「哈！這批貨值錢！」卡爾特把扳手一丟。「船長，我先開動了。」', [['kalt', '哈！這批貨值錢！'], ['kalt', '船長，我先開動了。']]);
  assert.deepEqual(view(proseNodes(turn, run, {})), ['[卡爾特] 「哈！這批貨值錢！」', '卡爾特把扳手一丟。', '[卡爾特] 「船長，我先開動了。」']);
});

test('lead-in narration ending in a colon and trailing attribution stay narration; no stray quote marks', () => {
  const {run, turn} = turnOf('她愣了一下，小聲補了句：「……湯，很好喝。」\n\n「座標在第七頁。」她說著，又低頭喝了一口。', [['ael', '……湯，很好喝。'], ['ael', '座標在第七頁。']]);
  assert.deepEqual(view(proseNodes(turn, run, {})), ['她愣了一下，小聲補了句：', '[艾兒] 「……湯，很好喝。」', '[艾兒] 「座標在第七頁。」', '她說著，又低頭喝了一口。']);
});

test('the split never changes the text: pieces join back to the original body', () => {
  const body = '「先走。」卡爾特說。「好。」艾兒點頭，「啪」地合上筆記本。';
  const {run, turn} = turnOf(body, [['kalt', '先走。'], ['ael', '好。']]);
  assert.equal(proseNodes(turn, run, {}).map(p => p.className.startsWith('line') ? p.kids[1].textContent : p.textContent).join(''), body);
});

test('paragraphs without speech are untouched; unvalidated presentations fall back to plain prose', () => {
  const {run, turn} = turnOf('只有敘事。\n\n「說話。」卡爾特說。', [['kalt', '說話。']]);
  assert.deepEqual(view(proseNodes({...turn, bodyHash: 'b'.repeat(64)}, run, {})), ['只有敘事。', '「說話。」卡爾特說。']);
});
