import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWorldbooks, stripWorldbookContainers } from '../core/worldbook.mjs';
import { decodeDocument } from '../vendor/cardstudio-scean/lib/document-projection.js';

const entry = (id, extras = {}) => ({ id, keys: ['煙燈'], content: `Entry ${id}: lamp design, not a completed action.`, enabled: true, insertion_order: 100, ...extras });
const book = (...entries) => ({ name: 'Research ship handbook', entries, extensions: {} });
const snapshot = (worldbook, extra = {}) => ({ cardId: 'research-ship', revision: 1, card: { data: { name: 'Synthetic ship' } }, worldbook, ...extra });
const select = (wb, input = '檢查煙燈', options = {}) => selectWorldbooks(snapshot(wb), { playerInput: input, ...options });
const ids = result => result.entries.map(e => e.entryId);

test('B1 KEY selects lamp context, not unrelated civilization, and never mutates state', () => {
  const input = snapshot(book(entry(1), entry(2, { keys: ['古文明'], content: 'Unrelated civilization.' })));
  const before = JSON.stringify(input);
  const result = selectWorldbooks(input, { playerInput: '看看煙燈' });
  assert.deepEqual(ids(result), ['1']);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.diagnostics.entries[1].reason, 'primary_miss');
  assert.equal(result.entries[0].content.includes('not a completed action'), true);
  assert.deepEqual(result.diagnostics.entries[0].primaryHits, [{ key: '煙燈', sources: ['playerInput'] }]);
});

test('B1 disabled excludes even constant; constant enabled needs no KEY', () => {
  const result = select(book(entry(1, { constant: true, enabled: false }), entry(2, { constant: true, keys: [] }), entry(3, { disable: true })));
  assert.deepEqual(ids(result), ['2']);
  assert.deepEqual(result.diagnostics.entries.map(e => e.reason), ['disabled', 'constant', 'disabled']);
});

test('B1 selective primary AND secondary with all four supported conditions', () => {
  const result = select(book(...[0, 1, 2, 3].map(logic => entry(logic, { selective: true, secondary_keys: ['燃料', '火花'], selectiveLogic: logic }))), '煙燈 燃料');
  assert.deepEqual(ids(result), ['0', '1']);
  assert.equal(result.diagnostics.entries[2].reason, 'secondary_condition_failed');
  assert.equal(result.diagnostics.entries[3].reason, 'secondary_condition_failed');
  assert.deepEqual(ids(select(book(entry(1, { selective: true, secondary_keys: [] })))), []);
  assert.deepEqual(ids(select(book(entry(1, { selective: true, secondary_keys: ['火花'] })))), []);
  assert.equal(select(book(entry(1, { selective: true, secondary_keys: ['煙燈'], selectiveLogic: 99 }))).diagnostics.entries[0].reason, 'unsupported_selective_logic');
});

test('B1 current input always included; explicit message and player-turn scan windows differ', () => {
  const recentDialogue = [{ turn: 1, input: '遠古煙燈', body: '走到甲板' }, { turn: 2, input: '魔塔', body: '現在休息' }];
  const wb = book(entry(1, { keys: ['魔塔'] }), entry(2, { keys: ['煙燈'] }));
  const byMessage = select(wb, '等待', { recentDialogue, config: { scanWindow: { unit: 'messages', count: 1 } } });
  const byTurn = select(wb, '等待', { recentDialogue, config: { scanWindow: { unit: 'player_turns', count: 1 } } });
  assert.deepEqual(ids(byMessage), []); assert.deepEqual(ids(byTurn), ['1']);
  assert.equal(byTurn.diagnostics.scan[0].material.length, 3);
  assert.deepEqual(ids(select(wb, '煙燈', { recentDialogue, config: { scanWindow: { unit: 'messages', count: 0 } } })), ['2']);
});

test('B1 message-form history groups by explicit or inferred player turns, ignores failed/private history', () => {
  const recentDialogue = [{ role: 'user', content: '煙燈' }, { role: 'assistant', content: '桌上' }, { role: 'assistant', content: '再看一次' }, { role: 'assistant', content: '古文明', status: 'failed' }, { role: 'assistant', content: '不該看見', visibility: 'private' }];
  const result = select(book(entry(1), entry(2, { keys: ['古文明'] })), '', { recentDialogue, config: { scanWindow: { unit: 'player_turns', count: 1 } } });
  assert.deepEqual(ids(result), ['1']);
  assert.equal(JSON.stringify(result).includes('不該看見'), false);
});

