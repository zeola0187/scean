// Stage v2 foundation: DOM helpers, a tiny store and the native transport.
// Runs inside the opaque sandboxed iframe: no storage, no network, text only.
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'tabIndex', 'open', 'selected', 'htmlFor']);
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x); }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendKids(el, kids);
  return el;
}
export function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false || k === true) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}
export function replace(el, ...kids) { el.replaceChildren(); return appendKids(el, kids); }

export function createStore(initial) {
  let state = initial, queued = false; const subs = new Set();
  const flush = () => { queued = false; for (const fn of subs) fn(state); };
  return {
    get: () => state,
    set(patch) { state = typeof patch === 'function' ? patch(state) : {...state, ...patch}; if (!queued) { queued = true; requestAnimationFrame(flush); } },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    flushNow: flush,
  };
}

export const uuid = () => globalThis.crypto.randomUUID();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every Host read/write goes through the authenticated native bridge. A
// timeout never means failure: callers must look the operation up again.
export function createTransport(native) {
  async function call(action, payload = {}, {timeout = 15000, signal} = {}) {
    if (!native) throw Object.assign(new Error('新版舞台只在 DSH 內使用；請從 DSH 的舞台入口開啟。'), {code: 'NATIVE_REQUIRED'});
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    signal?.addEventListener('abort', () => controller.abort(), {once: true});
    try { return await native.request(action, payload, controller.signal); }
    catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw Object.assign(new Error('連線沒有在時間內回應；原本的操作可能仍在進行。'), {code: 'CONNECTION_UNKNOWN', category: 'transport'});
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {call, native: !!native};
}

// Player-language errors. Codes stay available in diagnostics, not headlines.
const MESSAGES = {
  CARD_CONTEXT_REQUIRED: '這個對話還沒有選定作品。請先到「創作」選一張工作卡。',
  CARD_CONTEXT_CHANGED: '這個對話的作品已經變更，請重新整理。',
  RUN_BUSY: '這一局正在處理上一個行動，請稍候。',
  RUN_NOT_FOUND: '找不到這個存檔，可能已被移到回收區。',
  OPENING_STALE: '開場資訊已經更新，請重新選擇。', OPENING_EXPIRED: '開場選擇已逾時，請重新選擇。',
  VERSION_CONFLICT: '故事剛剛更新過，請重新整理後再試。', STALE_HISTORY_TARGET: '最後一段已經變更，請重新確認。',
  MODEL_TIMEOUT: '模型沒有在時間內完成，這一輪沒有保存。', CANCELLED: '已取消，這一輪沒有保存。',
  NEEDS_TIME_PRECISION: '故事需要你確認這一步的時間。',
  IDEAS_STALE: '故事剛剛有更新，請再按一次「想法」。', IDEAS_BUSY: '正在取得想法，請稍候。',
};
export function friendly(error) {
  if (!error) return '';
  const code = error.code ?? error.failure?.code;
  return MESSAGES[code] ?? (typeof error.message === 'string' && /[一-鿿]/.test(error.message) ? error.message : '操作沒有完成。') ;
}
