# SCEAN

在 DSH 裡製作角色、保存劇本，接著開始可以持續發展的角色扮演。

你用自然語言決定行動與對話，SCEAN 組織場景、描寫角色反應，並在正文完成後更新故事狀態、記憶與時間。Runtime 與 Card Studio 包含在同一個 Suite 套件。

**本文件目前是本機安裝候選的首頁草稿，版本 `1.6.4-local.w29.2d.rc3.1.dsh022.2`。尚未推送、合併或發布；下列新版下載與來源標籤連結待發布後才會生效。不要把它當成目前 GitHub Latest。**

## 本版整理的功能

- 支援本輪核對的官方 **DSH 0.2.2-rc.1／Windows**，Studio 工具沿用明確的工作卡範圍與授權。
- 導演 → Writer 正文 → PostStat 世界結算 → Host 檢查與保存；既有故事保留原卡片與來源身份。
- 章節召回保留最近 3 篇摘要。有效舊章不超過 8 篇時全部帶入，這個小集合不需 embedding 或 rerank；更多舊章沿用有界混合檢索。
- 協作讀取器接受 PostStat 流程合法省略的逐項引用，不修改舊正文或私人欄位權限。
- 時間入口顯示「指定結算時間（選填）」，保留確認、來源變動失效與忙碌停用。
- 失敗後可依目前模型設定重做本輪；明確使用原模型重試或繼續結算時，仍保留原請求及模型身份。

這份候選包含先前 PR #1 未納入的上述局部修補。沒有新增故事存檔格式或自動搬移資料；不是把伺服器 Profile 複製到另一台電腦。

## 從本專案首頁安裝

本輪乾淨安裝目標是 **官方 DSH 0.2.2-rc.1、Windows**。主力機若尚未使用這個宿主版本，先確認宿主升級及備份方案；不要用版本豁免強制安裝。

1. 等待當下生成、結算與保存完成，正常退出需要更新的 DSH。建立當時最新的程式、Profile、卡片、故事及設定備份。
2. 新版發布後，從本頁下載固定版本的 [Suite TGZ](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.2/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.2-suite.tgz) 與 [SHA256SUMS.txt](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.2/SHA256SUMS.txt)。核對雜湊後，在官方插件／bundle 安裝流程選擇該 TGZ。
3. Suite 已包含舞台 Runtime 與 Studio。確認實際版本為 `1.6.4-local.w29.2d.rc3.1.dsh022.2`，再用合成新演出或既有資料的唯讀頁面驗證。
4. 使用 OpenRouter 且需要輸出預設修補時，另外安裝同版 Release 的 [guard TGZ](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.2/SCEAN-OpenRouter-output-default-0.1.0-local.4.tgz)。guard 只支援精確的 DSH 0.2.2-rc.1，不會隨 Suite 自動安裝；安裝不會自動呼叫付費模型。

這是「從首頁下載固定版本套件」的流程。不要把純倉庫網址貼入安裝器，期待它自動選擇此 Release：Git 安裝依預設分支解析，而目前公開 `main` 仍有較舊的套件程式。

現有 RC3 用戶的 [1.6.3 Release](https://github.com/zeola0187/scean/releases/tag/v1.6.3-local.w29.2d.rc3.1) 保留。這份候選不會更改其附件、標籤或 Latest 身份；舊 SDK 的套件准入不等於本輪新增了舊機實測。

## 資料與使用

保存角色與劇本後開啟新演出；後續修卡不會改寫已存在演出的固定版本。日曆、論壇、章節與模型工作需要作品或使用者的相應設定。

保持卡片、正文、記憶、來源與操作身份完整。失敗後先查看現有結果，結果不明時不要反覆重送。回退前先保留更新後新增的資料，再還原相配套的程式與設定；不要直接用舊備份覆蓋新進度。

模型生成、向量檢索及背景工作依既有服務設定產生用量。安裝、設定與唯讀驗收不代表授權付費生成。本套件不包含模型憑證、私人故事、Seeker、SDK 或其他服務設定。

## 驗證與原始碼

[本版說明與範圍](docs/DSH022-FULL-STAGE-RELEASE.zh-TW.md) 記錄準備方式與未驗項目；實際驗證結果隨套件的 detached receipt 提供。先前伺服器真模型驗收與本版的乾淨安裝／離線測試分別記錄，不互相替代。

預定 [完整對應原碼](https://github.com/zeola0187/scean/tree/v1.6.4-local.w29.2d.rc3.1.dsh022.2) 與 [來源 ZIP](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.2/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.2-source.zip) 將與套件一起提供，目前仍未公開。

本機重建使用 Python 3.11+、Node.js 24+：

```text
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
python scripts/build-candidate.py --stage=build-suite-source-release-check
python tests/release-support.test.py -v
python tests/license-distribution.test.py -v
python scripts/prepare-release.py --output ../NEW_RELEASE_DIRECTORY
```

打包工具只接受已核對的 `EXPORT-MANIFEST.json` 位元；原碼若改動，先重新審核與更新白名單。SDK、測試 Profile、快取、Git 歷史及使用者資料不隨包發送。guard 的測試使用攔截 HTTP，不代表真 OpenRouter 帳號或文學品質驗收。

SCEAN 原創程式與內容採 **AGPL-3.0-only**；`advanced-tavern-card-authoring` 保留 MIT 授權。詳見 [LICENSE](LICENSE)、[授權範圍](LICENSE-SCOPE.md)、[第三方聲明](THIRD-PARTY-NOTICES.md) 與 [原碼取得](SOURCE-AVAILABILITY.md)。
