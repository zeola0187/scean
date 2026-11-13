// The stage shelf for the work bound to this conversation: continue a
// performance, or start a new one from a saved script version.
import {h} from './s2-core.mjs';
import {clockText} from './s2-render.mjs';

const ago = t => { const ms = Date.now() - Date.parse(t ?? ''); if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`; };
const STATUS = {source_missing: '來源工作卡已不存在；既有演出仍可閱讀。', source_recycled: '來源工作卡已移到回收區；既有演出仍可閱讀。', source_pending: '來源工作卡正在處理中，請稍後。', session_archived: '這個創作對話已封存。', unavailable: '目前無法確認作品來源，請稍後重試。'};

export function productNav(actions, current) {
  return h('nav', {class: 'product-nav', 'aria-label': 'SCEAN'},
    h('span', {class: 'brand'}, h('span', {class: 'brand-mark'}, 'S'), h('span', {class: 'brand-name'}, 'SCEAN')),
    h('div', {class: 'nav-tabs', role: 'tablist'},
      [['home', '作品'], ['studio', '創作'], ['stage', '舞台']].map(([id, label]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(id === current), class: id === current ? 'on' : '', onclick: () => id === 'stage' ? actions.home() : actions.nav(id)}, label))));
}

export function renderShelf(s, actions) {
  const ctx = s.context, scoped = !!ctx?.cardScope;
  const title = s.latest?.snapshot?.card?.name ?? s.scripts[0]?.title ?? '這個作品';
  const head = h('header', {class: 'shelf-bar'}, productNav(actions, 'stage'),
    h('button', {class: 'ghost small', type: 'button', onclick: () => actions.sheet('settings')}, '顯示'));
  if (!scoped) return h('div', {class: 'shelf'}, head, h('main', {class: 'shelf-main'},
    h('section', {class: 'empty-state big'}, h('p', {class: 'eyebrow'}, '舞台'), h('h1', null, '這個對話還沒有作品'),
      h('p', null, '舞台會演出「創作」裡保存好的劇本。先到創作選一張角色卡，或請 AI 從一個想法開始。'),
      h('div', {class: 'row'}, h('button', {class: 'primary', type: 'button', 'data-autofocus': true, onclick: () => actions.nav('studio')}, '前往創作'), h('button', {class: 'ghost', type: 'button', onclick: () => actions.nav('home')}, '看所有作品'))),
    s.error ? h('p', {class: 'error'}, s.error.message ?? '') : null));

  const latest = s.latest, lastRow = s.runs[0];
  const status = ctx.playbackStatus?.status && STATUS[ctx.playbackStatus.status];
  const resume = latest ? h('article', {class: 'resume'},
    h('div', {class: 'resume-copy'},
      h('p', {class: 'eyebrow'}, `繼續演出${latest.playerIdentity?.name ? ' · ' + latest.playerIdentity.name : ''}`),
      h('h1', {class: 'resume-title'}, title),
      h('p', {class: 'resume-where'}, [clockText(latest.storyClockLabel), `${latest.turnCount ?? 0} 段`].filter(Boolean).join(' · ')),
      latest.lastTurn?.body ? h('blockquote', {class: 'resume-line'}, latest.lastTurn.body.split(/\n+/).filter(Boolean).at(-1)) : latest.openingDisplay ? h('blockquote', {class: 'resume-line'}, latest.openingDisplay.slice(0, 120)) : null,
      h('div', {class: 'row'}, h('button', {class: 'primary big', type: 'button', 'data-autofocus': true, onclick: () => actions.open(latest.runId)}, '繼續閱讀'), h('span', {class: 'meta'}, ago(lastRow?.updatedAt))))) : null;

  const scripts = s.scripts.length ? h('section', {class: 'shelf-section'},
    h('div', {class: 'section-head'}, h('h2', null, latest ? '開一場新的演出' : '開始演出'), h('p', {class: 'meta'}, '每一場演出固定使用保存當下的劇本版本；之後修改作品不會影響已開始的演出。')),
    h('ul', {class: 'scripts'}, s.scripts.map((sc, i) => h('li', null, h('div', {class: 'script'},
      h('div', null, h('strong', null, sc.title ?? title, s.scripts.length > 1 && i === 0 ? h('span', {class: 'tag'}, '最新') : null),
        h('p', {class: 'meta'}, [`劇本版本 r${sc.revision ?? '—'}`, sc.createdAt ? `保存於 ${ago(sc.createdAt)}` : null, `${s.runs.filter(r => r.scriptId === sc.scriptId).length} 場演出`].filter(Boolean).join(' · '))),
      h('button', {class: latest ? 'ghost' : 'primary', type: 'button', onclick: () => actions.startScript(sc)}, '選開場並開演')))))) :
    h('section', {class: 'empty-state'}, h('strong', null, '還沒有保存的劇本'), h('p', null, '在「創作」裡完成檢查並保存劇本後，就能在這裡開演。'), h('button', {class: latest ? 'ghost' : 'primary', type: 'button', onclick: () => actions.nav('studio')}, '前往創作'));

  const others = s.runs.slice(latest ? 1 : 0);
  const saves = others.length ? h('section', {class: 'shelf-section'}, h('h2', null, '其他演出'),
    h('ul', {class: 'save-list'}, others.map(r => h('li', null, h('button', {class: 'save-row', type: 'button', onclick: () => actions.open(r.runId)},
      h('span', {class: 'save-copy'}, h('strong', null, r.playerName ? `${r.playerName} 的故事` : (r.title ?? '演出')), h('span', {class: 'meta'}, `${r.turnCount ?? 0} 段 · ${ago(r.updatedAt)}`)),
      h('span', {class: 'meta'}, '繼續 ›')))))) : null;

  return h('div', {class: 'shelf'}, head, h('main', {class: 'shelf-main'},
    status ? h('p', {class: 'notice warn', role: 'status'}, status) : null,
    s.notice ? h('p', {class: 'notice', role: 'status'}, s.notice) : null,
    resume ?? h('header', {class: 'work-head'}, h('p', {class: 'eyebrow'}, '舞台'), h('h1', null, title)),
    scripts, saves,
    h('footer', {class: 'shelf-foot'}, h('button', {class: 'link', type: 'button', onclick: () => actions.useLegacy()}, '使用舊版舞台（完整進階設定）'))));
}
