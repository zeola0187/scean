import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { WorkspaceClient } from '../cardstudio-bundle/lib/client-controller.js';

// Local installed-source fixture is deliberately excluded from Git. No DSH,
// browser, filesystem tools, provider, or real session is started by these tests.
const fixtureUrl = new URL('../evidence/app-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url);
const nativeSource = await fs.readFile(fixtureUrl, 'utf8');
assert.equal(createHash('sha256').update(nativeSource).digest('hex'), '64843c950b829f44feed3248af6c46bbd620cf85e7c687b4f7f60e1ec4eb4782', 'DSH 0.2.0-rc.2 source fixture changed; review its contract');
const start = nativeSource.indexOf('function ConversationContent(props) {');
assert(start >= 0);
const contentSource = nativeSource.slice(start, nativeSource.indexOf('//#endregion', start));
const dockExpression = nativeSource.match(/variant === "composer" && input !== void 0 && sessionId !== void 0 \? renderSlot\("conversation\.composer\.dock", \{\}\) : null/)[0];
const createElement = (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } });
const react = {
  createElement, Fragment: 'fragment', useState: initial => [initial, () => {}],
  useRef: current => ({ current }), useCallback: fn => fn, useEffect: () => {},
};
const nativeContent = vm.runInNewContext(`${contentSource}; ConversationContent`, {
  react, react_jsx_runtime: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  ConversationRoot_module_css_default: {}, clsx: (...parts) => parts.filter(Boolean).join(' '),
  ConversationSessionView: 'native-views', NoConversationWidthControls: 'native-width',
  HeroShell: 'native-hero', WorkspaceChip: 'native-workspace',
  workspaceLabel: value => value, workspaceDisplayTitle: value => value,
});
function nativeRender({ hero, registered = new Map(), sessionId = 'synthetic-card-session' }) {
  const invoked = [], visible = [];
  const session = sessionId === undefined ? undefined : { id: sessionId };
  const input = sessionId === undefined ? undefined : { text: '' };
  const renderSlot = (name, props) => {
    invoked.push({ name, props });
    for (const registration of registered.values()) if (registration.name === name) visible.push({ ...registration, element: registration.component(props) });
    if (name === 'conversation.composer.bar') vm.runInNewContext(dockExpression, { variant: props.variant, input, sessionId, renderSlot });
    return { type: 'native-slot', props: { name } };
  };
  nativeContent({
    sessionId, hero, phase: hero ? 'blank' : 'active',
    useSession: selector => selector(session), useInput: selector => selector(input),
    useSessions: selector => selector({ byId: session ? { [sessionId]: { cwd: 'C:/Synthetic User/Card Studio' } } : {} }),
    useSessionStatus: selector => selector(new Map()),
    useWorkspaces: selector => selector({ phase: 'ready', items: [{ workspaceId: 'synthetic-workspace', title: 'DSH-CardStudio', sessionIds: session ? [sessionId] : [] }] }),
    useComposerBlock: selector => selector(undefined), useFactorySlot: (_name, fallback) => fallback,
    renderSlot, renderSlotChain: (_name, _props, options) => options.fallback,
    selectWorkspace: async () => { throw new Error('Tests never create a session'); }, t: key => key,
  });
  return { invoked, visible };
}
const generatedClient = await fs.readFile(new URL('../cardstudio-bundle/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const success = value => ({ ok: true, value });
const capabilities = { skills: [{ name: 'synthetic-guide', description: 'Synthetic' }], tools: [] };
function mountClient(respond = request => success(request.action === 'acquire' ? { lease_id: 'synthetic-lease' } : capabilities), initialRow = { id: 'synthetic-card-session', cwd: 'C:/Synthetic User/Card Studio', retainedBy: { mainView: 1 } }) {
  let descriptor, row = initialRow, subscription;
  const registered = new Map(), requests = [], cleanups = [], selected = [], timers = new Map();
  let timerId = 0;
  vm.runInNewContext(generatedClient, {
    window: { __ModuleLoader__: { load: value => { descriptor = value; } } },
    crypto: { randomUUID: () => 'synthetic-page-001' },
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
  });
  const module = descriptor.factory(name => { assert.equal(name, 'react'); return react; });
  const ctx={
    get(name){return name.split('.').reduce((value,key)=>value?.[key],this);},
    on:()=>()=>{},
    inject(names,fn){if(names.includes('remote.session')&&!this.get('remote.session'))return;assert(names.every(name=>this.get(name)!==undefined));fn(this);},
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    locale: { register: () => () => {}, bind: () => key => key },
    layout: { selectPanel: value => selected.push(value) },
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => { const key = options.key ?? options.id; assert(!registered.has(key), 'duplicate Client registration'); registered.set(key, { ...options, component }); return () => registered.delete(key); },
    },
    sessions: { list: {
      getSnapshot: () => ({ byId: row ? { [row.id]: row } : {} }),
      subscribe: fn => { subscription = fn; return () => { subscription = undefined; }; },
    } },
    typert:{},
    remote: {directoryPicker:{pick:async()=>({ok:true,value:null})},async $mount(){},cardstudio:{request:async(id,request)=>{assert.equal(id,'synthetic-card-session');if(request.action==='workspace')return {ok:true,value:success({workspace:'C:/Synthetic User/Card Studio'})};requests.push(JSON.parse(JSON.stringify(request)));return {ok:true,value:await respond(request)};}}, commands: { execute: async (id, text, attachments) => {
      assert.equal(id, 'synthetic-card-session'); assert.deepEqual([...attachments], []);
      assert(text.startsWith('/cardstudio '));
      const request = JSON.parse(text.slice('/cardstudio '.length)); requests.push(request);
      const response = await respond(request);
      return { ok: true, value: { result: { text: JSON.stringify(response) } } };
    } } },
  };module.apply(ctx);
  return { registered, requests, selected, timers,
    change: value => { row = value; subscription?.(); },
    close: async () => { for (const fn of cleanups.reverse()) await fn(); },
  };
}
const panelOf=client=>{const view=client.registered.get('local-cardstudio').component();return view.type(view.props);};
const textOf = element => typeof element === 'string' ? element : Array.isArray(element) ? element.map(textOf).join(' ') : textOf(element?.props?.children ?? '');
const entry = render => render.visible.find(item => item.id === 'local-cardstudio-entry');
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}

