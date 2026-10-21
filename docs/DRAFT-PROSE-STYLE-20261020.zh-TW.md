# Draft 收尾方法與本局 Prose 自由文風

此文記錄第一個獨立提交 cb76b34；後續另獲授權的可切換模式見 WRITING-MODES-20261020.zh-TW.md。兩份文件的施工範圍與測試分開。

本機私人功能基底為已正式安裝的 fb68713e99c070a4d26f49c88d2b7bbfbe570646，保留第一批、角色局部格式重試及第二批。研究只讀取指定三份文字提案；沒有合併實驗舊基準、修改原證據或帳本，也沒有加入導演工作模式。

## 玩家操作

在既有「設定 → 本局資料 → 本局文風」自由輸入文字，再按「保存文風」。可任意改寫，不限定風格標籤；兩個可改寫範例只會填入草稿。取消修改不保存；清空後仍須明確保存，才回到原本文風。設定獨立於其他 Run、卡片及固定 Snapshot；本版沒有全域／卡片文風預設或風格商店。

明示文字只送進 Prose，文風部分優先於原 Draft／共享 Preset；原 Preset 不拆解、不刪改，Director／Draft／Character／Stat 不接收這個新欄位。固定契約優先：不能改事件、行動者、玩家決策、發言者、結果、時間、資源、拒絕與安全條件，也不能補寫玩家言行或私有角色知識。無設定時，模型輸入保持原有欄位與文風行為。這是模型指令邊界，不是語義品質或保真率保證。

Draft 只增加方法段：角色已說清楚的選擇不再由旁白重列，保留真正待決與自然留白；不要求每回合發生事件、不強制全員回應、不替玩家決定，也不刪掉角色拒絕與安全條件。其餘角色與階段契約保持。

## 固定、持久化與工具契約

人類舞臺 RPC `proseStyle` 讀取設定，`proseStyleSave` 接收 runId、text、expectedRevision、operationId；沿既有已驗證 operator 與當前卡片 scope。沒有新增 Agent 工具或診斷授權。文字 trim 後空白代表清除，最大 12,000 UTF-16 字元／48,000 UTF-8 bytes，超限拒絕，不截短；revision 衝突保留草稿。

設定保存在該 Run 目錄的 `prose-style.json`，schemaVersion 1、runId、revision、text、hash、operationId、fingerprint。沿 DurableStore 既有非阻塞跨程序 ticket lock 及原子 rename；使用獨立且固定名稱的設定鎖，避免長回合 writer lock 阻擋下一回合設定。它不能提交故事 aggregate，不推進 Run version，不改正文／State／Memory／Snapshot。生成中的保存只改未來新請求。保存回執遺失先查回 operationId；原子發布後的錯誤可確認成功，未知結果禁止 UI 盲目重送。

每個新 request 在預檢前讀設定並固定 text/version/hash/source，先寫 attempt audit 才執行模型。相同 requestId 的失敗／取消／重啟重試沿原固定值；既有舊 attempt 缺欄位時沿原行為，不偷偷採新文風；已提交 receipt 仍直接冪等返回。新 request 才讀新版。設定不能重放已付費結果，也不觸發生成。

Prose payload 的 `proseStyle` 完整納入現有 budgetStage，屬必要且 restricted 的來源，不偷換 adapter system、不截字，也不改第一批已修正的「估計只供診斷、由 provider 執行實際上限」政策。完整文字與 hash 保留在原本受保護的設定／attempt／Prose prompt；共享 Inspector 只顯示版本／來源，不暴露文字或指紋。實際 request trace 記錄版本／hash；原生 Port 仍沿既有路由與 usage 路徑。

## 相容性與回滾

舊 Run 無遷移、無新設定檔；第一次明確保存才建立設定。舊 Snapshot 不改寫。顯式私人 Run 備份使用格式 5 帶目前設定與 request 版本引用；未使用新設定的備份仍保留既有格式 1–4。格式與 domain 嚴格配對，不接受舊格式偷帶新設定。新 reader 支援舊格式；舊版本 reader 不保證讀格式 5。回復 fb68713 程式時，舊版會忽略旁存的文風設定，原局與故事仍可讀取／繼續；舊匯出器會丟棄它不認識的設定引用，需保留新版本私人完整備份及設定檔。

本次測試只用隔離合成資料、scripted 模型及既有離線 SDK。自動化涵蓋生成途中切換、同 request 重試、版本衝突、鎖、取消、空白、原子故障／回執遺失、舊 Run、私人備份及前端跨 Run／未知結果邊界。桌面與窄窗以實際 CUA 操作檢查；真模型品質、所有 provider、實體手機／Safari 未驗收。沒有新付費模型對照、盲評或模型費用授權。

實際測試數字、SHA、畫面、備份與正式安裝結果保存於本輪 detached 交付／安裝回執；只有相應驗證通過的行為標為完成。未推送公私倉、不 Release、不上傳私人資料。
