# SCEAN

在 DSH 裡製作角色、保存劇本，接著開始持續發展的角色扮演。Suite 完整包包含舞台 Runtime 與 Card Studio。

## DSH 0.2.2-rc.3 預發版

Windows／官方 **DSH 0.2.2-rc.3** 請使用 **`1.6.4-local.w29.2d.rc3.1.dsh022.3`**。

[下載 Suite 完整包](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-suite.tgz) · [SHA256SUMS](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SHA256SUMS.txt) · [版本說明](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.3) · [相容性與驗證範圍](docs/DSH022-RC3-COMPATIBILITY.md)

1. 等待生成及保存完成，備份 DSH、Profile、卡片、演出與設定。
2. 下載上面的固定 TGZ 並核對 SHA256，在 DSH 官方插件／bundle 安裝流程選擇該 TGZ。
3. 確認載入版本為 `1.6.4-local.w29.2d.rc3.1.dsh022.3`，再用新建的合成演出或既有資料的唯讀檢查驗收。
4. 如需 OpenRouter 輸出預設修補，另裝 [guard 0.1.0-local.5](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-OpenRouter-output-default-0.1.0-local.5.tgz)。此 guard 僅支援已核對的 DSH 0.2.2-rc.3，不隨 Suite 自動安裝，也不會在預設安裝時自動呼叫付費模型。

若遇到 `ERR_PNPM_UNEXPECTED_STORE`，先核對現有 profile 的 `node_modules/.modules.yaml` 與安裝器使用的 store，再保全資料並採 profile 範圍修復；不要刪除依賴、清理正在引用的備份資料夾或直接改全域 store。

請下載固定 TGZ。把倉庫根網址貼入 Git 安裝器會解析預設分支，不代表安裝此預發版。不要使用版本豁免強裝。

## 這版改動與驗證

依實際封裝 rc.3 SDK 核對舞台與 Studio，加入精確 engine／peer 邊界；guard 更新實際 adapter 指紋，補測 prefix digest 與 signed-thinking replay。舞台核心、Studio runtime 邏輯、guard wrapper 與權限政策沒有改動。

離線回歸 **1,748 通過、0 失敗、1 個既有 skip**；另外三項缺失歷史 fixture 明確排除。官方 PluginManager 全新隔離 profile 安裝成功；安裝後的 Studio 匯入、儲存與舞台啟動、guard 啟用及釋放均完成合成測試。測試沒有使用正式使用者資料或付費模型。

**正式 Desktop UI 與真實模型尚未驗收。** 本版仍是預發版，既有 [1.6.3 正式 Release](https://github.com/zeola0187/scean/releases/tag/v1.6.3-local.w29.2d.rc3.1) 與 GitHub Latest 保留。若使用 DSH 0.2.2-rc.1，可參閱 [先前 .2 預發版](https://github.com/zeola0187/scean/releases/tag/v1.6.4-local.w29.2d.rc3.1.dsh022.2)。

## 使用與資料

從創作入口製作或匯入卡片，檢查並保存劇本，再到舞台選擇保存版本與開場。修改作品不會覆寫既有演出的固定版本。章節、時間、世界日常與不同模型分工沿用既有設定。

模型生成、向量召回及背景工作依服務設定產生用量。安裝不等於授權付費生成。更新或降版前先保全新增故事資料，不要用整份舊 profile 覆蓋新進度。

## 原始碼與授權

[固定版本原始碼](https://github.com/zeola0187/scean/tree/v1.6.4-local.w29.2d.rc3.1.dsh022.3) · [完整對應 source ZIP](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-source.zip) · [來源與套件收據](https://github.com/zeola0187/scean/releases/download/v1.6.4-local.w29.2d.rc3.1.dsh022.3/SCEAN-1.6.4-local.w29.2d.rc3.1.dsh022.3-source-receipt.json)

套件與完整來源不包含 SDK、Seeker、模型憑證、私人故事或 profile。SCEAN 原創內容採 **AGPL-3.0-only**；保留 `advanced-tavern-card-authoring` 的 MIT 授權。詳見 [LICENSE](LICENSE)、[授權範圍](LICENSE-SCOPE.md) 與[第三方聲明](THIRD-PARTY-NOTICES.md)。
