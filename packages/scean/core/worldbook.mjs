import {resolvePlayerText,projectTemplateText} from './player-text.mjs';
import { clone, hash, SceanError } from './contracts.mjs';
import { publicData } from './memory-policy.mjs';

// A literal, bounded selector. No authored regular expression or script executes.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const strings = value => Array.isArray(value) ? value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean) : [];
const word = char => char !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(char);
const regexLike = key => /^\/[\s\S]*\/[a-z]*$/i.test(key);
const privateContainer = value => object(value) && (value.visibility === 'restricted' || value.visibility === 'private' || value.visibility === 'characters' || Object.hasOwn(value, 'contextScope') || ['private', 'known_event'].includes(value.access?.kind) || value.scope?.kind === 'player_only' || value.role === 'player_history');
function project(value) {
  if (privateContainer(value)) return undefined;
  if (Array.isArray(value)) return value.map(project).filter(v => v !== undefined);
  if (!object(value)) return value;
  const safe = publicData(value);
  if (safe === undefined) return undefined;
  return Object.fromEntries(Object.entries(safe).map(([key, child]) => [key, project(child)]).filter(([, child]) => child !== undefined));
}

function literal(text, key, { caseSensitive, matchWholeWords }) {
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? key : key.toLowerCase();
  if (!needle) return false;
  const bounded = matchWholeWords || /^\p{Script=Han}$/u.test(needle);
  let offset = 0;
  while (offset <= source.length) {
    const found = source.indexOf(needle, offset);
    if (found < 0) return false;
    // Unicode code points, not JS \b (which treats Han as punctuation).
    const before = [...source.slice(Math.max(0, found - 2), found)].at(-1);
    const after = [...source.slice(found + needle.length, found + needle.length + 2)][0];
    if (!bounded || (!word(before) && !word(after))) return true;
    offset = found + Math.max(1, needle.length);
  }
  return false;
}

function messages(recentDialogue) {
  const result = [];
  let inferredTurn = 0;
  for (const [index, raw] of (Array.isArray(recentDialogue) ? recentDialogue : []).entries()) {
    const row = project(raw);
    if (row === undefined) continue;
    if (typeof row === 'string') { result.push({ source: `history:${index}`, role: 'assistant', turn: `implicit:${inferredTurn}`, playerTurnIndex: inferredTurn, text: row }); continue; }
    if (!object(row) || row.status && row.status !== 'committed') continue;
    if (typeof row.input === 'string' || typeof row.body === 'string') {
      inferredTurn++;
      const turn = row.turn ?? `implicit:${inferredTurn}`;
      if (typeof row.input === 'string') result.push({ source: `history:${index}:input`, role: 'user', turn, playerTurnIndex: inferredTurn, text: row.input });
      if (typeof row.body === 'string') result.push({ source: `history:${index}:body`, role: 'assistant', turn, playerTurnIndex: inferredTurn, text: row.body });
    } else if (['user', 'assistant'].includes(row.role)) {
      if (row.role === 'user' || row.turn !== undefined && result.at(-1)?.turn !== row.turn) inferredTurn++;
      const text = row.content ?? row.text;
      if (typeof text === 'string') result.push({ source: `history:${index}`, role: row.role, turn: row.turn ?? `implicit:${inferredTurn}`, playerTurnIndex: inferredTurn, text });
    }
  }
  return result;
}

function scan(history, playerInput, window) {
  let chosen;
  if (window.unit === 'messages') chosen = window.count === 0 ? [] : history.slice(-window.count);
  else {
    const turns = [...new Set(history.map(row => row.playerTurnIndex))];
    const allowed = new Set(window.count === 0 ? [] : turns.slice(-window.count));
    chosen = history.filter(row => allowed.has(row.playerTurnIndex));
  }
  return [...chosen, { source: 'playerInput', role: 'user', turn: 'current', text: playerInput }];
}

function unwrap(value) {
  if (!object(value)) return value;
  if (value.spec === 'lorebook_v3') return value.data;
  if (value.card?.data?.character_book) return value.card.data.character_book;
  if (value.data?.character_book) return value.data.character_book;
  if (value.book) return unwrap(value.book);
  return value;
}

