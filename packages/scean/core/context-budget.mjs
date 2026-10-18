import { SceanError, clone } from './contracts.mjs';

// Capacity accounting is deliberately independent of billing and UsageLedger.
// Unknown capacity stays unknown. Estimates are diagnostics, never a quota.
export const DEFAULT_CONTEXT_WINDOW = null;
export const CONTEXT_ESTIMATE_METHOD = 'unicode-script-v1: Latin runs ceil(chars/3), CJK 2/codepoint, other Unicode 3/codepoint, punctuation 1, whitespace ceil(chars/3); estimate, not tokenizer';
const outputs = { director: 4096, character: 4096, adjudicate: 4096, draft: 4096, prose: 8192, prose_repair: 4096, post_stat: 4096 };
export const defaultOutputReserve = stage => outputs[stage] ?? 4096;

/** A reproducible multilingual heuristic, not a provider token count or bound. */
export function estimateContextTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let tokens = 0;
  const chunks = text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/gu) ?? [];
  for (const chunk of chunks) {
    if (/^[A-Za-z0-9_\s]+$/.test(chunk)) tokens += Math.ceil(chunk.length / 3);
    else if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(chunk)) tokens += 2;
    else tokens += chunk.codePointAt(0) > 127 ? 3 : 1;
  }
  return tokens;
}

const topFields = {
  chapter_rerank: ['query', 'candidates', 'instructions'],
  chapter_analysis: ['range', 'turns', 'instructions'],
  chapter_summary: ['detail', 'range', 'turns', 'previousChapters', 'instructions'],
  summary: ['previousSummary', 'turns', 'sourceRange', 'instructions'],
  director: ['assembly', 'conversation'],
  character: ['character', 'question', 'publicWorld', 'ownState', 'memory', 'playerInput', 'currentEvent', 'lastCommittedTurn', 'characterIdentities', 'worldbook'],
  adjudicate: ['mode', 'action', 'state', 'worldbook', 'playerInput', 'recentDialogue', 'characterIdentities', 'stateBlueprint'],
  draft: ['context', 'directorBrief'],
  prose: ['draft', 'playerInput', 'preset', 'characterIdentities'],
  prose_repair: ['bodyHash', 'ranges', 'bannedTerms'],
  post_stat: ['finalBody', 'previousState', 'characters', 'stateBlueprint', 'outputContract'],
};
for(const stage of ['director','character','adjudicate','draft','prose','prose_repair','post_stat'])topFields[stage].push('playerIdentity');
const assemblyFields = new Set(['playerInput', 'writingGuidance', 'sources', 'chapterSummary', 'rollingSummary', 'chapterContext', 'recentDialogue', 'worldState', 'memory', 'characters', 'characterIdentities', 'stateBlueprint', 'derivedFacts']);
const sourceFields = new Set(['snapshot', 'card', 'worldbook', 'preset', 'selectedOpening']);
const escapePath = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = path => '/' + path.map(escapePath).join('/');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
const nonnegative = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Budget an already audience-authorized packet. The engine owns public/owner ACL
 * projection before this function. Unknown stage fields are excluded so raw
 * assembly containers cannot be smuggled into Prose/PostStat by a new caller.
 */
