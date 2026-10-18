// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from the user ZEOLAS 0.8 archive; origin qualifications and retained license in licenses/zeolas*.
// User reports local authorship; official Aventuras authorship of these functions is not established.
import { createHash } from 'node:crypto';
import { eligibleMemory, publicData, ownerData } from './memory-policy.mjs';

export function normalized(value        )         {
  return value.normalize('NFKC').toLocaleLowerCase()
}
export function tokenizeForSparseRecall(value        )           {
  const text = normalized(value)
  const tokens           = []
  for (const match of text.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}_]+/gu,
  )) {
    const term = match[0]
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(term)) {
      const characters = Array.from(term)
      tokens.push(...characters)
      for (let index = 0; index < characters.length - 1; index++) {
        tokens.push(characters[index] + characters[index + 1])
      }
    } else {
      tokens.push(term)
    }
  }
  return tokens
}
export function bm25(input                         , chunks               )                {
    if (chunks.length === 0) return []
    const queryTokens = tokenizeForSparseRecall(input.query)
    const documents = chunks.map((chunk) => tokenizeForSparseRecall(chunk.text))
    const averageLength =
      documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1
    const documentFrequency = new Map                ()
    for (const document of documents) {
      for (const term of new Set(document)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
      }
    }

    const normalizedQuery = normalized(input.query)
    const referencedEntityIds = new Set        ()
    for (const entity of [
      ...input.characters,
      ...input.locations,
      ...input.items,
      ...input.storyBeats.map((beat) => ({ id: beat.id, name: beat.title })),
    ]) {
      if (entity.name && normalizedQuery.includes(normalized(entity.name))) {
        referencedEntityIds.add(entity.id)
      }
    }

    return chunks
      .map((chunk, index)              => {
        const document = documents[index]
        const frequencies = new Map                ()
        for (const term of document) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
        let bm25Score = 0
        for (const term of queryTokens) {
          const frequency = frequencies.get(term) ?? 0
          if (frequency === 0) continue
          const containing = documentFrequency.get(term) ?? 0
          const inverseFrequency = Math.log(
            1 + (chunks.length - containing + 0.5) / (containing + 0.5),
          )
          const k1 = 1.2
          const b = 0.75
          bm25Score +=
            inverseFrequency *
            ((frequency * (k1 + 1)) /
              (frequency + k1 * (1 - b + b * (document.length / averageLength))))
        }

        const exactKeyword = chunk.keywords.some((keyword) => {
          const value = normalized(keyword)
          return value.length >= 2 && normalizedQuery.includes(value)
        })
        const structuredMatch = [
          ...chunk.characterIds,
          ...chunk.locationIds,
          ...chunk.itemIds,
          ...chunk.storyBeatIds,
        ].some((id) => referencedEntityIds.has(id))
        const activeThreadBoost = chunk.storyBeatIds.some((id) =>
          input.storyBeats.some(
            (beat) => beat.id === id && (beat.status === 'active' || beat.status === 'pending'),
          ),
        )
        const score =
          bm25Score +
          (exactKeyword ? 2.5 : 0) +
          (structuredMatch ? 3.5 : 0) +
          (activeThreadBoost ? 0.5 : 0)
        return {
          chunk,
          score,
          bm25Score,
          reason: structuredMatch ? 'structured' : exactKeyword ? 'exact' : 'bm25',
        }
      })
      .sort(
        (left, right) =>
          right.score - left.score || right.chunk.endPosition - left.chunk.endPosition,
      )
  }
