# SCEAN 舞台 v2 與 Card Studio 產品整合

> 下一階段（DSH Desktop 整合與預覽版）：[STAGE-V2-DESKTOP.zh-TW.md](STAGE-V2-DESKTOP.zh-TW.md)；預覽版使用說明：[DESKTOP-PREVIEW.zh-TW.md](DESKTOP-PREVIEW.zh-TW.md)。

基準：`v1.6.4-local.w29.2d.rc3.1.dsh022.3`；分支 `proto/stage-a-p0`（獨立 worktree）。目標 DSH：0.2.2-rc.3（已核對 app.asar SHA-256 與 `dsh-compatibility.json` 相符）。

## 1. 產品結構

| 區域 | 位置 | 內容 |
|---|---|---|
| 作品 | Studio `local-scean-home` | 目前對話的作品與進度（創作 → 檢查 → AI 審閱 → 劇本 → 演出）、下一步按鈕；沒有作品時提供「和 AI 從一個想法開始」「使用現有角色卡」；「開始新作品」會建立新的創作對話並回到作品頁 |
| 創作 | Studio `local-scean-studio` | 與助理的原生 DSH 對話；側欄「開演前」三步驟（檢查作品／請 AI 審閱／保存劇本並開演）、作品外觀、可複製的協作提示 |
| 舞台 | SCEAN `local-scean`（v2 預設） | 作品書架（繼續演出、選開場開演）、閱讀頁、此刻、角色、日曆、論壇、設定集、回顧 |

三區使用相同的「作品／創作／舞台」導覽。每個 DSH 創作對話綁定一部作品（沿用既有權限模型）。

## 2. 架構

**Stage v2**（`isolated/web/stage2.html`、`stage2.css`、`stage2.mjs`、`s2-*.mjs`）
- 與舊版共用 opaque sandbox iframe、MessageChannel 橋接與 CSP（`default-src 'none'`、`connect-src 'none'`、`font-src 'none'`、script hash）。沒有網路或儲存後門；`tests/plugin-client.test.mjs` 檢查。
- `scripts/build-player-native.mjs` 編譯兩份獨立文件（舊版 `app.mjs`、v2 `stage2.mjs`），一起放入 `plugin/client.js`。
- 原生面板依裝置偏好 `scean.stageUi.v1` 選擇 v2（預設）或舊版。新的橋接動作 `native.stageUi` 只切換呈現，不影響權限；舊版設定區有「改用新版舞台」。
- 回合流程沿用舊版的識別規則：先 `draftSave`，每次執行使用新的 operationId；重試保留 requestId 並帶 `retryOf`；新時間確認改用新 requestId；只以 Host 收據證明提交。
- **送出前一律重新讀取 `runView`**。世界日常會在背景提交，舊的 version/head 會被 Host 拒絕。「想法」也同樣使用最新 head，過期時重試一次。
- v2 在畫面上時，不顯示父層的「本輪已保存」前景提示，避免在手機上蓋住舞台頁首；背景／OS 通知不受影響。

**Card Studio**（`sources/card-studio/cardstudio-bundle/client-template.js`）
- 作品頁、開演前三步驟、作品外觀、協作提示。
- 「檢查作品」會先在沒有未保存編輯時重新讀取最新保存版本，避免 AI 剛修改後出現 `SCEAN_REVISION`。
- 審閱狀態：當檢查過的版本等待 AI 審閱時，每 6 秒安靜地重新讀取（只做本機檢查，不呼叫模型）。成功即停；有未保存編輯時暫停；無活動約 2 分鐘後停止。另保留「手動更新」。

## 3. Host／Core 契約變更（皆為新增，既有語意不變）

1. `historyPage` 可選參數 `changes: true`（`core/turn-changes.mjs`）：每回合附上公開的「這一步之後」差異。
   - 有 Blueprint 的作品只列已宣告的 **public** 變數；restricted 變數在讀值前就略過。
   - 沒有 Blueprint 的作品只用公開世界投影。
   - 不讀角色私人狀態或記憶；時間顯示使用 Host 的 Clock 標籤。
   - 單元測試含 restricted／private canary：`tests/turn-changes.test.mjs`。
2. 故事時段可選 `label`（`core/story-clock.mjs`）：例如「放學後」。最多 24 字、不可含 `<>`。未提供時沿用原本的名稱表；既有定義與 definitionHash 不變。
3. `publicSnapshot.presentationTheme`：讀取卡片 `extensions.scean.presentationTheme`，只接受 `neutral|campus|road|fantasy`。不是 CSS，也不是自由文字。

## 4. 相容性

- 存檔格式、提交流程、StoryClock、記憶、私密投影、作者前端沙盒都沒有修改。舊演出在 v2 正常閱讀與遊玩：沒有主題時用中性外觀，沒有 Blueprint 時顯示公開世界差異。
- **降版限制**：在作品時間設定中使用時段 `label` 的作品，舊版 SCEAN 的時間驗證不接受多出的欄位，因此用舊版開新演出會失敗。這類作品只能由本版或更新版開演。`presentationTheme` 對舊版沒有影響。
- 新舊介面讀寫同一份 Host 資料。已驗證：v2 提交的回合（含唯一輸入字串）在切回舊版後可見。

