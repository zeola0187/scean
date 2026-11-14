// Minimal Chrome DevTools Protocol driver for isolated loopback acceptance.
// Real mouse/keyboard events (Input.*), per-frame evaluation (the SCEAN stage
// lives in an opaque sandboxed iframe), screenshots. No dependencies.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const DESKTOP = {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false};
export const PHONE = {width: 390, height: 844, deviceScaleFactor: 2, mobile: true};
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({port = 9400 + Math.floor(Math.random() * 400), headless = true} = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'scean-cdp-'));
  const proc = spawn(CHROME, [...(headless ? ['--headless=new'] : []), '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], {stdio: 'ignore'});
  return connect(port, {onClose: async () => { proc.kill(); await sleep(400); try { rmSync(profile, {recursive: true, force: true}); } catch {} }});
}
// Attach to an already running Chromium/Electron (e.g. DSH Desktop started with --remote-debugging-port).
// Out-of-process iframes are reached through flattened auto-attached sessions, so the product's own
// site-isolation settings stay untouched.
export async function attach({port, match = t => t.type === 'page' && t.url.startsWith('dsh-app://')}) { return connect(port, {match}); }

async function connect(port, {match = t => t.type === 'page', onClose = async () => {}} = {}) {
  let targets;
  for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(match)) break; } catch {} await sleep(150); }
  const pageTarget = targets.find(match), ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, {once: true}));
  // contexts: frameId -> {contextId, sessionId}; frameSessions: frameId -> sessionId of an OOPIF target.
  let id = 0; const pending = new Map(), contexts = new Map(), frameSessions = new Map(), listeners = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.executionContextCreated') { const c = m.params.context; if (c.auxData?.isDefault) contexts.set(c.auxData.frameId, {contextId: c.id, sessionId: m.sessionId}); }
    if (m.method === 'Runtime.executionContextsCleared') for (const [k, v] of contexts) if (v.sessionId === m.sessionId) contexts.delete(k);
    if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
      const sid = m.params.sessionId; frameSessions.set(m.params.targetInfo.targetId, sid);
      for (const method of ['Runtime.enable', 'Page.enable']) ws.send(JSON.stringify({id: ++id, method, params: {}, sessionId: sid}));
      ws.send(JSON.stringify({id: ++id, method: 'Runtime.runIfWaitingForDebugger', params: {}, sessionId: sid}));
    }
    if (m.method === 'Target.detachedFromTarget') for (const [k, v] of frameSessions) if (v === m.params.sessionId) frameSessions.delete(k);
    for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, m => m.error ? reject(Object.assign(Error(method + ': ' + m.error.message), {cdp: m.error})) : resolve(m.result)); ws.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})})); });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true}).catch(() => {});
  const logs = [];
  listeners.push(m => { if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push({type: m.params.type, text: m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 500)}); if (m.method === 'Runtime.exceptionThrown') logs.push({type: 'exception', text: m.params.exceptionDetails.exception?.description?.slice(0, 500) ?? m.params.exceptionDetails.text}); });

  async function frames() {
    const {frameTree} = await send('Page.getFrameTree'); const out = [];
    const walk = (n, depth, sessionId) => { out.push({id: n.frame.id, url: n.frame.url, name: n.frame.name, depth, sessionId}); for (const c of n.childFrames ?? []) walk(c, depth + 1, sessionId); };
    walk(frameTree, 0);
    // Out-of-process iframes (Electron keeps site isolation on) live in their own attached sessions.
    const roots = [];
    for (const [, sid] of frameSessions) { try { const r = await send('Page.getFrameTree', {}, sid); if (!out.some(f => f.id === r.frameTree.frame.id)) roots.push({tree: r.frameTree, sid}); } catch {} }
    // Real depth from parent ids, so a sandboxed panel inside the stage is never mistaken for the stage.
    for (let pass = 0; pass < 4 && roots.length; pass++) for (const root of [...roots]) {
      const parent = out.find(f => f.id === root.tree.frame.parentId);
      if (parent) { walk(root.tree, parent.depth + 1, root.sid); roots.splice(roots.indexOf(root), 1); }
    }
    for (const root of roots) walk(root.tree, 9, root.sid);
    return out;
  }
  // Frame selection: 'main' or a predicate over frame tree rows (e.g. stage iframe = first about:srcdoc child).
  async function contextFor(frame = 'main') {
    const list = await frames();
    const row = frame === 'main' ? list[0] : typeof frame === 'function' ? list.find(frame) : list.find(f => f.id === frame);
    if (!row) throw Error('FRAME_NOT_FOUND');
    for (let i = 0; i < 60 && !contexts.has(row.id); i++) await sleep(50);
    const c = contexts.get(row.id) ?? {}; return {contextId: c.contextId, sessionId: c.sessionId, frameId: row.id};
  }
  async function evaluate(expr, frame = 'main') {
    const {contextId, sessionId} = await contextFor(frame);
    const r = await send('Runtime.evaluate', {expression: expr, contextId, awaitPromise: true, returnByValue: true, userGesture: true}, sessionId);
    if (r.exceptionDetails) throw Error('EVAL: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  }
  // Absolute page coordinates of an iframe's content origin.
  async function frameOffset(frame) {
    if (frame === 'main') return {x: 0, y: 0};
    const {frameId} = await contextFor(frame);
    const {backendNodeId} = await send('DOM.getFrameOwner', {frameId});
    const {model} = await send('DOM.getBoxModel', {backendNodeId});
    return {x: model.content[0], y: model.content[1]};
  }
  async function center(selectorOrText, frame = 'main') {
    const expr = `(()=>{const q=${JSON.stringify(selectorOrText)};let el=null;
      if(q.startsWith('css:'))el=document.querySelector(q.slice(4));
      else{const all=[...document.querySelectorAll('button,a,[role=button],[role=tab],[role=radio],[role=treeitem],[role=menuitem],[role=option],label,summary,input,textarea,select,li,h2,h3,[data-test]')].filter(e=>e.getClientRects().length);
        el=all.find(e=>(e.getAttribute('aria-label')||'').trim()===q)||all.find(e=>e.innerText?.trim()===q)||all.find(e=>e.innerText?.trim().startsWith(q))||all.find(e=>(e.getAttribute('aria-label')||'').includes(q))||[...document.querySelectorAll('span,div,p,strong')].filter(e=>e.getClientRects().length&&!e.children.length).find(e=>e.textContent.trim()===q);}
      if(!el)return null;el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:!!el.disabled};})()`;
    const pos = await evaluate(expr, frame); if (!pos) return null;
    const off = await frameOffset(frame); return {x: pos.x + off.x, y: pos.y + off.y, disabled: pos.disabled};
  }
  const api = {
    send, frames, evaluate, logs,
    async viewport(device) { await send('Emulation.setDeviceMetricsOverride', device); await send('Emulation.setTouchEmulationEnabled', device.mobile ? {enabled: true, maxTouchPoints: 5} : {enabled: false}); },
    // Real OS window size (Desktop): Electron has no CDP window bounds, so move the top-level window of `pid`.
    async windowSize(width, height, pid) {
      const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool MoveWindow(System.IntPtr h,int x,int y,int w,int ht,bool r); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h,int c);'; $h=(Get-Process -Id ${Number(pid)}).MainWindowHandle; [W.U]::ShowWindow($h,9) | Out-Null; [W.U]::MoveWindow($h,40,20,${Number(width)},${Number(height)},$true) | Out-Null`;
      const size = async () => (await send('Runtime.evaluate', {expression: '({w:innerWidth,h:innerHeight})', returnByValue: true})).result.value;
      const before = await size(); execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {windowsHide: true});
      // The renderer reports the new size a little later; wait until it changes and then holds still.
      let last = before, stable = 0;
      for (let i = 0; i < 40 && stable < 3; i++) { await sleep(150); const now = await size(); stable = now.w === last.w && now.h === last.h && (now.w !== before.w || now.h !== before.h) ? stable + 1 : 0; last = now; }
      return last; },
    async goto(url) { await send('Page.navigate', {url}); await sleep(600); },
    async waitFor(expr, {frame = 'main', timeout = 20000, label = expr} = {}) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { last = await evaluate(expr, frame); if (last) return last; } catch (e) { last = e.message; } await sleep(200); } throw Error('WAIT_TIMEOUT: ' + label + ' last=' + JSON.stringify(last)?.slice(0, 200)); },
    async click(target, {frame = 'main', timeout = 15000} = {}) {
      const end = Date.now() + timeout; let pos;
      while (Date.now() < end) { pos = await center(target, frame).catch(() => null); if (pos && !pos.disabled) break; await sleep(200); }
      if (!pos || pos.disabled) { try { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(process.cwd(), 'click-failure.png'), Buffer.from(r.data, 'base64')); } catch {} throw Error('CLICK_TARGET_NOT_FOUND: ' + target); }
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x: pos.x, y: pos.y, button: 'left', clickCount: 1});
      await sleep(250);
    },
    async type(text) { await send('Input.insertText', {text}); await sleep(100); },
    async key(key, modifiers = 0) { const map = {Enter: {code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'}, Escape: {code: 'Escape', windowsVirtualKeyCode: 27}}; const k = map[key]; await send('Input.dispatchKeyEvent', {type: 'keyDown', key, modifiers, ...k}); await send('Input.dispatchKeyEvent', {type: 'keyUp', key, modifiers, ...k}); await sleep(150); },
    async shot(file) { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(file, Buffer.from(r.data, 'base64')); return file; },
    async close() { try { ws.close(); } catch {} await onClose(); },
  };
  return api;
}
// The SCEAN stage iframe: the srcdoc child carrying the shared player.
export const STAGE_FRAME = f => f.depth === 1 && f.url === 'about:srcdoc';
