// Invented material for the isolated stage-next official DSH harness. Never user RP.
// Three genre cards (campus / road trip / TRPG) and one scripted adapter that
// answers every SCEAN model stage plus a minimal Card Studio co-author.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {frontendPackage} from '../core/frontend.mjs';

const W = (category, key, displayName, type, extra = {}) => ({scope: 'world', category, key, displayName, type, visibility: 'public', ...extra});
const value = (v, val) => ({scope: v.scope, category: v.category, key: v.key, value: val, source: {id: 'synthetic-author', version: 1}});

function genreCard(spec) {
  const bp = {schemaVersion: 1, id: spec.id + '-state', version: 1, extensionPolicy: 'allow', variables: [...spec.variables,
    // Restricted canary: must never appear in any player-facing surface.
    W('facts', 'backstage_truth', 'RESTRICTED_LABEL_CANARY', 'string', {visibility: 'restricted'})]};
  const initial = {schemaVersion: 1, blueprintId: bp.id, blueprintVersion: 1, values: [...spec.variables.map(v => value(v, v.type === 'json' ? {status: spec.initial[v.key], assignees: ['player'], progress: 0} : spec.initial[v.key])), value(bp.variables.at(-1), 'RESTRICTED_VALUE_CANARY')]};
  const bindings = spec.variables.filter(v => v.type !== 'json').map(v => ({alias: v.key, target: {scope: 'world', category: v.category, key: v.key}, type: v.type === 'enum' ? 'enum' : v.type}));
  const frontend = frontendPackage({schemaVersion: 1, id: spec.id + '-panel', runtime: {profile: 'scean-html-bindings-v1', apiMajor: 1}, html: spec.panel.html, css: spec.panel.css, bindings, conditions: {}, capabilities: {network: 'none', worldActions: [], derivedDisplays: []}}, bp, spec.characters);
  return {spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: spec.title, description: spec.description, personality: '', scenario: spec.scenario, first_mes: spec.openings[0].text,
    mes_example: '', creator_notes: 'Synthetic stage-next fixture; no private card data.', system_prompt: '', post_history_instructions: '',
    alternate_greetings: spec.openings.slice(1).map(o => o.text), tags: ['synthetic', spec.genre], creator: 'SCEAN stage-next fixture', character_version: '1',
    character_book: {name: spec.title + '設定', extensions: {}, entries: spec.lore.map((e, i) => ({id: i + 1, keys: e.keys, comment: e.title, content: e.text, enabled: true, insertion_order: i, constant: !!e.constant, extensions: {}}))},
    extensions: {scean: {presentationTheme: spec.theme, characters: spec.characters, stateBlueprint: bp, initialState: initial, frontend, storyTimeDefinition: spec.time,
      worldRoutineDefinition: {schemaVersion: 1, calendar: true, forum: true, medium: spec.medium}}},
  }};
}

