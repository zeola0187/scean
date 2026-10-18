# W01 前端與公開資料契約

依固定基準 `32f8630fbb0f3ecfa0a393bd9be8004ac3759082` 的 `core/frontend.mjs`、`core/public-state-bindings.mjs`、`core/condition-ast.mjs`、`core/derived-facts.mjs`、`core/state-blueprint.mjs` 及共用 renderer 撰寫。遇新版本，重新核對已註冊工具及實作，不能只改版本標籤。

## 三種不同資料

| 資料 | 定義及使用位置 | 不具有的效果 |
| --- | --- | --- |
| 正式 State | Run 已原子 Commit 的世界／角色資料；Blueprint 宣告型別及可見性，InitialState 提供建 Run 的初值 | 前端 HTML 或條件不能寫入它 |
| `frontend.conditions` | 只控制該畫面的布林 AST；以公開原始 bindings 或 Host derivedBindings 為輸入 | 不自動進入模型，不是事件、State 更新或 NPC 認知 |
| `derivedFacts` | 與 HTML 無關的卡片版本化 Host 規則；從已 Commit 的公開 State 投影布林事實 | 不寫 State 或 Memory，不等於角色已知，不預測同回合尚未 Commit 的提案 |

Host 只將 `provideToWriter:true` 的事實包提供給 Director 及 Draft。它不是額外模型階段；不直接進 Prose 或 PostStat。包中含規則名稱、描述、結果、config/rule hash、Run/Snapshot 與 canonical version/head；不可省略其來自已 Commit State 的時點。所需核心 context 超出預算時 Runtime 拒絕該模型 dispatch，不能把規則默默省略後宣稱仍有保證。Scripted Model 證明輸入路徑，不能證明真模型一定遵循規則。

## Blueprint 及初值

- `stateBlueprint={schemaVersion:1,id,version,extensionPolicy:"allow"|"deny",variables:[...]}`。`version` 為正整數；最多 300 個變數。維持作者既有 extensionPolicy，不為畫面方便擅改。
- 每個變數必要欄位：`key,displayName,scope,category,type,visibility`。`scope` 為 `world` 或 `character`；後者必須有既有 roster 的 `characterId`，前者不可有它。`player` 不是 NPC roster ID。
- `category` 僅 `locations,tasks,resources,equipment,time,effects,facts`；`type` 僅 `number,string,boolean,enum,json`；`visibility` 僅 `public,restricted`。型別和可見性都不是 HTML 自行定義的。
- 可選欄位：`unit,min,max,enumValues,readOnly,derivedDescription,requiredFields`。unit/min/max 僅 number；min/max 要有限且相容；enum 必須列非空、不重複的 enumValues。`requiredFields` 只用於 json；tasks 必須是 json，含非空 `status`、唯一合法 `assignees` 與 0–100 的有限 `progress`。
- `derivedDescription` 只是描述；`readOnly` 是正式 State 寫入約束，都不會執行公式。可執行的布林規則必須使用 `derivedFacts`。
- `initialState={schemaVersion:1,blueprintId,blueprintVersion,values:[...]}`；每筆 `values` 有 `scope,category,key,value,source:{id,version}`，角色值另有 characterId。必須對應同版 Blueprint，值符合宣告型別、範圍、enum 與必要欄位。不要用字串 `"false"` 代替 boolean 或用 `"62"` 代替 number。
- 初值可以缺席，缺值保持 unknown，不預設成 false、0、安全或可用。已有合法 false、0、空字串則仍是 known。來源版本接受非空字串或正整數，保留實際來源紀錄。

## 綁定、AST 及套件

`frontend` 必要欄位與值：

```json
{
  "schemaVersion": 1,
  "id": "author-selected-id",
  "runtime": {"profile": "scean-html-bindings-v1", "apiMajor": 1},
  "html": "<section><p>靜態文字</p></section>",
  "css": "section{padding:16px}",
  "bindings": [],
  "conditions": {},
  "capabilities": {"network": "none", "worldActions": [], "derivedDisplays": []}
}
```

即使沒有動態 binding，也需要合法 Blueprint。`hash` 是保存完整性值，由 Host 計算；修改候選時不要沿用舊 hash。無其他任意欄位。

- `bindings` 最多 64 筆，每筆恰為 `{alias,target:{scope,category,key,characterId?},type}`，精確對應已宣告 **public** 變數；enum 的 binding.type 保留 `enum`，AST 以 string 比較。沒有 wildcard、JSON 子路徑或未宣告值直讀；restricted 值不可透過衍生規則間接外洩。
- `derivedBindings` 可選，最多 64 筆，每筆恰為 `{alias,factId}`，factId 必須存在於同卡的 `derivedFacts.facts`，結果型別為 boolean。別把 capability 的 `derivedDisplays` 改成非空陣列來啟用它；當前該陣列仍必須是空的。
- alias 與 condition 名稱在同一命名空間，必須唯一。使用安全 ID：1–128 個 ASCII 字母／數字／底線／連字號，首位為字母或數字；拒絕裝置保留名稱、constructor/prototype，以及 alias 的 `__proto__`。不把 CSS 選擇器字串當 alias。
- AST 葉節點只有 `{ref:"alias"}` 或 `{literal:值}`；literal 限 boolean、有限 number 或不超過 500 字的 string。運算節點恰為 `{op,args}`，支援 `and,or,not,eq,ne,lt,lte,gt,gte`。
- `and/or` 需 1–32 個 boolean 參數；`not` 一個 boolean；比較運算兩個參數。數值排序只接 number；eq/ne 要相同且非 json 型別。沒有 eval、任意函數、算術公式、陣列成員或時間視窗運算。
- `conditions` 最多 64 個，僅引用原始 public bindings 及 derivedBindings，**不能引用其他 conditions**；其驗證共用 512 個 AST 節點預算、最深 12 層。實際畫面需要布林 alias 時，表達式應產生 boolean；根節點為非布林 ref/literal 不會自動轉成真假。
- `derivedFacts={schemaVersion:1,id,version,bindings,facts}`，可帶 Host hash；version 正整數。bindings 同上，只讀 public Blueprint；facts 最多 64 筆，每筆恰為 `{id,name,description,provideToWriter,expression}`。name 為非空最多 300 字、description 非空最多 2000 字，provideToWriter 是 boolean；expression **必須為 boolean**。各 facts 的 expression 共用 512 節點預算、最深 12 層。規則不能引用其他 facts 或前端 conditions；不要用循環／分層別名實現未支援公式。