export function fuseRanks(input, sparse, dense, poolChunks = [], includeSticky = false) {
    const fusePool = (
      sparse               ,
      dense               ,
      poolChunks               ,
      includeSticky         ,
    )                => {
      const fused = new Map                     ()
      const addRank = (items               , kind                    ) => {
        items.forEach((item, index) => {
          const existing = fused.get(item.chunk.id)
          const rrf = 1 / (60 + index + 1)
          if (existing) {
            existing.rrfScore = (existing.rrfScore ?? 0) + rrf
            if (kind === 'dense') existing.denseScore = item.denseScore
            existing.reason = 'hybrid'
          } else {
            fused.set(item.chunk.id, { ...item, rrfScore: rrf })
          }
        })
      }
      addRank(
        sparse
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, 40),
        'sparse',
      )
      addRank(dense.slice(0, 40), 'dense')
      if (includeSticky) {
        for (const chunk of poolChunks) {
          const stickyBonus = input.stickyLorebookBonuses?.[chunk.sourceId] ?? 0
          if (stickyBonus <= 0) continue
          const existing = fused.get(chunk.id)
          if (existing) {
            existing.stickyBonus = stickyBonus
          } else {
            fused.set(chunk.id, {
              chunk,
              score: stickyBonus * 0.5,
              bm25Score: 0,
              rrfScore: stickyBonus / 100,
              stickyBonus,
              reason: 'hybrid',
            })
          }
        }
      }
      return [...fused.values()]
        .sort(
          (left, right) =>
            (right.rrfScore ?? 0) +
              (right.stickyBonus ?? 0) / 100 -
              ((left.rrfScore ?? 0) + (left.stickyBonus ?? 0) / 100) ||
            right.score - left.score ||
            right.chunk.updatedAt - left.chunk.updatedAt,
        )
        .filter((item, index, all) => {
          const priorFromSource = all
            .slice(0, index)
            .filter((candidate) => candidate.chunk.sourceId === item.chunk.sourceId).length
          return priorFromSource < (includeSticky ? 1 : 2)
        })
        .slice(0, 32)
    }
return fusePool(sparse,dense,poolChunks,includeSticky);
}

// SCEAN adapter: all authority comes from the supplied committed snapshot.
const stable = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const abortCheck = signal => { if (signal?.aborted) throw Object.assign(fail('MEMORY_CANCELLED'), { name: 'AbortError' }); };