## 5. 驗證

隔離環境：`scripts/stage-next-host.mjs`。官方 DSH Web 0.2.2-rc.3（從已核對的 app.asar 解出），`DSH_HOME` 位於 `evidence/` 下，只綁 127.0.0.1，出站網路由 `w19-offline-network.cjs` 阻擋。所有模型呼叫由 `fixtures/stage-next.mjs` 的 scripted adapter 回答，涵蓋 director／writer／post_stat／ideas／calendar／forum／Studio 協作與審閱工具迴圈。

- **正式安裝**：未寫入正式 DSH 或個人 Profile。
- **付費模型**：0 次請求。

| 項目 | 結果 |
|---|---|
| 首次使用旅程（桌面）：新作品 → 匯入 → 作品外觀 → AI 改寫開場 → 檢查 → AI 審閱 → 保存劇本並開演 → 選開場 → 兩個回合 → 想法 → 六個面板 | 校園 16/16、TRPG 17/17、公路含故障 20/20 |
| 同上（手機 390×844，觸控模擬） | 校園 17/17、公路含故障 20/20 |
| 故障恢復（真實 Host）：結算失敗 → 讀暫存正文 → 繼續整理；連線回應遺失 → 自動查回；寫作中取消 → 再送一次 | 桌面、手機皆通過 |
| 新舊介面共存與資料一致 | 4/4 |
| 單元測試（新增） | turn-changes 3/3、v2 沙盒／CSP 1/1 |
| 全套離線回歸 | 1,690 tests：1,674 pass／15 fail／1 skip |

全套回歸的 15 個失敗中，13 個與未改動的基準在同一環境下相同（缺少歷史 fixture、暫存路徑 junction 等環境因素）。另外 2 個是負載下的時序測試：單獨重跑 3 次都通過；基準環境也有 1 個同類的時序失敗。

截圖：`evidence/firstrun/`、`evidence/coexist/`、`evidence/e2e/`；各旅程的報告是同目錄的 `*-report.json`。

## 6. 過程中發現並處理的問題

- **背景提交使 base 過期**：世界日常背景提交讓前端持有的 base version/head 過期，回合與想法被拒。v2 改為送出前重新讀取。
- **AI 修改後立即檢查失敗**：檢查送出舊 revision（`SCEAN_REVISION`）。「檢查作品」改為先重新讀取最新保存版本。
- **審閱完成需要手動更新**：審閱完成後還要按一次更新，且容易和對話結束時的刷新互相競爭。改為自動、有上限的重新讀取。
- **父層提示蓋住舞台頁首**：DSH 前景提示在手機上蓋住舞台頁首與「⋯」。v2 在畫面上時不顯示該提示。
- **手機版面**：Studio 改為先顯示對話，文案不再提「左邊」；變化列在手機上改成兩行。

## 7. 尚未完成或尚未驗證

- ~~**單位字串誤判**~~：已在 Desktop 階段修正，可攜性規則不再把「/24」等文字當成路徑，相容性稽核也會提前檢出真實路徑。見 [STAGE-V2-DESKTOP.zh-TW.md](STAGE-V2-DESKTOP.zh-TW.md) §4.1。
- **審閱需由使用者在對話中提出**：DSH SDK 沒有提供插件代送訊息到會話的公開 API，所以「請 AI 審閱」需要使用者在對話中送出（提供一鍵複製）。
- **作品列表只到目前對話**：這是刻意的產品決策。每張 Seed 卡使用自己的創作對話，避免不同素材混入同一段 AI 上下文；同一 Seed 的多個劇本版本留在同一個對話中。
- **進階設定仍在舊版舞台**：模型分派、摘要服務、文風、禁用詞、備份、診斷。v2 的設定頁提供切換入口。
- **其他未提供的功能**：「我已知的設定」需要 revealedLore，尚未實作，v2 明確顯示「尚無法顯示」。v2 不支援非原生的隔離 HTTP 伺服器。
- **未驗證的環境**：DSH Desktop（Electron）本體已在下一階段完成隔離驗收，見 [STAGE-V2-DESKTOP.zh-TW.md](STAGE-V2-DESKTOP.zh-TW.md)。實體 Android／iOS、真實網路與真實模型仍未驗證。

## 8. 如何執行

```bash
python scripts/prepare-test-sdk.py --asar "E:/DSH/resources/app.asar"
node scripts/dev-build.mjs
node scripts/stage-next-host.mjs --label=stage-next-dev
node scripts/stage-next-firstrun.mjs --genre=road --faults
node scripts/stage-next-firstrun.mjs --phone --genre=campus --faults
node scripts/stage-next-coexist.mjs --conversation=改寫開場
```

- **SDK 準備**：只讀取 asar，寫入本 worktree 的 `node_modules`。
- **建置**：產生兩個 client，並依 BUILD-MAP 同步 `packages/`。
- **Harness 入口**：啟動後打開 `evidence/stage-next-dev/launch.json` 裡的 `entry`。
- **停止**：在 `evidence/stage-next-dev/` 建立 `stop-request` 檔案。
