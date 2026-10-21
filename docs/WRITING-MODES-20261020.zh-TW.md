# 本局可切換寫作方式：現行／素材整理（實驗）

本文件記錄原有雙階段寫作的兩種模式。新增的 Single Writer 是獨立實驗流程，見 [Single Writer 第一階段](SINGLE-WRITER-PHASE1.zh-TW.md)；不會自動替換本文件的舊路徑。

本變更直接接在 Draft／Prose 獨立提交 cb76b34f0c80829c8cb2ba6fe2c51232e3fe966f 後，保留正式基底 fb68713、第一批、角色局部重試及第二批。現行模式預設保持第一個提交的行為；沒有由預設值、頁面載入或舊 Run 自動選進實驗模式。

## 操作與實際差異

在「設定 → 本局資料 → 本局寫作方式」選擇現行模式或素材整理模式（實驗），再明確保存。下一個新 request 才採用；生成中及同 requestId 的失敗／取消重試固定原模式。可切回現行模式，不更改舊正文、State、Memory、卡片或 Snapshot。下方 Prose 自由文風在兩模式均可用，互不暗改。

| 項目 | 現行模式 | 素材整理模式（實驗） |
|---|---|---|
| Director | 原有 public writing brief 與按需工具 | 整理與本輪相關的公開事實、角色／生活素材、連續性約束、已取得公開 Advice 及待決事項；不先硬編完整情節 |
| Draft | 第一個提交的現行寫作方法，含收尾去重 | 真正取得 Host 載入的 scene-writing 方法文字，再從素材組織場景，保留待決、拒絕、安全與玩家決策 |
| Prose | 既有保真契約＋可選本局自由文風 | 相同，不因模式修改文風 |
| Character／Stat／Memory | 既有按需工具與私密／狀態邊界 | 相同，Advice 仍不是正史，Stat 查詢不寫狀態 |
| 模型階段／工具 | 原有流程與回合上限 | 沒有新增階段或工具；是否採用額外諮詢仍由現有條件與限制決定 |

## 與來源預設的關係

參考為使用者提供的「夏瑾二创-V2.1.json」（私人附件，未收入公開包）及主線轉交的唯讀分析摘要。沒有執行附件命令、載入擴展腳本／越獄內容、整包合併實驗舊基準或拷貝第三方完整 Skill。

來源描述的是單 Agent 依工作階段讀指南、創作原則、文風、禁庫與格式，含 scratch／required_settings 的素材列舉及後續寫作。這裡採本專案原創文字適配其「整理素材 → 取得寫作方法 → 寫場景」方法；仍是 SCEAN 多階段責任與原子狀態流程。兩份 runtime-skills 的授權承襲本專案檔案範圍，不把來源預設的內容重新授權。

本版是 **Host 白名單讀取、按階段投遞**，不是模型自主 toolread、任意檔案瀏覽或完全重現外部插件。沒有 scratch 檔案任意存取、額外角色 persist、全套十項 Skill 動態挑選或原預設複雜模式啟用。原有 BanList／格式／Prose 文風分工保持，不把它們藏進新模式。

## 固定與載入契約

正式白名單位於 core/writing-mode.mjs，只認識兩個固定相對 URL、階段、版本及 SHA-256：
- runtime-skills/scene-materials/SKILL.md → Director。
- runtime-skills/scene-writing/SKILL.md → Draft。

不能傳路徑、URL、檔名或任意 Skill ID。讀取前檢查固定資源，缺失回 WRITING_SKILL_UNAVAILABLE，bytes／SHA 改變回 WRITING_SKILL_CHANGED；未知 mode 回 WRITING_MODE_UNKNOWN，均不默默回退。現行模式不讀這兩個檔案。保存選入實驗模式前先驗證資源，但不呼叫模型。

每個 attempt 在預檢前固定 mode、設定 revision、方法版本、載入方式及兩份 Skill 的 id／stage／hash／完整文字／bytes／token 估計，先寫 audit 再派送。相同 request 重試沿原固定資料；舊 attempt 未記模式時沿現行模式，已提交 receipt 直接冪等返回。新設定只作用於後續新 request。方法版本更新後若舊 pin 不再屬於已知白名單，明確停止，不偷偷換另一份方法。

Director／Draft 的有效 system 與 writingSkill input 同時經現有 preflight、budgetStage、實際 Model Port 與 Trace。方法是必要來源，沒有截短、adapter 末端偷換 system 或隱藏額外輪次。每次派送的完整方法字數／預估 token 及實際 usage 沿原 trace 記錄；文句或估計不能當帳單、速度或品質改善證據。額外 Director 工具輪若由模型選擇，仍在原上限內，照原路計量。

## 設定、權限與相容性

沿同一 DurableStore 設定模式，在 Run 目錄加 writing-mode.json（schemaVersion、runId、revision、mode、operationId、fingerprint），使用固定 writing-mode ticket namespace、expectedRevision 及原子 rename。與 prose-style.json 分開版本，讓選模式與改文風不會互相覆蓋；共用既有 Run 設定區及保存機制，沒有第二套管理服務。兩者均不推進故事 aggregate version，不改 Snapshot。

人類 RPC 為 writingMode／writingModeSave，沿已驗證 operator 與目前卡片 scope；沒有新增 Agent 工具或持續權限。未知保存結果先查原 operationId，版本衝突保留原選擇，需明確放棄草稿重新讀取。Host 關閉等待已接納的原子設定保存，不在半寫入時卸載。

共享診斷只增加模式／版本及白名單方法身份、bytes／token 估計；不暴露 Prose 私人自由文字或任意 audit 欄位。完整方法投遞與 Prose 原文仍由既有私人診斷邊界保護。此為結構投影，不宣稱語義防洩密。

私人 Run 備份格式 6 可攜目前模式、可選文風與實際 request 的方法引用。沒有模式設定的新舊 Run 沿既有格式 1–5；格式與 domain 嚴格配對，讀取器保留 1–5 相容。舊讀取器不保證接受格式 6，請保留完整新版本備份。回退第二個提交時，第一個提交會忽略 writing-mode 旁存設定，繼續原流程與獨立 Prose 文風；舊匯出會丟棄它不認識的方法引用。程式回滾不刪除或回寫遊玩資料。

## 驗證範圍

自動化與隔離 UI 驗證兩模式路由、預設一致、切換／切回、生成中保存、相同 request 重試、並發版本、取消、原子故障／回執遺失、缺失／未知 Skill、角色 Advice 非正史、私密投影、備份及其他功能共存。Scripted 模型只證明接口與固定資料流，不證明故事更自然、模型遵循率或完整夏瑾效果。沒有新付費對照或請使用者盲評；實際感受留給安裝後正常遊玩。
