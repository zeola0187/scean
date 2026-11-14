// Synthetic fixture. Not derived from any user card or saved story.
export default {
  workId: 'road-ferry',
  genre: 'road',
  title: '往南的末班渡輪',
  tagline: '三天，一台老車，趕在末班船開走之前。',
  description: '失聯半年的樂團主唱寄來一張明信片，郵戳是南方離島。你和阿哲、沈蔓開著那台叫「小藍」的舊車沿濱海公路南下，第三天清晨的渡輪是這一季最後一班。',
  revision: 2,
  coverGlyph: '南',
  playerDefault: '季遠',
  time: {
    periods: [{id: 'dawn', label: '清晨'}, {id: 'day', label: '白天'}, {id: 'dusk', label: '黃昏'}, {id: 'night', label: '夜間'}],
    dayLabel: d => `旅程第 ${d} 日`,
  },
  characters: [
    {id: 'zhe', name: '阿哲', role: '駕駛 · 前鼓手', color: 'amber',
      bio: '開車很穩，話很少。小藍是他父親留下的車，他不讓任何人碰方向盤。',
      relation: '高中同學，樂團解散後很久沒聯絡。'},
    {id: 'man', name: '沈蔓', role: '副駕 · 攝影', color: 'teal',
      bio: '負責地圖和底片。喜歡在路標前停車拍照，常常因此跟阿哲吵起來。',
      relation: '主唱的表妹，是她找到那張明信片的。'},
    {id: 'wei', name: '魏伯', role: '加油站老闆', color: 'slate',
      bio: '在濱海公路邊顧了三十年加油站，知道哪一段路晚上會起霧。',
      relation: '路上第一次遇見。'},
  ],
  openings: [
    {id: 'o1', title: '出發', text: '凌晨四點，小藍的引擎咳了兩聲才發動。沈蔓把明信片夾在遮陽板上，郵戳上的港口名字被雨水暈開了一半。「三天，」阿哲說，「趕不上就要等到明年春天。」'},
  ],
  worldbook: [
    {id: 'w1', title: '濱海公路', text: '沿海岸線南下的雙線道，夜間 140K 至 160K 之間常起霧。'},
    {id: 'w2', title: '末班渡輪', text: '本季最後一班在第三日清晨 06:40 開出，錯過需等到隔年三月。'},
    {id: 'w3', title: '主唱的去向（劇透）', text: '主唱在離島的民宿打工，並不知道明信片被寄出；是民宿老闆替她寄的。'},
  ],
  initialState: {
    location: '濱海公路 · 112K',
    tasks: [{id: 't1', title: '第三日清晨前抵達港口', status: '進行中'}],
    items: [{id: 'fuel', name: '油量', qty: 3, unit: '／4 格'}, {id: 'cash', name: '現金', qty: 4200, unit: '元'}, {id: 'film', name: '拍立得底片', qty: 6, unit: '張'}],
    effects: [{id: 'tired', label: '輕微疲勞'}],
  },
  startClock: {day: 1, period: 'dusk'},
  history: [
    {input: '我把車窗搖下來，問阿哲要不要換我開一段。', clock: {day: 1, period: 'dusk'}, body: [
      ['l', 'zhe', '不用。'],
      ['n', '他回答得很快，眼睛沒有離開路面。海風灌進車裡，把沈蔓的地圖吹得啪啪作響。'],
      ['l', 'man', '前面有加油站。油表剩不到一半了，你們誰都別說還撐得到。'],
    ], delta: [{k: 'item', id: 'fuel', name: '油量', qty: -1, unit: '／4 格'}]},
  ],
  chapters: [
    {id: 'c1', order: 1, title: '凌晨四點的引擎', summary: '三人從城市出發，阿哲堅持一個人開車。黃昏時油量不足，沈蔓要求停靠加油站。', startTurn: 1, endTurn: 1, current: true},
  ],
  calendar: [
    {id: 'e1', day: 2, period: 'night', label: '漁港夜市', status: 'planned', note: '每週只開一晚。'},
    {id: 'e2', day: 3, period: 'dawn', label: '末班渡輪 06:40', status: 'planned', note: '本季最後一班。'},
    {id: 'e3', day: 2, period: 'day', label: '南迴段道路施工', status: 'planned', note: '條件未知：是否封路取決於天候。', unknown: true},
  ],
  forum: [
    {id: 'f1', author: 'wei', day: 1, period: 'day', title: '今晚 150K 附近會起霧', body: '跑夜車的朋友記得開霧燈，別跟著前車太近。', replies: [{author: 'man', day: 1, period: 'dusk', text: '謝謝！我們大概晚上會經過。'}]},
  ],
  beats: [
    {body: [
      ['n', '加油站的招牌只亮了一半。一個穿著舊工作服的老人從亭子裡走出來，敲了敲小藍的引擎蓋。'],
      ['l', 'wei', '這台老車，你們要跑多遠？'],
      ['l', 'man', '南邊的港口。後天早上的船。'],
      ['l', 'wei', '那今晚別走 150K 那段。霧一起來，連路邊的護欄都看不到。'],
    ], delta: [{k: 'location', to: '魏伯加油站 · 128K'}, {k: 'item', id: 'fuel', name: '油量', qty: 1, unit: '／4 格'}, {k: 'item', id: 'cash', name: '現金', qty: -900, unit: '元'}], advance: 0},
    {body: [
      ['n', '你們最後還是上路了。過了 145K，霧從海面漫上來，遠光燈只照得到前方三公尺。'],
      ['l', 'zhe', '……都別說話。'],
      ['n', '沈蔓握著拍立得，沒有按下快門。'],
    ], delta: [{k: 'location', to: '濱海公路 · 151K'}, {k: 'effect', id: 'fog', label: '濃霧'}, {k: 'relation', who: 'zhe', label: '緊繃'}], advance: 1},
    {body: [
      ['n', '霧散的時候天已經亮了。路邊停著一排賣早餐的小貨車，海面是灰藍色的。'],
      ['l', 'man', '幫我拍一張。這是我們第一個看見的日出。'],
      ['n', '阿哲終於把車停下來，靠在車門邊，點了一根菸又沒抽。'],
    ], delta: [{k: 'effect', id: 'fog', label: '濃霧', remove: true}, {k: 'item', id: 'film', name: '拍立得底片', qty: -1, unit: '張'}, {k: 'relation', who: 'man', label: '親近'}], advance: 1,
      interlude: {forum: {id: 'f2', author: 'man', title: '第一張日出', body: '底片剩五張。希望最後一張能拍到她。', replies: []}}},
    {body: [
      ['n', '中午經過一座小鎮，路口立著黃色告示牌：「南迴段明日施工，預計封閉半日」。'],
      ['l', 'zhe', '如果明天封路，我們今晚就要過山。'],
    ], delta: [{k: 'location', to: '海線小鎮 · 210K'}, {k: 'task', id: 't2', title: '決定今晚是否過山', status: '待決定'}], advance: 0,
      interlude: {calendar: {id: 'e4', day: 2, period: 'night', label: '山路夜間管制', status: 'planned', note: '若明日施工確定，今晚十點起單線通行。'}}},
  ],
  ideas: [
    ['玩家行動', '跟魏伯打聽港口附近哪裡有民宿。'],
    ['角色自主', '阿哲也許會在加油時第一次提起樂團解散的原因。'],
    ['場景展開', '在加油站的留言牆上找找有沒有主唱的筆跡。'],
    ['世界自然運轉', '天色暗得很快，霧可能比魏伯說的更早出現。'],
    ['意外與轉折', '小藍的引擎蓋下冒出一縷白煙。'],
  ],
};
