# 玩家配色與閱讀空間（功能分支候選）

本候選基於 `f2d7e78693cfb8d82b7e4f52c5f09f1436d4e77d`，僅更新共用玩家 UI；不是新版 Release，也不會更新現役安裝。

在故事工具的「設定」中可選：

- **顯示模式**：跟隨系統、淺色、深色。
- **深色配色**：深黑、森林綠、酒紅；淺色模式維持原有外觀。
- **閱讀字級**：標準、大字。
- **閱讀寬度**：舒適（上限 730px）、寬版（上限 1100px）。實際可用寬度由視窗和側欄決定。

桌面頂部的「收合書架／展開書架」及「收合此刻／展開此刻」彼此獨立，入口始終在側欄外。可用 Tab、Enter、空白鍵操作；欄內有焦點時收合，焦點會回到對應入口。滑鼠切換時保留正在編輯的輸入焦點和游標。

玩家介面寬度低於 1180px 時，沿用「書架／故事／此刻」分頁，桌面收合值暫不作用。回到寬視窗時恢復原值。這裡指玩家面板的寬度，包含 DSH 側邊欄後不一定等於螢幕寬度。

配色、字級、閱讀寬度及左右收合只保存在**此裝置、此入口**。換瀏覽器、網址／port 或清除瀏覽器資料可能需重選，不提供 Host／Profile 跨裝置同步。舊設定仍保留原有模式、字級；新增欄位以森林綠、寬版、兩側展開補齊。保存失敗會明示，本次選擇仍可使用。

改變排版會保留可見文字錨點；位於末尾時繼續跟隨末尾。隱藏側欄不重建正文或輸入節點。警告、錯誤與焦點色獨立於配色；卡片作者前端保留自己的 sandbox 和配色，不注入平台 CSS。

共用來源為 `isolated/web/presentation.mjs`、`presentation.css`、`player-shell.mjs`、`reading-layout.mjs`，原生偏好白名單在 `plugin/player-native-bridge.mjs`。`plugin/client.js` 及 `packages/scean/plugin/client.js` 必須由來源重建，不手改生成檔。

在全新功能分支 checkout 重現驗證，可依序執行：

```powershell
python scripts/prepare-test-sdk.py --asar PATH_TO_REVIEWED_APP_ASAR
node --test tests/ui-layout-preferences.test.mjs tests/w19-presentation.test.mjs tests/w19-client.test.mjs tests/plugin-client.test.mjs
python scripts/build-candidate.py --stage=build-suite-source-ui-check
node --require ./scripts/w19-offline-network.cjs scripts/test-ui-layout-gui.mjs
node scripts/test-ui-official-host.mjs
```

最後一個命令持續執行官方隔離 Web Host，另開終端執行 `node scripts/test-ui-official-gui.mjs`。結束時在 `evidence/ui-layout-official-host/stop-request` 建立空檔案，由夾具正常關閉。所有資料與瀏覽器 Profile 留在本 checkout 的 evidence，SDK 留在忽略的 node_modules；不讀現役故事／憑證，不聯絡模型供應商。需本機 Node 24、Python、Chrome 及已核實官方 rc.2 ASAR，不下載外部依賴。

測試層次分開：共用 Web UI 使用測試專用公開傳輸與真 Host/Core/Store；生成原生 UI 使用測試 DSH／React 掛載；官方 Profile 測試使用真正 DSH Web 與真正原生插件面板，透過測試插件建立空白合成 Session。這些都不等於原生 Desktop 視窗、實體手機／觸控或真模型品質測試。既有 `isolated/server.mjs` 主機限制仍保留；完整回歸的既有失敗另列於驗收記錄。

後續與其他分支整合時，注意 `isolated/web/player-shell.mjs` 可能與開場選擇工作重疊，生成 client 應在合併共用來源後重新產生。此分支沒有修改 Skills/catalog、授權檔、Core、Writer、Memory 或 State 契約。
