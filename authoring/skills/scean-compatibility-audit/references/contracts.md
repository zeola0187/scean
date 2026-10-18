# 工程邊界

## A 世界書

JSON/PNG 由 Studio 真正 codec 匯入與保存，稽核經 CardService.read/load 驗 bytes/hash。純 selector 使用 `core/worldbook.mjs:selectWorldbooks`，不另寫匹配器。enabled、constant、keys、secondary/selective、掃描窗與欄位差異依真 diagnostics。空輸入、合法不觸發、條件正例／負例分開測；不要求同一場景全部入選。regex、腳本、遞迴與不支援欄位保留 UNSUPPORTED；自然語言條件是模型軟規則，非 Host predicate。工具不推斷作者預期。

## B Blueprint / InitialState

重用 validateBlueprint、materializeInitialState、validateBlueprintStateChanges、publicBlueprintState。驗 schema/scope/category/type、角色 ID、初值型別、min/max、enum、readOnly、requiredFields、任務 status/assignees/progress、extensionPolicy。工具對宣告合成邊界正負例，驗收「預期拒絕確實拒絕」可 PASS；原卡違反既有契約才 FAIL。0、false、空字串與缺值不可混淆；unknown 是未提供值，不能代填 0。restricted 宣告和值不得冒充公開前端可讀；公開 PostStat 不能更新 restricted，readOnly 也限制更新。requiredFields 只驗存在，不提供任意巢狀 schema／計算器。

baseline_revision 僅比較同文件已保存版本的宣告與約束，列增加、移除、型別／範圍／列舉／唯讀／可見性與 extensionPolicy 差異；不判作品簡化、數量或玩法選擇錯誤。語意等價、原意與初值是否符合故事需另行人工審核。

## C Host / CR / Memory

validateRoster 確認穩定唯一角色 ID；validateCharacterSources 驗 sourceBindings 的角色 ID、descriptionHash、entry/card-field 來源 hash。舊版明確背景沒有 bindings 合法，但須 WARN 無來源證據。來源由同一已保存 revision 解析，hash 證明來源一致，不能證明濃縮語意。

設定依 ID 凍結於 Snapshot；State/Memory 是 Runtime 歸屬資料。Director 可全知讀作者備註。CR 是一次性諮詢，問題／advice 不自動成記憶；PostStat 才依現行結構與 ACL 提交。卡片稽核只可驗保存契約，實際上下文／Memory 需隔離 scripted Runtime 測試；無測試為 NOT_TESTED。不得重做 WriterMemoryCR 或以全知判秘密洩漏 FAIL。骰子、數值計算、條件若僅是自然語言，不得宣稱 Host 已執行。

## D 前端／保存交接

重用 Studio inspectFrontend/analyzeFrontend 與 buildSavedSnapshot，Runtime normalizeStudioHandoffSnapshot。真前端 API／Bridge／render 需合法隔離環境另測，不能把靜態 HTML 解析當 UI 驗收。JS/EJS/MVU/TavernHelper 依賴不執行。

可選已保存 `data.extensions.scean.auditFrontendReferences` 是作者列出的靜態稽核斷言，**不是渲染或綁定 API**。每筆 `{scope,characterId?,category,key,type,interface:"publicBlueprintState"}`，對照實際 Blueprint 宣告／公開投影；工具只驗明列的參照，不推斷任意程式碼，也不宣稱有通用前端綁定支援。未列完整參照時只能報部分靜態覆蓋。沒有宣告、未知值、不可公開讀、型別／接口不合必須分開陳述。

Snapshot/hash/來源 bindings 固定；新卡 revision 需新 Run，舊 Run 不熱載入。純 Snapshot 驗證不是實際建立／切換 Run 證據；隔離端到端測試與正式遊玩各自列結果。Skill 是選用工程檢查，既有開局路徑不加強制 Gate。
