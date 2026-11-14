// Mock Transport: an in-memory imitation of the SCEAN Host for P0.
// No network, no model, no storage of real data. Everything is synthetic.
//
// Semantics it imitates from the rc3 Host (plugin/host.mjs, core/engine.mjs):
//  - one writer per run; a second turn while busy fails RUN_BUSY
//  - stages memory → director → (character) → writer → validation → post_stat → commit
//  - body, state, clock and world events become visible together at commit
//  - a failed post_stat keeps a saved body checkpoint on the attempt (settlementBody)
//  - COMMIT_OUTCOME_UNKNOWN is resolved by reading runView({requestId}).requestReceipt
//  - cancel is refused once the commit stage has begun
//  - an operationId is single-use; a committed requestId replays its receipt
import {ACTIONS, TransportError} from './contract.mjs';
import campus from '../fixtures/campus.mjs';
import road from '../fixtures/road.mjs';
import trpg from '../fixtures/trpg.mjs';

const WORKS = [campus, road, trpg];
const clone = v => structuredClone(v);
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, {once: true});
});
let seq = 0;
const id = p => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`;
const hash = v => JSON.stringify(v ?? null);

export const OUTCOMES = Object.freeze({
  normal: '正常完成',
  slow: '慢速生成（方便測試取消）',
  needs_time: '需要確認時間',
  settlement_fail: '正文完成、結算失敗',
  unknown_saved: '提交結果未知（實際已保存）',
  unknown_lost: '提交結果未知（實際未保存）',
  fail: '生成失敗（未保存任何內容）',
});

export function createMockTransport({latency = 120} = {}) {
  const runs = new Map();
  const progress = new Map();
  const running = new Map();
  const usedOps = new Set();
  const lab = {next: 'normal', sticky: false, speed: 1, pauseAt: null};

  const work = workId => WORKS.find(w => w.workId === workId) ?? fail('SCRIPT_NOT_FOUND', '找不到這個作品。');
  function fail(code, message, extra) { throw new TransportError(code, message, extra); }
  const periodIndex = (w, p) => w.time.periods.findIndex(x => x.id === p);
  const clockLabel = (w, c) => `${w.time.dayLabel(c.day)} · ${w.time.periods[periodIndex(w, c.period)]?.label ?? c.period}`;
  const advanceClock = (w, c, n) => {
    let i = periodIndex(w, c.period) + n, day = c.day;
    while (i >= w.time.periods.length) { i -= w.time.periods.length; day++; }
    return {day, period: w.time.periods[i].id};
  };

  function applyDelta(state, delta) {
    const s = clone(state), changes = [];
    s.relations ??= {}; s.facts ??= [];
    for (const d of delta) {
      if (d.k === 'location') { changes.push({kind: 'location', label: '地點', before: s.location, after: d.to}); s.location = d.to; }
      else if (d.k === 'item') {
        const row = s.items.find(i => i.id === d.id);
        const before = row?.qty ?? 0, after = before + d.qty;
        if (row) row.qty = after; else s.items.push({id: d.id, name: d.name, qty: after, unit: d.unit});
        if (row && after <= 0 && !d.unit) s.items = s.items.filter(i => i !== row);
        changes.push({kind: 'item', label: d.name, before: row ? before : null, after, unit: d.unit ?? '', sign: d.qty > 0 ? '+' : '−'});
      } else if (d.k === 'task') {
        const row = s.tasks.find(t => t.id === d.id), before = row?.status ?? null;
        if (row) row.status = d.status; else s.tasks.push({id: d.id, title: d.title, status: d.status});
        changes.push({kind: 'task', label: d.title, before, after: d.status});
      } else if (d.k === 'effect') {
        if (d.remove) { s.effects = s.effects.filter(e => e.id !== d.id); changes.push({kind: 'effect', label: d.label, after: '解除'}); }
        else { s.effects.push({id: d.id, label: d.label}); changes.push({kind: 'effect', label: d.label, after: '新狀態'}); }
      } else if (d.k === 'relation') {
        const before = s.relations[d.who] ?? null; s.relations[d.who] = d.label;
        changes.push({kind: 'relation', who: d.who, before, after: d.label});
      } else if (d.k === 'fact') { s.facts.push(d.label); changes.push({kind: 'fact', label: d.label}); }
      else if (d.k === 'check') changes.push({kind: 'check', label: d.label, after: d.result});
    }
    return {state: s, changes};
  }

  function createRun(w, {openingId, playerName}) {
    const opening = w.openings.find(o => o.id === openingId) ?? w.openings[0];
    const run = {
      runId: id('run'), workId: w.workId, version: 1, head: id('h'), createdAt: Date.now(), updatedAt: Date.now(),
      playerName, opening, clock: clone(w.startClock), state: clone(w.initialState), turns: [], beatIndex: 0,
      forum: clone(w.forum), calendar: clone(w.calendar), chapters: [{id: 'c1', order: 1, title: opening.title, summary: '', startTurn: 1, endTurn: 0, current: true}],
      receipts: {}, attempts: {}, seenForum: w.forum.length,
    };
    runs.set(run.runId, run);
    return run;
  }
  // Seed one save per work, with its scripted history already committed.
  for (const w of WORKS) {
    const run = createRun(w, {openingId: w.openings[0].id, playerName: w.playerDefault});
    run.chapters = clone(w.chapters);
    let clock = clone(w.startClock);
    w.history.forEach((h, i) => {
      const {state, changes} = applyDelta(run.state, h.delta);
      run.turns.push({turn: i + 1, requestId: id('req'), commitId: id('commit'), input: h.input, body: h.body, delta: h.delta, changes, clockBefore: clock, clockAfter: h.clock, world: []});
      run.state = state; clock = h.clock;
    });
    run.clock = clock; run.version = run.turns.length + 1; run.updatedAt = Date.now() - (WORKS.indexOf(w) + 1) * 3600e3 * 7;
  }

  function lastLine(run) {
    const t = run.turns.at(-1); if (!t) return run.opening.text;
    const seg = t.body.at(-1); return seg[0] === 'l' ? seg[2] : seg[1];
  }
  const publicCharacters = w => w.characters.map(({id, name, role, color, bio, relation}) => ({id, name, role, color, bio, relation}));
  function runView(run, requestId) {
    const w = work(run.workId);
    const view = {
      runId: run.runId, workId: w.workId, version: run.version, head: run.head, turnCount: run.turns.length,
      snapshot: {title: w.title, genre: w.genre, revision: w.revision, characters: publicCharacters(w)},
      playerIdentity: {name: run.playerName}, openingDisplay: run.opening.text, openingTitle: run.opening.title,
      storyClock: clone(run.clock), storyClockLabel: clockLabel(w, run.clock),
      timeControls: {definition: {periods: clone(w.time.periods)}, base: clone(run.clock)},
      state: clone(run.state), lastTurn: run.turns.at(-1) ? {turn: run.turns.at(-1).turn, requestId: run.turns.at(-1).requestId, commitId: run.turns.at(-1).commitId} : null,
      host: {pending: running.has(run.runId)}, newForum: run.forum.length - run.seenForum,
    };
    if (requestId) {
      const r = run.receipts[requestId];
      view.requestReceipt = r ? {requestId, commitId: r.commitId, status: run.turns.some(t => t.commitId === r.commitId) ? 'committed' : 'retired'} : {requestId, status: 'not_found'};
    }
    return view;
  }
  const publicTurn = (run, t) => {
    const w = work(run.workId);
    const {delta, ...rest} = clone(t);
    return {...rest, clockBeforeLabel: clockLabel(w, t.clockBefore), clockAfterLabel: clockLabel(w, t.clockAfter)};
  };

  async function execute(run, req, {resumeFrom} = {}) {
    const w = work(run.workId);
    if (running.has(run.runId)) fail('RUN_BUSY', '這一局正在處理上一個行動。');
    const opKey = `${run.runId}:${req.operationId}`;
    if (usedOps.has(opKey)) fail('OPERATION_ID_REUSED', '每次執行都需要新的 operationId。');
    usedOps.add(opKey);
    const prior = run.receipts[req.requestId];
    if (prior) {
      if (prior.inputHash !== hash(req.input) || prior.tcHash !== hash(req.timeConfirmation)) fail('IDEMPOTENCY_CONFLICT', '輸入或時間確認已改變，需要新的 requestId。');
      return {replayed: true, commitId: prior.commitId};
    }
    const outcome = resumeFrom ? 'normal' : lab.next;
    if (!lab.sticky && !resumeFrom) lab.next = 'normal';
    const controller = new AbortController();
    const attemptId = resumeFrom?.attemptId ?? id('attempt');
    const p = {runId: run.runId, requestId: req.requestId, operationId: req.operationId, attemptId, stage: 'memory', status: 'pending', sequence: 0, events: []};
    progress.set(run.runId, p); running.set(run.runId, {controller, p});
    const speed = (outcome === 'slow' ? 3 : 1) / lab.speed;
    const stage = async (name, ms) => {
      p.stage = name; p.status = 'pending'; p.sequence++; p.events.push({stage: name, status: 'pending', at: Date.now()});
      await wait(ms * speed, controller.signal);
      if (lab.pauseAt === name) { lab.pauseAt = null; await wait(lab.pauseMs ?? 30000, controller.signal); } // review aid: hold a stage on screen
      p.events.push({stage: name, status: 'completed', at: Date.now()});
    };
    const beat = w.beats[run.beatIndex % w.beats.length];
    try {
      let body;
      if (!resumeFrom) {
        await stage('memory', 350);
        await stage('director', 900);
        if (outcome === 'needs_time' && !req.timeConfirmation) {
          fail('NEEDS_TIME_PRECISION', '這一步的時間無法從目前的故事時間判斷，需要你確認。', {stage: 'director', timeControls: {definition: {periods: clone(w.time.periods)}, base: clone(run.clock)}});
        }
        if (beat.body.some(s => s[0] === 'l')) await stage('character', 700);
        await stage('writer', 1600);
        if (outcome === 'fail') fail('MODEL_OUTPUT_INCOMPLETE', '正文生成在完成前中斷，沒有保存任何內容。', {stage: 'writer'});
        body = clone(beat.body);
        await stage('validation', 250);
        run.attempts[attemptId] = {requestId: req.requestId, input: req.input, timeConfirmation: req.timeConfirmation ?? null, bodyCheckpoint: {body}};
      } else {
        body = run.attempts[resumeFrom.attemptId].bodyCheckpoint.body;
      }
      await stage('post_stat', 1100);
      if (outcome === 'settlement_fail') fail('POST_STAT_FAILED', '正文已寫好，但世界結算沒有通過檢查。', {stage: 'post_stat', attemptId, bodySaved: true});
      p.stage = 'commit'; p.status = 'pending'; p.events.push({stage: 'commit', status: 'pending', at: Date.now()});
      running.get(run.runId).committing = true;
      await new Promise(r => setTimeout(r, 400 * speed));
      if (outcome !== 'unknown_lost') {
        // Atomic publication: body + state + clock + world events in one step.
        const tc = req.timeConfirmation;
        // timeConfirmation follows the rc3 schemaVersion 2 shape: target {dayOrdinal, periodId}.
        const target = tc ? {day: tc.target.dayOrdinal, period: tc.target.periodId ?? run.clock.period} : null;
        const before = tc?.mode === 'refine' ? target : clone(run.clock);
        const after = tc?.mode === 'advance_to' ? target : advanceClock(w, before, beat.advance ?? 0);
        const {state, changes} = applyDelta(run.state, beat.delta);
        const commitId = id('commit'), world = [];
        if (beat.interlude?.forum) { const post = {...clone(beat.interlude.forum), id: id('post'), day: after.day, period: after.period}; post.replies = (post.replies ?? []).map(r => ({...r, day: after.day, period: after.period})); run.forum.push(post); world.push({kind: 'forum', id: post.id, title: post.title, author: post.author}); }
        if (beat.interlude?.calendar) { const ev = {...clone(beat.interlude.calendar), id: id('event')}; run.calendar.push(ev); world.push({kind: 'calendar', id: ev.id, title: ev.label, day: ev.day, period: ev.period}); }
        run.turns.push({turn: run.turns.length + 1, requestId: req.requestId, commitId, input: req.input, body, delta: clone(beat.delta), changes, clockBefore: before, clockAfter: after, world, timeConfirmed: !!tc});
        run.state = state; run.clock = after; run.beatIndex++; run.version++; run.head = id('h'); run.updatedAt = Date.now();
        const chapter = run.chapters.find(c => c.current); if (chapter) chapter.endTurn = run.turns.length;
        run.receipts[req.requestId] = {commitId, inputHash: hash(req.input), tcHash: hash(req.timeConfirmation)};
        p.commitId = commitId;
      }
      if (outcome === 'unknown_saved' || outcome === 'unknown_lost') fail('COMMIT_OUTCOME_UNKNOWN', '連線在保存時中斷，無法確認這一輪是否已保存。', {stage: 'commit'});
      p.status = 'committed'; p.events.push({stage: 'commit', status: 'committed', at: Date.now()});
      return {commitId: p.commitId, version: run.version, turn: run.turns.length};
    } catch (error) {
      const e = error instanceof TransportError ? error : new TransportError('CANCELLED', '已取消，這一輪沒有保存。', {stage: p.stage, category: 'cancelled'});
      p.status = e.code === 'CANCELLED' ? 'cancelled' : e.code === 'COMMIT_OUTCOME_UNKNOWN' ? 'unknown' : 'failed';
      p.lastFailure = {code: e.code, stage: e.stage ?? p.stage};
      throw e;
    } finally { running.delete(run.runId); }
  }

  const handlers = {
    scriptList: () => WORKS.map(w => ({workId: w.workId, genre: w.genre, title: w.title, tagline: w.tagline, revision: w.revision, coverGlyph: w.coverGlyph,
      saves: [...runs.values()].filter(r => r.workId === w.workId).length})),
    scriptGet: ({workId}) => { const w = work(workId); return {workId: w.workId, genre: w.genre, title: w.title, tagline: w.tagline, description: w.description, revision: w.revision, coverGlyph: w.coverGlyph,
      playerDefault: w.playerDefault, characters: publicCharacters(w), openings: clone(w.openings), worldbookCount: w.worldbook.length,
      periods: clone(w.time.periods), startLabel: clockLabel(w, w.startClock)}; },
    homeSummary: () => [...runs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(r => { const w = work(r.workId); return {
      runId: r.runId, workId: w.workId, genre: w.genre, title: w.title, coverGlyph: w.coverGlyph, playerName: r.playerName, turnCount: r.turns.length,
      clockLabel: clockLabel(w, r.clock), location: r.state.location, lastLine: lastLine(r), updatedAt: r.updatedAt, pending: running.has(r.runId)}; }),
    list: () => handlers.homeSummary(),
    openingStart: ({workId, openingId, playerName}) => {
      const name = String(playerName ?? '').trim(); if (!name) fail('PLAYER_NAME_REQUIRED', '請填寫這一局的主角名字。');
      return {runId: createRun(work(workId), {openingId, playerName: name.slice(0, 80)}).runId};
    },
    runView: ({runId, requestId}) => runView(need(runId), requestId),
    historyPage: ({runId}) => { const run = need(runId); return {turns: run.turns.map(t => publicTurn(run, t)), chapters: clone(run.chapters)}; },
    turn: req => execute(need(req.runId), req),
    settlementResume: ({runId, requestId, sourceAttemptId, operationId}) => {
      const run = need(runId), a = run.attempts[sourceAttemptId];
      if (!a?.bodyCheckpoint || a.requestId !== requestId) fail('SETTLEMENT_SOURCE_STALE', '已保存正文的來源不符，沒有送出。');
      return execute(run, {runId, requestId, operationId, input: a.input, timeConfirmation: a.timeConfirmation ?? undefined}, {resumeFrom: {attemptId: sourceAttemptId}});
    },
    settlementBody: ({runId, attemptId}) => { const a = need(runId).attempts[attemptId]; if (!a?.bodyCheckpoint) fail('SETTLEMENT_SOURCE_STALE', '找不到完整的已保存正文。'); return {status: 'saved_not_committed', attemptId, body: clone(a.bodyCheckpoint.body)}; },
    progress: ({runId}) => clone(progress.get(runId) ?? null),
    cancel: ({runId, operationId}) => {
      const r = running.get(runId);
      if (!r) return {cancelRequested: false, status: 'not_called', reason: 'not_running'};
      if (r.p.operationId !== operationId) return {cancelRequested: false, status: 'not_called', reason: 'operation_mismatch'};
      if (r.committing) return {cancelRequested: false, status: 'not_called', reason: 'commit_in_progress'};
      r.controller.abort(new TransportError('CANCELLED', '已取消，這一輪沒有保存。', {category: 'cancelled'}));
      return {cancelRequested: true, status: 'pending'};
    },
    rollback: ({runId, expectedVersion}) => {
      const run = need(runId); if (running.has(runId)) fail('RUN_BUSY', '請等這一輪處理完。');
      if (expectedVersion !== run.version) fail('VERSION_CONFLICT', '故事已更新，請重新整理後再試。');
      const t = run.turns.pop(); if (!t) fail('NOTHING_TO_ROLLBACK', '沒有可以收回的回合。');
      run.receipts[t.requestId] && (run.receipts[t.requestId].status = 'retired');
      delete run.receipts[t.requestId];
      // Reverse: rebuild state from scratch for the mock.
      rebuild(run); return {version: run.version};
    },
    regenerate: async ({runId, expectedVersion, operationId, requestId}) => {
      const run = need(runId); if (expectedVersion !== run.version) fail('VERSION_CONFLICT', '故事已更新，請重新整理後再試。');
      const last = run.turns.at(-1); if (!last) fail('NOTHING_TO_REGENERATE', '沒有可以重寫的回合。');
      const saved = {turns: clone(run.turns), state: clone(run.state), clock: clone(run.clock), forum: clone(run.forum), calendar: clone(run.calendar), receipts: clone(run.receipts)};
      run.turns.pop(); delete run.receipts[last.requestId]; rebuild(run, false);
      try { return await execute(run, {runId, requestId, operationId, input: last.input}); }
      catch (e) { if (e.code !== 'COMMIT_OUTCOME_UNKNOWN') Object.assign(run, saved); throw e; }
    },
    worldRoutineRead: ({runId, kind}) => {
      const run = need(runId), w = work(run.workId);
      if (kind === 'forum') { run.seenForum = run.forum.length; return {kind, board: {campus: '星川夜話板', road: '南下旅人留言板', trpg: '冒險者公會告示板'}[w.genre], posts: clone(run.forum).sort((a, b) => b.day - a.day || periodIndex(w, b.period) - periodIndex(w, a.period)).map(p => ({...p, timeLabel: clockLabel(w, p), replies: (p.replies ?? []).map(r => ({...r, timeLabel: r.day ? clockLabel(w, r) : clockLabel(w, p)}))}))}; }
      if (kind === 'calendar') return {kind, now: clone(run.clock), nowLabel: clockLabel(w, run.clock), days: [...new Set([run.clock.day - 1, ...Array.from({length: 7}, (_, i) => run.clock.day + i)])].filter(d => d >= 0).map(d => ({day: d, label: w.time.dayLabel(Math.max(1, d)), events: run.calendar.filter(e => e.day === d).map(e => ({...e, periodLabel: w.time.periods[periodIndex(w, e.period)]?.label}))}))};
      fail('WORLD_KIND', '未知的世界資訊類型。');
    },
    playerWorldbook: ({runId}) => ({spoilers: 'included', scope: 'full_snapshot', entries: clone(work(need(runId).workId).worldbook)}),
    revealedLore: () => fail('NOT_IMPLEMENTED', 'revealedLore 尚未在 Host 實作。'),
    playerIdeas: async ({runId}) => { await wait(900 / lab.speed); return {ideas: work(need(runId).workId).ideas.map(([category, text]) => ({category, text}))}; },
    playerRecap: ({runId}) => ({chapters: clone(need(runId).chapters)}),
  };
  function need(runId) { return runs.get(runId) ?? fail('RUN_NOT_FOUND', '找不到這個存檔。'); }
  function rebuild(run, bump = true) {
    const w = work(run.workId); let state = clone(w.initialState), clock = clone(w.startClock);
    for (const t of run.turns) { state = applyDelta(state, t.delta ?? []).state; clock = t.clockAfter; }
    run.state = state; run.clock = clock;
    const chapter = run.chapters.find(c => c.current); if (chapter) chapter.endTurn = run.turns.length;
    if (bump) { run.version++; run.head = id('h'); }
  }

  return {
    kind: 'mock',
    actions: ACTIONS,
    async call(action, payload = {}) {
      const handler = handlers[action];
      if (!handler) throw new TransportError('UNKNOWN_ACTION', `未知的動作：${action}`);
      if (!['turn', 'settlementResume', 'regenerate', 'playerIdeas'].includes(action)) await wait(latency / lab.speed);
      return clone(await handler(clone(payload)));
    },
    lab: {
      get: () => ({...lab}),
      set(patch) { Object.assign(lab, patch); },
      outcomes: OUTCOMES,
    },
  };
}
