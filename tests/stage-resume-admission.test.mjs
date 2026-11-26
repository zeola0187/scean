import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {HostJobs} from '../plugin/job-host.mjs';

test('a retryable failure is visible after its operation releases the run', async () => {
  const jobs = new HostJobs({root: '.', now: Date.now, progressByRun: new Map()});
  const run = {runId: 'run', version: 1, head: null, turns: [], receipts: {}};
  const row = {runId: run.runId, kind: 'turn', operationId: 'op', requestId: 'req', status: 'failed',
    failure: {stageAvailable: true, canStageResume: true, resumeAttemptId: 'first'}};
  jobs.active.set(run.runId, {row});
  const pending = await jobs.view(row, run);
  assert.equal(pending.status, 'running');
  assert.equal(pending.pending, true);
  assert.equal(pending.failure, undefined);
  jobs.active.delete(run.runId);
  const done = await jobs.view(row, run);
  assert.equal(done.status, 'failed');
  assert.equal(done.failure.resumeAttemptId, 'first');
});

test('legacy retry sends the original checkpoint identity to Host', async () => {
  const source = await readFile(new URL('../isolated/web/app.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function submitTurn(');
  const end = source.indexOf('\n}', start);
  assert(start >= 0 && end > start);
  const wires = [];
  const state = {draft: {input: 'Example action', requestId: 'same-request'}, failure:
    {stageAvailable: true, canStageResume: true, requestId: 'same-request', resumeAttemptId: 'saved-attempt'}};
  const submit = vm.runInNewContext(source.slice(start, end + 2) + '\nsubmitTurn', {
    state, view: {runId: 'run', capture: () => 1, current: () => true},
    backupBusy: false, historyBusy: false, $: () => ({value: state.draft.input}),
    userScrollEpoch: 0, historySync: {}, controls() {}, async saveDraft() {},
    async sendHostOperation(kind, args) { wires.push([kind, {...args}]); },
  });
  await submit(true);
  assert.deepEqual(wires, [['stageResume', {requestId: 'same-request', sourceAttemptId: 'saved-attempt'}]]);
});
