# SCEAN

> **DSH 0.2.2-rc.3 安裝請使用下面完整的 `.tgz` 網址。首頁網址 `https://github.com/zeola0187/scean` 是說明頁；把它貼入 DSH 會安裝預設分支的舊版 `1.6.0`，並被 rc.3 拒絕。**

## 可直接貼入 DSH 的安裝來源

1. 開啟 DSH「插件」→「添加插件」→「安装第三方插件」。
2. 在「包名或地址」欄貼上**下面完整一行**，不要只貼倉庫首頁、Release 說明頁或 Code／Download ZIP 的地址：

```text
https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz
```

3. 安裝結果應為 `@local/dsh-scean-suite 1.6.4-local.w29.2d.rc3.1.dsh022.3`。若顯示 `1.6.0`，來源仍是舊版；不要開啟版本豁免。
4. 也可以先下載該 TGZ，再把下載檔的**完整本機路徑**貼入同一欄位。下載的是 `-suite.tgz`，不是 source ZIP；安裝前仍需等待生成與保存完成並備份資料。

Suite 已含舞台 Runtime 與 Card Studio；其他已安裝插件的相容性警告是獨立問題，Suite 不會更新或啟用那些插件。

在 DSH 裡製作角色、保存劇本，接著開始一場可以持續發展的角色扮演。

你用自然語言決定行動與對話，SCEAN 負責組織場景、描寫角色反應，並在正文完成後更新故事狀態、記憶與時間。從製卡到遊玩、閱讀與回顧，都在同一個工作台完成。

