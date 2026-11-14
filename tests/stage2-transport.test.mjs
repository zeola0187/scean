// Stage v2 transport: a stale Card Studio generation (CARD_CONTEXT_CHANGED) is recovered by
// re-reading the context once, but only for the same card in the same creation conversation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransport} from '../isolated/web/s2-core.mjs';

const scope = (generation, cardId = 'card-a', authoringSessionId = 'session-a') => ({provider: '@local/dsh-card-studio-scean-test', cardId, authoringSessionId, generation});
const changed = () => Object.assign(new Error('目前對話或卡片已變更'), {code: 'CARD_CONTEXT_CHANGED'});

function fakeNative({next, failures = 1}) {
  const calls = []; let current = scope('g1'), left = failures;
  return {calls, native: {async request(action, payload) {
    calls.push(action);
    if (action === 'native.context') { const value = {cardScope: current}; current = next ?? current; return value; }
    if (left-- > 0) { current = next ?? current; throw changed(); }
    return {ok: action, payload};
  }}};
}

test('same card, new Studio generation: context is refreshed once and the request is retried', async () => {
  const {native, calls} = fakeNative({next: scope('g2')}), seen = [];
  const {call} = createTransport(native, {onContext: c => seen.push(c.cardScope.generation)});
  await call('native.context');
  assert.deepEqual(await call('operationSubmit', {kind: 'turn'}), {ok: 'operationSubmit', payload: {kind: 'turn'}});
  assert.deepEqual(calls, ['native.context', 'operationSubmit', 'native.context', 'operationSubmit']);
  assert.deepEqual(seen, ['g2']);
});

test('a different card or conversation is not retried and is marked as a real change', async () => {
  for (const next of [scope('g2', 'card-b'), scope('g2', 'card-a', 'session-b'), null]) {
    const {native, calls} = fakeNative({next: next ?? scope('g1')});
    if (next === null) native.request = (orig => async (action, payload) => action === 'native.context' && calls.length ? (calls.push(action), {cardScope: null}) : orig(action, payload))(native.request);
    const {call} = createTransport(native);
    await call('native.context');
    await assert.rejects(call('playerIdeas', {runId: 'r'}), e => e.code === 'CARD_CONTEXT_CHANGED' && e.cardChanged === true);
    assert.equal(calls.filter(a => a === 'playerIdeas').length, 1);
  }
});

test('retries at most once and never loops on native.context itself', async () => {
  const {native, calls} = fakeNative({next: scope('g2'), failures: 5});
  const {call} = createTransport(native);
  await call('native.context');
  await assert.rejects(call('runView', {runId: 'r'}), {code: 'CARD_CONTEXT_CHANGED'});
  assert.deepEqual(calls, ['native.context', 'runView', 'native.context', 'runView']);
});

test('concurrent failures share one context refresh', async () => {
  const {native, calls} = fakeNative({next: scope('g2'), failures: 2});
  const {call} = createTransport(native);
  await call('native.context');
  await Promise.all([call('runView', {runId: 'r'}), call('historyPage', {runId: 'r'})]);
  assert.equal(calls.filter(a => a === 'native.context').length, 2);
});

test('a dropped Studio record (REQUIRED) is retried once after the context re-acquires it', async () => {
  const calls = []; let lost = true;
  const native = {async request(action, payload) {
    calls.push(action);
    if (action === 'native.context') return {cardScope: scope('g9')};
    if (lost) { lost = false; throw Object.assign(new Error('no record'), {code: 'CARD_CONTEXT_REQUIRED'}); }
    return {ok: action};
  }};
  const {call} = createTransport(native);
  await call('native.context');
  assert.deepEqual(await call('runView', {runId: 'r'}), {ok: 'runView'});
  assert.deepEqual(calls, ['native.context', 'runView', 'native.context', 'runView']);
});
