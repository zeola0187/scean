# 單一 Writer 與本機文風 Skill

新故事與沒有明確工作流設定的故事，採用 Director → Single Writer → 本機驗證／必要局部修復 → post_stat → 原子提交。Director 按需查詢 history、Character 與 Stat，權限與額度不變；沒有 Writer 補查迴圈、固定 Prose 或新增評分模型。

玩家在「設定 → 本局資料 → 本局文風」選擇風格，預覽完整內容，按「保存文風」後於下一個新請求生效。「自然日常」為本專案原創內建風格；也可沿用卡片／Preset、直接自訂，或按「匯入文風包」讀取自己的本機 JSON 資產。

## 選擇與自由改寫

文風只有一個生效內容欄位。選擇 Skill 會把完整文風文件載入草稿；修改文字後改為「自訂文風」，保存時不再疊加原選 Skill。清空並保存可恢復卡片／Preset 文風。選擇、取消及匯入資產本身都不生成正文，也不修改已保存正文、Snapshot 或 State。

Host 在新 attempt 預檢前解析選定資產，核對 ID、版本與 SHA256，固定其全文及本局設定版本，從第一次 Writer 請求完整提供。這不是模型自行選擇 read_skill，也沒有給模型任意檔案工具。完整 Preset、原創寫作方法與文風列為必要預算輸入；文風／來源參考仍為 restricted 診斷資料。

自訂文風只控制節奏、措辭與敘事表達，不能改變既定事件、行動者、裁決、拒絕、角色知識、權限及玩家重大決策；與這些邊界衝突的風格要求不能覆寫固定規則。

## 本機資產契約

通用文風包是純資料：`schemaVersion:1`、`kind:"scean-writing-style-pack"`、`styles` 陣列。每個項目包含 `id`、`label`、`version`、完整 `text` 與 `sha256`。本機 ID 使用 `local-` 前綴；內建 ID 不能被匯入包覆蓋。SHA256 對 UTF-8 文本計算，不能省略全文、改用摘要或猜測來源。

最多 48 個本機項目，包不超過 1MiB；每篇最多 12,000 字元／48,000 UTF-8 bytes，名稱最多 100 字元。重複 ID、無效 hash、額外腳本／路徑欄位及損壞結構會被拒絕。文件內的 Markdown、frontmatter 或文字只是文風資料，不會被執行、解析為工具授權或匯入其他檔案。

資產保存於 Runtime 已有資料根目錄的 `writing-style-library.json`；沿用 DurableStore 原子保存與固定 settings lock，不建立偽 Run。匯入需要原有操作者及卡片範圍授權，不授權 Agent 匯入或讀取全庫。文風保存仍使用本局 revision、operationId 與獨立短鎖；衝突不自動覆蓋，回執遺失可讀回確認，重複同一操作不增加版本。

缺失、損壞或內容已變更的已選 Skill 會明確顯示不可用，新請求在模型呼叫前停止。使用者可重新選擇，或明確把已保存文字改為自訂。已開始的 attempt 與同 requestId 重試沿用固定全文，即使之後資產或設定變動也不換文風。重新生成亦保留本局設定與失敗請求 pin；不把設定複製進正文／State aggregate。

## 舊流程與資料

舊故事若已明確保存 legacy 工作流，仍能走必要相容路徑，介面提供改用 Single Writer；新流程選單不再提供建立 Draft → Prose 工作流。未做舊檔遷移。內部 `unconfiguredWritingMode:'current'` 可供原有流程的相容測試明確選用；正式 Host 使用預設 Single Writer。

Writer 的最終正文與 hash 驗證、既有有界 BanList 修復、post_stat final-only、State／Memory schema／visibility、取消、timeout、未知提交恢復及單次原子保存保持原有邊界。私人 Run 備份可包含本局固定文風全文與參考，不會把整個本機資產庫裝入 Run；這不代表舊程式能降版讀取新版收據。

## 公開來源與私人資產

本程式碼與通用安裝包只包含載入／切換能力、原創方法與原創內建文風。使用者提供的第三方文風另存工作樹外的私人可匯入包，不進 Git 歷史、乾淨來源匯出或通用發布包；不以 gitignore 代替來源隔離。通用測試僅使用合成文本。

原始附件的其他 preset、工具指令、寫作指南、格式與禁詞等不會隨文風匯入。私人資產的來源、內容 hash、抽取範圍與不可公開項目應另存私人交付回執。本機測試與 scripted UI 通過只驗證機制，不宣稱第三方素材授權、敘事品質或真模型實玩已驗收。
