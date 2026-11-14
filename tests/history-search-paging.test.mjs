// 回顧 search over long stories: newest-first paging that never skips or repeats a hit, matches the
// stored text exactly, and leaves the model tool's default behaviour (oldest first, no paging) unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchHistory, readHistory} from '../core/history-recall.mjs';

function longRun(n = 1000) {
  const turns = Array.from({length: n}, (_, i) => ({turn: i + 1, commitId: `c${i + 1}`, requestId: `r${i + 1}`, input: i % 7 === 0 ? `我問起鋼琴的事（${i + 1}）` : `繼續往前（${i + 1}）`,
    body: `第${i + 1}段。` + (i % 3 === 0 ? '走廊盡頭傳來鋼琴聲。' : '雨還在下。') + '天台的門鎖著。'.repeat(20)}));
  return {runId: 'run-long', turns, head: turns.at(-1).commitId, receipts: {}};
}

test('newest-first pages cover every hit once, in order, and match the saved text', () => {
  const run = longRun(), seen = [];
  const started = Date.now();
  for (let offset = 0; offset !== null && offset !== undefined;) {
    const page = searchHistory(run, {query: '鋼琴', mode: 'literal', limit: 10, offset, order: 'newest'});
    for (const hit of page.hits) {
      seen.push(hit.turn);
      const turn = run.turns[hit.turn - 1], field = turn[hit.snippetField];
      assert.equal(field.slice(hit.snippetStart, hit.snippetStart + hit.snippet.length), hit.snippet); // snippet is the stored text
      assert.ok(hit.snippet.includes('鋼琴'));
    }
    offset = page.nextOffset;
  }
  const expected = run.turns.filter(t => (t.input + t.body).includes('鋼琴')).map(t => t.turn).reverse();
  assert.deepEqual(seen, expected);
  assert.ok(Date.now() - started < 5000, 'searching 1,000 turns page by page stays fast');
});

test('defaults are unchanged for the model tool: oldest first, five hits, no paging fields', () => {
  const page = searchHistory(longRun(50), {query: '鋼琴'});
  assert.equal(page.hits.length, 5); assert.equal(page.hits[0].turn, 1);
  assert.equal(page.total, undefined); assert.equal(page.nextOffset, undefined);
});

test('a passage read returns the exact saved section with its neighbours', () => {
  const run = longRun(30), v = readHistory(run, {commitId: 'c10', radius: 1});
  assert.deepEqual(v.turns.map(t => t.turn), [9, 10, 11]);
  assert.equal(v.turns[1].body, run.turns[9].body);
});