export const GENRES = {
  campus: {
    id: 'campus-rooftop', genre: 'campus', theme: 'campus', title: '放學後的天台', medium: {id: 'night-board', label: '星川夜話板'},
    description: '星川高中的天台已經封閉三年。轉學生在放學後聽見上方傳來鋼琴聲，攝影社的許晴說，她拍到過一扇本該上鎖的門。',
    scenario: '現代校園，轉學第一週。',
    characters: [
      {id: 'qing', name: '許晴', description: '攝影社二年級生，總是掛著底片相機，對學校傳聞的興趣比對考試大。', publicDescription: '攝影社二年級生，總是掛著底片相機，對學校傳聞的興趣比對考試大。'},
      {id: 'mu', name: '周牧', description: '學生會副會長，守規矩、記時間，負責天台鑰匙的保管登記。', publicDescription: '學生會副會長，守規矩、記時間，負責天台鑰匙的保管登記。'},
      {id: 'ye', name: '葉老師', description: '導師兼音樂科老師，溫和但很少談自己的事。', publicDescription: '導師兼音樂科老師，溫和但很少談自己的事。'},
    ],
    variables: [W('locations', 'player_location', '目前地點', 'string'), W('tasks', 'piano_mystery', '鋼琴聲之謎', 'json'), W('tasks', 'club_form', '社團申請', 'json'), W('equipment', 'photo_evidence', '證據照片', 'number', {min: 0, max: 20, unit: '張'})],
    initial: {player_location: '三樓樓梯口', piano_mystery: '剛聽見琴聲', club_form: '週四前要交', photo_evidence: 0},
    time: {schemaVersion: 1, calendar: {id: 'hoshikawa', version: 1, kind: 'fixed-month', monthLengths: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], anchor: {year: 2026, month: 4, day: 15}, weekLength: 7},
      hoursPerDay: 24, minutesPerHour: 60, periods: {morning: {start: 420, end: 719, label: '上午'}, noon: {start: 720, end: 779, label: '午休'}, afternoon: {start: 780, end: 959, label: '下午'}, after_school: {start: 960, end: 1139, label: '放學後'}, night: {start: 1140, end: 1439, label: '夜晚'}},
      initial: {dayOrdinal: 1, precision: 'period', periodId: 'after_school'}},
    openings: [{text: '放學的鐘聲剛停，走廊上只剩拖地的水痕。你抱著還沒填完的社團申請表經過樓梯口，聽見上方傳來斷斷續續的鋼琴聲。天台的門，三年前就封起來了。'},
      {text: '攝影社暗房的紅燈下，許晴把一張剛顯影的照片推到你面前。畫面裡，天台的門開著一道縫。「這是昨天放學後拍的，」她壓低聲音，「你要不要一起去看看？」'}],
    lore: [{title: '天台封閉', keys: ['天台'], text: '三年前一場意外後，天台改為禁止進入，鑰匙由學生會登記保管。', constant: true},
      {title: '舊音樂教室', keys: ['音樂教室', '鋼琴'], text: '頂樓的舊音樂教室已停用，裡面仍放著一台走音的直立鋼琴。'}],
    panel: {html: '<section class="card"><h2>學生手帳</h2><p>地點 <b data-scean-text="player_location"></b></p><p>證據照片 <b data-scean-text="photo_evidence"></b> 張</p></section>', css: '.card{padding:18px;background:#f7fbff;color:#173a7a;border:2px dashed #9db7e8;border-radius:14px}h2{font-size:20px;margin:0 0 8px}'},
    beats: [
      {body: '你們沿著走廊往學生會辦公室走。門半掩著，周牧正把一串鑰匙收進抽屜。\n\n「放學了還在這裡？有事嗎。」周牧抬起頭。\n\n他的視線停在許晴的相機上，又移到你手裡的申請表。\n\n「我們只是想問，天台的鑰匙一直都在嗎？」許晴說。\n\n「……登記表上寫得很清楚。」',
        dialogue: [['mu', '放學了還在這裡？有事嗎。'], ['qing', '我們只是想問，天台的鑰匙一直都在嗎？'], ['mu', '……登記表上寫得很清楚。']],
        changes: [['locations', 'player_location', '學生會辦公室'], ['tasks', 'piano_mystery', '周牧似乎在隱瞞什麼']], time: {elapsedMinutes: 20}},
      {body: '中庭的路燈一盞接一盞亮起。你們繞到音樂教室後方，窗簾沒有拉好。\n\n裡面沒有人，但琴蓋是打開的，譜架上夾著一張手寫樂譜，標題被鉛筆塗掉了。許晴舉起相機按下快門。\n\n「這字跡……跟公告欄上某個人的很像。」許晴低聲說。',
        dialogue: [['qing', '這字跡……跟公告欄上某個人的很像。']],
        changes: [['locations', 'player_location', '音樂教室後窗'], ['equipment', 'photo_evidence', 1], ['tasks', 'piano_mystery', '找到一張被塗掉標題的樂譜']], time: {advancePeriods: 1}},
      {body: '隔天早上，葉老師在點名後叫住你。\n\n「程同學，社團申請表交了嗎？攝影社的話，週四博覽會之前要給我簽名。」葉老師說。\n\n她說話時看著窗外，手指在講桌上輕輕敲著，節奏和昨天的琴聲很像。',
        dialogue: [['ye', '程同學，社團申請表交了嗎？攝影社的話，週四博覽會之前要給我簽名。']],
        changes: [['locations', 'player_location', '二年三班教室']], time: {nextDay: 'morning'}},
    ],
  },
  road: {
    id: 'road-ferry', genre: 'road', theme: 'road', title: '往南的末班渡輪', medium: {id: 'south-board', label: '南下旅人留言板'},
    description: '失聯半年的樂團主唱寄來一張明信片，郵戳是南方離島。你和阿哲、沈蔓開著那台叫「小藍」的舊車沿濱海公路南下，第三天清晨的渡輪是這一季最後一班。',
    scenario: '公路旅行，三天兩夜。',
    characters: [
      {id: 'zhe', name: '阿哲', description: '駕駛兼前鼓手，開車很穩、話很少，不讓任何人碰小藍的方向盤。', publicDescription: '駕駛兼前鼓手，開車很穩、話很少，不讓任何人碰小藍的方向盤。'},
      {id: 'man', name: '沈蔓', description: '副駕與攝影，負責地圖和底片，常常因為想停車拍照跟阿哲吵起來。', publicDescription: '副駕與攝影，負責地圖和底片，常常因為想停車拍照跟阿哲吵起來。'},
      {id: 'wei', name: '魏伯', description: '在濱海公路邊顧了三十年加油站的老闆，知道哪一段路晚上會起霧。', publicDescription: '在濱海公路邊顧了三十年加油站的老闆，知道哪一段路晚上會起霧。'},
    ],
    variables: [W('locations', 'player_location', '位置', 'string'), W('resources', 'fuel', '油量', 'number', {min: 0, max: 4, unit: '格'}), W('resources', 'cash', '現金', 'number', {min: 0, max: 100000, unit: '元'}), W('equipment', 'film', '拍立得底片', 'number', {min: 0, max: 20, unit: '張'}), W('tasks', 'ferry', '末班渡輪', 'json'), W('effects', 'weather', '天候', 'string')],
    initial: {player_location: '濱海公路 112K', fuel: 2, cash: 4200, film: 6, ferry: '第三日清晨 06:40 開船', weather: '晴，海風大'},
    time: {schemaVersion: 1, calendar: {id: 'trip', version: 1, kind: 'relative'}, hoursPerDay: 24, minutesPerHour: 60,
      periods: {dawn: {start: 300, end: 479, label: '清晨'}, day: {start: 480, end: 1019, label: '白天'}, dusk: {start: 1020, end: 1139, label: '黃昏'}, night: {start: 1140, end: 1439, label: '夜間'}},
      initial: {dayOrdinal: 1, precision: 'period', periodId: 'dusk'}},
    openings: [{text: '凌晨四點，小藍的引擎咳了兩聲才發動。沈蔓把明信片夾在遮陽板上，郵戳上的港口名字被雨水暈開了一半。「三天，」阿哲說，「趕不上就要等到明年春天。」'}],
    lore: [{title: '濱海公路', keys: ['公路', '霧'], text: '沿海岸線南下的雙線道，夜間 140K 至 160K 之間常起霧。', constant: true}, {title: '末班渡輪', keys: ['渡輪', '港口'], text: '本季最後一班在第三日清晨 06:40 開出，錯過需等到隔年三月。'}],
    panel: {html: '<section class="dash"><p class="k">FUEL</p><p class="v"><b data-scean-text="fuel"></b>/4</p><p class="k">CASH</p><p class="v"><b data-scean-text="cash"></b></p></section>', css: '.dash{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;padding:16px;background:#21303d;color:#ffd9a0;border-radius:6px;font-family:monospace}.k{margin:0;opacity:.7}.v{margin:0;font-size:20px}'},
    beats: [
      {body: '加油站的招牌只亮了一半。一個穿著舊工作服的老人從亭子裡走出來，敲了敲小藍的引擎蓋。\n\n「這台老車，你們要跑多遠？」魏伯問。\n\n「南邊的港口。後天早上的船。」沈蔓說。\n\n「那今晚別走 150K 那段。霧一起來，連路邊的護欄都看不到。」',
        dialogue: [['wei', '這台老車，你們要跑多遠？'], ['man', '南邊的港口。後天早上的船。'], ['wei', '那今晚別走 150K 那段。霧一起來，連路邊的護欄都看不到。']],
        changes: [['locations', 'player_location', '魏伯加油站 128K'], ['resources', 'fuel', 4], ['resources', 'cash', 3300]], time: {elapsedMinutes: 30}},
      {body: '你們最後還是上路了。過了 145K，霧從海面漫上來，遠光燈只照得到前方三公尺。\n\n「……都別說話。」阿哲說。\n\n沈蔓握著拍立得，沒有按下快門。',
        dialogue: [['zhe', '……都別說話。']],
        changes: [['locations', 'player_location', '濱海公路 151K'], ['effects', 'weather', '濃霧'], ['resources', 'fuel', 3]], time: {advancePeriods: 1}},
      {body: '霧散的時候天已經亮了。路邊停著一排賣早餐的小貨車，海面是灰藍色的。\n\n「幫我拍一張。這是我們第一個看見的日出。」沈蔓說。\n\n阿哲終於把車停下來，靠在車門邊。',
        dialogue: [['man', '幫我拍一張。這是我們第一個看見的日出。']],
        changes: [['effects', 'weather', '晴'], ['equipment', 'film', 5], ['locations', 'player_location', '海線早餐車 170K']], time: {nextDay: 'dawn'}},
    ],
  },
  trpg: {
    id: 'trpg-ashmine', genre: 'trpg', theme: 'fantasy', title: '灰燼礦坑', medium: {id: 'guild-board', label: '冒險者公會告示板'},
    description: '公會懸賞：灰燼礦坑第三層的礦工隊已失聯六日。你與半精靈遊俠艾琳、矮人戰士布洛克接下委託，在月蝕祭之前把他們帶回來。',
    scenario: '奇幻地城探索，TRPG 風格。',
    characters: [
      {id: 'ailin', name: '艾琳', description: '半精靈遊俠，在地面上比在地底自在，弓弦保養得一絲不苟。', publicDescription: '半精靈遊俠，在地面上比在地底自在，弓弦保養得一絲不苟。'},
      {id: 'brok', name: '布洛克', description: '矮人戰士，自稱認得礦坑的每一條礦脈，他的表弟在失蹤的礦工隊裡。', publicDescription: '矮人戰士，自稱認得礦坑的每一條礦脈，他的表弟在失蹤的礦工隊裡。'},
      {id: 'kas', name: '守墓人卡斯', description: '在礦坑入口旁小屋獨居的老人，只回答被問到的問題。', publicDescription: '在礦坑入口旁小屋獨居的老人，只回答被問到的問題。'},
    ],
    variables: [W('locations', 'player_location', '位置', 'string'), W('resources', 'hp', '生命值', 'number', {min: 0, max: 24, unit: '點'}), W('resources', 'torches', '火把', 'number', {min: 0, max: 10, unit: '支'}), W('resources', 'gold', '金幣', 'number', {min: 0, max: 9999}), W('tasks', 'missing_miners', '失蹤的礦工隊', 'json'), W('effects', 'condition', '狀態', 'string')],
    initial: {player_location: '第二層・坍方走廊', hp: 18, torches: 3, gold: 40, missing_miners: '六人失聯，往第三層', condition: '無'},
    time: {schemaVersion: 1, calendar: {id: 'harvest', version: 1, kind: 'fixed-month', era: '王曆', monthLengths: [30, 30, 30, 30], monthNames: ['播種月', '盛夏月', '收穫月', '霜降月'], anchor: {year: 312, month: 3, day: 12}},
      hoursPerDay: 24, minutesPerHour: 60, periods: {dawn: {start: 300, end: 479, label: '黎明'}, day: {start: 480, end: 1019, label: '白晝'}, dusk: {start: 1020, end: 1199, label: '黃昏'}, deep: {start: 1200, end: 1439, label: '深夜'}},
      initial: {dayOrdinal: 1, precision: 'period', periodId: 'day'}},
    openings: [{text: '升降籠的鐵鍊在黑暗中嘎嘎作響。布洛克舉起火把，礦坑第二層的空氣又冷又乾，牆上有新鮮的鑿痕。「這是我表弟的記號，」他說，「他們往下走了。」'}],
    lore: [{title: '灰燼礦坑', keys: ['礦坑'], text: '矮人氏族廢棄的舊礦坑，共四層。第三層以下的礦脈會在月蝕時發出微光。', constant: true}, {title: '月蝕祭', keys: ['月蝕'], text: '鎮上每年的祭典。傳說月蝕當晚，礦坑深處的門會打開。'}],
    panel: {html: '<section class="sheet"><h2>冒險者紀錄</h2><p>HP <b data-scean-text="hp"></b> / 24</p><progress max="24" data-scean-progress="hp"></progress><p>火把 <b data-scean-text="torches"></b></p></section>', css: '.sheet{padding:16px;background:#19161c;color:#f3d9a4;border:1px solid #a97b22}h2{font-family:serif;font-size:20px;margin:0 0 8px}'},
    beats: [
      {body: '你們一前一後鑽過縫隙。另一邊是一條向下傾斜的坑道，地上散落著礦工的工具。\n\n「有腳印，至少四個人。往下走，沒有回頭。」艾琳說。\n\n火把的光在潮濕的岩壁上晃動。遠處傳來規律的敲擊聲，三下，停頓，三下。',
        dialogue: [['ailin', '有腳印，至少四個人。往下走，沒有回頭。']],
        changes: [['locations', 'player_location', '第二層・傾斜坑道'], ['resources', 'torches', 2]], time: {elapsedMinutes: 40}},
      {body: '敲擊聲來自一扇鐵門。門從裡面被鐵條封住，門縫透出微弱的藍光。\n\n「是礦工的求救暗號……還是他們在警告我們別開門？」艾琳說。\n\n你伸手觸碰門把，指尖一陣刺痛。',
        dialogue: [['ailin', '是礦工的求救暗號……還是他們在警告我們別開門？']],
        changes: [['locations', 'player_location', '第三層入口・封鐵門'], ['resources', 'hp', 15], ['effects', 'condition', '指尖麻痺'], ['tasks', 'missing_miners', '找到從裡面封住的門']], time: {advancePeriods: 1}},
      {body: '布洛克終於從另一條路繞了過來，滿身都是石灰。他把耳朵貼在門上聽了很久。\n\n「三下，停，三下。這是我們氏族的『別進來』。」布洛克說。\n\n他的聲音第一次壓得這麼低。',
        dialogue: [['brok', '三下，停，三下。這是我們氏族的『別進來』。']],
        changes: [['effects', 'condition', '無'], ['resources', 'hp', 17]], time: {elapsedMinutes: 30}},
    ],
  },
};

