# SCEAN

> **目前版本 `1.7.0-local.stagev2.1.dsh022.3`：已正式整合新版舞台（Stage v2）。可以直接把本頁網址 `https://github.com/zeola0187/scean` 貼進 DSH 安裝。**

在 DSH 裡製作角色、保存劇本，接著開始一場可以持續發展的角色扮演。Suite 完整包同時包含舞台 Runtime 與 Card Studio。

## 安裝（DSH 0.2.2-rc.3）

1. 等待進行中的生成與保存完成，並備份 DSH、Profile、卡片、演出與設定。
2. 開啟 DSH「插件」→「添加插件」→「安装第三方插件」。
3. 在「包名或地址」貼上**下面完整一行**：

```text
https://github.com/zeola0187/scean
```

4. 安裝完成後，插件清單應顯示 `@local/dsh-scean-suite`，版本為 **`1.7.0-local.stagev2.1.dsh022.3`**。如果顯示的是舊版本號，請不要開啟版本豁免，改用下方的固定版本安裝。
5. 重新開啟 DSH，在對話中打開「舞臺」。看到書架式首頁，就代表新版舞台已啟用。

首頁網址會跟隨 `main` 的最新安裝版本。已經裝好的 DSH 不會因為首頁更新而自動升級；要升級時，再貼一次同一個網址即可。

要固定安裝這一版，可使用固定 tag：`https://github.com/zeola0187/scean#v1.7.0-local.stagev2.1.dsh022.3`。

## 支援的 DSH 版本

- **已實測：Windows／官方 DSH 0.2.2-rc.3**。測試用的 Desktop 封包 SHA256 與 [`dsh-compatibility.json`](dsh-compatibility.json) 中審核過的 rc.3 封包一致。
- 套件宣告允許的 DSH 版本（`engines`）沿用前一版，但新版舞台**只在 0.2.2-rc.3 上驗證**，其他版本不宣稱相容。
- 不支援也不需要版本豁免。

## 第一次使用

1. 在 DSH 配置可用的模型。
2. 打開「舞臺」。第一次會看到三個入口：
   - **試玩範例故事**：一鍵開始內建的「放學後的天台」。
   - **製作自己的角色**：進入 Card Studio 的編輯室。
   - **匯入卡片**：使用既有的 PNG／JSON 卡片。
3. 在 Card Studio 檢查並保存劇本，回到舞臺選擇保存版本與開場，就能開始新演出。
4. 輸入行動或對話，閱讀正文。

每一份 Seed 卡片對應一個 DSH 創作對話，這是刻意的設計。

## 新版舞台有什麼

- **書頁式閱讀**：正文就是主畫面。作品面板接在最新一段之後，舊段落維持乾淨的閱讀版面。
- **這一步要花多久**：需要時間資訊時，直接點「片刻」、今天剩下的時段或「到明天」；需要細調時再展開「指定時間…」。
- **回顧**：分章節閱讀完整摘要，也能搜尋已保存的原文（最新的在前）。可以打開任一段原文、翻上一段或下一段，並一鍵回到目前進度。
- **與此同時**：世界有新公告或論壇傳聞時，會以插頁形式接在最新正文之後；看過就可以收起。
- **我已知的設定**：在正文旁按「記下」釘住重要的一句話，筆記可以匯出與匯入。
- **劇本版本**：演出固定使用開始時的劇本版本；修改作品後，可以用新版另開演出，原本的演出保留。
- **進階工坊**：模型、文風、章節等進階設定集中在舞台的工坊入口。
- **手機**：面板可往下滑關閉，叫出鍵盤時版面會跟著調整。
- **例外恢復**：模型錯誤、時間衝突、結算失敗都有明確的說明與重試方式，不會悄悄丟掉你的輸入。

## 資料與已知限制

- **存檔格式沿用 v13**，新版只多兩份附屬資料：世界消息的已讀紀錄 `feed-cursor.json` 與玩家筆記 `player-notes.json`。降版時這兩份資料會被舊版忽略，演出本身不受影響。
- **舊演出不保證能在新版舞台正常遊玩**。本專案仍在快速開發，舊存檔不提供遷移；沒有故事時間定義的舊演出可能只能閱讀或匯出。建議用新版開新演出。
- 新版舞台在合成測試與使用者親自遊玩中通過驗收，但模型仍可能誤判狀態、時間或角色反應。
- 實體手機與 Safari 只做過窄螢幕模擬，尚未在實機上驗證。
- 模型生成、摘要、向量召回與背景工作會依你使用的服務產生用量；安裝本身不會呼叫付費模型。
- 匯入卡片不代表卡片的外部腳本或插件機制都相容。

## 回退到前一版

如果新版不能使用，可以安裝前一個可用版本 **`1.6.4-local.w29.2d.rc3.1.dsh022.3`**（DSH 0.2.2-rc.3）。在同一個「包名或地址」欄貼上這個固定 TGZ 直鏈：

```text
https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz
```

[版本說明](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.3) · [SHA256SUMS.txt](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SHA256SUMS.txt)

- 回退只更換插件，不會刪除或改寫任何演出資料。新版建立的 `feed-cursor.json` 與 `player-notes.json` 會留在原處，舊版不會讀取。
- 不要用整份舊 Profile 覆蓋新的進度。
- 需要 OpenRouter 輸出預設修補時，另外安裝 [guard 0.1.0-local.5](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-OpenRouter-output-default-0.1.0-local.5.tgz)。它只支援 DSH 0.2.2-rc.3，不會隨 Suite 自動安裝。

更早的 [1.6.3 正式版](https://github.com/zeola0187/scean/releases/tag/v1.6.3-local.w29.2d.rc3.1)（DSH 0.2.1-rc.3）仍是 GitHub Latest。

## 原始碼與授權

[本版固定原碼](https://github.com/zeola0187/scean/tree/v1.7.0-local.stagev2.1.dsh022.3) · [Stage v2 整合與驗收報告](docs/STAGE-V2-FINAL.zh-TW.md) · [本版發行說明](docs/RELEASE-STAGE-V2.zh-TW.md)

套件與原碼都不包含 DSH SDK、Seeker、模型憑證、私人故事或 Profile。SCEAN 原創內容採 **AGPL-3.0-only**；`advanced-tavern-card-authoring` 保留原有的 MIT 授權。詳見 [LICENSE](LICENSE)、[授權範圍](LICENSE-SCOPE.md) 與[第三方聲明](THIRD-PARTY-NOTICES.md)。
