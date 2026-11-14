// SCEAN Stage v2 — reading-first player ("書頁"). Shared by DSH Desktop and
// DSH Web through the authenticated native bridge; all authority stays in Host.
import {h, replace, createStore, createTransport, friendly, sleep} from './s2-core.mjs';
import {createOperations} from './s2-turn.mjs';
import {renderShelf} from './s2-shelf.mjs';
import {createReader} from './s2-reader.mjs';
import {renderSheet} from './s2-sheets.mjs';

const native = globalThis.__SCEAN_NATIVE__;
// A silently refreshed card context (same card, new Studio generation) is kept in the store as well.
const {call} = createTransport(native, {onContext: context => { if (context?.cardScope) store.set({context}); }});
const store = createStore({
  screen: 'loading', context: null, scripts: [], runs: [], latest: null, runId: null, run: null, turns: [], history: null,
  op: null, draft: '', sheet: null, sheetData: null, confirm: null, notice: null, flash: 0, highlight: null, ideas: null,
  prefs: {theme: 'auto', size: 'normal', dark: false}, spoilerOk: {}, error: null, viewerId: null, feed: null,
});
let reader = null, view = null, sheetKey = null, selectionEpoch = 0;

async function loadShelf() {
  let context = await call('native.context').catch(error => ({error}));
  // Right after the stage document is swapped (workshop/legacy round trip) the Studio record can be
  // momentarily unbound; an available conversation is retried briefly instead of showing an empty shelf.
  for (let i = 0; i < 4 && !context?.cardScope && context?.playbackStatus?.status === 'available'; i++) { await sleep(1200); context = await call('native.context').catch(error => ({error})); }
  store.set({context});
  if (!context?.cardScope) { store.set({screen: 'shelf', scripts: [], runs: [], latest: null}); return; }
  const [runs, scripts] = await Promise.all([call('list').catch(() => []), call('scriptList').catch(() => [])]);
  const sorted = [...(Array.isArray(runs) ? runs : [])].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  let latest = null;
  if (sorted[0]) latest = await call('runView', {runId: sorted[0].runId}).catch(() => null);
  store.set({runs: sorted, scripts: Array.isArray(scripts) ? scripts : scripts?.scripts ?? [], latest});
}

async function reload({highlight = false} = {}) {
  const runId = store.get().runId; if (!runId) return;
  const epoch = selectionEpoch;
  const [run, history] = await Promise.all([call('runView', {runId}), call('historyPage', {runId, limit: 20, changes: true})]);
  if (epoch !== selectionEpoch) return; // a newer selection owns the view
  store.set(s => ({...s, run, turns: history.turns ?? [], history: {hasMore: !!history.hasMore, beforeCursor: history.beforeCursor ?? null}, highlight: highlight ? history.turns?.at(-1)?.commitId ?? null : s.highlight}));
}

const ops = createOperations({store, call, reload, getViewerId: () => store.get().viewerId});

const actions = {
  async home() { selectionEpoch++; ops.stop(); store.set({screen: 'shelf', runId: null, run: null, turns: [], op: null, sheet: null, confirm: null, ideas: null}); await loadShelf().catch(error => store.set({error})); },
  async open(runId) {
    selectionEpoch++; ops.stop();
    store.set({screen: 'reader', runId, run: null, turns: [], op: null, sheet: null, confirm: null, ideas: null, draft: '', notice: null, highlight: null, feed: null});
    try {
      await reload();
      const draft = await call('draftGet', {runId}).catch(() => null);
      if (draft?.input && !store.get().draft) store.set({draft: draft.input});
      await ops.adopt(runId);
      store.flushNow(); requestAnimationFrame(() => reader?.scrollEnd());
    } catch (error) { store.set({error, screen: 'shelf'}); }
  },
  async earlier() {
    const s = store.get(); if (!s.history?.beforeCursor) return;
    const page = await call('historyPage', {runId: s.runId, limit: 20, changes: true, cursor: s.history.beforeCursor, expectedHead: s.run.lastTurn?.commitId ?? null});
    store.set(x => ({...x, turns: [...(page.turns ?? []), ...x.turns], history: {hasMore: !!page.hasMore, beforeCursor: page.beforeCursor ?? null}}));
  },
  nav(screen) { return call('native.navigate', {screen}).catch(error => store.set({notice: friendly(error)})); },
  sheet(kind, arg) { store.set({sheet: {kind, arg}, sheetData: null}); },
  closeSheet() { store.set({sheet: null, sheetData: null}); },
  setPref(key, value) { store.set(s => ({...s, prefs: {...s.prefs, [key]: value}})); },
  async startScript(script) {
    store.set({notice: '正在準備開場…'});
    try {
      const saved = await call('scriptGet', {scriptId: script.scriptId});
      const value = await call('scriptStart', {scriptId: saved.scriptId, scriptHash: saved.scriptHash, expectedRevision: saved.revision, operationId: globalThis.crypto.randomUUID()}, {timeout: 30000});
      store.set({notice: null});
      if (value.runId) return actions.open(value.runId);
      const offer = await call('openingOffer');
      if (offer) actions.sheet('opening', offer); else store.set({notice: '開場尚未準備好，請稍後再試。'});
    } catch (error) { store.set({notice: friendly(error)}); }
  },
  async startOpening(offer, openingIndex, playerName) {
    const value = await call('openingStart', {offerId: offer.offerId, cardId: offer.cardId, revision: offer.revision, snapshotHash: offer.snapshotHash, openingIndex, playerName}, {timeout: 30000});
    actions.closeSheet(); if (value.runId) await actions.open(value.runId);
  },
  // World feed: refreshed on open, after any version change and every 45 s while reading.
  // Fetching never marks anything read; only feedSeen (the player viewed items) does.
  async loadFeed() {
    const runId = store.get().runId; if (!runId) return;
    try { const feed = await call('worldFeed', {runId}); if (store.get().runId === runId) store.set({feed}); } catch { /* the feed is optional */ }
  },
  async feedSeen({ids = [], forumSequence} = {}) {
    const runId = store.get().runId; if (!runId || (!ids.length && forumSequence === undefined)) return;
    const unseen = new Set(ids);
    store.set(s => s.feed ? {...s, feed: {...s.feed, items: s.feed.items.filter(i => !unseen.has(i.id) && (forumSequence === undefined || !i.sequence || i.sequence > forumSequence)), unread: Math.max(0, s.feed.unread - ids.length)}} : s);
    await call('worldFeedSeen', {runId, ids: ids.slice(0, 200), ...(forumSequence !== undefined ? {forumSequence} : {})}).catch(() => {});
    await actions.loadFeed();
  },
  async addNote({commitId, excerpt}) {
    const runId = store.get().runId; if (!runId) return;
    try { await call('playerNoteAdd', {runId, commitId, excerpt}); store.set({notice: '已記下。在「設定集 › 我已知的」可以找到。'}); setTimeout(() => { if (store.get().notice?.startsWith('已記下')) store.set({notice: null}); }, 4000); }
    catch (error) { store.set({notice: friendly(error)}); }
  },
  async deleteNote(noteId) { const runId = store.get().runId; await call('playerNoteDelete', {runId, noteId}).catch(error => store.set({notice: friendly(error)})); store.set(s => ({...s, sheetData: null})); },
  async useLegacy() { await call('native.stageUi', {ui: 'legacy'}).catch(error => store.set({notice: friendly(error)})); },
  async workshop() { const runId = store.get().runId; await call('native.stageUi', runId ? {ui: 'workshop', runId} : {ui: 'workshop'}).catch(error => store.set({notice: friendly(error)})); },
  call, ops, store, reload,
};