const PRIOR_IDEAS = ['玩家行動', '角色自主', '場景展開', '世界自然運轉', '意外與轉折'];
const IDEAS = {
  campus: ['問許晴，她拍到開著的門是在幾點幾分。', '周牧可能主動來找你，問你昨天有沒有上樓。', '去舊音樂教室看看那台直立鋼琴。', '社團博覽會的準備讓走廊變得很吵，琴聲今天也許不會出現。', '你在置物櫃裡發現一張沒有署名的紙條。'],
  road: ['跟魏伯打聽港口附近哪裡有民宿。', '阿哲也許會在加油時第一次提起樂團解散的原因。', '在加油站的留言牆上找找主唱的筆跡。', '天色暗得很快，霧可能比魏伯說的更早出現。', '小藍的引擎蓋下冒出一縷白煙。'],
  trpg: ['用鐵鍬輕敲三下，回應門後的暗號。', '布洛克可能堅持要破門，不管暗號是什麼意思。', '沿著腳印的反方向，找礦工隊來時的路。', '火把燒得比預期快，你們得決定要不要回地面補給。', '門後的敲擊聲突然變成了四下。'],
};
const FORUM = {
  campus: {authorId: 'qing', title: '今晚的琴聲停得特別早', text: '六點十分就停了。巧的是音樂教室的燈也是那時候關的。這只是我的觀察。'},
  road: {authorId: 'man', title: '第一張日出', text: '底片剩五張。希望最後一張能拍到她。'},
  trpg: {authorId: 'kas', title: '致仍在礦坑裡的人', text: '鐵門是從裡面封的。如果你聽見敲門聲，先數一數是幾下。'},
};
const CALENDAR = {campus: '社團博覽會', road: '漁港夜市', trpg: '月蝕祭'};

