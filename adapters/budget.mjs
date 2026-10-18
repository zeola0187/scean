import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const safeKeys = ['provider', 'model', 'stage', 'inputBytes', 'maxTokens', 'runId', 'attemptId', 'requestId'];

// Usage only: reserve/settle mean request start/end, never monetary reservation.
// Legacy budget journals cannot be appended to; all historical evidence stays intact.
export class UsageLedger {
  constructor(filePath) { this.path = resolve(filePath); }
  async transaction(fn) {
    await mkdir(dirname(this.path), { recursive: true });
    let lock;
    try { lock = await open(this.path + '.lock', 'wx'); } catch { throw fail('USAGE_LEDGER_LOCKED'); }
    try {
      const rows = await this.read();
      if (rows.length && (rows[0].type !== 'usage-journal' || rows[0].schemaVersion !== 2)) throw fail('HISTORICAL_LEDGER_READ_ONLY');
      const append = async data => {
        const row = { seq: rows.length, previous: rows.at(-1)?.hash ?? null, time: new Date().toISOString(), ...data };
        row.hash = hash(row);
        const file = await open(this.path, 'a');
        try { await file.writeFile(JSON.stringify(row) + '\n'); await file.sync(); } finally { await file.close(); }
        rows.push(row);
      };
      if (!rows.length) await append({ type: 'usage-journal', schemaVersion: 2, monetaryEnforcement: false });
      return await fn(rows, append);
    } finally { await lock.close(); await unlink(this.path + '.lock'); }
  }
  async read() {
    let raw;
    try { raw = await readFile(this.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    if (raw && !raw.endsWith('\n')) throw fail('USAGE_LEDGER_CORRUPT');
    let rows;
    try { rows = raw.trim() ? raw.trimEnd().split('\n').map(JSON.parse) : []; } catch { throw fail('USAGE_LEDGER_CORRUPT'); }
    rows.forEach((row, seq) => { const { hash: digest, ...data } = row; if (row.seq !== seq || row.previous !== (rows[seq - 1]?.hash ?? null) || digest !== hash(data)) throw fail('USAGE_LEDGER_CORRUPT'); });
    return rows;
  }
  summarize(rows) {
    const starts = rows.filter(x => x.type === 'reserve');
    const ends = new Map(rows.filter(x => x.type === 'settle').map(x => [x.id, x]));
    const known = [...ends.values()].filter(x => x.actualCostUsd !== null);
    return { monetaryEnforcement: false, generationRequests: starts.filter(x => x.kind === 'generation').length,
      embeddingRequests: starts.filter(x => x.kind === 'embedding').length,
      knownActualCostUsd: known.reduce((sum, r) => sum + r.actualCostUsd, 0),
      actualCostStatus: starts.some(r => ends.get(r.id)?.actualCostUsd == null) ? 'unknown_or_partial' : 'reported',
      unknownCostRequests: starts.filter(r => ends.get(r.id)?.actualCostUsd == null).length,
      unresolved: starts.filter(r => !ends.has(r.id)).length, reservations: starts.length };
  }
  async summary() { return this.transaction(rows => this.summarize(rows)); }
  async reserve({ kind = 'generation', caseId, requestId = randomUUID(), retry = 0, meta = {} }) {
    if (!['generation', 'embedding'].includes(kind) || !caseId || !Number.isInteger(retry) || retry < 0 || retry > 2) throw fail('INVALID_USAGE_REQUEST');
    return this.transaction(async (rows, append) => {
      if (rows.some(x => x.type === 'reserve' && x.requestId === requestId)) throw fail('REQUEST_ALREADY_RECORDED');
      if (retry && rows.filter(x => x.type === 'reserve' && x.caseId === caseId && x.retry > 0).length >= 2) throw fail('CASE_TECHNICAL_RETRIES_EXHAUSTED');
      const id = randomUUID();
      const safeMeta = Object.fromEntries(safeKeys.filter(k => typeof meta[k] === 'string' || Number.isFinite(meta[k])).map(k => [k, typeof meta[k] === 'string' ? meta[k].slice(0, 160) : meta[k]]));
      await append({ type: 'reserve', id, kind, caseId, requestId, retry, meta: safeMeta }); return id;
    });
  }
  async settle(id, { actualCostUsd = null, usage = null, status = 'unknown' } = {}) {
    if (actualCostUsd !== null && (!Number.isFinite(actualCostUsd) || actualCostUsd < 0)) throw fail('INVALID_REPORTED_COST');
    return this.transaction(async (rows, append) => {
      if (!rows.some(x => x.type === 'reserve' && x.id === id)) throw fail('UNKNOWN_USAGE_REQUEST');
      if (rows.some(x => x.type === 'settle' && x.id === id)) throw fail('ALREADY_SETTLED');
      const safeUsage = usage && Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheReadInputTokens', 'cacheWriteInputTokens'].filter(k => Number.isFinite(usage[k]) && usage[k] >= 0).map(k => [k, usage[k]]));
      await append({ type: 'settle', id, actualCostUsd, usage: safeUsage, status: String(status).slice(0, 80) });
      return this.summarize(rows);
    });
  }
}
export { UsageLedger as BudgetLedger };
