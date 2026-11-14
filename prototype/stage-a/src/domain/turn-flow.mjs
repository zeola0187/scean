// Turn lifecycle controller. Owns request/operation identities the same way the
// rc3 client does (isolated/web/view-model.mjs):
//  - every execution attempt gets a fresh operationId
//  - "再試一次" keeps the frozen requestId + input + timeConfirmation
//  - a changed input or a changed time confirmation gets a new requestId
//  - nothing is shown as story until the Host reports a committed receipt
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Player-facing phases. Engineering stage names stay in diagnostics.
export const PHASES = [
  {id: 'think', label: '構思', stages: ['memory', 'director', 'character', 'adjudicate']},
  {id: 'write', label: '書寫正文', stages: ['writer', 'writer_repair', 'validation', 'draft', 'prose', 'prose_repair', 'banlist']},
  {id: 'settle', label: '整理世界', stages: ['post_stat']},
  {id: 'save', label: '保存', stages: ['commit']},
];
export const phaseOf = stage => PHASES.findIndex(p => p.stages.includes(stage));

export function createTurnFlow({store, transport, refresh}) {
  let pollTimer = 0;
  const op = () => store.get().op;
  const setOp = patch => store.set(s => ({...s, op: s.op ? {...s.op, ...patch} : null}));

  function poll(runId, operationId) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const current = op(); if (!current || current.operationId !== operationId) return clearInterval(pollTimer);
      try { const p = await transport.call('progress', {runId}); if (p && p.operationId === operationId && op()?.operationId === operationId && op().stage !== p.stage) setOp({stage: p.stage}); } catch { /* polling is best effort */ }
    }, 200);
  }

  async function run(kind, payload) {
    const runId = store.get().runId; if (!runId) return;
    const operationId = uuid();
    store.set(s => ({...s, draft: kind === 'turn' ? '' : s.draft, notice: null, op: {kind, runId, phase: 'running', stage: 'memory', startedAt: Date.now(), operationId, error: null, savedBody: null,
      requestId: payload.requestId, input: payload.input, timeConfirmation: payload.timeConfirmation ?? null, attemptId: payload.sourceAttemptId ?? null}}));
    poll(runId, operationId);
    try {
      const action = kind === 'resume' ? 'settlementResume' : kind === 'regenerate' ? 'regenerate' : 'turn';
      const request = {runId, operationId, requestId: payload.requestId, input: payload.input, ...(payload.timeConfirmation ? {timeConfirmation: payload.timeConfirmation} : {}),
        ...(kind === 'resume' ? {sourceAttemptId: payload.sourceAttemptId} : {}), ...(kind === 'regenerate' ? {expectedVersion: store.get().run.version} : {})};
      await transport.call(action, request);
      clearInterval(pollTimer);
      await refresh({highlightLatest: true});
      store.set(s => ({...s, op: null, flash: {kind: 'saved', at: Date.now()}}));
    } catch (error) {
      clearInterval(pollTimer);
      const e = {code: error.code, message: error.message, stage: error.stage};
      if (error.code === 'NEEDS_TIME_PRECISION') setOp({phase: 'needs_time', error: e, timeControls: error.timeControls});
      else if (error.code === 'POST_STAT_FAILED') setOp({phase: 'settlement_failed', error: e, attemptId: error.attemptId});
      else if (error.code === 'COMMIT_OUTCOME_UNKNOWN') { setOp({phase: 'unknown', error: e}); recheck(); }
      else if (error.code === 'CANCELLED') setOp({phase: 'cancelled', error: e});
      else setOp({phase: 'failed', error: e});
    }
  }

  async function recheck() {
    const current = op(); if (!current) return;
    setOp({phase: 'unknown', checking: true});
    await new Promise(r => setTimeout(r, 1200));
    try {
      const view = await transport.call('runView', {runId: current.runId, requestId: current.requestId});
      if (view.requestReceipt?.status === 'committed') {
        await refresh({highlightLatest: true});
        store.set(s => ({...s, op: null, flash: {kind: 'confirmed', at: Date.now()}}));
      } else setOp({phase: 'not_saved', checking: false});
    } catch (error) { setOp({phase: 'unknown', checking: false, error: {code: error.code, message: error.message}}); }
  }

  return {
    submit(input) {
      const text = input.trim(); if (!text || op()?.phase === 'running') return;
      return run('turn', {requestId: uuid(), input: text});
    },
    // Same request identity; Host either replays a committed receipt or runs a new attempt.
    retry() { const o = op(); if (o) return run(o.kind === 'resume' ? 'turn' : o.kind, {requestId: o.requestId, input: o.input, timeConfirmation: o.timeConfirmation}); },
    // A new time confirmation changes the request content, so it needs a new requestId.
    confirmTime(timeConfirmation) { const o = op(); if (o) return run(o.kind, {requestId: uuid(), input: o.input, timeConfirmation}); },
    resumeSettlement() { const o = op(); if (o?.attemptId) return run('resume', {requestId: o.requestId, input: o.input, timeConfirmation: o.timeConfirmation, sourceAttemptId: o.attemptId}); },
    async readSavedBody() {
      const o = op(); if (!o?.attemptId) return;
      const value = await transport.call('settlementBody', {runId: o.runId, attemptId: o.attemptId});
      setOp({savedBody: value.body});
    },
    recheck,
    async cancel() {
      const o = op(); if (!o || o.phase !== 'running') return;
      setOp({cancelling: true});
      const r = await transport.call('cancel', {runId: o.runId, operationId: o.operationId});
      if (!r.cancelRequested) setOp({cancelling: false, cancelRefused: r.reason});
    },
    regenerate(guidance) { const s = store.get(); const last = s.turns.at(-1); if (last) return run('regenerate', {requestId: uuid(), input: last.input, guidance}); },
    // Returns the failed input to the composer for editing; nothing was saved.
    dismiss({restore = true} = {}) { const o = op(); store.set(s => ({...s, op: null, draft: restore && o?.input ? o.input : s.draft})); },
  };
}
