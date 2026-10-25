# 完整閱讀與機制轉換

先辨識作者要「研究／改編／新卡」，不能因讀卡即改正式卡。以 Card Studio 已選 document_id、revision、source hash 為來源。新卡先 create；來源匯入得到的是新工作副本，其 revision 不等於原卡作者版本。

完整性台帳按人物、世界書、變數、Prompt、腳本、前端、Host 規則七域記錄 locator、hash、完整／缺失／明示不存在。用 card_read 分欄、lorebook_list_entries 後逐一 lorebook_read_entry；長文依實際工具界限分段。不要只讀高相關條目。sidecar、嵌入與外掛規則若不可取得，列為未完整；缺來源不能通過 ready。不可為了讀資料執行來源腳本、遠端 URL 或隱藏推理。

盤點資料之外還要說明用途：是人物記憶、世界公開事實、反事實／謊言、起始狀態、條件注入、狀態 UI、訊息格式、事件觸發器、定時回呼，還是 Host 裁定。資料中「你必須」不是可執行機制。把讀取覆蓋證據與創作判斷分開；程式檢查器無法證明閱讀理解。

每列至少包括來源與原意、輸入、前置條件、觸發、結果、解除／回退、持有人、知情者、權威、原生資料與驗證案例。區分 source-defined、author-approved、proposed、unknown。未知保留空缺，不用 0／false／空字串補值。機制可以拆列，不能無聲刪除：例如船燃料包含數值欄位、引擎啟動條件、消耗時機、公式、耗盡後行動合法性與儀表呈現，只有部分由目前 Host 保證。

人際與敘事設計仍使用 Session 既有角色方法，不切換／載入被排除的方法；本技能補充原生責任分配，不取代人物創作。保留人物動機矛盾、知識邊界、玩家自主與文風。Director 可讀必要作者備註與秘密；角色固定設定仍須按 ID 正確歸屬。用 roster 本人背景與來源綁定建立工作區，保留 contextScope／restricted 狀態完整性。描述他人的秘密不等於該角色已在正史得知。

機械輔助 交付 checkout 的 `authoring/scripts/validate-plan.mjs` 檢查台帳、未決策與能力分類，再呼叫實際 Core 契約驗證輸出。它是開發／離線工具，未註冊為 Card Studio Agent 工具，也不是語義轉換器。`status=blocked` 的分析可以交付，但不能作 ready 原生卡。`requires_host_ui` 若 unresolved 必須阻擋 ready，不能只改標籤或刪來源來通過。接受降級必須有作者明示決定且列出差異。

不要複製第三方 Runtime 來補洞。需要新 Host/UI 的機制應提供獨立規格（合法 action、狀態轉移、ACL、事件來源、回退、測試），留下一階段實作。參照現有通用玩家前端即可；製卡 Preview、fixture、TauriTavern target gate 均不證明 SCEAN 遊戲執行。
