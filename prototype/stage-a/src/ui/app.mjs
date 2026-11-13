import {h, replace} from '../lib/h.mjs';
import {renderShelf} from './shelf.mjs';
import {createReader} from './reader.mjs';
import {renderSheet} from './sheets.mjs';

export function mountApp(root, ctx) {
  const {store, actions} = ctx;
  const screen = h('div', {class: 'screen'});
  const sheetHost = h('div', {class: 'sheet-host'});
  const live = h('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'});
  root.append(screen, sheetHost, live);
  let view = null, reader = null, sheetKey = null, lastFlash = null;

  function applyTheme(s) {
    const el = document.documentElement;
    if (s.prefs.theme === 'system') el.removeAttribute('data-theme'); else el.dataset.theme = s.prefs.theme;
    el.dataset.size = s.prefs.size;
    const genre = s.view === 'reader' && s.prefs.skin === 'genre' ? s.run?.snapshot?.genre ?? null : null;
    if (genre) el.dataset.genre = genre; else delete el.dataset.genre;
  }

  store.subscribe(s => {
    applyTheme(s);
    if (s.view !== view) {
      view = s.view; reader?.dispose(); reader = null;
      if (view === 'reader') { reader = createReader(ctx); replace(screen, reader.el); }
    }
    if (view === 'shelf') replace(screen, renderShelf(s, ctx));
    else reader.update(s);

    const key = s.sheet ? JSON.stringify([s.sheet.kind, s.sheet.arg, s.sheetData?.stamp ?? null, s.run?.version, s.op?.phase, s.prefs, s.spoilerOk[s.runId], s.works.length, s.saves.length]) : null;
    if (key !== sheetKey) {
      sheetKey = key;
      const wasOpen = sheetHost.firstChild;
      const scrollTop = sheetHost.querySelector('.sheet-body')?.scrollTop ?? 0;
      replace(sheetHost, s.sheet ? renderSheet(s, ctx) : null);
      document.body.classList.toggle('has-sheet', !!s.sheet);
      const body = sheetHost.querySelector('.sheet-body');
      if (wasOpen && s.sheet) sheetHost.querySelector('.sheet')?.classList.add('no-anim');
      if (body && wasOpen && s.sheet) body.scrollTop = scrollTop;
      if (s.sheet && !wasOpen) requestAnimationFrame(() => sheetHost.querySelector('[data-autofocus], .sheet-close')?.focus({preventScroll: true}));
    }
    if (s.flash && s.flash !== lastFlash) { lastFlash = s.flash; live.textContent = s.flash.kind === 'confirmed' ? '已確認保存。' : '這一段已保存。'; }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && store.get().sheet && !e.isComposing) { e.preventDefault(); actions.closeSheet(); }
  });
}
