// Synthetic fixture. Not derived from any user card or saved story.
export default {
  workId: 'trpg-ashmine',
  genre: 'trpg',
  title: '灰燼礦坑',
  tagline: '失蹤的礦工隊，和一扇從裡面被封住的門。',
  description: '公會懸賞：灰燼礦坑第三層的礦工隊已失聯六日。你與半精靈遊俠艾琳、矮人戰士布洛克接下委託，在月蝕祭之前把他們帶回來。',
  revision: 5,
  coverGlyph: '燼',
  playerDefault: '瑟恩',
  time: {
    periods: [{id: 'dawn', label: '黎明'}, {id: 'day', label: '白晝'}, {id: 'dusk', label: '黃昏'}, {id: 'deep', label: '深夜'}],
    dayLabel: d => `收穫月 ${11 + d} 日`,
  },
  characters: [
    {id: 'ailin', name: '艾琳', role: '半精靈遊俠', color: 'jade',
      bio: '在地面上比在地底自在。弓弦保養得一絲不苟，討厭密閉空間但從不承認。',
      relation: '和你搭檔過兩次委託。'},
    {id: 'brok', name: '布洛克', role: '矮人戰士', color: 'ember',
      bio: '自稱認得這座礦坑的每一條礦脈。嗓門很大，喝酒和戰鬥都不肯輸。',
      relation: '這次委託的發起人，他的表弟在失蹤的礦工隊裡。'},
    {id: 'kas', name: '守墓人卡斯', role: '礦坑入口的老人', color: 'slate',
      bio: '在礦坑入口旁的小屋獨居。知道很多事，但只回答被問到的問題。',
      relation: '曾警告你們不要在深夜下到第三層。'},
  ],
  openings: [
    {id: 'o1', title: '入坑', text: '升降籠的鐵鍊在黑暗中嘎嘎作響。布洛克舉起火把，礦坑第二層的空氣又冷又乾，牆上有新鮮的鑿痕。「這是我表弟的記號，」他說，「他們往下走了。」'},
  ],
  worldbook: [
    {id: 'w1', title: '灰燼礦坑', text: '矮人氏族廢棄的舊礦坑，共四層。第三層以下的礦脈會在月蝕時發出微光。'},
    {id: 'w2', title: '月蝕祭', text: '鎮上每年的祭典。傳說月蝕當晚，礦坑深處的門會打開。'},
    {id: 'w3', title: '封門的人（劇透）', text: '礦工隊是自己封住第三層的門，因為他們在裡面發現了不該被帶出去的東西。'},
    {id: 'w4', title: '卡斯的身分（劇透）', text: '卡斯是三十年前唯一從第四層活著回來的礦工。'},
  ],
  initialState: {
    location: '第二層 · 坍方走廊',
    tasks: [{id: 't1', title: '找到失蹤的礦工隊', status: '進行中'}, {id: 't2', title: '月蝕祭前返回地面', status: '剩 3 日'}],
    items: [{id: 'hp', name: '生命值', qty: 18, unit: '／24'}, {id: 'torch', name: '火把', qty: 3, unit: '支'}, {id: 'gold', name: '金幣', qty: 40, unit: ''}],
    effects: [],
  },
  startClock: {day: 1, period: 'day'},
  history: [
    {input: '我蹲下來檢查坍方的石堆，看有沒有能鑽過去的縫。', clock: {day: 1, period: 'day'}, body: [
      ['n', '石堆底部有一道勉強能容一人匍匐的縫隙，冷風從裡面吹出來，帶著硫磺味。'],
      ['l', 'brok', '我過不去。這縫是給精靈和瘦子挖的。'],
      ['l', 'ailin', '那就你在這邊守著。我和瑟恩先過去看看。'],
    ], delta: [{k: 'check', label: '察覺 DC 12', result: '成功'}, {k: 'fact', label: '坍方底部有可匍匐通過的縫隙'}]},
  ],
  chapters: [
    {id: 'c1', order: 1, title: '升降籠與鑿痕', summary: '小隊下到第二層，在坍方走廊找到礦工隊留下的記號與一道狹窄縫隙。', startTurn: 1, endTurn: 1, current: true},
  ],
  calendar: [
    {id: 'e1', day: 4, period: 'deep', label: '月蝕祭', status: 'planned', note: '鎮上廣場點燈。'},
    {id: 'e2', day: 5, period: 'day', label: '公會懸賞截止', status: 'planned', note: ''},
    {id: 'e3', day: 0, period: 'dusk', label: '小隊抵達礦坑', status: 'done', note: ''},
  ],
  forum: [
    {id: 'f1', author: 'brok', day: 0, period: 'dusk', title: '【懸賞】灰燼礦坑失蹤礦工隊', body: '六名礦工，最後一次被看見是下到第三層。帶回任何人，公會付二十金幣一人。', replies: [{author: 'kas', day: 0, period: 'deep', text: '別在深夜下去。'}]},
  ],
  beats: [
    {body: [
      ['n', '你們一前一後鑽過縫隙。另一邊是一條向下傾斜的坑道，地上散落著礦工的工具。'],
      ['l', 'ailin', '有腳印，至少四個人。往下走，沒有回頭。'],
      ['n', '火把的光在潮濕的岩壁上晃動。遠處傳來規律的敲擊聲，三下，停頓，三下。'],
    ], delta: [{k: 'location', to: '第二層 · 傾斜坑道'}, {k: 'check', label: '敏捷 DC 10', result: '成功'}, {k: 'item', id: 'torch', name: '火把', qty: -1, unit: '支'}], advance: 0},
    {body: [
      ['n', '敲擊聲來自一扇鐵門。門從裡面被鐵條封住，門縫透出微弱的藍光。'],
      ['l', 'ailin', '是礦工的求救暗號……還是他們在警告我們別開門？'],
      ['n', '你伸手觸碰門把，指尖一陣刺痛。'],
    ], delta: [{k: 'location', to: '第三層入口 · 封鐵門'}, {k: 'check', label: '體質 DC 13', result: '失敗'}, {k: 'item', id: 'hp', name: '生命值', qty: -3, unit: '／24'}, {k: 'effect', id: 'numb', label: '指尖麻痺'}], advance: 1,
      interlude: {forum: {id: 'f2', author: 'kas', title: '致仍在礦坑裡的人', body: '鐵門是從裡面封的。如果你聽見敲門聲，先數一數是幾下。', replies: []}}},
    {body: [
      ['n', '布洛克終於從另一條路繞了過來，滿身都是石灰。他把耳朵貼在門上聽了很久。'],
      ['l', 'brok', '三下，停，三下。這是我們氏族的「別進來」。'],
      ['n', '他的聲音第一次壓得這麼低。'],
    ], delta: [{k: 'relation', who: 'brok', label: '動搖'}, {k: 'task', id: 't1', title: '找到失蹤的礦工隊', status: '已找到封門處'}], advance: 0},
    {body: [
      ['n', '你們退回坑道紮營。艾琳守第一班，火把只剩最後一支。'],
      ['l', 'ailin', '月蝕是後天晚上。如果傳說是真的，那扇門到時候會自己打開。'],
    ], delta: [{k: 'effect', id: 'numb', label: '指尖麻痺', remove: true}, {k: 'item', id: 'hp', name: '生命值', qty: 4, unit: '／24'}], advance: 1,
      interlude: {calendar: {id: 'e4', day: 3, period: 'dusk', label: '公會補給隊到達入口', status: 'planned', note: '會在升降籠旁留下火把與口糧。'}}},
  ],
  ideas: [
    ['玩家行動', '用鐵鍬輕敲三下，回應門後的暗號。'],
    ['角色自主', '布洛克可能堅持要破門，不管暗號是什麼意思。'],
    ['場景展開', '沿著腳印的反方向，找礦工隊來時的路。'],
    ['世界自然運轉', '火把燒得比預期快，你們得決定要不要回地面補給。'],
    ['意外與轉折', '門後的敲擊聲突然變成了四下。'],
  ],
};
