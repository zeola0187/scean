# 世界書條件：自訂變數決定本輪是否允許掃描

這是 ST-Prompt-Template 1.17.9 的 `@@if` 目標方案，不是標準 CCv2/v3 的通用語意，也不是前端顯示隱藏。CardStudio 用受限 JSON 規則產生固定、含錯誤防護的條件；不執行使用者 EJS，不另裝 runtime。既有 target 的角色助手仍是唯一 writer。

## 工具與定位

用 `cardstudio_worldbook_gate`：

- `inspect`：列出目標 namespace、可用 `values.<field>`、條目穩定 ID 與診斷。
- `read`：指定 `entry_id`，取得原條目、現有受管規則與 `source_hash`。
- `create`：在既有條目附加新條件；先用 `lorebook_upsert_entry` 建立條目。
- `patch`：替換該條目的受限規則；不重寫條目本文。
- `remove`：只移除受管條件，恢復原本文。這會讓條目重新依原本常駐／關鍵字等規則運作。
- `evaluate`：提供合成 `values` 或 `snapshot`，逐條回傳 pass/fail/unknown 與理由，不讀真實聊天。

所有寫入帶 `document_id`、目前 `expected_revision`、穩定 `entry_id`、剛讀到的 `expected_source_hash`。讀寫同一 revision，衝突重讀，不盲目重試。條件與卡片、sidecar 共用 history、diff、rollback。原有 keywords、constant、scan depth、budget、recursive 設定及未知 metadata 不改動。

已有未知 EJS 或任何 `@@` 裝飾器時，只讀分析；不自動包覆、合併或整欄覆蓋。不得修改 target 受管的常駐狀態規則條目。匯入卡的手寫 `@@if` 未經驗證，不標成安全條件。

## 已宣告變數與型別

先讀目標 schema。P0 只允許既有 message-scope writer 的 `values.<欄位>`；不猜變數名稱，不跨到 chat/global，不接受深層任意 path、prototype keys 或程式字串。

| operator | 欄位 | 規則參數 |
|---|---|---|
| `eq` | number / boolean / string / enum | `value`，必須同型別 |
| `lt` / `lte` / `gt` / `gte` | number | 有限數字 `value` |
| `range` | number | `min`、`max`、明確的 `includeMin`、`includeMax` |
| `in` | string / enum | 1–16 個不重複的合法 `values` |
| `contains` | 字串 array | 字串 `value` |
| `time_window` | string | 嚴格 `HH:mm` 的 `start`、`end` |
| `and` / `or` | 子條件 | 2–8 個 `args`，最多 4 層、32 個節點 |

不偷偷把 `"30"` 轉成數字，也不把 `"true"` 轉成布林。所有被引用的欄位都先驗證：OR 的另一分支成立，也不會掩蓋缺值或錯型別。缺值、超界、過期 schema、解析錯誤與任何例外均不放行；試算標 unknown，目標條件回傳 false。

例如使用已宣告的任務、事件與背包變數：

```json
{
  "schemaVersion": 1,
  "predicate": {
    "op": "and",
    "args": [
      {"path":"values.quest_stage","op":"eq","value":"chapter_2"},
      {"path":"values.event_done","op":"eq","value":true},
      {"path":"values.inventory","op":"contains","value":"bronze_key"}
    ]
  }
}
```

另一個條目可以使用 `{"path":"values.location","op":"in","values":["garden","hall"]}`。名稱只是例子，必須是該卡已宣告欄位，enum 值也須已宣告。

## 分段、時間與回落

數值分段用 `range` 或比較運算。可附 `partition:{"id":"quest_phases","path":"values.progress"}`，同組必須都是該數值欄位的條件，且 schema 有有限 min/max。工具檢查整個數值定義域的邊界及區間，回報重疊與缺口；未補齊的分組可保存，但不通過 target export。混合多變數的任意布林覆蓋問題不宣稱已求解，不加 partition 即不宣稱互斥。

例如進度 `[0,30)`、`[30,70)`、`[70,100]`，至少測 29、30、69、70、0、100，再從高值降回低值。P0 每輪重新判斷，可鎖回；永久解鎖需要額外持久旗標與另行設計，不私下增加。

