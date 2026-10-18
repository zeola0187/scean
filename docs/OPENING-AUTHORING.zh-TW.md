# 開場白原生製卡指引 1.0.0

`scean-opening-authoring` 由本次實際提供的自然語言規格整理，完整原規則分置於其 references，透過現行 Card Studio catalog／Session 的 Skills 服務讀取。原規格 SHA-256：`f08bf582c42483e6d0883a6df13f635afdc6d7fe4479e436478c9a7da9ac9e23`。舊開場白 Skill 及 Palette 持續停用。

創作重點是自然生活的世界、玩家自由、同一起始時間切片、共用 Blueprint／InitialState、必要文風試寫，以及作者確認後的局部受控保存。只要求一篇時不自行新增多開場，不重寫未指定的篇章。新 Skill 不改人物核心背景、Preset、Writer Runtime 或初始狀態。

現行工具可以版本化保存正文、局部開場陣列與穩定 ID 的世界書條目，並讀回、diff、history、rollback。作者確認與文學規則屬於指引；沒有新增 Host 口頭確認判定器，也沒有替其他製卡工作縮限原有權限。跨卡片／世界書寫入不是同一原子交易，部分失敗須記錄及安全修復。

含 HTML／混合來源的正文在 Content scope 可能只讀，需人類切到既有 Full scope 後保留標記編輯；不能剝除來源內容來繞過。新增世界書條目同樣需要現行 Full scope。

本版尚無開場獨立標題／情境介紹欄位，這些非劇透說明保留為對話交付資料，不混入正文或自行建立卡片欄位。舞台的主／替代入口與選擇流程照常工作；舊 Run 保留固定 Snapshot。

完整規則與準確參數見該 Skill 的 `references/creative-guide.md`、`authoring-workflow.md`、`studio-contract.md`。合成測試驗證讀取／工具／保存／交接，無法證明真模型文學品質或對自然語言規範的遵循；本次未呼叫付費模型。
