# 驗證、共同回退與交付

## v0.1.4 完整 authoring bundle 匯出

`cardstudio_document(action="export_bundle")` 交付 sidecar／素材，不是舊 export 的隱含功能。參數為 document_id、expected_revision、可選 name（1–80 個安全 ASCII 英數／底線／連字號）。唯一新目錄含 card.json 或保留原圖 metadata 的 card.png、authoring.json、assets/<sha256>、README.txt、manifest.json；receipt 包含 path、revision、file_count、有界 files／omitted_files 與 compatibility。依 receipt 找檔案，不由 card name 自行拼 filesystem 路徑。

Only card.json／card.png 是標準 card interchange；sidecar 與 assets 不是已安裝 ST runtime，Visual State 需明確 target adapter。Bundle 重新檢查共同 hashes／素材；失敗時 INCOMPLETE 標記不代表成功匯出。本版沒有 authoring bundle reimport tool，不能宣稱 sidecar 可原生重匯入新工作副本。一般只要角色卡另存仍使用 action=export。

## 局部讀寫紀律

所有 mutation 使用同一 working document ID、當前 expected_revision 和工具要求的 stable ID／hash。Session lease conflict／stale revision／source hash mismatch 發生時重讀局部後調整，不直接 filesystem 寫 sidecar，不忽略 lease，也不無限重試。

`cardstudio_document` 提供 history／diff／rollback／export。Diff 可以包含敏感卡文；只在使用者授權範圍內按需顯式讀取，不例行回全卡。Write receipt 的 bounded changed paths／IDs 不是完整欄位 bodies；欲檢查改動，另作局部 read。

卡、frontend metadata、fixture、visual contract 與 asset refs 應參與共同 snapshot。回退後檢查舊 component locator／source hash、fixture、contractRevision、mapping 及圖片仍可讀取。素材 blob 不能因當前 unlink 就立即刪除而破壞歷史。Archive／recycle／export 後的處理由 Plugin 決定，模型不在 filesystem 自行整理或刪除素材。

## 驗收清單

- 零起步：建立合法 CCv2/v3、基本欄位與合理空／有內容 worldbook；無 frontend 仍可 rollback/export。
- 既有卡：僅批准路徑改變；unknown top-level／data／book／entry／extension、macro／regex／script 與圖片保留。PNG 檢查主 metadata、inactive chunks、CRC／image preservation；JSON export 不含原 PNG 圖片是格式差異，不是丟圖證據。
- Frontend：host 定 locator、穩定 ID 與 hash；不安全邊界拒寫；class/id/selector／regex 引用分析；unsupported／unknown 有診斷。
- Fixture：型別、missing／null、數值範圍、長字串與長 inventory；label 不反寫 value。高好感、隱藏數字、360/390 與 desktop 採用同一 fixture 檢查。
- Visual State：六表情、invalid ID／enum、wrong type、path／URL／script 拒絕、stale sequence／revision、多角色 partial update、neutral／placeholder fallback。
- Assets：僅 admitted raster；decode／大小／尺寸與非 raster 拒絕；immutable digest、不暴露 real path、link/unlink、共同 rollback 後圖片可達。
- Preview：卡 JS／EJS／MVU／remote code 不執行；外部 image／CSS URL 不請求；無 host RPC／filesystem／env／credentials；CSP 不可用時清楚 diagnostic。
- Lifecycle：每次局部 mutation 可追蹤 revision；snapshot、rollback、recycle/archive 與 export 不使素材失聯；匯出 receipt 給實際位置。

## 使用者共創交付

主文先呈現角色／劇情／一致性或可見改動；成功 receipt 證實後簡短說已寫入或產出。模型必須核對授權範圍 diff、check、匯出 receipt 及回退條件，但工具步驟、JSON、hash、逐項 PASS／NA、一般相容提醒與 fixture／viewport 細節留可展開診斷，按需提供，不固定附技術報告。純討論不 mutation、不每輪 full check。

必須告知：修復停止、非白名單 FAIL、缺素材、缺授權／scope、無法安全解决的來源／版本衝突或尚未儲存／匯出，短述影響、目前結果與需要的決定。WARN 若影響本次用途也須告知，不能只看 severity。只有已授權 scope 內的宿主白名單 Gate rebind 可安靜修復；同一交付最多三輪、每輪最多64個且完整重查，遵守全部停止條件。再試受阻操作仍說未完成，回到無關創作不反覆播錯；未解決診斷仍保留。

工具紀錄／驗收證據按實際執行分層：

1. 已執行的工具流程／結構校驗；
2. 合成 fixture 的 Preview 與安全檢查；
3. 真實模型對話（若本次確實發生）；
4. 目標 ST／第三方 runtime（明確版本與 adapter，若本次確實驗證）。

未測試的層次寫明未測試。Deterministic tools E2E 不等於真實模型共創驗收，Preview 圖片切換成功不等於 ST 執行成功。

模型核對 Export 時區分（主文只短述與用途相關的限制，使用者詢問時提供完整格式說明）：CCv2/v3 JSON／PNG 的角色文本與保留內容；authoring sidecar 的 fixtures／component metadata／contracts／assets refs；需目標 adapter 才能解釋的 Visual State。僅以實際 export receipt 確認有哪些檔案；不得承諾 sidecar 被 ST 自動匯入。新卡沒有原始 PNG 時不宣稱保留了不存在的頭像／metadata；原 PNG 另存時遵循既有 preservation 工具。

不要自動釋出、推送、安裝、重啟正式 DSH，或上傳真卡／私有圖片。效能與美觀反饋留在本地 working copy。任何新增依賴、擴大 runtime 執行／網路許可權或改變正式工具的需求須另列決策點。

## Scope 與證據層級（0.1.6-library.1）

Authoring Scope 保存在 workspace 的 `.cardstudio/authoring-scopes/<Session SHA256>.json`，不是卡片編輯 history。每個 Session 獨立；同 Session 多視窗共用 mode/epoch。人類切換撤銷旧 epoch、取消並等待舊 jobs 結束，回覆成功後舊作業不能再提交。模型沒有升權工具。入口驗權後仍需提交時比對保護投影；unknown metadata、runtime sidecar 與 entry identity 不變。來源 import/Library copy 是 exact-byte 新工作副本，不會重設 scope；後續修改仍按當前 policy。rollback 也需保護投影。

Node／合成 pipeline／離線 React UI／隔離官方 Host／實際 Tavern+模型，逐層獨立記錄；dryrun、靜態 Preview 及 User/no-op floor 不得轉述為真實 RP runtime PASS。四個 export 入口仍 fresh preflight；修復最多三輪。