AST 保留 known/unknown/unavailable/stale。`and` 有確知 false 可得 false，`or` 有確知 true 可得 true；否則缺值傳遞，不把 unknown 強轉 false。過期 projection 一律顯示 stale。`data-scean-when` 只有 known true 才顯示。

## HTML 與輸出

允許元素只有：

```text
section article div span p h1 h2 h3 h4 h5 h6 header footer main aside nav
ul ol li dl dt dd strong em small b i code pre blockquote br hr details summary
progress table thead tbody tr th td caption
```

允許屬性只有：`id,class,title,role,aria-label,aria-live,open,hidden,max,data-scean-text,data-scean-state,data-scean-when,data-scean-progress`。沒有 inline style、on*、href、src、任意 data-*、img/svg、button/input/form、iframe 或 script。id/class 僅 ASCII 字母數字底線、空格、連字號；id 不能重複。屬性值最多 500 字且不能有 `&`、`<`、`>` 或控制字元，不能以 entity 逃逸規則。

| 屬性 | 輸入與效果 |
| --- | --- |
| `data-scean-text` | 任一已准入 alias；以跳脫文字取代子內容，json 值顯示為 JSON 字串，不解析成 HTML |
| `data-scean-state` | boolean alias；renderer 加 `data-state` 與 `scean-true/false/unknown/unavailable/stale` class，可為這些 class 寫 CSS |
| `data-scean-when` | boolean alias；不是 known true 就加 hidden，不會更新世界狀態 |
| `progress[data-scean-progress]` | number alias；max 是合法正有限數，缺省 100，已知值顯示限制在 0..max；未知不顯示捏造進度 |

不直接手寫 `value` 或 `data-state` 屬性；它們由 renderer 產生。註解被忽略；標籤要合法巢狀。HTML 上限 96,000 字、CSS 64,000 字、套件 JSON 200,000 bytes；HTML 掃描上限 2,000 tokens／巢狀堆疊 32。設計時留餘量，不能拿上限當版面目標。Host 投影在不透明隔離頁面顯示，CSP 不允許 JS、網路、圖片、外部字型或 Host bridge。

## CSS 子集

CSS 寫在 `frontend.css`。選擇器只接受 ASCII 字母數字、`_ . # *`、空白及 `> + ~ -`，逗號可分組；不支援屬性選擇器、偽類／偽元素或 escape。用 `.scean-true` 等 class，不用 `[data-state=true]`。

允許屬性：

```text
display position box-sizing width min-width max-width height min-height max-height
margin margin-top margin-right margin-bottom margin-left
padding padding-top padding-right padding-bottom padding-left
border border-width border-style border-color border-radius border-top border-bottom border-left border-right
color background background-image background-color opacity
font-size font-weight font-family font-style line-height letter-spacing
text-align text-decoration text-transform white-space overflow overflow-x overflow-y
overflow-wrap word-break text-overflow vertical-align
flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self
justify-content gap row-gap column-gap order grid-template-columns grid-template-rows grid-column grid-row
object-fit object-position aspect-ratio list-style-type border-collapse border-spacing box-shadow
```

允許函數：`rgb,rgba,hsl,hsla,calc,clamp,min,max,repeat,minmax,fit-content,linear-gradient`；linear-gradient 只限 background/background-image。position 只接受 static/relative。值仍需通過有限字元及括號規則，不保證上述函數的所有瀏覽器語法都接受；由 `dynamic_validate` 決定，不靠瀏覽器成功渲染推定可保存。

禁止資源函數 url()、CSS 變數／var()、custom properties、escape、URL/data/file/javascript 值、`!important`、一般字串內容、巢狀宣告與任意 at-rule。font-family 另允許受限字母數字／Unicode 字體名稱及逗號列表，不代表可下載字型。

唯一 at-rule 是 bounded `@media`：僅 `(min-width:Npx)`／`(max-width:Npx)`，可用 AND，最多 4 子句、N 不超過 4096；可選 `screen and`、`all and`／`only` 前綴，不支援 preference/device/range 語法或逗號 OR，最多 3 層。整份最多 250 rules；宣告區塊最多 32,000 字、單值最多 1,000 字、函數括號深度最多 16。

底層 sanitizer 會略過不支援片段並產生 diagnostic；**W01 動態套件驗證只要有任一 CSS diagnostic 就拒絕整包**，不是默默保存其餘 CSS。修正錯誤再預覽／保存，不宣稱「自動清理後已成功」。