test('B1 book scan_depth means historical messages; explicit config overrides it', () => {
  const wb = { ...book(entry(1)), scan_depth: 0 };
  const recentDialogue = [{ input: '煙燈', body: '停止' }];
  assert.deepEqual(ids(select(wb, '', { recentDialogue })), []);
  assert.deepEqual(ids(select(wb, '', { recentDialogue, config: { scanWindow: { unit: 'messages', count: 2 } } })), ['1']);
});

test('B1 deterministic priority admission is distinct from presentation order', () => {
  const wb = book(entry(1, { insertion_order: 100 }), entry(2, { insertion_order: 300 }), entry(3, { insertion_order: 200 }));
  const result = select(wb, '煙燈', { config: { maxEntries: 2 } });
  assert.deepEqual(ids(result), ['3', '2']);
  assert.deepEqual(result.entries.map(e => e.selectionRank), [1, 0]);
  assert.equal(result.diagnostics.entries[0].reason, 'entry_limit');
  assert.deepEqual(select(wb, '煙燈', { config: { maxEntries: 2 } }), result);
});

test('B1 exact embedded plus standalone canonical equality dedupes, distinct version/content/name stays', () => {
  const wb = book(entry(1));
  const same = selectWorldbooks(snapshot(structuredClone(wb), { card: { data: { character_book: wb } } }), { playerInput: '煙燈' });
  assert.equal(same.entries.length, 1); assert.equal(same.diagnostics.books[1].status, 'deduplicated');
  const changed = selectWorldbooks(snapshot(null, { card: { data: { character_book: wb } }, worldbooks: [{ book: wb, source: { id: 'other', revision: 2 } }, { ...wb, name: 'Other name' }, book(entry(1, { content: 'Other content' }))] }), { playerInput: '煙燈' });
  assert.equal(changed.entries.length, 4);
  assert.equal(changed.entries.find(e => e.bookVersion === 2).bookId, 'other');
});

test('B1 actual Studio codec accepts embedded-array and standalone ST dictionary formats', () => {
  const canonical = book(entry(2, { secondary_keys: ['燃料'], selective: true }));
  const rawST = { name: 'Synthetic city', entries: { 19: { uid: 19, key: ['煙燈'], keysecondary: ['燃料'], selective: true, content: 'City lamp.', disable: false, order: 200 } } };
  for (const value of [canonical, rawST, { spec: 'lorebook_v3', data: canonical }]) {
    const decoded = decodeDocument(Buffer.from(JSON.stringify(value)), 'worldbook');
    const result = selectWorldbooks(snapshot(decoded), { playerInput: '煙燈 燃料' });
    assert.equal(result.entries.length, 1);
  }
  assert.deepEqual(ids(select({ spec: 'lorebook_v3', data: canonical }, '煙燈 燃料')), ['2']);
  assert.deepEqual(ids(select(rawST, '煙燈 燃料')), ['19']);
});

test('B1 case and Unicode word boundary rules are explicit, no user regex compilation', () => {
  const wb = book(entry(1, { keys: ['LAMP'] }), entry(2, { keys: ['LAMP'], case_sensitive: true }), entry(3, { keys: ['林'] }), entry(4, { keys: ['cat'], match_whole_words: true }));
  assert.deepEqual(ids(select(wb, 'lamp 森林 catapult')), ['1']);
  assert.deepEqual(ids(select(wb, 'LAMP 林，cat!')), ['1', '2', '3', '4']);
  assert.deepEqual(ids(select(book(entry(1, { keys: ['煙燈'] })), '看看煙燈')), ['1']);
});

test('B1 regex keys and flag excluded without executing regex, even when constant', () => {
  const result = select(book(entry(1, { keys: ['/(a+)+$/'], constant: true }), entry(2, { use_regex: true }), entry(3, { secondary_keys: ['/秘密/i'] })));
  assert.equal(result.entries.length, 0);
  assert.equal(result.diagnostics.entries.every(e => e.reason === 'unsupported_regex'), true);
});