`time_window` 採 `[start,end)`；`22:00` 到 `06:00` 跨午夜，`06:00` 不包含。起終點相同拒絕，不猜全天或空集合。只接受零補齊的 24 小時 `HH:mm`，不拿顯示字串作寬鬆日期解析。日期、時區、劇情天數沒有專用時間語意；劇情日數若明確宣告為 number，僅可作一般數值比較。

## 狀態與生成時序

讀取與 writer 相同 namespace 的最新樓層／swipe snapshot，使用 message scope、`withMsg:{id:-1}`、`noCache:true`。固定產生式會核對 profile、definition digest、錯誤狀態、樓層／swipe 與目前訊息文字的變更標記。這個標記只是新鮮度檢查，不是密碼學簽章。writer 尚未完成、最新樓缺快照、訊息剛編輯或狀態解析失敗時關閉條件，不退回 chat/global、不拿 fixture 補值。

初始化由唯一 writer 使用明確 initialState。回覆的 `<state-update>` 在該回覆完成後保存，影響後續 prompt；不能倒過來改變本次已送出的內容。不在 EJS 條件內 setvar/incvar，不安裝第二個 writer。舊 target writer 缺新鮮度標記時必須明確 rebuild，再以隔離合成卡驗收，不能由 export 暗改。

## 驗證與交付界線

1. 先決定使用者要「條件且關鍵字匹配」還是「條件成立便作常駐候選」。保持原設定；需要改 constant/keys 時另用世界書工具明確局部修改。
2. 以 `evaluate` 的合成 values 測通過、不通過、缺值、錯型別、邊界、回落和跨午夜。結果只代表 **gating eligible**，不是最終 prompt 注入。
3. 條件成立後，keywords、probability、groups、token budget、scan depth、recursive、sticky 等宿主機制仍可能影響選入。條件 false 在掃描前排除；顯示 hidden 或晚期 EJS 輸出空字串不是等價測試。
4. `target check` 驗證受管條件來源與 schema/namespace/digest；手寫 `@@if`、改壞的受管來源、分段衝突會阻止 target 認證匯出。raw backup 保留原始內容且 ready:false，不冒充驗收。
5. 鎖回僅停止此次世界書注入，不刪除已在歷史訊息或其他 prompt 區塊出現的內容。

前提是目標端 **Prompt Template 已啟用且載入成功**。原生酒館不會代為執行 `@@if`；插件停用時不能保證條件生效。編輯室的靜態 check 不查閱或修改日常插件設定，也不能把條件當成機密資料的存取控制。需在隔離目標確認依賴啟用，不能繞過安全提示。

編輯室 Preview 仍只是靜態美化預覽，不新增條件 UI，也不執行 EJS。隔離官方 handler/scanner harness 證據不等於整個桌面 TT 實機驗收；需明說哪些部分用了合成 host/tokenizer。

## 固定版本依據

- [Prompt Template 1.17.9 裝飾器規格](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/docs/features_cn.md#装饰器)：`@@if` 在掃描前排除。
- [官方載入 handler](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/src/modules/handler.ts)：WORLDINFO_ENTRIES_LOADED。
- [官方條件與錯誤處理](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/src/function/worldinfo.ts)：只認 `'false'` 的排除比較，需要生成式自行 catch 並 false。
- [TT 2.3.0 對應 build 掃描器](https://github.com/Darkatse/TauriTavern/blob/3fe9e055b512/src/scripts/world-info.js)：條件排除後仍有關鍵字、機率、遞迴與 budget。

本文件為獨立 MIT 指引，不改動 Palette 或其他來源授權。

## 受管本文與批次修復（0.1.6-library.1）

通用 card/book/frontend/target_source mutation 不得改寫或刪除受管 Gate 本文。Full 人類 Scope 才可 edit_body；以目前 source hash、唯一 old_text／new_text 修改純正文，保留編譯 wrapper、rule 及未知 metadata。Content 可 read/inspect/evaluate，禁止 Gate 寫入。

同一輪將所有仍符合 safe gate_rebind 的计划（最多64）在同一 revision 中提交，共同快照與 rollback。每輪完整 check；最多三輪，任何歷次修復 fingerprint 再現或 FAIL 增加停止。批次不是放寬可修復白名單。
