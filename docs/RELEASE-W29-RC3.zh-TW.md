# SCEAN 1.6.2-local.w29.2d.rc3.1：W29 與 DSH RC3

本版為 **預發行**，目標是官方 **DSH 0.2.1-rc.3**。以正式安裝驗收通過的 W29 Runtime 為準，從公開 1.6.0 整合以下尚未發布的功能與修正：

- **StoryClock 與 State Operations**：每個新 Run 只有 Host 權威故事時間；模型提出 hold／advance_by／advance_to，Host 在正文前結算時間與公共事件。正文、State、Clock、來源及 checkpoint 原子提交，支援 retry／rollback／regenerate／重啟恢復。
- **七日日曆**：只規劃公共世界事件，依故事日滾動補足；未發生的計畫與已結算結果分離。舞臺可閱讀今日、未來公告及歷史事件，不推進時間、不派送模型。
- **角色論壇與路人補文**：角色自主選題、發主文與跨日留言；附時間與來源回流 Director／Character／Writer。新卡明確啟用路人策略後，最多三位有效受邀角色皆明確拒絕、且邀請達界或合格名單用盡，才補每日最多一篇路人主文。失敗、未知、來源過期或零合格角色不冒充拒絕；第一版不生成路人留言。
- **獨立模型設定**：原本各 RP Agent 的模型分流，以及獨立「日曆」「論壇」路由。未設定分別繼承 Stat／Character；路由固定於工作，沒有偷偷跨供應商 fallback，論壇作者仍保有自身角色身分與權限。
- **Studio 與閱讀介面**：選卡／新建成功後進入創作對話，入口意圖與附加資料載入分離，保留 session／generation／lease 守門；製卡工具支援時間、論壇媒介與版本化路人 opt-in。舞臺提供日曆、論壇及角色上色；保留 Director 工具／對話傳輸與平板閱讀修正。
- **RC3 相容**：三份 manifest 精確加入 RC3 支援；NativeModelPort 保留 `CLIENT_UPGRADE_REQUIRED`／`MODEL_UNSUPPORTED` 的精確不可自動重試分類。延續 SourceCut、routePin、私有資料邊界及 v9／v10 容量上限。

**升級前先完整備份** DSH 程式、profile、插件、卡片、Run、設定及 metadata。不要以舊備份直接覆寫可能包含新資料的目錄。v10 存檔不可用舊 2C 降版讀取；本版不提供降版工具。既有 Run 不會自動啟用 W29 能力，新卡須明確設定並另開新 Run。

新卡可請製卡助手：「使用正式卡片工具設定並讀回 `storyTimeDefinition` 與 `worldRoutineDefinition`，啟用公共七日日曆、指定可用論壇媒介；若需要路人補文，明確啟用 schemaVersion 1 的 ambientPosts 策略。保存 Snapshot 後再交接舞臺。」可用欄位以已安裝工具 capability 為準；不能只在自然語言中聲稱啟用。論壇／日曆背景工作依既有 pulse 與故事日排程，不保證一開舞臺就已完成。舞臺書架內有「日曆」「論壇」；閱讀與切日零模型派送。

正式驗收涵蓋原生 RC3 啟動／正常重啟、Studio 製卡到新 Run、真正日曆規劃／主文／留言及含 Character 諮詢的完整 Single Writer 回合。總計 **9／18 次實際模型派送，九次首次成功，重試與 embedding 均為 0**；Clock、來源、v10 匯出驗證及重啟持久化通過。此為有界工程樣本，未聲稱所有自由文字或供應商路徑都已覆蓋。

歷史 Core 38／Studio 79 失敗、官方 contextWindow 差異及既有 presentation 偶發限制保留原結論，沒有為發行放寬 gate，也未宣稱全專案測試全綠。本次發行準備不再呼叫付費模型、不修改或重啟正式安裝。日記只含結構與介面，不包含自動生成頻率；沒有玩家發文、路人留言或事件改期取消功能。

發行套件經白名單重整，排除私人研究紀錄、卡／Run、Prompt、模型原始輸出、憑證、session、帳本、備份、個人路徑及 DSH installer／SDK。與原驗收 tgz 的位元組不同；來源映射與 detached descriptor 記錄新 hash 及相同的已驗收 Runtime fingerprint。