export function budgetStage(stage, prompt, options = {}) {
  if (!topFields[stage] || !object(prompt) || typeof prompt.system !== 'string' || !object(prompt.input)) throw new SceanError('INVALID_CONTEXT_PACKET');
  if(prompt.input.playerIdentity!==undefined){const p=prompt.input.playerIdentity;if(!object(p)||Object.keys(p).length!==4||p.actorId!=='player'||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!Number.isSafeInteger(p.boundVersion)||p.boundVersion<0||p.meaning!=='Display name of reserved actor player; never an NPC ID, state key or memory knower.')throw new SceanError('INVALID_PLAYER_IDENTITY');}
  const original = clone(prompt);
  const candidates = [];
  const metadata = options.sourceMetadata ?? {};
  const owner = stage === 'character' ? prompt.input.character?.id : null;
  const boundary = (path, value, reason) => {
    candidates.push({ sourceID: `stage:${stage}:${pointer(path)}`, path: pointer(path), priority: 0, visibility: 'restricted', estimate: estimateContextTokens(value), mandatory: false, included: false, reason });
  };
  function sanitize(value, path) {
    if (Array.isArray(value)) return value.map((v, i) => sanitize(v, [...path, i]));
    if (!object(value)) return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      const inCard = path.includes('card');
      const allowed = path.length === 1 && path[0] === 'input' ? topFields[stage].includes(key)
        : path.length === 2 && ['assembly', 'context'].includes(path[1]) ? assemblyFields.has(key)
        : path.at(-1) === 'sources' ? sourceFields.has(key)
        : true;
      if (!allowed) boundary(next, child, 'stage_boundary');
      else if (inCard && ['character_book', 'worldbook', 'worldbooks'].includes(key)) boundary(next, child, 'embedded_book_requires_selection');
      else out[key] = sanitize(child, next);
    }
    return out;
  }
  const sanitized = { system: original.system, input: sanitize(original.input, ['input']) };
  function record(value, path, { mandatory = true, priority = 1000, visibility = 'public' } = {}) {
    const p = pointer(path), supplied = metadata[p] ?? {};
    const sourceID = typeof supplied.sourceID === 'string' ? supplied.sourceID
      : typeof value?.ref === 'string' ? value.ref
      : typeof value?.id === 'string' ? `stage:${stage}:${p}:${value.id}` : `stage:${stage}:${p}`;
    const candidate = { sourceID, path: p, priority: mandatory ? 1000 : (Number.isFinite(supplied.priority) ? supplied.priority : priority), visibility: supplied.visibility ?? visibility,
      estimate: estimateContextTokens(value), mandatory, included: true, reason: mandatory ? 'required_core' : 'within_capacity' };
    candidates.push(candidate);
  }
  function visit(value, path) {
    const key = path.at(-1);
    const visibility = owner && (path.includes('character') || path.includes('ownState') || path.includes('memory')) ? `character:${owner}` : 'public';
    if (key === 'chapterSummary' || key === 'rollingSummary') return record(value, path, { mandatory: key === 'rollingSummary' && options.requireNarrativeCoverage === true, priority: 80, visibility });
    if (Array.isArray(value) && ['recentDialogue', 'memory', 'records', 'worldbook', 'entries'].includes(key)) {
      if (!value.length) return record(value, path, { visibility });
      value.forEach((item, i) => {
        const isHistory = key === 'recentDialogue';
        const isBook = key === 'worldbook' || key === 'entries';
        const bookPriority = Number.isFinite(item?.priority) ? item.priority : 0;
        const committed = options.committedRecentIds === undefined || options.committedRecentIds.includes(item?.commitId);
        record(item, [...path, i], { mandatory: isHistory && committed && options.requireNarrativeCoverage === true, priority: isHistory ? 40 + i / Math.max(value.length, 1) : isBook ? 20 + Math.max(-10, Math.min(10, bookPriority / 100)) : 60 - i / Math.max(value.length, 1), visibility });
      });
      return;
    }
    if (object(value) && ['input', 'assembly', 'context', 'sources', 'worldbook', 'memory'].includes(key)) {
      if (!Object.keys(value).length) return record(value, path, { visibility });
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k]);
      return;
    }
    // Owner character/relationships and own authoritative state are indivisible.
    record(value, path, { visibility });
  }
  record(sanitized.system, ['system'], { visibility: 'system' });
  visit(sanitized.input, ['input']);
  const contextWindow = positive(options.contextWindow, 0);
  const outputReserve = positive(options.outputReserve, defaultOutputReserve(stage));
  const overheadReserve = nonnegative(options.overheadReserve, 0);
  const estimatedTools = options.tools?.length ? estimateContextTokens(options.tools) : 0;
  const toolReserve = Math.max(nonnegative(options.toolReserve, estimatedTools), estimatedTools);
  const inputCapacity = contextWindow || null;
  const size = packet => estimateContextTokens(packet.system) + estimateContextTokens(packet.input);
  const candidateEstimate = size(sanitized);
  const requiredEstimate = candidateEstimate;
  const diagnostics = { schemaVersion: 1, stage, status: 'ready', estimateMethod: CONTEXT_ESTIMATE_METHOD, estimateOnly: true,
    contextWindow, capacitySource: contextWindow ? 'model_capability' : 'unknown',
    outputReserve, toolReserve, overheadReserve, inputCapacity, candidateEstimate, requiredEstimate, includedEstimate: candidateEstimate,
    actualUsage: null, sources: candidates };
  diagnostics.policy = 'complete_authorized_packet_no_token_quota';
  diagnostics.estimatedOverflow = contextWindow > 0 && candidateEstimate + toolReserve > contextWindow;
  diagnostics.reason = diagnostics.estimatedOverflow ? 'estimate_only_provider_enforces_actual_limit' : 'no_platform_token_quota';
  // Keep a data/transport safety bound, independent of tokens or model capacity.
  if (Buffer.byteLength(JSON.stringify(sanitized)) > 16 * 1024 * 1024) throw Object.assign(new SceanError('CONTEXT_PACKET_TOO_LARGE'), { diagnostics });
  return { prompt: sanitized, diagnostics };
}
