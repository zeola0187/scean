import {h} from '../lib/h.mjs';

const GENRE = {campus: '現代校園', road: '公路旅行', trpg: 'TRPG 冒險'};
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`; };

export function cover(genre, glyph, size = 'md') {
  return h('div', {class: `cover cover-${genre} cover-${size}`, 'aria-hidden': 'true'},
    h('span', {class: 'cover-art'}), h('span', {class: 'cover-glyph'}, glyph));
}

export function renderShelf(s, {actions}) {
  const [latest, ...others] = s.saves;
  const header = h('header', {class: 'shelf-bar'},
    h('div', {class: 'brand'}, h('span', {class: 'brand-mark'}, 'S'), h('span', {class: 'brand-name'}, 'SCEAN'), h('span', {class: 'brand-sub'}, '舞台')),
    h('span', {class: 'proto-chip', title: '使用合成資料，不呼叫模型'}, '原型 P0'),
    h('div', {class: 'bar-actions'},
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('lab')}, '原型控制台'),
      h('button', {class: 'ghost', type: 'button', onclick: () => actions.openSheet('settings')}, '顯示設定')));

  const continueSection = latest ? h('section', {class: 'shelf-section', 'aria-labelledby': 'continue-title'},
    h('h2', {id: 'continue-title', class: 'section-title'}, '繼續你的故事'),
    h('article', {class: `resume genre-${latest.genre}`},
      cover(latest.genre, latest.coverGlyph, 'lg'),
      h('div', {class: 'resume-copy'},
        h('p', {class: 'eyebrow'}, `${GENRE[latest.genre]} · ${latest.playerName} 的故事`),
        h('h3', {class: 'resume-title'}, latest.title),
        h('p', {class: 'resume-where'}, `${latest.clockLabel} · ${latest.location}`),
        h('blockquote', {class: 'resume-line'}, latest.lastLine),
        h('div', {class: 'resume-actions'},
          h('button', {class: 'primary', type: 'button', 'data-autofocus': true, onclick: () => actions.openRun(latest.runId)}, '繼續閱讀'),
          h('span', {class: 'meta'}, `${latest.turnCount} 段 · ${ago(latest.updatedAt)}`)))),
    others.length ? h('ul', {class: 'save-list'}, others.map(r => h('li', null,
      h('button', {class: 'save-row', type: 'button', onclick: () => actions.openRun(r.runId)},
        cover(r.genre, r.coverGlyph, 'sm'),
        h('span', {class: 'save-copy'}, h('strong', null, r.title), h('span', null, `${r.playerName} · ${r.clockLabel}`), h('span', {class: 'save-line'}, r.lastLine)),
        h('span', {class: 'meta'}, ago(r.updatedAt)))))) : null) : null;

  const works = h('section', {class: 'shelf-section', 'aria-labelledby': 'works-title'},
    h('div', {class: 'section-head'}, h('h2', {id: 'works-title', class: 'section-title'}, '作品'), h('p', {class: 'section-note'}, '三個合成範例，各自代表一種題材。')),
    h('ul', {class: 'works'}, s.works.map(w => h('li', null,
      h('button', {class: `work genre-${w.genre}`, type: 'button', onclick: () => actions.openSheet('work', w.workId)},
        cover(w.genre, w.coverGlyph),
        h('span', {class: 'work-copy'}, h('span', {class: 'eyebrow'}, GENRE[w.genre]), h('strong', {class: 'work-title'}, w.title), h('span', {class: 'work-tag'}, w.tagline),
          h('span', {class: 'meta'}, w.saves ? `${w.saves} 個存檔` : '還沒有存檔')))))));

  const doors = h('section', {class: 'shelf-section', 'aria-labelledby': 'doors-title'},
    h('h2', {id: 'doors-title', class: 'section-title'}, '開始的方式'),
    h('ul', {class: 'doors'},
      h('li', null, h('button', {class: 'door', type: 'button', onclick: () => actions.openSheet('work', s.works[0]?.workId)},
        h('strong', null, '試玩範例故事'), h('span', null, '直接選一個作品開始，不需要先製卡。'))),
      h('li', null, h('div', {class: 'door is-off', 'aria-disabled': 'true'},
        h('strong', null, '用角色卡開始'), h('span', null, '拖入 PNG 或 JSON 角色卡，檢查後開局。'), h('em', null, 'P0 未接入'))),
      h('li', null, h('div', {class: 'door is-off', 'aria-disabled': 'true'},
        h('strong', null, '和 AI 一起創作'), h('span', null, '到工作室與製卡助手整理設定、開場與時間。'), h('em', null, 'P0 未接入')))));

  return h('div', {class: 'shelf'}, header, h('main', {class: 'shelf-main'}, continueSection, works, doors,
    h('p', {class: 'footnote'}, '這是可操作的原型。所有作品、存檔與正文都是合成資料，只存在這個分頁的記憶體中，重新整理就會還原。')));
}
