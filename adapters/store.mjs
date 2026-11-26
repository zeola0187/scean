import {encodeRunBundle} from '../core/save-bundle.mjs';
import {validateTemporalRun} from '../core/state-operations.mjs';
import { mkdir, open, readFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeId, json, clone, checkAbort, SceanError } from '../core/contracts.mjs';
import {assertRunActive,runLifecycle} from '../core/run-lifecycle.mjs';

const IO_RETRY_MS = [10, 20];
const WINDOWS_ATOMIC_REPLACE_RETRY_MS = [10, 20, 40, 80, 160, 200];

// One aggregate is the authority for body, state, memories and idempotency receipts.
// Indexes and attempt audit files are explicitly non-authoritative.
export class DurableStore {
  constructor(options) {
    if (typeof options === 'string') options = { root: options };
    if (!options?.root) throw new SceanError('STORE_ROOT_REQUIRED');
    this.root = path.resolve(options.root); this.fault = options.fault; this.held = new Set();
    this.canonicalFileIo = new Map();
  }
  runDir(runId) { return path.join(this.root, 'runs', safeId(runId)); }
  currentFile(runId) { return path.join(this.runDir(runId),'current.json'); }
  async inject(point, detail) { await this.fault?.(point, detail); }
  async withCanonicalFileIo(file, operation) {
    if (process.platform !== 'win32' || path.basename(file) !== 'current.json') return operation();
    // Reader polls from the same host must not keep the canonical file open
    // while it is being replaced. Queue by file, not by host or unrelated Run.
    const prior = this.canonicalFileIo.get(file) ?? Promise.resolve();
    const result = prior.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.canonicalFileIo.set(file, tail);
    try { return await result; }
    finally { if (this.canonicalFileIo.get(file) === tail) this.canonicalFileIo.delete(file); }
  }
  async retrySharingViolation(operation, delays = IO_RETRY_MS) {
    // Windows readers/antivirus may briefly hold a delete-denying handle.
    // Never remove the destination as a fallback: that would break atomicity.
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (attempt >= delays.length || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  async syncDir(dir) {
    let handle;
    try { handle = await open(dir, 'r'); await handle.sync(); }
    catch (error) { if (!['EPERM', 'EISDIR', 'EINVAL', 'EACCES', 'ENOTSUP', 'EBADF'].includes(error.code)) throw error; }
    finally { await handle?.close(); }
  }
  async atomic(file, data, { signal, commit = false, maxBytes } = {}) {
    const dir = path.dirname(file); await mkdir(dir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      checkAbort(signal);
      handle = await open(temporary, 'wx');
      const encoded=json(data);
      if(maxBytes && Buffer.byteLength(encoded,'utf8')>maxBytes)throw new SceanError('STAGE_CHECKPOINT_TOO_LARGE');
      await handle.writeFile(encoded, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      if (commit) await this.inject('beforeRename', { file, data: clone(data) });
      checkAbort(signal);
      // Give a transient Windows sharing violation a bounded chance to clear.
      // Every attempt still replaces the destination atomically, or leaves it untouched.
      await this.withCanonicalFileIo(file, () => this.retrySharingViolation(
        () => { checkAbort(signal); return rename(temporary, file); },
        process.platform === 'win32' ? WINDOWS_ATOMIC_REPLACE_RETRY_MS : IO_RETRY_MS,
      ));
      await this.syncDir(dir);
      // Abort after publication cannot erase a committed round.
      if (commit) await this.inject('afterRename', { file, data: clone(data) });
    } finally {
      await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async read(runId,{includeTrashed=false}={}) {
    try {
      const file = this.currentFile(runId);
      const run = JSON.parse(await this.withCanonicalFileIo(file, () => this.retrySharingViolation(() => readFile(file, 'utf8'))));
      if (run.runId !== runId || !Number.isSafeInteger(run.version)) throw new SceanError('CORRUPT_RUN');
      runLifecycle(run);return includeTrashed?run:assertRunActive(run);
    } catch (error) { if (error.code === 'ENOENT') throw new SceanError('RUN_NOT_FOUND'); throw error; }
  }
  async listRuns({trashed=false}={}) {
    const dir = path.join(this.root, 'runs'); let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const summaries = [];
    for (const entry of entries.filter(e => e.isDirectory())) {
      try {
        const run = await this.read(entry.name,{includeTrashed:true}),life=runLifecycle(run);
        if((life.status==='trashed')!==trashed)continue;
        summaries.push({ runId: run.runId, version: run.version, head:run.head??null, lifecycleRevision:life.revision,...(life.changedAt?{lifecycleChangedAt:life.changedAt}:{}),cardId: run.snapshot.cardId, revision: run.snapshot.revision, ...(run.playerIdentity?{playerName:run.playerIdentity.name}:{}), createdAt: run.createdAt, updatedAt: run.updatedAt, turnCount: run.turns.length });
      } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(run,options={}) {
    return this.withRunLock(run.runId, async () => {
      try { await this.read(run.runId,{includeTrashed:true}); throw new SceanError('RUN_EXISTS'); }
      catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
      validateTemporalRun(run);if(run.worldRoutine)encodeRunBundle(run);
      await this.atomic(path.join(this.runDir(run.runId), 'current.json'), run, { ...options, commit: true }); return clone(run);
    },options);
  }
  async commit(runId, expectedVersion, next, options = {}) {
    if (!this.held.has(runId)) throw new SceanError('LOCK_REQUIRED');
    const prior = await this.read(runId);
    if(json(prior.recycle??null)!==json(next.recycle??null))throw new SceanError('RUN_LIFECYCLE_CHANGED');
    if (prior.version !== expectedVersion || !Number.isSafeInteger(next.version) || next.version !== expectedVersion + 1 || next.runId !== runId) throw new SceanError('VERSION_CONFLICT');
    validateTemporalRun(next);if(next.worldRoutine)encodeRunBundle(next);
    await this.atomic(path.join(this.runDir(runId), 'current.json'), next, { ...options, commit: true });
    return clone(next);
  }
  async writeAttempt(runId, attempt) {
    safeId(attempt.attemptId);
    await this.atomic(path.join(this.runDir(runId), 'attempts', `${attempt.attemptId}.json`), attempt, attempt.stageCheckpoint||attempt.bodyCheckpoint?.stageBasis?{maxBytes:16*1024*1024}:{});
  }

  async stageDispatches(runId,requestId,basis){
    safeId(runId);safeId(requestId);
    const file=path.join(this.runDir(runId),'stage-dispatches',requestId+'.json');
    try{
      const raw=await this.retrySharingViolation(()=>readFile(file,'utf8'));
      if(Buffer.byteLength(raw)>32768)throw new SceanError('STAGE_LEDGER_INVALID');
      const record=JSON.parse(raw);
      if(record.version!==1||record.basis!==basis||!record.counts||Array.isArray(record.counts)||
        typeof record.counts!=='object'||Object.keys(record.counts).length>100||
        Object.entries(record.counts).some(([k,n])=>!/^(director|character|writer|writer_repair|adjudicate)(:\d+){0,3}$/.test(k)||
          !Number.isInteger(n)||n<1||n>(k==='director'?10:2)))throw new SceanError('STAGE_LEDGER_INVALID');
      return record.counts;
    }catch(e){if(e.code==='ENOENT')return {};throw e;}
  }

  async reserveStageDispatch(runId,requestId,basis,{key,group,limit},expected){
    if(!this.held.has(runId))throw new SceanError('LOCK_REQUIRED');
    // A cancelled provider reservation can finish after its parent operation has unwound.
    // Keep that reservation and the next operation's counter update mutually exclusive.
    return this.withRunLock(runId,async()=>{
      const counts=await this.stageDispatches(runId,requestId,basis);
      if(Object.entries(expected).some(([k,n])=>(counts[k]??0)<n))throw new SceanError('STAGE_LEDGER_INVALID');
      if((counts[key]??0)>=2||(counts[group]??0)>=limit)throw new SceanError('STAGE_DISPATCH_LIMIT');
      counts[group]=(counts[group]??0)+1;
      if(key!==group)counts[key]=(counts[key]??0)+1;
      await this.atomic(path.join(this.runDir(runId),'stage-dispatches',requestId+'.json'),{version:1,basis,counts});
      return counts;
    },{namespace:'stage-dispatches'});
  }

  async readSettlementLedger(runId){
    let data;try{const bytes=await readFile(path.join(this.runDir(runId),'settlement-dispatches.json'),'utf8');if(Buffer.byteLength(bytes)>1024*1024)throw new SceanError('SETTLEMENT_LEDGER_LIMIT');data=JSON.parse(bytes);}catch(e){if(e.code==='ENOENT')return{schemaVersion:1,entries:{}};throw e;}
    if(data.schemaVersion!==1||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries)||Object.keys(data.entries).length>4096)throw new SceanError('SETTLEMENT_LEDGER_INVALID');
    for(const[k,v]of Object.entries(data.entries))if(!/^[a-f0-9]{64}$/.test(k)||!Number.isInteger(v.used)||v.used<0||v.used>2)throw new SceanError('SETTLEMENT_LEDGER_INVALID');return data;
  }
  async settlementDispatches(runId,lineage){return(await this.readSettlementLedger(runId)).entries[lineage]?.used??0;}
  async reserveSettlementDispatch(runId,lineage){
    if(!this.held.has(runId)||!/^[a-f0-9]{64}$/.test(lineage))throw new SceanError('LOCK_REQUIRED');
    const data=await this.readSettlementLedger(runId),old=data.entries[lineage]?.used??0;if(old>=2)throw new SceanError('SETTLEMENT_DISPATCH_LIMIT');
    if(!Object.hasOwn(data.entries,lineage)&&Object.keys(data.entries).length>=4096)throw new SceanError('SETTLEMENT_LEDGER_LIMIT');
    data.entries[lineage]={used:old+1};await this.atomic(path.join(this.runDir(runId),'settlement-dispatches.json'),data);return old+1;
  }

  async readAttempts(runId) {
    const dir = path.join(this.runDir(runId), 'attempts');
    let names;
    try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const attempts = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await this.retrySharingViolation(() => readFile(path.join(dir, name), 'utf8')))));
    return attempts.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.attemptId.localeCompare(b.attemptId));
  }
  // Selected checkpoint only. Reader requests never enumerate/recover audit files.
  async readAttempt(runId, attemptId) {
    safeId(runId);safeId(attemptId);let handle;
    try {
      handle=await this.retrySharingViolation(()=>open(path.join(this.runDir(runId),'attempts',`${attemptId}.json`),'r'));
      const info=await handle.stat();
      if(!info.isFile()||info.size>16*1024*1024)throw new SceanError('ATTEMPT_TOO_LARGE');
      const text=await handle.readFile('utf8');
      if(Buffer.byteLength(text,'utf8')>16*1024*1024)throw new SceanError('ATTEMPT_TOO_LARGE');
      const value=JSON.parse(text);
      if(value?.attemptId!==attemptId||value.runId!==runId)throw new SceanError('ATTEMPT_IDENTITY_MISMATCH');
      return value;
    }catch(error){
      if(error.code==='ENOENT')throw new SceanError('ATTEMPT_NOT_FOUND');
      if(error instanceof SyntaxError)throw new SceanError('ATTEMPT_CORRUPT');
      throw error;
    }finally{await handle?.close();}
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
  async withRunLock(runId, fn, { signal, namespace } = {}) {
    if(namespace!==undefined&&!['prose-style','writing-mode','writing-styles','agent-models','agent-model-defaults','model-route-pins','world-feed','player-notes','stage-dispatches'].includes(namespace))throw new SceanError('LOCK_NAMESPACE');
    const lockKey=namespace?namespace+':'+runId:runId;
    const dir = ['writing-styles','agent-model-defaults'].includes(namespace)?path.join(this.root,'settings-locks',namespace):path.join(this.runDir(runId), namespace?namespace+'-tickets':'writer-tickets'); await mkdir(dir, { recursive: true }); checkAbort(signal);
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
      this.held.add(lockKey); checkAbort(signal); return await fn();
    } finally {
      if (acquired) this.held.delete(lockKey);
      await this.atomic(phaseFile('x'), { ...owner, phase: 'released' });
      await this.clearTicketFiles(dir, token);
    }
  }
}
export default DurableStore;
