import { mkdir, open, readFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeId, json, clone, checkAbort, SceanError } from '../core/contracts.mjs';

// One aggregate is the authority for body, state, memories and idempotency receipts.
// Indexes and attempt audit files are explicitly non-authoritative.
export class DurableStore {
  constructor(options) {
    if (typeof options === 'string') options = { root: options };
    if (!options?.root) throw new SceanError('STORE_ROOT_REQUIRED');
    this.root = path.resolve(options.root); this.fault = options.fault; this.held = new Set();
  }
  runDir(runId) { return path.join(this.root, 'runs', safeId(runId)); }
  async inject(point, detail) { await this.fault?.(point, detail); }
  async retrySharingViolation(operation) {
    // Windows readers/antivirus may briefly hold a delete-denying handle.
    // Never remove the destination as a fallback: that would break atomicity.
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (attempt >= 2 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }
  async syncDir(dir) {
    let handle;
    try { handle = await open(dir, 'r'); await handle.sync(); }
    catch (error) { if (!['EPERM', 'EISDIR', 'EINVAL', 'EACCES', 'ENOTSUP', 'EBADF'].includes(error.code)) throw error; }
    finally { await handle?.close(); }
  }
  async atomic(file, data, { signal, commit = false } = {}) {
    const dir = path.dirname(file); await mkdir(dir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      checkAbort(signal);
      handle = await open(temporary, 'wx');
      await handle.writeFile(json(data), 'utf8'); await handle.sync(); await handle.close(); handle = null;
      if (commit) await this.inject('beforeRename', { file, data: clone(data) });
      checkAbort(signal);
      await this.retrySharingViolation(() => { checkAbort(signal); return rename(temporary, file); });
      await this.syncDir(dir);
      // Abort after publication cannot erase a committed round.
      if (commit) await this.inject('afterRename', { file, data: clone(data) });
    } finally {
      await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async read(runId) {
    try {
      const run = JSON.parse(await this.retrySharingViolation(() => readFile(path.join(this.runDir(runId), 'current.json'), 'utf8')));
      if (run.runId !== runId || !Number.isSafeInteger(run.version)) throw new SceanError('CORRUPT_RUN');
      return run;
    } catch (error) { if (error.code === 'ENOENT') throw new SceanError('RUN_NOT_FOUND'); throw error; }
  }
  async listRuns() {
    const dir = path.join(this.root, 'runs'); let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const summaries = [];
    for (const entry of entries.filter(e => e.isDirectory())) {
      try {
        const run = await this.read(entry.name);
        summaries.push({ runId: run.runId, version: run.version, cardId: run.snapshot.cardId, revision: run.snapshot.revision, ...(run.playerIdentity?{playerName:run.playerIdentity.name}:{}), createdAt: run.createdAt, updatedAt: run.updatedAt, turnCount: run.turns.length });
      } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(run,options={}) {
    return this.withRunLock(run.runId, async () => {
      try { await this.read(run.runId); throw new SceanError('RUN_EXISTS'); }
      catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
      await this.atomic(path.join(this.runDir(run.runId), 'current.json'), run, { ...options, commit: true }); return clone(run);
    },options);
  }
  async commit(runId, expectedVersion, next, options = {}) {
    if (!this.held.has(runId)) throw new SceanError('LOCK_REQUIRED');
    const prior = await this.read(runId);
    if (prior.version !== expectedVersion || !Number.isSafeInteger(next.version) || next.version !== expectedVersion + 1 || next.runId !== runId) throw new SceanError('VERSION_CONFLICT');
    await this.atomic(path.join(this.runDir(runId), 'current.json'), next, { ...options, commit: true });
    return clone(next);
  }
  async writeAttempt(runId, attempt) {
    safeId(attempt.attemptId);
    await this.atomic(path.join(this.runDir(runId), 'attempts', `${attempt.attemptId}.json`), attempt);
  }
  async readAttempts(runId) {
    const dir = path.join(this.runDir(runId), 'attempts');
    let names;
    try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const attempts = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await this.retrySharingViolation(() => readFile(path.join(dir, name), 'utf8')))));
    return attempts.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.attemptId.localeCompare(b.attemptId));
  }
  async recoverAttempts(runId) {
    if (!this.held.has(runId)) throw new SceanError('LOCK_REQUIRED');
    const run = await this.read(runId);
    for (const attempt of await this.readAttempts(runId)) {
      if (attempt.status !== 'pending') continue;
      const receipt = run.receipts?.[attempt.requestId];
      const owner = receipt?.attemptId ?? receipt?.result?.trace?.attemptId ?? run.turns?.find(t => t.commitId === receipt?.commitId)?.attemptId;
      const retired = receipt?.status === 'retired' && owner === attempt.attemptId;
      const published = !!receipt && !retired && typeof owner === 'string' && owner === attempt.attemptId;
      attempt.status = retired ? 'retired' : published ? 'committed' : 'failed';
      if (attempt.commit) attempt.commit.status = attempt.status;
      attempt.recovery = published ? 'published_before_interruption' : 'interrupted_before_commit';
      attempt.finishedAt = new Date().toISOString();
      if (published) attempt.commitId = receipt.commitId;
      else attempt.error = { code: 'INTERRUPTED_BEFORE_COMMIT', stage: attempt.stages?.at(-1)?.stage ?? 'not_recorded', message: '程序在正式提交前中斷；本次未提交。' };
      for (const stage of attempt.stages ?? []) if (stage.status === 'pending') { stage.status = published ? 'not_recorded' : 'failed'; stage.finishedAt = attempt.finishedAt; if (!published) stage.error = attempt.error; }
      await this.writeAttempt(runId, attempt);
    }
  }
  async activeTickets(dir) {
    const owners = new Map();
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.json'))) {
      const file = path.join(dir, name); let owner;
      try { owner = JSON.parse(await this.retrySharingViolation(() => readFile(file, 'utf8'))); }
      catch (error) { if (error.code === 'ENOENT') continue; if (error instanceof SyntaxError) throw new SceanError('CORRUPT_LOCK'); if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw new SceanError('RUN_BUSY'); throw error; }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== 'string' || !['choosing', 'ready', 'released'].includes(owner.phase) || (owner.ticket !== null && (!Number.isSafeInteger(owner.ticket) || owner.ticket < 1))) throw new SceanError('CORRUPT_LOCK');
      const prior = owners.get(owner.token);
      const priority = { choosing: 0, ready: 1, released: 2 };
      if (!prior || priority[owner.phase] > priority[prior.phase]) owners.set(owner.token, owner);
    }
    const active = [];
    for (const owner of owners.values()) {
      if (owner.phase === 'released') continue;
      try { process.kill(owner.pid, 0); active.push(owner); }
      catch (error) {
        if (error.code === 'ESRCH') await this.clearTicketFiles(dir, owner.token);
        else active.push(owner); // Unknown process permission => fail closed as active.
      }
    }
    return active;
  }
  async clearTicketFiles(dir, token) {
    // Remove release marker last, so a transient Windows reader cannot resurrect
    // a ticket whose ready/choosing files could not yet be deleted.
    for (const phase of ['c', 'r', 'x']) {
      try { await this.retrySharingViolation(() => unlink(path.join(dir, `${token}.${phase}.json`))); }
      catch (error) { if (error.code === 'ENOENT') continue; if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) return; throw error; }
    }
  }
  async withRunLock(runId, fn, { signal } = {}) {
    const dir = path.join(this.runDir(runId), 'writer-tickets'); await mkdir(dir, { recursive: true }); checkAbort(signal);
    const token = randomUUID(); const phaseFile = phase => path.join(dir, `${token}.${phase}.json`);
    const owner = { pid: process.pid, token, ticket: null, phase: 'choosing', createdAt: new Date().toISOString() };
    let acquired = false;
    try {
      // Nonblocking Lamport bakery: publish choosing state before selecting a ticket.
      // Phase files are immutable: Windows readers cannot block replacement.
      // Each contender owns never-reused filenames, so dead cleanup has no ABA race.
      await this.atomic(phaseFile('c'), owner);
      const tickets = await this.activeTickets(dir);
      owner.ticket = Math.max(0, ...tickets.map(t => t.ticket ?? 0)) + 1;
      owner.phase = 'ready'; await this.atomic(phaseFile('r'), owner);
      const competitors = (await this.activeTickets(dir)).filter(t => t.token !== token);
      if (competitors.some(t => t.ticket === null || t.ticket < owner.ticket || (t.ticket === owner.ticket && t.token < token))) throw new SceanError('RUN_BUSY');
      acquired = true;
      this.held.add(runId); checkAbort(signal); return await fn();
    } finally {
      if (acquired) this.held.delete(runId);
      await this.atomic(phaseFile('x'), { ...owner, phase: 'released' });
      await this.clearTicketFiles(dir, token);
    }
  }
}
export default DurableStore;
