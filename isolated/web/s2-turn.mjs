// Host-owned operations for Stage v2. Same identity rules as the legacy client:
// - the draft is saved first, every attempt gets a fresh operationId;
// - "retry" keeps the frozen requestId (+ retryOf) after a terminal failure;
// - new input or a new time confirmation always gets a new requestId;
// - only the canonical receipt / run head proves a commit, never a response.
import {uuid, sleep} from './s2-core.mjs';

export const PHASES = [
  {id: 'think', label: '構思', stages: ['memory', 'director', 'character', 'adjudicate', 'resolve_turn_time']},
  {id: 'write', label: '書寫正文', stages: ['writer', 'writer_repair', 'validation', 'draft', 'prose', 'prose_repair', 'banlist']},
  {id: 'settle', label: '整理世界', stages: ['post_stat']},
  {id: 'save', label: '保存', stages: ['commit']},
];
export const phaseIndex = stage => Math.max(0, PHASES.findIndex(p => p.stages.includes(stage)));
const PENDING = new Set(['accepted', 'queued', 'running', 'pending', 'admitted']);
const DONE = new Set(['committed', 'completed']);

export function createOperations({store, call, reload, getViewerId = () => null}) {
  let polling = 0;
  const op = () => store.get().op;
  const patch = p => store.set(s => ({...s, op: s.op ? {...s.op, ...p} : null}));
  const run = () => store.get().run;
  // Background world routines may commit at any time: submit against the freshest
  // canonical head, never the version the page happened to render.
  const base = r => ({baseVersion: r.version, baseHead: r.head ?? r.lastTurn?.commitId ?? null, expectedLifecycleRevision: r.lifecycleRevision ?? 0});

  async function submit(kind, payload, {input = payload.input ?? null, timeConfirmation = payload.timeConfirmation ?? null} = {}) {
    const r = run(); if (!r || op()?.phase === 'running') return;
    const operationId = uuid(), my = ++polling, viewerId = getViewerId();
    store.set(s => ({...s, notice: null, op: {kind, phase: 'running', stage: 'memory', startedAt: Date.now(), operationId, requestId: payload.requestId ?? null, input, timeConfirmation, failure: null, savedBody: null}}));
    try {
      const fresh = await call('runView', {runId: r.runId}); store.set(x => x.runId === r.runId ? {...x, run: fresh} : x);
      if (kind === 'turn') await call('draftSave', {runId: r.runId, input, requestId: payload.requestId, ...(viewerId ? {viewerId} : {}), expectedLifecycleRevision: fresh.lifecycleRevision ?? 0});
      const receipt = await call('operationSubmit', {...payload, kind, runId: r.runId, operationId, ...(viewerId ? {viewerId} : {}), ...base(fresh)});
      if (receipt?.operationId && receipt.operationId !== operationId) patch({operationId: receipt.operationId});
    } catch (error) {
      if (error.code === 'CONNECTION_UNKNOWN' || error.name === 'AbortError') { patch({phase: 'unknown', checking: true}); return watch(my); }
      return settle({status: 'failed', failure: {code: error.code, message: error.message}});
    }
    return watch(my);
  }

  // Poll the Host's operation ledger; a lost response is resolved here too.
  async function watch(token) {
    for (let i = 0; token === polling; i++) {
      const o = op(); if (!o) return;
      let receipt, progress;
      try {
        [receipt, progress] = await Promise.all([
          call('operationStatus', {runId: run().runId, ...(o.operationId ? {operationId: o.operationId} : {}), ...(o.phase === 'unknown' && o.requestId ? {requestId: o.requestId} : {})}),
          call('progress', {runId: run().runId}).catch(() => null)]);
      } catch (error) { if (i > 40) return patch({phase: 'unknown', checking: false}); await sleep(1200); continue; }
      if (token !== polling) return;
      const stage = progress?.operationId === op()?.operationId ? progress.stage : receipt?.stage;
      if (receipt?.requestOutcome?.status === 'committed' || DONE.has(receipt?.status)) return settle({status: 'committed'});
      if (PENDING.has(receipt?.status)) { if (stage && stage !== op()?.stage) patch({stage, phase: 'running', checking: false}); }
      else if (receipt?.status === 'not_recorded' && o.phase === 'unknown') { if (i > 6) return patch({phase: 'not_saved', checking: false}); }
      else if (receipt?.status) return settle(receipt);
      await sleep(i < 20 ? 600 : 1200);
    }
  }

  async function settle(receipt) {
    polling++;
    if (receipt.status === 'committed') { await reload({highlight: true}); store.set(s => ({...s, op: null, flash: Date.now()})); return; }
    const f = receipt.failure ?? {};
    if (receipt.status === 'cancelled') patch({phase: 'cancelled', failure: f});
    else if (f.bodyAvailable && f.resumeAttemptId) patch({phase: 'settlement_failed', failure: f});
    else if (f.code === 'NEEDS_TIME_PRECISION') patch({phase: 'needs_time', failure: f});
    else if (receipt.status === 'interrupted') patch({phase: 'failed', failure: {...f, message: 'DSH 在處理途中重新啟動，這一輪沒有保存。'}});
    else patch({phase: 'failed', failure: f});
    await reload({});
  }

  return {
    send(text, timeConfirmation) {
      const input = text.trim(); if (!input) return;
      return submit('turn', {input, requestId: uuid(), ...(timeConfirmation ? {timeConfirmation} : {})}, {input, timeConfirmation});
    },
    retry() {
      const o = op(); if (!o) return;
      if (o.kind === 'regenerate') return submit('regenerate', {requestId: uuid()}, {input: o.input});
      return submit('turn', {input: o.input, requestId: o.requestId, ...(o.timeConfirmation ? {timeConfirmation: o.timeConfirmation} : {}), ...(o.operationId && ['failed', 'cancelled'].includes(o.phase) ? {retryOf: o.operationId} : {})}, {input: o.input, timeConfirmation: o.timeConfirmation});
    },
    // A new confirmation changes request content, so it needs a new requestId.
    confirmTime(timeConfirmation) { const o = op(); if (o) return submit('turn', {input: o.input, requestId: uuid(), timeConfirmation}, {input: o.input, timeConfirmation}); },
    resume() { const o = op(); if (o?.failure?.resumeAttemptId) return submit('settlementResume', {requestId: o.failure.requestId ?? o.requestId, sourceAttemptId: o.failure.resumeAttemptId}, {input: o.input}); },
    async readSaved() { const o = op(); if (!o?.failure?.resumeAttemptId) return; const v = await call('settlementBody', {runId: run().runId, attemptId: o.failure.resumeAttemptId}); patch({savedBody: v.body}); },
    hideSaved() { patch({savedBody: null}); },
    async cancel() {
      const o = op(); if (!o || o.phase !== 'running') return; patch({cancelling: true});
      try { const r = await call('cancel', {runId: run().runId, operationId: o.operationId, ...(o.requestId ? {requestId: o.requestId} : {})}); if (!r?.cancelRequested) patch({cancelling: false, cancelRefused: r?.reason ?? 'not_running'}); }
      catch { patch({cancelling: false}); }
    },
    recheck() { const o = op(); if (!o) return; patch({phase: 'unknown', checking: true}); return watch(++polling); },
    regenerate(guidance) { const last = store.get().turns.at(-1); if (last) return submit('regenerate', {requestId: uuid(), ...(guidance ? {guidance} : {})}, {input: last.input}); },
    rollback() { return submit('rollback', {confirmation: 'rollback-last-committed-turn'}, {input: store.get().turns.at(-1)?.input ?? ''}); },
    // Returns the uncommitted input to the composer; nothing was saved.
    dismiss() { const o = op(); polling++; store.set(s => ({...s, op: null, draft: o?.input && o.kind === 'turn' ? o.input : s.draft})); },
    // Reattach to an operation the Host still owns (e.g. after reopening the panel).
    async adopt(runId) {
      try {
        const receipt = await call('operationStatus', {runId});
        if (PENDING.has(receipt?.status) && ['turn', 'regenerate', 'settlementResume', 'rollback'].includes(receipt.kind)) {
          store.set(s => ({...s, op: {kind: receipt.kind, phase: 'running', stage: receipt.stage ?? 'memory', startedAt: Date.parse(receipt.acceptedAt ?? '') || Date.now(), operationId: receipt.operationId, requestId: receipt.requestId, input: null, adopted: true}}));
          return watch(++polling);
        }
      } catch {}
    },
    stop() { polling++; },
  };
}
