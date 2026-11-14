# SCEAN 1.7.0-local.stagev2.1.dsh022.3：Stage v2 正式整合

## 版本與來源

- **Suite／Runtime／Studio 版本**：`1.7.0-local.stagev2.1.dsh022.3`。
- **固定原碼標籤**：`v1.7.0-local.stagev2.1.dsh022.3`。
- **整合方式**：以 `main`（`2851519`，rc.3 相容 Suite `1.6.4-local.w29.2d.rc3.1.dsh022.3`）為基礎，用一般合併（no-ff）引入驗收標籤 `stage-v2-accepted`（`7f285f8`）。
- **合併結果**：沒有衝突。`main` 在分岔後只改了 README 與 EXPORT-MANIFEST，Stage v2 沒有動到這兩份檔案；rc.3 相容修正、首頁網址安裝機制、授權與第三方聲明全部保留。
- **安裝來源**：GitHub 首頁網址 `https://github.com/zeola0187/scean` 對應預設分支 `main`。
- **Guard**：`0.1.0-local.5` 沒有改動，仍隨前一版 Release 發布，也不隨 Suite 自動安裝。

## 版本號與快取

- 新版本號與舊版 `1.6.4-local.w29.2d.rc3.1.dsh022.3` 不同，pnpm／DSH 不會把它當成已快取的舊套件。
- 舊版的固定 tag 與 Release 資產沒有被覆寫。
- 從首頁網址安裝時，pnpm 依 Git commit 解析來源，所以安裝到的一定是當下 `main` 的內容。

## 建置

- 正式產物由既有流程 `python scripts/build-candidate.py` 產生：
  1. Card Studio client 由 `sources/card-studio/build_cardstudio.py --client-only` 產生。
  2. 原生 Player Client 由 `scripts/build-player-native.mjs` 產生，Stage v2 的 11 個模組一起打包進 `plugin/client.js`。
  3. `BUILD-MAP.json` 的 271 個 runtime 檔案逐一複製到 `packages/` 並比對雜湊。
- Stage v2 新增的 runtime 檔案：
  - `packages/scean/plugin/world-feed.mjs`
  - `packages/scean/plugin/player-notes.mjs`
  - `packages/scean/core/turn-changes.mjs`
  - `packages/studio/lib/samples/scean-sample-campus.json`
- 隔離預覽工具（`scripts/desktop-preview.mjs`）只用於開發測試，它產生的 `.stagev2-<sha>` 套件不是發行產物。

## 驗證

實際的測試數字、安裝驗證步驟與證據記錄在倉庫根目錄的 `RELEASE-VERIFICATION.json`。

驗證原則：
- 只使用隔離的 DSH Desktop 副本與隔離資料。
- 只使用 scripted provider，不發出付費模型請求。
- 不寫入使用者的正式 DSH 或 Profile。

## 相容性

- **目標 DSH**：0.2.2-rc.3。測試用 Desktop 的 `app.asar` SHA256 為 `14cfd81c…725ae`，與審核過的封包一致。
- **其他 DSH 版本**：套件 `engines` 沿用前一版宣告，但本版只在 0.2.2-rc.3 驗證過。
- **存檔**：沿用 v13，新增附屬資料 `feed-cursor.json` 與 `player-notes.json`。舊演出不提供遷移；建議用新版開新演出。

## 回退

在 DSH「包名或地址」貼上前一版的固定 TGZ：

```text
https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz
```

回退只更換插件，不刪除演出資料。