/** Remove raw books from every recognized source wrapper before model assembly. */
export function stripWorldbookContainers(value, { preservePrivate = false } = {}) {
  // CR's caller has already applied owner authorization; do not public-project
  // that packet merely to remove embedded books.
  const safe = preservePrivate ? clone(value) : project(value);
  function strip(item) {
    if (Array.isArray(item)) return item.map(strip).filter(v => v !== undefined);
    if (!object(item)) return item;
    const rows = Array.isArray(item.entries) ? item.entries : object(item.entries) ? Object.values(item.entries) : [];
    const bookShape = rows.length > 0 && rows.every(row => object(row) && typeof row.content === 'string' && (Array.isArray(row.keys) || Array.isArray(row.key)));
    if (item.spec === 'lorebook_v3' || bookShape) return undefined;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !['character_book', 'worldbook', 'worldbooks'].includes(key)).map(([key, child]) => [key, strip(child)]).filter(([, child]) => child !== undefined));
  }
  return strip(safe);
}

function bookCandidates(snapshot) {
  const result = [];
  const embedded = snapshot.card?.data?.character_book;
  if (embedded !== undefined) result.push({ raw: embedded, path: 'card.data.character_book', source: snapshot.source?.card ?? { id: snapshot.cardId ?? 'card', revision: snapshot.revision ?? null }, parent: snapshot.card });
  const raw = snapshot.worldbooks ?? snapshot.worldbook;
  const values = Array.isArray(raw) ? raw : raw?.books && Array.isArray(raw.books) ? raw.books : [raw];
  for (const [index, value] of values.entries()) if (value !== undefined && value !== null) {
    result.push({ raw: value, path: values.length === 1 ? 'worldbook' : `worldbooks:${index}`, source: value?.source ?? (values.length === 1 ? snapshot.source?.worldbook : null) ?? { id: value?.sourceId ?? value?.id ?? `worldbook:${index}`, revision: value?.revision ?? null }, parent: value });
  }
  return result;
}

const entryFields = new Set(['id', 'uid', 'name', 'comment', 'content', 'keys', 'key', 'secondary_keys', 'keysecondary', 'enabled', 'disable', 'constant', 'selective', 'selectiveLogic', 'selective_logic', 'insertion_order', 'order', 'priority', 'displayIndex', 'position', 'case_sensitive', 'caseSensitive', 'match_whole_words', 'matchWholeWords', 'use_regex', 'useRegex', 'extensions', 'visibility', 'access', 'scope', 'contextScope']);
const extensionFields = new Set(['position', 'selectiveLogic', 'selective_logic', 'case_sensitive', 'caseSensitive', 'match_whole_words', 'matchWholeWords', 'use_regex', 'useRegex', 'priority']);
const bookFields = new Set(['id', 'name', 'description', 'entries', 'version', 'revision', 'scan_depth', 'case_sensitive', 'match_whole_words', 'extensions', 'visibility', 'access', 'contextScope', 'scope']);
const warning = (code, extra = {}) => ({ code, ...extra });
function settings(entry, book, config) {
  const extensions = entry.extensions ?? {};
  const pick = (...names) => { for (const container of [entry, extensions]) for (const name of names) if (container[name] !== undefined) return container[name]; };
  return {
    caseSensitive: pick('case_sensitive', 'caseSensitive') ?? config.caseSensitive ?? book.case_sensitive ?? false,
    matchWholeWords: pick('match_whole_words', 'matchWholeWords') ?? config.matchWholeWords ?? book.match_whole_words ?? false,
    regex: pick('use_regex', 'useRegex') === true,
    logic: pick('selectiveLogic', 'selective_logic') ?? 0,
    position: pick('position') ?? 'after_char',
    priority: finite(pick('priority'), finite(entry.order ?? entry.insertion_order, 100)),
  };
}

/**
 * Pure selection over an immutable Run snapshot. entries are in presentation
 * order; diagnostics.selectionOrder is the independent admission priority order.
 * A selected entry is context, never an event or a state update.
 */