export async function seedStageNextStudio(workspace) {
  for (const folder of ['imports', 'library']) await fs.mkdir(path.join(workspace, folder), {recursive: true});
  for (const g of Object.values(GENRES)) await fs.writeFile(path.join(workspace, 'imports', g.id + '.json'), JSON.stringify(genreCard(g)));
}
export const stageNextCard = genre => genreCard(GENRES[genre]);

// Host-side test control: files in the evidence dir arm one-shot faults.
export async function readFault(out, stage) {
  const file = path.join(out, `fault-${stage}.json`);
  try { const v = JSON.parse(await fs.readFile(file, 'utf8')); await fs.unlink(file); return v; } catch { return null; }
}

function genreOf(text) { return text.includes('灰燼礦坑') ? 'trpg' : text.includes('往南的末班渡輪') ? 'road' : 'campus'; }
function nextTime(def, clock, rule) {
  if (!rule) return {unchanged: true};
  if (rule.elapsedMinutes) return {elapsedMinutes: rule.elapsedMinutes};
  const day = clock?.position?.latest?.dayOrdinal ?? 1, ids = Object.keys(def?.periods ?? {});
  if (rule.nextDay) return {dayOrdinal: day + 1, periodId: rule.nextDay};
  const current = clock?.periodId ?? ids.find(id => def.periods[id].start <= (clock?.position?.latest?.minuteOfDay ?? 0) && (clock?.position?.latest?.minuteOfDay ?? 0) <= def.periods[id].end) ?? ids[0];
  const i = ids.indexOf(current) + rule.advancePeriods;
  return i < ids.length ? {dayOrdinal: day, periodId: ids[i]} : {dayOrdinal: day + 1, periodId: ids[i - ids.length]};
}

