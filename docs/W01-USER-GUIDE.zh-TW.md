# W01 第一階段候選操作說明

公開來源保留 W01 功能與合成測試；現行驗證方式及平台限制見 [驗收說明](VALIDATION.md)。私人歷史報告不隨公開來源提供；真模型、原私人卡及跨實體裝置仍 NOT_TESTED。

## 1. 在 Card Studio 製作

1. 使用新測試 Profile，開新對話，在 Studio 選擇合成卡工作副本。角色名冊仍須有穩定 ID、名稱及明確背景。不要指向正式卡片／Profile。
2. 在既有人類「Authoring Scope」控制選 Full。Agent 沒有升權接口；Content mode 可讀與預覽，但不能寫 Blueprint／前端。
3. 進入前端製作區，選「SCEAN 動態前端」。JSON 同時包含 `stateBlueprint`、`initialState`、`frontend`。先定義或確認變數的 scope/category/key、型別、public/restricted 與必要初值。已有 Blueprint 直接沿用；不得另外製作世界狀態資料庫。
4. Agent 使用 `cardstudio_scean_frontend(action="dynamic_read", document_id=...)` 讀回 Blueprint 與前端包。以作者要求設計自由 HTML/CSS，標註 `data-scean-text`、`data-scean-state`、`data-scean-when` 或 progress 綁定。完整契約見 [W01-CONTRACT.md](W01-CONTRACT.md)。
5. 用 `dynamic_validate`／「驗證綁定」檢查。缺變數 `FRONTEND_BINDING_MISSING`、型別不符 `FRONTEND_BINDING_TYPE`、restricted `FRONTEND_BINDING_UNAUTHORIZED`、失效引用 `FRONTEND_REFERENCE_MISSING`、不支援 CSS／HTML 會明確拒絕。初值缺少則預覽回報 `FRONTEND_VALUE_UNKNOWN`，不默認安全。
6. 發現缺變數時，Agent 可在同一次工作補 `blueprint` 和 `initial_state`，再以 `dynamic_save` 原子保存；不需強制再開第二次模型工作。需要變更 schema version 時，InitialState 的 blueprintVersion 也須一致。
7. 「預覽動態前端」使用合成初值及同一 renderer，會標示 authoring source；不讀任何 Run。這不等於正式狀態與模型遊玩驗收。
8. 「保存動態前端版本」／`dynamic_save(frontend, blueprint?, initial_state?, expected_revision)` 建立新的不可變卡片 Revision。Host 產生內容 hash。過期 Revision 拒絕，不覆寫另一頁成果。
9. 局部修改用 `dynamic_patch(field="html"|"css", expected_source_hash=讀回hash, old_text=唯一原文, new_text=...)`。其餘卡片與綁定不受影響。更新 binding／條件時則保存完整 frontend 包的新版本。既有 history/diff/rollback 可檢視與回到保存版本；不刪除舊 revision。

工具範例（欄位值都是合成示意）：

```json
{
  "action":"dynamic_save",
  "document_id":"先讀回實際工作副本ID",
  "expected_revision":3,
  "frontend":{
    "schemaVersion":1,"id":"my-panel",
    "runtime":{"profile":"scean-html-bindings-v1","apiMajor":1},
    "html":"<section class=\"panel\"><h2>角色手札</h2><p data-scean-text=\"mana\"></p><progress max=\"100\" data-scean-progress=\"mana\"></progress><p data-scean-when=\"ready\">術式可用</p></section>",
    "css":".panel{background:#fff4d5;color:#392724;padding:24px;border-radius:18px}",
    "bindings":[{"alias":"mana","target":{"scope":"world","category":"resources","key":"mana"},"type":"number"}],
    "conditions":{"ready":{"op":"gte","args":[{"ref":"mana"},{"literal":30}]}},
    "capabilities":{"network":"none","worldActions":[],"derivedDisplays":[]}
  }
}
```

此例須先在 Blueprint 宣告 public number `world/resources/mana`。可由同次 dynamic_save 附上合法 Blueprint／InitialState。不可直接照抄示意 ID。

## 2. 保存 → Handoff → 正式 Run

1. 作者檢查並保存指定 Revision，確定沒有未保存 JSON／文字。
2. 在原有「SCEAN 舞台測試與唯讀 Inspector」確認名冊及 Preset，以現行 human page lease 按「將已保存 rN 送舞台／新開 testRun」。Agent 前端工具不能自行啟動 RP。
3. Handoff 從 exact saved card 取前端包，檢查 Blueprint、型別、HTML/CSS/AST、hash，再固定進 Snapshot。Frontend hash 與 Snapshot hash 可在 Run／Inspector 追查。
4. 舞臺故事區在最新有效已提交正文之後、輸入區之前顯示唯一的「卡片畫面」；開局時在固定開場之後，與既有文字 RP、Composer、官方 State 面板共存。卡片只讀獲准的已提交資料；輸入草稿、生成提案、取消或失敗均不更新世界畫面。
5. 成功 Commit 後由既有 canonical polling 調和，自動更新文字、布林 class／顏色、進度條與條件顯示。沒有額外模型／Embedding 呼叫。
6. 斷線會立即標為過期；15 秒未確認 canonical heartbeat 也會失去 current 狀態。安全燈不保留為目前安全。重新連線／續局／Run 切換後重新核對 canonical version/head/hash。
7. 回退／重生成沿既有正式流程；畫面只讀最後有效 State。舊 Run 固定原資產；修改卡片必須保存新 Revision、另開新 Run 才會使用。
8. 前端失效時選「使用官方顯示」，文字 RP／官方 State 繼續使用，不改世界狀態。修卡另開新 Run，沒有暗中更新舊存檔。

桌面與 Web 共用可信 player／renderer；卡片置於 empty-sandbox iframe，不執行卡片 JS、網路或 Host RPC。實際 Electron／Web 的視覺、鍵盤、CSP、續局與跨分頁流程仍須依驗收矩陣補測。

## 3. 本版邊界

- 自由組合受限 HTML/CSS，不是固定官方面板；CSS 界線依 Studio 既有 allowlist。未包裝圖片／字體／外部依賴。
- 本地互動為原生 details/summary 收合；自訂 tabs/filter 按鈕未實作。面板位置、分頁及側欄變更不重新掛載 iframe。Commit／freshness 變更仍由既有 renderer 更新同一 iframe 的 srcdoc，內部捲動與收合狀態可能重置。
- 閱讀有效舊文時不因新回合完成而強迫跳底。僅載入較舊頁而沒有最新正文時，最新面板暫不顯示；「回到最新原文」後再出現。面板永遠代表目前已提交 State，不是各舊回合的狀態快照。
- HTML/CSS 只設計面板內部；外層由平台固定在最新正文後。套件沒有 placement／mount，卡內 position 仍只 static／relative；沒有新增側邊模式或可執行 JS／Host Action。
- 前端無 WorldState 寫權、無完整規則引擎；worldActions／derivedDisplays 預留但目前必須為空。
- 「不執行卡片 JS」是 v1 profile 邊界；將來隔離 JS、Host Action／授權衍生結果需要另版契約、安全與生命週期驗收。
- 四條件案例使用 `check_1`～`check_4` 四個明示合成布林條件；不是《漫遊者號》未知原卡規則。
