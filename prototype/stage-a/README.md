# SCEAN 舞台 · 方案 A「書頁」· P0 可操作原型

基準：`v1.6.4-local.w29.2d.rc3.1.dsh022.3`（分支 `proto/stage-a-p0`）。本目錄是獨立原型，**不接 Host、不改 Runtime、不呼叫模型、不讀寫任何存檔**。所有作品、存檔、正文均為合成資料，只存在瀏覽器分頁記憶體中。

## 執行

```bash
node prototype/stage-a/serve.mjs          # 只綁 127.0.0.1:5178
```

開啟 `http://127.0.0.1:5178/`。直達特定畫面（也可在 Artifact 預覽中使用）：

| 連結 | 畫面 |
|---|---|
| `#read-campus` / `#read-road` / `#read-trpg` | 直接進入該題材的存檔 |
| `#work-trpg` | 作品頁與開新局 |
| `#demo-running-road` | 生成中（停在「書寫正文」20 秒，可按取消） |
| `#demo-time-campus`、`#demo-timesheet-road` | 需要確認時間／時間確認表單 |
| `#demo-settle-campus` | 正文完成、結算失敗，顯示暫存正文 |
| `#demo-unknown-trpg` | 提交結果未知 → 確認未保存 → 再試一次 |
| `#demo-forum-campus`、`#demo-calendar-campus`、`#demo-lore-trpg`、`#demo-character-road`、`#demo-world-trpg`、`#demo-menu-trpg` | 各閱讀面板 |

任何連結後加 `-dark` 或 `-light` 可指定外觀，例如 `#demo-settle-trpg-dark`。其他情境可用畫面上的「原型控制台」指定下一次送出的結果。

截圖：`node prototype/stage-a/tools/shoot.mjs`（需先啟動 serve.mjs，使用本機 Chrome 的 DevTools Protocol；手機截圖為 390×844、DPR 2、觸控模擬）。

## 結構

```
src/
  main.mjs                 組裝：store + transport + turn flow + UI
  transport/contract.mjs   UI 可用的 action 清單；標示 existing（rc3 Host 已有）或 proposed（提案）
  transport/mock-transport.mjs  模擬 Host：單一寫入者、階段進度、原子提交、暫存正文、提交未知、取消時機
  domain/turn-flow.mjs     回合生命週期與 requestId / operationId 規則（沿用 rc3 view-model 的語意）
  ui/                      shelf（書架）、reader（閱讀頁＋輸入）、sheets（側欄／底部抽屜）、parts
  fixtures/                三個合成作品：現代校園、公路旅行、TRPG
  demo.mjs                 審閱用直達連結
styles/tokens.css          中性外觀＋三套題材 token（各含淺色／深色）
styles/app.css             共用版面；題材只改 token 與少量點綴，不改資訊架構
```

UI 只呼叫 `transport.call(action, payload)`。P1 以 HTTP（隔離 server）或 Typert（原生）adapter 取代 mock，UI 不需改動。

## 本輪要求對照

1. 獨立 worktree／分支，未修改正式版本、部署或存檔。
2. 元件化前端（無框架、無外部相依）＋ Mock Transport；不呼叫模型。
3. 書架 → 作品 → 開新局 → 閱讀 → 輸入 → 角色／此刻與變化／論壇／日曆，全部可操作。
4. 正常、生成中、時間確認、結算失敗、提交未知、取消、重試皆可重現；另含重寫與收回。
5. 未提交內容一律放在「待處理區」：虛線框＋「尚未保存」；暫存正文另有斜紋底與「尚未計入故事」標籤，不進入故事流、不產生變化回執、角色名不可點。
6. 「等待…」只把等待寫成玩家行動草稿，由故事判斷經過時間，**不送 timeConfirmation**。timeConfirmation 只在 Host 回報 `NEEDS_TIME_PRECISION` 後出現，形狀沿用 rc3 schemaVersion 2（refine／advance_to，`dayOrdinal`＋`periodId`），且只套用於該次輸入；改變確認內容會換新 requestId。
7. 「我已知的設定」在 revealedLore 實作前明確顯示「尚無法顯示」，不以完整世界書代替；完整設定集需按確認才顯示，並常駐「含劇透 · 不代表你已知」標示。
8. 同一版面支援三種題材外觀：現代校園（方格紙、原子筆藍、螢光筆）、公路旅行（柏油灰、鈉燈琥珀、路面虛線時間分隔）、TRPG（石板、黃銅、襯線、裁定徽章）。可在顯示設定切回統一中性外觀。
9. 桌面（1440×900）與手機（390×844）實際瀏覽器驗收；截圖見 `screenshots/`。

## 與 rc3 Host 的落差（P1 前要決定）

- 回合的公開變化（`changes`）、書架摘要（最後一句、時間、地點）由 mock 產生；正式 Host 需要第一階段提案的 `historyPage` 逐輪差異與 `homeSummary`。
- `revealedLore` 尚未存在，mock 直接回 `NOT_IMPLEMENTED`。
- 「世界動態」插頁（論壇新貼文、日曆新公告）在 mock 中與回合一起提交；正式世界日常是背景工作，P1 需要 `worldFeed` 或輪詢 `worldRoutineRead` 比對。
- 「重寫這段」的額外指引欄位尚未放入 UI。
- 原文搜尋、角色私人診斷、工坊（模型、摘要服務、備份）不在 P0 範圍。

## 已知限制

- 只做過 Chromium（Chrome／Edge 引擎）驗收；未在實體 Android、iOS Safari 與實體鍵盤彈出情境測試。
- 字型由 Google Fonts 載入；離線時會退回系統字型。
- 無自動化單元測試；turn-flow 的識別碼規則以手動情境驗證。
