// Minimal observable store; renders are batched to one per animation frame.
export function createStore(initial) {
  let state = initial, queued = false;
  const subs = new Set();
  const flush = () => { queued = false; for (const fn of subs) fn(state); };
  return {
    get: () => state,
    set(patch) {
      state = typeof patch === 'function' ? patch(state) : {...state, ...patch};
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    flushNow: flush,
  };
}

export const prefs = {
  read(key, fallback) { try { const v = localStorage.getItem('scean-p0.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem('scean-p0.' + key, JSON.stringify(value)); } catch { /* storage unavailable: preference stays in memory */ } },
};