export const inject = ['llm'];
export async function apply(ctx) {
  const home = process.env.DSH_HOME; if (!home || !/stage-next-[a-z0-9-]+/.test(home)) throw Error('STAGE_NEXT_ISOLATED_HOME_REQUIRED');
  const out = path.dirname(home), file = path.join(out, 'adapter-calls.json');
  let calls = []; try { calls = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  const counters = {};
  class Scripted extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'offline')]; }
    async resolveModel(provider, id) { if (provider !== 'next-scripted' || id !== 'offline') throw Error('NON_SYNTHETIC_MODEL_REFUSED'); return {provider, id, name: 'Stage-next scripted (no paid model)', toolUpdate: 'addition-only', defaultMaxTokens: 8192, context: {contextWindow: 131072}, reasoning: {efforts: [{id: 'off', name: 'Off'}], defaultEffort: 'off'}}; }
    async *stream(options) {
      if (options.provider !== 'next-scripted' || options.model !== 'offline') throw Error('NON_SCRIPTED_REFUSED');
      const texts = (options.messages ?? []).flatMap(m => (m.content ?? []).filter(c => c.type === 'text').map(c => ({role: m.role, text: c.text})));
      const first = texts.find(t => t.role === 'user')?.text ?? '';
      let input = null; try { input = JSON.parse(first); } catch {}
      let stage, answer, toolCall = null;
      const raw = JSON.stringify(input ?? texts);
      const genre = genreOf(raw);
      if (!input && /^Generate the session title/.test(first)) { stage = 'session_title'; answer = /審閱/.test(first) ? '審閱作品' : /開場/.test(first) ? '改寫開場' : '創作對話'; }
      else if (input && Array.isArray(input.directions) && Array.isArray(input.turns)) { stage = 'ideas'; answer = JSON.stringify({ideas: PRIOR_IDEAS.map((category, i) => ({category, text: IDEAS[genre][i]}))}); }
      else if (input?.range && Array.isArray(input.turns)) { stage = input.detail ? 'chapter_summary' : 'chapter_analysis'; answer = JSON.stringify(stage === 'chapter_analysis' ? {shouldCreateChapter: true, optimalEndTurn: input.range.endTurn, suggestedTitle: '第一段旅程', keywords: [], characters: [], locations: [], plotThreads: [], emotionalTone: '平靜', significantEvents: []} : {title: '第一段旅程', summary: '合成章節摘要：主角與同伴完成了開場後的第一段行動。', keywords: [], characters: [], locations: [], plotThreads: [], emotionalTone: '平靜'}); }
      else if (input?.handoffContract) { stage = 'director'; answer = JSON.stringify(input.handoffContract.example ?? {}); }
      else if (input?.directorHandoff && input?.context) {
        stage = 'writer'; const n = counters[genre] = (counters[genre] ?? 0); const beat = GENRES[genre].beats[n % GENRES[genre].beats.length];
        const fault = await readFault(out, 'writer'); if (fault?.holdMs) await new Promise(r => setTimeout(r, fault.holdMs)); if (fault?.fail) throw Error('SCRIPTED_WRITER_FAULT');
        answer = JSON.stringify({finalBody: beat.body, dialogue: beat.dialogue.map(([speakerId, text]) => ({kind: 'speech', speakerId, text, occurrence: 1}))});
        await new Promise(r => setTimeout(r, 900));
      } else if (typeof input?.finalBody === 'string' && input.bodyHash) {
        stage = 'post_stat'; const fault = await readFault(out, 'post_stat'); if (fault?.fail) throw Error('SCRIPTED_POST_STAT_FAULT');
        const g = GENRES[genre], n = counters[genre] ?? 0, beat = g.beats.find(b => b.body === input.finalBody) ?? g.beats[n % g.beats.length];
        counters[genre] = n + 1;
        const temporal = input.temporal ?? {};
        answer = JSON.stringify({time: nextTime(temporal.definition, temporal.clock, beat.time), stateChanges: beat.changes.map(([category, key, value]) => ({scope: 'world', category, key, operation: 'set', value: category === 'tasks' ? {status: value, assignees: ['player'], progress: 50} : value})), memories: []});
      } else if (input?.window && input?.clock && Array.isArray(input.window.unplannedDays)) {
        stage = 'calendar_plan'; const target = input.window.unplannedDays.find(d => d > input.clock.position.latest.dayOrdinal);
        answer = JSON.stringify({schemaVersion: 1, kind: 'calendar_plan', dayStart: input.window.dayStart, dayEnd: input.window.dayEnd, events: target === undefined ? [] : [{key: 'genre-event', label: CALENDAR[genre], scope: 'public_world', start: {dayOrdinal: target, minuteOfDay: 1140}, end: {dayOrdinal: target, minuteOfDay: 1320}, announcement: 'public', requiredForScene: false}]});
      } else if (input?.character?.id && /forum|diary/.test(raw.slice(0, 4000))) {
        const kind = raw.includes('"forum_reply"') ? 'forum_reply' : raw.includes('"diary"') && !raw.includes('forum') ? 'diary' : 'forum_post'; stage = kind;
        const f = FORUM[genre]; answer = JSON.stringify({schemaVersion: 1, kind, authorId: input.character.id, decision: 'publish', title: kind === 'forum_post' ? f.title : '', text: kind === 'forum_post' ? f.text : '我也注意到了，不過這只是我的看法。', epistemic: 'belief'});
      } else if (options.tools?.length && texts.some(t => t.role === 'user')) {
        // Card Studio co-author: one bounded scripted reply per user message.
        stage = 'studio_agent';
        await fs.writeFile(path.join(out, 'studio-agent-last.json'), JSON.stringify({system: String(options.system ?? '').slice(0, 6000), tools: options.tools?.map(t => t.name), messages: (options.messages ?? []).map(m => ({role: m.role, parts: (m.content ?? []).map(c => ({type: c.type, text: String(c.text ?? c.arguments ?? '').slice(0, 1500), name: c.name}))}))}, null, 1));
        const users = texts.filter(t => t.role === 'user').map(t => t.text);
        const lastUser = [...users].reverse().find(t => !/^Card Studio selection|^- `|Time sampled|^<system|^\[/.test(t.trim())) ?? users[0] ?? '';
        const docId = /Exact document_id="([^"]+)"/.exec(users.join(' '))?.[1];
        const msgs = options.messages ?? [], lastUserAt = msgs.map((m, i) => m.role === 'user' && (m.content ?? []).some(c => c.type === 'text' && !/^Card Studio selection|^- `|Time sampled|^<system|^\[/.test(String(c.text).trim())) ? i : -1).reduce((a, b) => Math.max(a, b), -1);
        const results = msgs.slice(lastUserAt + 1).filter(m => m.role === 'tool').flatMap(m => (m.content ?? []).filter(c => c.type === 'text').map(c => { try { return JSON.parse(c.text); } catch { return {raw: c.text}; } }));
        const last = results.at(-1), readValue = results.find(r => r?.ok && Number.isSafeInteger(r.value?.revision) && r.value?.card)?.value;
        const call = (name, args) => { toolCall = {id: 'scripted-' + name + '-' + results.length, name, arguments: JSON.stringify(args)}; };
        if (!docId) answer = '目前這個對話還沒有選定工作卡，請先在右側選擇或匯入一張卡。（scripted adapter）';
        else if (/審閱|review/i.test(lastUser)) {
          if (!results.length) call('card_read', {document_id: docId});
          else if (last?.ok === false) answer = `審閱還不能開始：${last.error?.message ?? last.error?.code ?? '來源未準備'}。請先按「檢查並準備」，讓我審閱固定下來的版本。`;
          else if (last?.value?.reviewId && last.value.nextOffset === undefined && last.value.instruction) call('cardstudio_scean_work_review', {action: 'read', document_id: docId, expected_revision: readValue.revision, review_id: last.value.reviewId, fingerprint: last.value.evidenceFingerprint, offset: 0});
          else if (last?.value?.encoding === 'json-fragment' && last.value.nextOffset !== null) call('cardstudio_scean_work_review', {action: 'read', document_id: docId, expected_revision: readValue.revision, review_id: last.value.reviewId, fingerprint: last.value.evidenceFingerprint, offset: last.value.nextOffset});
          else if (last?.value?.encoding === 'json-fragment' && last.value.nextOffset === null) call('cardstudio_scean_work_review', {action: 'complete', document_id: docId, expected_revision: readValue.revision, review_id: last.value.reviewId, fingerprint: last.value.evidenceFingerprint, verdict: 'pass', summary: '角色、開場、時間與狀態設定一致，可以開演。（scripted 審閱，不代表模型品質）', issues: []});
          else if (last?.value?.status === 'completed') answer = '審閱完成：角色、開場、時間與狀態設定彼此一致，沒有需要修改的地方。現在可以保存劇本並開演。（離線 scripted 審閱，不代表真實模型品質。）';
          else if (readValue) call('cardstudio_scean_work_review', {action: 'begin', document_id: docId, expected_revision: readValue.revision});
          else answer = '讀取工作卡失敗，請重新整理後再試。';
        } else if (/開場|opening/i.test(lastUser)) {
          if (!results.length) call('card_read', {document_id: docId});
          else if (readValue && results.length === 1) call('card_patch_fields', {document_id: docId, expected_revision: readValue.revision, patches: [{op: 'replace', path: '/data/first_mes', value: readValue.card.data.first_mes.replace(/。$/, '') + '。琴聲在你踏上第一階時停了，像是有人察覺到你。'}]});
          else if (last?.ok) answer = '我把開場最後一句改成「琴聲在你踏上第一階時停了」，讓玩家一進場就感覺到被注意。作品板上的開場已經更新；不滿意可以叫我改回來。（scripted adapter）';
          else answer = `修改沒有成功：${last?.error?.message ?? '未知原因'}。`;
        } else answer = `收到：「${lastUser.slice(0, 60)}」。你可以請我「改寫開場」或「審閱這份作品」。（隔離驗收用的 scripted 協作回覆，不代表真實模型品質。）`;
      } else { stage = 'unexpected'; await fs.writeFile(path.join(out, 'unexpected-input.json'), JSON.stringify({keys: Object.keys(input ?? {}), tools: options.tools?.map(t => t.name), sample: raw.slice(0, 2000)}, null, 2)); throw Error('STAGE_NEXT_UNEXPECTED_INPUT'); }
      if (stage !== 'director' && stage !== 'studio_agent' && options.tools?.length) throw Error('UNEXPECTED_TOOL_CAPABILITY:' + stage);
      calls.push({index: calls.length + 1, stage, genre, at: new Date().toISOString(), synthetic: true, paid: false}); await fs.writeFile(file, JSON.stringify(calls, null, 2));
      options.signal?.throwIfAborted();
      if (toolCall) { yield {type: 'block-end', index: 0, block: {type: 'tool-call', ...toolCall}}; yield {type: 'usage', usage: {inputTokens: 20, outputTokens: 40, totalTokens: 60}}; yield {type: 'finish', reason: {kind: 'tool-calls'}}; return; }
      yield {type: 'text-delta', index: 0, text: answer}; yield {type: 'block-end', index: 0, block: {type: 'text', text: answer}};
      yield {type: 'usage', usage: {inputTokens: 20, outputTokens: 40, totalTokens: 60}}; yield {type: 'finish', reason: {kind: 'stop'}};
    }
  }
  ctx.llm.registerAdapter(['next-scripted'], new Scripted());
}