test('installed DSH contract renders input dock for blank and active sessions; composer dock excludes hero', () => {
  for (const hero of [true, false]) {
    const result = nativeRender({ hero });
    assert(result.invoked.some(item => item.name === 'conversation.input.dock'));
    assert.equal(result.invoked.some(item => item.name === 'conversation.composer.dock'), !hero);
  }
});
test('generated Client entry reaches installed DSH blank hero and opens the existing main panel', async () => {
  const client = mountClient(); await flush();
  try {
    const dock = entry(nativeRender({ hero: true, registered: client.registered }));
    assert(dock, 'Card Studio entry is absent from the native blank-session render');
    dock.element.props.children[0].props.onClick(); assert.deepEqual(client.selected, ['local-cardstudio']);
    assert.deepEqual(client.requests.map(row => row.action), ['acquire', 'capabilities']);
  } finally { await client.close(); }
});
test('generated Client keeps its entry in the installed DSH active conversation render', async () => {
  const client = mountClient(); await flush();
  try { assert(entry(nativeRender({ hero: false, registered: client.registered }))); }
  finally { await client.close(); }
});
test('entry is present while acquire is pending and shows a connection failure without hiding', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const client = mountClient(() => pending);await flush();
  try {
    let dock = entry(nativeRender({ hero: true, registered: client.registered }));
    assert(dock, 'A connecting entry must be visible before the Host reply');
    assert(textOf(dock.element).includes('connecting'));
    resolve({ ok: false, error: { code: 'SYNTHETIC', message: 'synthetic connection failure' } }); await flush();
    dock = entry(nativeRender({ hero: true, registered: client.registered }));
    assert(dock); assert(textOf(dock.element).includes('connectionError'));
    const panel = panelOf(client);
    assert(textOf(panel).includes('synthetic connection failure'));
    assert(textOf(panel).includes('retry'));
  } finally { resolve(success({ lease_id: 'synthetic-lease' })); await client.close(); }
});
test('failed capabilities releases the acquired lease and preserves a visible error entry', async () => {
  const client = mountClient(request => request.action === 'capabilities'
    ? { ok: false, error: { code: 'SYNTHETIC', message: 'synthetic capability failure' } }
    : success({ lease_id: 'synthetic-lease' }));
  await flush();
  try {
    const dock = entry(nativeRender({ hero: true, registered: client.registered })); assert(dock);
    assert(textOf(dock.element).includes('connectionError'));
    assert(client.requests.some(request => request.action === 'release'));
  } finally { await client.close(); }
});
test('generated Client removes scoped entries and timers when changing to Other Workspace', async () => {
  const client = mountClient(); await flush();
  client.change({ id: 'synthetic-other-session', cwd: 'E:\\Other', retainedBy: { mainView: 1 } }); await flush();
  try {
    assert.equal(client.registered.size, 0); assert.equal(client.timers.size, 0);
    assert.deepEqual(client.requests.map(row => row.action), ['acquire', 'capabilities', 'release']);
  } finally { await client.close(); }
});
test('generated Client performs no Host operation before a workspace session exists', async () => {
  const client = mountClient(undefined, null); await flush();
  try { assert.equal(client.registered.size, 0); assert.equal(client.requests.length, 0); }
  finally { await client.close(); }
});
test('visible retry recovers without a model message; document operations wait for connection', async () => {
  let acquires = 0;
  const client = mountClient(request => request.action === 'acquire' && ++acquires === 1
    ? { ok: false, error: { code: 'SYNTHETIC', message: 'synthetic first connection failure' } }
    : success(request.action === 'acquire' ? { lease_id: 'synthetic-lease' } : capabilities));
  await flush();
  try {
    const buttons = elements(panelOf(client)).filter(element => element.type === 'button');
    const retry = buttons.find(element => textOf(element) === 'retry');
    assert(retry); assert.equal(retry.props.disabled, false);
    assert.equal(buttons.find(element => textOf(element) === 'refresh').props.disabled, true);
    assert.equal(buttons.find(element => textOf(element) === 'import').props.disabled, true);
    assert(!buttons.find(element => textOf(element) === 'back').props.disabled);
    await retry.props.onClick();
    assert.equal(client.registered.size, 4); assert.equal(client.timers.size, 1);
    assert.equal(textOf(entry(nativeRender({ hero: true, registered: client.registered })).element), 'title library');
    assert.deepEqual(client.requests.map(row => row.action), ['acquire', 'acquire', 'capabilities']);
  } finally { await client.close(); }
});
test('late capability failure cannot restore the entry after changing workspace', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const client = mountClient(request => request.action === 'capabilities' ? pending : success({ lease_id: 'synthetic-lease' }));
  await flush();
  client.change({ id: 'synthetic-other-session', cwd: 'E:\\Other', retainedBy: { mainView: 1 } });
  resolve({ ok: false, error: { code: 'SYNTHETIC', message: 'late failure from previous workspace' } }); await flush();
  try { assert.equal(client.registered.size, 0); assert.equal(client.timers.size, 0); }
  finally { await client.close(); }
});
test('controller rejects document calls until capability handshake has completed', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }), requests = [];
  const client = new WorkspaceClient({ root: 'C:/Synthetic User/Card Studio', pageId: 'synthetic-page-001',
    send: async (_id, request) => { requests.push(request.action); return request.action === 'capabilities' ? pending : success({ lease_id: 'synthetic-lease' }); },
    present: () => {}, show: () => {}, hide: () => {}, notify: () => {}, setTimer: () => 1, clearTimer: () => {},
  });
  const connecting = client.transition({ id: 'synthetic-card-session', cwd: 'C:/Synthetic User/Card Studio' }); await flush();
  try {
    await assert.rejects(client.call('imports'), /not ready/);
    assert.deepEqual(requests, ['acquire', 'capabilities']);
    resolve(success(capabilities)); await connecting;
    await client.call('imports'); assert.deepEqual(requests, ['acquire', 'capabilities', 'imports']);
  } finally { resolve(success(capabilities)); await connecting; await client.close(); }
});
