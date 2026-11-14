import {createStore, prefs} from './lib/store.mjs';
import {createMockTransport} from './transport/mock-transport.mjs';
import {createTurnFlow} from './domain/turn-flow.mjs';
import {mountApp} from './ui/app.mjs';
import {runDemo} from './demo.mjs';

// The UI only sees `transport.call`. P1 swaps this line for an HTTP/Typert adapter.
const transport = createMockTransport();

const store = createStore({
  view: 'shelf', works: [], saves: [], runId: null, run: null, turns: [], chapters: [],
  op: null, draft: '', sheet: null, sheetData: null, flash: null, highlight: null,
  ideas: null, confirm: null, spoilerOk: {}, notice: null,
  prefs: {theme: prefs.read('theme', 'system'), size: prefs.read('size', 'normal'), skin: prefs.read('skin', 'genre')},
});

async function loadHome() {
  const [works, saves] = await Promise.all([transport.call('scriptList'), transport.call('homeSummary')]);
  store.set({works, saves});
}
async function refresh({highlightLatest = false} = {}) {
  const runId = store.get().runId; if (!runId) return;
  const [run, history] = await Promise.all([transport.call('runView', {runId}), transport.call('historyPage', {runId})]);
  if (store.get().runId !== runId) return; // a newer selection owns the view
  store.set(s => ({...s, run, turns: history.turns, chapters: history.chapters, highlight: highlightLatest ? history.turns.at(-1)?.commitId ?? null : s.highlight}));
}
const flow = createTurnFlow({store, transport, refresh});

const actions = {
  async goShelf() { store.set({view: 'shelf', runId: null, run: null, turns: [], op: null, sheet: null, ideas: null, confirm: null}); await loadHome(); window.scrollTo(0, 0); },
  async openRun(runId) {
    store.set({view: 'reader', runId, run: null, turns: [], chapters: [], op: null, sheet: null, sheetData: null, ideas: null, confirm: null, highlight: null, draft: ''});
    await refresh(); store.flushNow();
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  },
  async startNew({workId, openingId, playerName}) {
    const {runId} = await transport.call('openingStart', {workId, openingId, playerName, operationId: crypto.randomUUID?.() ?? String(Date.now())});
    await actions.openRun(runId);
  },
  openSheet(kind, arg) { store.set({sheet: {kind, arg, from: document.activeElement}, sheetData: null}); },
  closeSheet() { const from = store.get().sheet?.from; store.set({sheet: null, sheetData: null}); requestAnimationFrame(() => from?.isConnected && from.focus?.({preventScroll: true})); },
  setPref(key, value) { prefs.write(key, value); store.set(s => ({...s, prefs: {...s.prefs, [key]: value}})); },
  async rollback() {
    const s = store.get(), last = s.turns.at(-1);
    await transport.call('rollback', {runId: s.runId, expectedVersion: s.run.version});
    store.set({confirm: null, draft: last?.input ?? s.draft, notice: '已收回上一步，原本的行動放回輸入框。'});
    await refresh();
  },
  refresh, loadHome,
};

mountApp(document.getElementById('app'), {store, transport, flow, actions});
await loadHome();
await runDemo({store, transport, flow, actions});