test('B1 unsupported placement/conditions warn and executable syntax is inert literal', () => {
  const result = select(book(entry(1, { position: 4, depth: 3, probability: 50, content: '<% execute() %> {{random}}', extensions: { cooldown: 2 } })));
  assert.equal(result.entries[0].placement, 'after_char');
  assert.equal(result.entries[0].content, '<% execute() %> {{random}}');
  assert.equal(result.diagnostics.warnings.some(w => w.code === 'UNSUPPORTED_PLACEMENT'), true);
  assert.equal(result.diagnostics.warnings.filter(w => w.code === 'UNSUPPORTED_ENTRY_FIELD').length, 2);
  assert.equal(result.diagnostics.warnings.some(w => w.code === 'EXECUTABLE_SYNTAX_LITERAL_ONLY'), true);
});

test('B1 private book, entry, nested scope and history do not reach output or hit evaluation', () => {
  const result = selectWorldbooks(snapshot(null, { worldbooks: [{ visibility: 'private', ...book(entry('private-id-secret', { content: 'BOOK_SECRET' })) }, book(entry(1), entry('secret-name', { content: 'ENTRY_SECRET', visibility: 'restricted' }), entry(3, { content: 'OWNER_SECRET', contextScope: { kind: 'character', characterId: 'npc' } }), entry(4, { content: 'EXT_SECRET', extensions: { visibility: 'private' } }))] }), { playerInput: '煙燈', recentDialogue: [{ input: 'HISTORY_SECRET', body: 'HISTORY_SECRET', visibility: 'private' }] });
  assert.equal(result.entries.length, 1);
  assert.equal(/SECRET|secret-name|private-id-secret/.test(JSON.stringify(result)), false);
  assert.equal(result.diagnostics.warnings.some(w => w.code === 'PRIVATE_WORLDBOOK_EXCLUDED'), true);
});

test('B1 scrub helper removes raw books at nested extension containers before selected injection', () => {
  const raw = { card: { data: { name: 'ship', character_book: book(entry(1)), extensions: { books: [book(entry(2))], nested: { worldbook: book(entry(3)) }, notes: 'Keep prose' } } }, worldbooks: [book(entry(4))], preset: { instructions: 'Keep style' }, private: { note: 'secret' } };
  const result = stripWorldbookContainers(raw);
  assert.equal(JSON.stringify(result).includes('lamp design'), false);
  assert.equal(result.card.data.extensions.notes, 'Keep prose');
  assert.equal(result.preset.instructions, 'Keep style');
  assert.equal(result.private, undefined);
});

test('B1 snapshot r1 selection is stable after external r2 edit', () => {
  const original = book(entry(1));
  const fixed = structuredClone(snapshot(original));
  original.entries[0].content = 'r2 edit';
  const result = selectWorldbooks(fixed, { playerInput: '煙燈' });
  assert.notEqual(result.entries[0].content, 'r2 edit');
  assert.equal(result.entries[0].bookVersion, 1);
});

test('B1 rawbook stripping preserves ordinary Preset entries and authorized CR private context', () => {
  const data = { preset: { entries: [{ role: 'system', content: 'Keep exact style instruction' }] }, character: { name: 'Rin', private: { history: 'Owner authorized secret' }, character_book: book(entry(1)) } };
  const result = stripWorldbookContainers(data, { preservePrivate: true });
  assert.deepEqual(result.preset, data.preset);
  assert.deepEqual(result.character.private, data.character.private);
  assert.equal(result.character.character_book, undefined);
  assert.equal(stripWorldbookContainers(data).character.private, undefined);
});

test('B1 rejects ambiguous invalid windows and bounds and reports unsupported raw format', () => {
  for (const scanWindow of [{ unit: 'turns', count: 2 }, { unit: 'messages', count: -1 }, { unit: 'messages', count: 1001 }]) assert.throws(() => select(book(), '', { config: { scanWindow } }), { code: 'INVALID_WORLDBOOK_CONFIG' });
  assert.throws(() => select(book(), '', { config: { maxEntries: -1 } }), { code: 'INVALID_WORLDBOOK_CONFIG' });
  assert.equal(select({ text: 'unsupported book' }).diagnostics.books[0].reason, 'unsupported_book_format');
});