export function validateVector(vector, dimensions) {
  if (!Array.isArray(vector) || !vector.length || vector.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw fail('MEMORY_VECTOR_INVALID');
  if (dimensions !== undefined && vector.length !== dimensions) throw fail('MEMORY_VECTOR_DIMENSION');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw fail('MEMORY_VECTOR_ZERO_OR_OVERFLOW');
  return vector;
}

export function cosineSimilarity(left, right) {
  validateVector(left); validateVector(right, left.length);
  const a = Math.hypot(...left), b = Math.hypot(...right);
  return left.reduce((score, value, index) => score + (value / a) * (right[index] / b), 0);
}

function scopedRecords(records, { runId, characterId, audience = 'public' }) {
  if (!Array.isArray(records)) throw fail('MEMORY_RECORDS_INVALID');
  const result = [], ids = new Set(), runs = new Set();
  for (const item of records) {
    // Exclude unauthorized records before validation, embedding, DF calculation or ranking.
    if (!eligibleMemory(item, { runId, characterId, audience })) continue;
    const record = audience === 'owner' && item.access?.kind !== 'world_public' ? ownerData(item, characterId) : publicData(item);
    if (!record) continue;
    if (typeof record.id !== 'string' || !record.id || typeof record.text !== 'string' || !record.text.trim() ||
        !Number.isInteger(record.version) || record.version < 1 || !Array.isArray(record.characterIds) ||
        record.characterIds.some(id => typeof id !== 'string' || !id) ||
        (record.visibility === 'characters' && !record.characterIds.length) ||
        !record.source || typeof record.source.runId !== 'string' || !record.source.runId ||
        !Number.isInteger(record.source.turn) || record.source.turn < 0 ||
        typeof record.source.commitId !== 'string' || !record.source.commitId ||
        typeof record.source.bodyHash !== 'string' || !record.source.bodyHash) throw fail('MEMORY_RECORD_INVALID');
    if (ids.has(record.id)) throw fail('MEMORY_DUPLICATE_ID');
    ids.add(record.id); runs.add(record.source.runId);
    result.push(record);
  }
  if (runId === undefined && runs.size > 1) throw fail('MEMORY_RUN_SCOPE_REQUIRED');
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function portCall(call, { signal, timeoutMs }) {
  abortCheck(signal);
  const controller = new AbortController();
  let timer, onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(Object.assign(fail('MEMORY_CANCELLED'), { name: 'AbortError' })); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(fail('MEMORY_PORT_TIMEOUT')); }, timeoutMs);
  });
  try {
    const response = await Promise.race([Promise.resolve().then(() => call(controller.signal)), interrupted]);
    abortCheck(signal);
    return response;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

/** Rebuildable derived cache only. This class has no database or canonical write port. */
export class Memory {
  #cache = new Map();
  #epoch = 0;
  constructor({ embed, rerank, embeddingModel = 'injected-provider', dimensions, topK = 8,
    embeddingTimeoutMs = 60000, rerankTimeoutMs = 15000, maxCacheEntries = 2048 } = {}) {
    if (!Number.isInteger(topK) || topK < 1 || topK > 32 ||
        (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions < 1)) ||
        !Number.isInteger(maxCacheEntries) || maxCacheEntries < 1 ||
        !Number.isFinite(embeddingTimeoutMs) || embeddingTimeoutMs <= 0 ||
        !Number.isFinite(rerankTimeoutMs) || rerankTimeoutMs <= 0) throw fail('MEMORY_CONFIG_INVALID');
    this.embed = embed; this.rerank = rerank; this.embeddingModel = embeddingModel;
    this.dimensions = dimensions; this.topK = topK; this.maxCacheEntries = maxCacheEntries;
    this.embeddingTimeoutMs = embeddingTimeoutMs; this.rerankTimeoutMs = rerankTimeoutMs;
  }
  clearCache() { this.#epoch++; this.#cache.clear(); }
  get cacheSize() { return this.#cache.size; }
  #key(record) { return digest({ model: this.embeddingModel, dimensions: this.dimensions ?? null, record }); }
  async #vectors(texts, kind, signal) {
    const call = typeof this.embed === 'function' ? this.embed : this.embed?.embed?.bind(this.embed);
    if (!call) throw fail('MEMORY_EMBED_PORT_INVALID');
    const response = await portCall(portSignal => call({ texts, kind, signal: portSignal, model: this.embeddingModel }),
      { signal, timeoutMs: this.embeddingTimeoutMs });
    const vectors = Array.isArray(response) ? response : response?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw fail('MEMORY_VECTOR_COUNT');
    const dimensions = this.dimensions ?? vectors[0]?.length;
    return vectors.map(vector => [...validateVector(vector, dimensions)]);
  }
  async #index(records, signal) {
    const epoch = this.#epoch, pending = new Map(), keys = records.map(record => this.#key(record));
    const missing = records.filter((_record, i) => !this.#cache.has(keys[i]));
    for (let index = 0; index < missing.length; index += 8) {
      const batch = missing.slice(index, index + 8);
      const vectors = await this.#vectors(batch.map(record => record.text), 'document', signal);
      vectors.forEach((vector, i) => pending.set(this.#key(batch[i]), vector));
    }
    abortCheck(signal);
    const vectors = keys.map(key => pending.get(key) ?? this.#cache.get(key));
    const dimensions = this.dimensions ?? vectors[0]?.length;
    vectors.forEach(vector => validateVector(vector, dimensions));
    // A cancelled/failed batch never publishes a partially built index.
    if (epoch === this.#epoch) {
      for (const [key, vector] of pending) this.#cache.set(key, vector);
      while (this.#cache.size > this.maxCacheEntries) this.#cache.delete(this.#cache.keys().next().value);
    }
    return vectors;
  }
  async prepare({ records, runId, characterId, audience = 'public', signal } = {}) {
    abortCheck(signal);
    const eligible = scopedRecords(records, { runId, characterId, audience });
    if (!this.embed || !eligible.length) return { status: this.embed ? 'empty' : 'disabled', count: eligible.length };
    await this.#index(eligible, signal);
    return { status: 'ready', count: eligible.length, model: this.embeddingModel };
  }
  async rebuild(options) { this.clearCache(); return this.prepare(options); }
  exportIndex() {
    const data = { schemaVersion: 1, model: this.embeddingModel, dimensions: this.dimensions ?? null,
      vectors: [...this.#cache].map(([key, vector]) => [key, [...vector]]) };
    return { ...data, digest: digest(data) };
  }
  restoreIndex(index) {
    const { digest: expected, ...data } = structuredClone(index ?? {});
    if (data.schemaVersion !== 1 || data.model !== this.embeddingModel || data.dimensions !== (this.dimensions ?? null) ||
        !Array.isArray(data.vectors) || data.vectors.length > this.maxCacheEntries || digest(data) !== expected) throw fail('MEMORY_INDEX_INVALID');
    const replacement = new Map();
    let dimensions = this.dimensions;
    for (const entry of data.vectors) {
      if (!Array.isArray(entry) || entry.length !== 2 || !/^[a-f0-9]{64}$/.test(entry[0]) || replacement.has(entry[0])) throw fail('MEMORY_INDEX_INVALID');
      validateVector(entry[1], dimensions); dimensions ??= entry[1].length;
      replacement.set(entry[0], [...entry[1]]);
    }
    this.#epoch++; this.#cache = replacement;
    return { status: 'ready', count: replacement.size };
  }
  async retrieve({ query, records, runId, characterId, audience = 'public', signal } = {}) {
    abortCheck(signal);
    if (typeof query !== 'string') throw fail('MEMORY_QUERY_INVALID');
    const eligible = scopedRecords(records, { runId, characterId, audience });
    const diagnostics = { eligibleCount: eligible.length, embedding: this.embed ? 'pending' : 'disabled',
      rerank: 'disabled', embeddingModel: this.embeddingModel, cacheHits: 0, failures: [] };
    const scope = { runId: runId ?? eligible[0]?.source.runId ?? null, characterId: characterId ?? null, audience };
    const chunks = eligible.map(record => ({ id: record.id, sourceId: record.id, text: record.text,
      keywords: [], characterIds: [], locationIds: [], itemIds: [], storyBeatIds: [],
      endPosition: record.source.turn, updatedAt: record.source.turn, record }));
    const sparse = bm25({ query, characters: [], locations: [], items: [], storyBeats: [] }, chunks);
    let dense = [];
    if (this.embed && eligible.length) {
      try {
        diagnostics.cacheHits = eligible.filter(record => this.#cache.has(this.#key(record))).length;
        const vectors = await this.#index(eligible, signal);
        const [queryVector] = await this.#vectors([query], 'query', signal);
        dense = chunks.map((chunk, index) => {
          const score = cosineSimilarity(queryVector, vectors[index]);
          return { chunk, score, denseScore: score, bm25Score: 0, reason: 'dense' };
        }).sort((a, b) => b.score - a.score);
        diagnostics.embedding = 'ready'; diagnostics.dimensions = queryVector.length;
      } catch (error) {
        abortCheck(signal);
        diagnostics.embedding = 'failed';
        // Provider text can contain credentials; diagnostics deliberately keep fixed machine codes only.
        diagnostics.failures.push(error.code?.startsWith('MEMORY_') ? error.code : 'MEMORY_EMBED_FAILED');
      }
    } else if (this.embed) diagnostics.embedding = 'empty';
    let ranked = fuseRanks({}, sparse, dense);
    if (this.rerank && ranked.length > 1) {
      try {
        const candidates = ranked.slice(0, this.topK);
        const response = await portCall(portSignal => this.rerank({ query,
          candidates: candidates.map(({ chunk }, index) => ({ index, ...structuredClone(chunk.record) })), signal: portSignal }),
        { signal, timeoutMs: this.rerankTimeoutMs });
        const rankings = Array.isArray(response) ? response : response?.rankings;
        if (!Array.isArray(rankings) || !rankings.length) throw fail('MEMORY_RERANK_INVALID');
        const scores = new Map();
        for (const item of rankings) {
          if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= candidates.length ||
              typeof item.score !== 'number' || !Number.isFinite(item.score) || scores.has(item.index)) throw fail('MEMORY_RERANK_INVALID');
          scores.set(item.index, item.score);
        }
        ranked = ranked.map((item, index) => ({ ...item, rerankScore: scores.get(index) })).sort((a, b) =>
          (b.rerankScore ?? -Infinity) - (a.rerankScore ?? -Infinity) || b.rrfScore - a.rrfScore);
        diagnostics.rerank = 'used';
      } catch (error) {
        abortCheck(signal);
        if (error.name === 'AbortError' && signal?.aborted) throw error;
        diagnostics.rerank = 'failed';
        diagnostics.failures.push(error.code?.startsWith('MEMORY_') ? error.code : 'MEMORY_RERANK_FAILED');
      }
    }
    abortCheck(signal);
    return { schemaVersion: 1, status: !eligible.length ? 'empty' :
      (diagnostics.embedding !== 'ready' || diagnostics.rerank === 'failed' ? 'degraded' : 'ready'),
      algorithm: 'zeolas-0.8-bm25-rrf', scope,
      records: ranked.slice(0, this.topK).map(item => ({ ...structuredClone(item.chunk.record),
        sourceHash: digest(item.chunk.record), scores: { bm25: item.bm25Score, dense: item.denseScore ?? null,
          rrf: item.rrfScore, rerank: item.rerankScore ?? null } })), diagnostics };
  }
}