export function selectWorldbooks(snapshot, { playerInput = '', recentDialogue = [], config = {}, playerName } = {}) {
  const requestedWindow = config.scanWindow;
  if (typeof playerInput !== 'string' || !object(config) || requestedWindow && (!['messages', 'player_turns'].includes(requestedWindow.unit) || !Number.isSafeInteger(requestedWindow.count) || requestedWindow.count < 0 || requestedWindow.count > 1000) || config.maxEntries !== undefined && (!Number.isSafeInteger(config.maxEntries) || config.maxEntries < 0 || config.maxEntries > 10000)) throw new SceanError('INVALID_WORLDBOOK_CONFIG');
  const diagnostics = { schemaVersion: 1, status: 'selected', books: [], entries: [], warnings: [], selectionOrder: [], presentationOrder: [], scan: [], stageUse: 'pending' };
  const history = messages(recentDialogue), candidates = [], seen = new Map();
  for (const [bookIndex, candidate] of bookCandidates(snapshot).entries()) {
    const rawBook = unwrap(candidate.raw);
    const sourceId = `worldbook:${bookIndex}`;
    if (privateContainer(candidate.parent) || privateContainer(candidate.raw) || privateContainer(rawBook) || privateContainer(snapshot.card?.data) && candidate.path === 'card.data.character_book') {
      diagnostics.books.push({ sourceId, path: candidate.path, status: 'excluded', reason: 'private_scope' });
      diagnostics.warnings.push(warning('PRIVATE_WORLDBOOK_EXCLUDED', { sourceId })); continue;
    }
    if (!object(rawBook) || !object(rawBook.entries) && !Array.isArray(rawBook.entries)) {
      diagnostics.books.push({ sourceId, path: candidate.path, status: 'excluded', reason: 'unsupported_book_format' }); continue;
    }
    const version = candidate.source?.revision ?? rawBook.revision ?? rawBook.version ?? snapshot.revision ?? null;
    // Version participates even when the serialized book is otherwise identical.
    const fingerprint = hash({ book: rawBook, version });
    const provenance = { sourceId, path: candidate.path, bookId: String(candidate.source?.id ?? rawBook.id ?? sourceId), bookVersion: version, contentHash: hash(rawBook) };
    if (seen.has(fingerprint)) {
      diagnostics.books.push({ ...provenance, status: 'deduplicated', identicalTo: seen.get(fingerprint), reason: 'exact_book_and_version' }); continue;
    }
    seen.set(fingerprint, sourceId);
    diagnostics.books.push({ ...provenance, status: 'processed' });
    for (const field of Object.keys(rawBook)) if (!bookFields.has(field)) diagnostics.warnings.push(warning('UNSUPPORTED_BOOK_FIELD', { sourceId, field }));
    for (const field of Object.keys(rawBook.extensions ?? {})) diagnostics.warnings.push(warning('UNSUPPORTED_BOOK_EXTENSION', { sourceId, field }));
    const book = project(rawBook);
    if (book.scan_depth !== undefined && (!Number.isSafeInteger(book.scan_depth) || book.scan_depth < 0 || book.scan_depth > 1000)) diagnostics.warnings.push(warning('INVALID_SCAN_DEPTH_DEFAULTED', { sourceId }));
    const count = Number.isSafeInteger(book.scan_depth) && book.scan_depth >= 0 && book.scan_depth <= 1000 ? book.scan_depth : 2;
    const window = requestedWindow ?? { unit: 'messages', count };
    const material = scan(history, playerInput, window);
    diagnostics.scan.push({ sourceId, window: clone(window), currentInputAlwaysIncluded: true, material });
    const rows = Array.isArray(rawBook.entries) ? rawBook.entries.map((entry, index) => [String(index), entry]) : Object.entries(rawBook.entries);
    for (const [index, [dictionaryKey, rawEntry]] of rows.entries()) {
      const ref = `${sourceId}:entry:${index}`;
      if (privateContainer(rawEntry) || privateContainer(rawEntry?.extensions)) { diagnostics.entries.push({ ref, sourceId, status: 'excluded', reason: 'private_scope' }); diagnostics.warnings.push(warning('PRIVATE_ENTRY_EXCLUDED', { ref })); continue; }
      const entry = project(rawEntry);
      if (!object(entry) || typeof entry.content !== 'string') { diagnostics.entries.push({ ref, sourceId, status: 'excluded', reason: 'invalid_entry' }); continue; }
      const entryId = String(entry.id ?? entry.uid ?? dictionaryKey);
      const state = { ref, ...provenance, entryId, status: 'excluded', primaryHits: [], secondaryHits: [] };
      diagnostics.entries.push(state);
      for (const field of Object.keys(entry)) if (!entryFields.has(field)) diagnostics.warnings.push(warning('UNSUPPORTED_ENTRY_FIELD', { ref, field }));
      for (const field of Object.keys(entry.extensions ?? {})) if (!extensionFields.has(field)) diagnostics.warnings.push(warning('UNSUPPORTED_ENTRY_EXTENSION', { ref, field }));
      const options = settings(entry, book, config);
      let placement;
      if ([0, 'before_char'].includes(options.position)) placement = 'before_char';
      else if ([1, 'after_char'].includes(options.position)) placement = 'after_char';
      else { placement = 'after_char'; diagnostics.warnings.push(warning('UNSUPPORTED_PLACEMENT', { ref, fallback: placement })); }
      if (entry.enabled === false || entry.disable === true) { state.reason = 'disabled'; continue; }
      if (!entry.content.trim()) { state.reason = 'empty_content'; continue; }
      const rawPrimary=strings(entry.keys??entry.key),rawSecondary=strings(entry.secondary_keys??entry.keysecondary);
      const primary=rawPrimary.map(key=>resolvePlayerText(key,playerName)),secondary=rawSecondary.map(key=>resolvePlayerText(key,playerName));
      if (options.regex || [...rawPrimary,...rawSecondary].some(regexLike)) { state.reason = 'unsupported_regex'; diagnostics.warnings.push(warning('REGEX_UNSUPPORTED', { ref })); continue; }
      if (/<%|<script\b|\{\{|@@/i.test(entry.content)) diagnostics.warnings.push(warning('EXECUTABLE_SYNTAX_LITERAL_ONLY', { ref }));
      if (entry.constant === true) state.reason = 'constant';
      else {
        const hits = keys => keys.filter(key => material.some(row => literal(row.text, key, options))).map(key => ({ key, sources: material.filter(row => literal(row.text, key, options)).map(row => row.source) }));
        state.primaryHits = hits(primary); state.secondaryHits = hits(secondary);
        if (!state.primaryHits.length) { state.reason = 'primary_miss'; continue; }
        if (entry.selective === true) {
          const logic = ({ and_any: 0, not_all: 1, not_any: 2, and_all: 3 })[options.logic] ?? options.logic;
          if (![0, 1, 2, 3].includes(logic)) { state.reason = 'unsupported_selective_logic'; diagnostics.warnings.push(warning('SELECTIVE_LOGIC_UNSUPPORTED', { ref })); continue; }
          if (!secondary.length) { state.reason = 'secondary_keys_missing'; continue; }
          const n = state.secondaryHits.length;
          if (![n > 0, n !== secondary.length, n === 0, n === secondary.length][logic]) { state.reason = 'secondary_condition_failed'; continue; }
        }
        state.reason = 'key_match';
      }
      state.status = 'candidate';
      candidates.push({ ref, ...provenance, entryId, content: projectTemplateText(entry.content,playerName), priority: options.priority, placement, visibility: 'public', displayIndex: finite(entry.displayIndex, index), bookIndex, entryIndex: index });
    }
  }
  const ordered = candidates.sort((a, b) => b.priority - a.priority || a.displayIndex - b.displayIndex || a.bookIndex - b.bookIndex || a.entryIndex - b.entryIndex);
  const admitted = ordered.slice(0, config.maxEntries ?? ordered.length);
  const admittedSet = new Set(admitted.map(e => e.ref));
  for (const row of diagnostics.entries) if (row.status === 'candidate') { row.status = admittedSet.has(row.ref) ? 'selected' : 'excluded'; if (row.status === 'excluded') row.reason = 'entry_limit'; }
  admitted.forEach((entry, rank) => { entry.selectionRank = rank; });
  diagnostics.selectionOrder = admitted.map(entry => entry.ref);
  // Lower-priority context first within each coarse before/after bucket.
  const entries = admitted.sort((a, b) => (a.placement === 'before_char' ? 0 : 1) - (b.placement === 'before_char' ? 0 : 1) || a.priority - b.priority || a.bookIndex - b.bookIndex || a.entryIndex - b.entryIndex).map((entry, presentationRank) => ({ ...entry, presentationRank }));
  diagnostics.presentationOrder = entries.map(entry => entry.ref);
  return { entries, diagnostics };
}
