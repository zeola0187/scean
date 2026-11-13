// Deep links for review and screenshots, e.g. #read-road, #demo-settle-trpg.
// Plain hash names only (the Artifact viewer passes nothing else).
const WORK = {campus: 'campus-rooftop', road: 'road-ferry', trpg: 'trpg-ashmine'};
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runDemo({store, transport, flow, actions}) {
  let hash = location.hash;
  if (hash.endsWith('-dark') || hash.endsWith('-light')) { const theme = hash.endsWith('-dark') ? 'dark' : 'light'; hash = hash.replace(/-(dark|light)$/, ''); store.set(s => ({...s, prefs: {...s.prefs, theme}})); }
  if (hash === '#shelf') return;
  const m = /^#(read|work|demo)-([a-z]+)(?:-([a-z]+))?$/.exec(hash);
  if (!m) return;
  const [, mode, a, b] = m;
  const genre = mode === 'demo' ? (b ?? 'campus') : a;
  const workId = WORK[genre]; if (!workId) return;
  if (mode === 'work') return actions.openSheet('work', workId);
  const save = store.get().saves.find(r => r.workId === workId);
  await actions.openRun(save.runId);
  if (mode === 'read') return;
  const scene = a;
  transport.lab.set({speed: 4});
  const submit = async (outcome, text) => { transport.lab.set({next: outcome}); store.set({draft: text}); await sleep(50); flow.submit(text); };
  const until = async pred => { for (let i = 0; i < 200 && !pred(store.get()); i++) await sleep(50); };
  if (scene === 'turn') { await submit('normal', '我點點頭，跟上去。'); await until(s => !s.op); }
  if (scene === 'running') { transport.lab.set({pauseAt: 'writer', pauseMs: 20000}); await submit('normal', '我點點頭，跟上去。'); await until(s => s.op?.stage === 'writer'); }
  if (scene === 'time') { await submit('needs_time', '我先回去休息，明天一早再繼續。'); await until(s => s.op?.phase === 'needs_time'); }
  if (scene === 'timesheet') { await submit('needs_time', '我先回去休息，明天一早再繼續。'); await until(s => s.op?.phase === 'needs_time'); actions.openSheet('time'); }
  if (scene === 'settle') { await submit('settlement_fail', '我點點頭，跟上去。'); await until(s => s.op?.phase === 'settlement_failed'); await flow.readSavedBody(); }
  if (scene === 'unknown') { transport.lab.set({speed: 1}); await submit('unknown_lost', '我點點頭，跟上去。'); await until(s => s.op?.phase === 'unknown'); }
  if (scene === 'character') actions.openSheet('character', store.get().run.snapshot.characters[0].id);
  if (scene === 'forum') { await submit('normal', '我點點頭，跟上去。'); await until(s => !s.op); await submit('normal', '繼續。'); await until(s => !s.op); actions.openSheet('forum'); }
  if (scene === 'calendar') actions.openSheet('calendar');
  if (scene === 'lore') actions.openSheet('lore');
  if (scene === 'world') actions.openSheet('world');
  if (scene === 'menu') actions.openSheet('menu');
  transport.lab.set({speed: 1});
  store.flushNow();
  await sleep(100);
  window.scrollTo(0, document.documentElement.scrollHeight);
}