function applyTheme(s) {
  const root = document.documentElement, theme = s.prefs.theme === 'auto' ? (s.screen === 'reader' ? s.run?.snapshot?.presentationTheme ?? 'neutral' : 'neutral') : s.prefs.theme;
  root.dataset.genre = theme; root.dataset.size = s.prefs.size; root.dataset.mode = s.prefs.dark ? 'dark' : 'light';
}

function mount() {
  const app = document.getElementById('app'), screen = h('div', {class: 'screen'}), sheetHost = h('div', {class: 'sheet-host'}), live = h('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'});
  app.append(screen, sheetHost, live);
  let lastFlash = 0, feedVersion = null;
  setInterval(() => { const s = store.get(); if (s.screen === 'reader' && s.runId && document.visibilityState === 'visible' && !s.op) void actions.loadFeed(); }, 45000);
  store.subscribe(s => {
    const fv = s.screen === 'reader' && s.run ? `${s.runId}:${s.run.version}` : null;
    if (fv && fv !== feedVersion) { feedVersion = fv; void actions.loadFeed(); }
    applyTheme(s);
    if (s.screen !== view) { view = s.screen; reader?.dispose(); reader = null; if (view === 'reader') { reader = createReader(actions); replace(screen, reader.el); } }
    if (view === 'shelf') replace(screen, renderShelf(s, actions));
    else if (view === 'loading') replace(screen, h('p', {class: 'loading'}, '正在打開舞台…'));
    else reader?.update(s);
    const key = s.sheet ? JSON.stringify([s.sheet.kind, s.sheet.arg?.offerId ?? s.sheet.arg, s.sheetData?.stamp ?? null, s.run?.version, s.op?.phase, s.prefs, s.spoilerOk]) : null;
    if (key !== sheetKey) {
      const wasOpen = !!sheetHost.firstChild, top = sheetHost.querySelector('.sheet-body')?.scrollTop ?? 0;
      sheetKey = key; replace(sheetHost, s.sheet ? renderSheet(s, actions) : null);
      document.body.classList.toggle('has-sheet', !!s.sheet);
      if (wasOpen && s.sheet) { sheetHost.querySelector('.sheet')?.classList.add('no-anim'); const b = sheetHost.querySelector('.sheet-body'); if (b) b.scrollTop = top; }
      if (s.sheet && !wasOpen) requestAnimationFrame(() => sheetHost.querySelector('[data-autofocus], .sheet-close')?.focus({preventScroll: true}));
    }
    if (s.flash && s.flash !== lastFlash) { lastFlash = s.flash; live.textContent = '這一段已保存。'; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && store.get().sheet && !e.isComposing) { e.preventDefault(); actions.closeSheet(); } });
}

mount();
native?.onPresentation?.(p => store.set(s => ({...s, prefs: {...s.prefs, dark: p.dark === true}})));
native?.onSelect?.(selection => { if (selection?.runId) void actions.open(selection.runId); else if (store.get().screen !== 'reader') void actions.home(); });
void (async () => {
  const boot = await call('native.bootstrap').catch(() => null);
  if (boot?.viewerId) store.set({viewerId: boot.viewerId});
  if (store.get().screen === 'loading') await actions.home();
})();
