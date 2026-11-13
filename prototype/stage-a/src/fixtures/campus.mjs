// Synthetic fixture. Not derived from any user card or saved story.
export default {
  workId: 'campus-rooftop',
  genre: 'campus',
  title: '放學後的天台',
  tagline: '轉學第一週，你聽見了不該存在的鋼琴聲。',
  description: '星川高中的天台已經封閉三年。轉學生的你在放學後聽見上方傳來鋼琴聲，而攝影社的許晴說，她拍到過一扇本該上鎖的門。',
  revision: 3,
  coverGlyph: '天台',
  playerDefault: '程以安',
  time: {
    periods: [
      {id: 'morning', label: '上午'}, {id: 'noon', label: '午休'},
      {id: 'afternoon', label: '下午'}, {id: 'after', label: '放學後'}, {id: 'night', label: '夜晚'},
    ],
    dayLabel: d => `第 ${Math.ceil(d / 5)} 週 · 週${'一二三四五'[(d - 1) % 5]}`,
  },
  characters: [
    {id: 'qing', name: '許晴', role: '攝影社 · 二年三班', color: 'coral',
      bio: '總是掛著底片相機，對學校傳聞的興趣比對考試大。說話快，記性好，會把聽到的事情寫在手帳背面。',
      relation: '同班，主動找你搭話的第一個人。'},
    {id: 'mu', name: '周牧', role: '學生會副會長', color: 'teal',
      bio: '守規矩、記時間，負責天台鑰匙的保管登記。對許晴的調查一直抱持懷疑。',
      relation: '在走廊攔下過你一次，提醒你天台禁止進入。'},
    {id: 'ye', name: '葉老師', role: '導師 · 音樂科', color: 'violet',
      bio: '溫和但很少談自己的事。音樂教室的鑰匙由她保管。',
      relation: '你的導師，轉學手續由她處理。'},
  ],
  openings: [
    {id: 'o1', title: '鋼琴聲', text: '放學的鐘聲剛停，走廊上只剩拖地的水痕。你抱著還沒填完的社團申請表經過樓梯口，聽見上方傳來斷斷續續的鋼琴聲。天台的門，三年前就封起來了。'},
    {id: 'o2', title: '暗房', text: '攝影社暗房的紅燈下，許晴把一張剛顯影的照片推到你面前。畫面裡，天台的門開著一道縫。「這是昨天放學後拍的，」她壓低聲音，「你要不要一起去看看？」'},
  ],
  worldbook: [
    {id: 'w1', title: '天台封閉', text: '三年前一場意外後，天台改為禁止進入，鑰匙由學生會登記保管。'},
    {id: 'w2', title: '舊音樂教室', text: '頂樓的舊音樂教室已停用，裡面仍放著一台走音的直立鋼琴。'},
    {id: 'w3', title: '彈琴的人（劇透）', text: '放學後在天台彈琴的是葉老師。她在天台放了一台電子琴，紀念三年前轉走的學生。'},
    {id: 'w4', title: '備用鑰匙（劇透）', text: '周牧知道備用鑰匙少了一把，但沒有上報。'},
  ],
  initialState: {
    location: '三樓樓梯口',
    tasks: [{id: 't1', title: '找出鋼琴聲的來源', status: '進行中'}, {id: 't2', title: '交出社團申請表', status: '週四前'}],
    items: [{id: 'i1', name: '空白社團申請表', qty: 1}],
    effects: [],
  },
  startClock: {day: 3, period: 'after'},
  history: [
    {input: '我停下腳步，抬頭往樓梯上方看，試著聽清楚是什麼曲子。', clock: {day: 3, period: 'after'}, body: [
      ['n', '琴聲很慢，像是有人一個音一個音在找位置。彈到第三小節時停了，隔了幾秒又重新開始。'],
      ['n', '樓梯轉角的燈閃了一下。身後傳來快步走近的聲音。'],
      ['l', 'qing', '你也聽到了吧？我就說不是我幻聽。'],
      ['n', '許晴舉起相機，鏡頭蓋還沒拿下來。'],
    ], delta: [{k: 'relation', who: 'qing', label: '同行'}]},
    {input: '「先別上去。」我拉住她，「被周牧看到會很麻煩。」', clock: {day: 3, period: 'after'}, body: [
      ['l', 'qing', '周牧？他這時間應該在學生會開會。'],
      ['n', '話才說完，走廊盡頭的學生會辦公室亮著燈。門口的白板寫著「天台鑰匙：本週無借用」。'],
      ['n', '琴聲停了。這次沒有再響起。'],
    ], delta: [{k: 'fact', label: '學生會白板寫著本週沒有人借天台鑰匙'}]},
  ],
  chapters: [
    {id: 'c1', order: 1, title: '樓梯口的琴聲', summary: '你第一次在放學後聽見天台的鋼琴聲，並與許晴結識。學生會的登記顯示本週無人借用天台鑰匙。', startTurn: 1, endTurn: 2, current: true},
  ],
  calendar: [
    {id: 'e1', day: 4, period: 'afternoon', label: '社團博覽會', status: 'planned', note: '各社團在中庭擺攤。'},
    {id: 'e2', day: 5, period: 'after', label: '校慶彩排', status: 'planned', note: '禮堂開放到晚上七點。'},
    {id: 'e3', day: 2, period: 'morning', label: '轉學生報到', status: 'done', note: ''},
    {id: 'e4', day: 6, period: 'morning', label: '期中段考', status: 'planned', note: '條件未知：是否延期取決於校慶進度。', unknown: true},
  ],
  forum: [
    {id: 'f1', author: 'qing', day: 3, period: 'noon', title: '【整理】天台琴聲目擊時間表', body: '目前收到四筆：都在放學後，週一、週三各兩次。曲子聽起來一樣。有人錄到的話私訊我。', replies: [
      {author: 'mu', day: 3, period: 'afternoon', text: '天台禁止進入。請不要鼓勵同學去確認。'},
      {author: 'qing', day: 3, period: 'afternoon', text: '我只是整理時間，沒叫任何人上去。'},
    ]},
    {id: 'f2', author: 'mu', day: 2, period: 'after', title: '學生會公告：天台鑰匙借用規則', body: '借用需於前一日登記並由指導老師簽名。未登記者一律不予借出。', replies: []},
  ],
  beats: [
    {body: [
      ['n', '你們沿著走廊往學生會辦公室走。門半掩著，周牧正把一串鑰匙收進抽屜。'],
      ['l', 'mu', '放學了還在這裡？有事嗎。'],
      ['n', '他的視線停在許晴的相機上，又移到你手裡的申請表。'],
      ['l', 'qing', '我們只是想問，天台的鑰匙一直都在嗎？'],
      ['l', 'mu', '……登記表上寫得很清楚。'],
    ], delta: [{k: 'location', to: '學生會辦公室'}, {k: 'relation', who: 'mu', label: '戒備'}], advance: 0},
    {body: [
      ['n', '中庭的路燈一盞接一盞亮起。你們繞到音樂教室後方，窗簾沒有拉好。'],
      ['n', '裡面沒有人，但琴蓋是打開的，譜架上夾著一張手寫樂譜，標題被鉛筆塗掉了。'],
      ['l', 'qing', '這字跡……跟公告欄上某個人的很像。'],
    ], delta: [{k: 'location', to: '音樂教室後窗'}, {k: 'item', id: 'i2', name: '樂譜照片', qty: 1}, {k: 'task', id: 't1', title: '找出鋼琴聲的來源', status: '有新線索'}], advance: 1,
      interlude: {forum: {id: 'f3', author: 'qing', title: '今晚的琴聲停得特別早', body: '六點十分就停了。巧的是音樂教室的燈也是那時候關的。', replies: [{author: 'mu', text: '請不要在版上暗示特定老師。'}]}}},
    {body: [
      ['n', '隔天早上，葉老師在點名後叫住你。'],
      ['l', 'ye', '程同學，社團申請表交了嗎？攝影社的話，週四博覽會之前要給我簽名。'],
      ['n', '她說話時看著窗外，手指在講桌上輕輕敲著，節奏和昨天的琴聲很像。'],
    ], delta: [{k: 'location', to: '二年三班教室'}, {k: 'relation', who: 'ye', label: '在意'}], advance: 1},
    {body: [
      ['n', '你把申請表遞過去。葉老師簽了名，筆停頓了一下。'],
      ['l', 'ye', '攝影社啊。拍照的時候……記得別去危險的地方。'],
      ['l', 'qing', '（小聲）她是不是在暗示什麼？'],
    ], delta: [{k: 'item', id: 'i1', name: '空白社團申請表', qty: -1}, {k: 'task', id: 't2', title: '交出社團申請表', status: '已完成'}], advance: 0,
      interlude: {calendar: {id: 'e5', day: 5, period: 'night', label: '天台結構檢查', status: 'planned', note: '總務處公告：週五晚上將派人檢查天台。'}}},
  ],
  ideas: [
    ['玩家行動', '問許晴，她拍到開著的門是在幾點幾分。'],
    ['角色自主', '周牧可能主動來找你，問你昨天有沒有上樓。'],
    ['場景展開', '去舊音樂教室看看那台直立鋼琴。'],
    ['世界自然運轉', '社團博覽會的準備讓走廊變得很吵，琴聲今天也許不會出現。'],
    ['意外與轉折', '你在置物櫃裡發現一張沒有署名的紙條。'],
  ],
};