[下載 DSH 0.2.2-rc.3 完整套件](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz) · [使用與版本說明](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.3) · [完整對應原碼](https://github.com/zeola0187/scean/tree/v1.6.4-local.w29.2d.rc3.1.dsh022.3)

## DSH 0.2.2-rc.3 預發版

Windows／官方 **DSH 0.2.2-rc.3** 請下載 **`1.6.4-local.w29.2d.rc3.1.dsh022.3`**。

**[直接下載 rc.3 Suite 完整包](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz)** · [SHA256SUMS.txt](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SHA256SUMS.txt) · [版本說明](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.3)

1. 等待生成及保存完成，備份 DSH、Profile、卡片、演出與設定。
2. 將上方完整 TGZ 網址貼入 DSH「包名或地址」；或下載並核對 SHA256 後，貼入 TGZ 的完整本機路徑。Suite 已包含舞台 Runtime 與 Card Studio。
3. 確認載入版本為 `1.6.4-local.w29.2d.rc3.1.dsh022.3`，再用合成新演出或既有資料的唯讀檢查驗收；不要使用版本豁免強裝。
4. 如需 OpenRouter 輸出預設修補，另裝 [guard 0.1.0-local.5](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-OpenRouter-output-default-0.1.0-local.5.tgz)。此 guard 僅支援已核對的 DSH 0.2.2-rc.3，不隨 Suite 自動安裝，也不會在預設安裝時自動呼叫付費模型。

本版依實際 rc.3 SDK 核對相容性與 guard 的 signed-thinking replay 行為。離線回歸 **1,748 通過、0 失敗、1 個既有 skip**，另明列三項缺失歷史 fixture。官方 PluginManager 隔離安裝及 Studio→舞台合成流程通過；**主力機正式 Desktop 安裝／UI與真實模型尚未驗收**。這是預發版，既有 1.6.3 正式 Release 與 GitHub Latest 保留。

若遇到 `ERR_PNPM_UNEXPECTED_STORE`，先核對現有 profile 所屬 store；不要刪除依賴、清理正在被引用的備份資料夾或直接改全域 store。

請下載上面的固定 TGZ；把倉庫根網址貼入 Git 安裝器仍會使用舊版預設分支，不代表安裝此預發版。套件不含 SDK、Seeker、模型憑證或私人資料，也不會搬移伺服器上的故事。

[完整對應原碼](https://github.com/zeola0187/scean/tree/v1.6.4-local.w29.2d.rc3.1.dsh022.3) · [完整 source ZIP](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-source.zip) · [來源與套件 receipt](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-source-receipt.json) · [相容性與測試限制](https://github.com/zeola0187/scean/blob/v1.6.4-local.w29.2d.rc3.1.dsh022.3/docs/DSH022-RC3-COMPATIBILITY.md)

DSH 0.2.2-rc.1 使用者可參閱[先前 .2 預發版](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.2)；guard .5 不適用 rc.1。

## 可以用 SCEAN 做什麼

### 製作角色與故事開場

建立角色卡，或匯入已有的 PNG／JSON 卡片。透過編輯室與製卡助手整理角色設定、世界書、開場和初始狀態，檢查後再保存。

完成的設定可以保存為獨立劇本，再從保存版本開啟新演出。修改工作卡後，舊演出仍保留原本使用的設定與進度。

### 用自然語言推動劇情

輸入主角想做的事或要說的話，接著閱讀完整正文。系統可按需要諮詢角色顧問，整理不同角色的觀點與反應，再交給寫作模型完成敘事。

你可以調整本局文風，使用單一 Writer，或保留原有的擬稿、潤稿流程。閱讀時可收合側欄、回看章節，並查看作品提供的動態資訊面板。

### 讓世界狀態跟著正文更新

正文完成後，世界結算會承接已發生的事情，更新作品所定義的物品、位置、資源、任務等狀態；沒有明說的合理後果與耗時，也交由結算模型判斷。

具有時間設定的演出可以使用上午、下午等粗時段，不必每輪填寫精確時分。若不滿意已提交的結果，可以回滾後重新選擇故事方向。

若正文已完成、後續結算失敗，可在來源、期限與次數允許時查看已保存正文並繼續結算，減少重寫同一段故事的需要。

### 查看故事裡的日曆與角色論壇

為作品啟用世界日常後，可以查看公共七日日曆，閱讀角色發表的主文與跨日留言，讓主線之外也有世界活動。

日曆上的安排是預定計畫，是否實際發生仍跟隨故事結算；論壇中的說法保留發言者立場。這些功能需在作品中明確設定並保存，既有演出不會自動加上新能力。

### 整理長篇故事與相關記憶

保留已提交正文、角色記憶與故事進度，支援章節回顧、長故事摘要及相關歷史召回。啟用並配置章節功能後，可結合近期章節與相關舊章，協助後續敘事延續脈絡。

### 為不同工作安排不同模型

沿用 DSH 已配置的供應商與模型，分別設定導演、角色顧問、正文、結算、摘要、靈感、日曆與論壇。可以設定全域預設，也可以只覆寫某一場演出。

模型生成，以及啟用的摘要、向量召回和背景工作，依你使用的服務產生相應用量。

## 第一次使用

1. 在 DSH 配置可用模型，安裝 SCEAN 完整套件。
2. 從「創作入口」建立或匯入角色卡，和製卡助手整理故事設定、開場及時間定義；需要日曆或論壇時，一併在作品中啟用。
3. 檢查並保存劇本，進入「舞臺」，選擇保存版本與開場，開啟新演出。
4. 輸入行動或對話，閱讀正文，並在旁邊查看狀態、回顧與世界資訊。

遊玩中想調整作品，可從「檢查這局的問題」與 AI 討論。確認修卡方向後保存新版，再用新版另開演出，原局保留。

## DSH 0.2.1-rc.3 舊版安裝與更新

既有 RC3 正式下載版為 **`1.6.3-local.w29.2d.rc3.1`**，是 **SCEAN 的正式發布**，目標環境為 **Windows／官方 DSH 0.2.1-rc.3**；DSH 主程式本身仍是 RC 版本。

1. 等待進行中的生成與保存完成，備份 DSH、Profile、卡片、演出與設定。
2. 從[此版 Release](https://github.com/zeola0187/scean/releases/tag/v1.6.3-local.w29.2d.rc3.1) 下載 **Suite 完整安裝包**，透過 DSH 的插件／bundle 安裝流程安裝。Suite 已包含 Runtime 與 Card Studio。
3. 確認實際載入的版本，再開啟舞臺。首次使用建議先用獨立 Profile 或新演出確認設定。

[直接下載 Suite](https://github.com/zeola0187/scean/releases/download/v1.6.3-local.w29.2d.rc3.1/SCEAN-1.6.3-local.w29.2d.rc3.1-suite.tgz) · [SHA256 清單](https://github.com/zeola0187/scean/releases/download/v1.6.3-local.w29.2d.rc3.1/SHA256SUMS.txt)

此版已設為 GitHub「Latest」。下載、版本說明與原碼均指向上述固定版本；DSH 主程式需求仍是 RC3。

## 資料與使用限制

- 新的故事存檔與恢復資料需要相容版本讀取；本版使用 v13 存檔與 v2 恢復／通知資料。降版前先保全升級後的新資料，不要直接以舊備份覆蓋。
- 未具有故事時間定義的舊演出不會自動補時或遷移，可能只能閱讀、匯出；要使用新流程，需先補齊作品時間設定，再另開演出。
- 模型仍可能誤判狀態、時間或角色反應。回滾能調整故事方向，但不代表所有格式、來源或保存錯誤都能靠重試解決。
- 匯入卡片不代表其外部腳本或插件機制都相容。目前主要驗證環境是 Windows／官方 DSH RC3，其他裝置與模型服務請依版本說明確認。

## 既有正式版原碼與授權

[完整對應原碼](https://github.com/zeola0187/scean/tree/v1.6.3-local.w29.2d.rc3.1)、來源 ZIP、來源收據與套件雜湊隨 Release 提供。開發與建置細節請參閱該版本的原碼及文件。

SCEAN 原創程式與內容採 **AGPL-3.0-only**；`advanced-tavern-card-authoring` 保留原有 MIT 授權。詳見 [LICENSE](LICENSE)、[授權範圍](LICENSE-SCOPE.md) 與[第三方聲明](THIRD-PARTY-NOTICES.md)。
