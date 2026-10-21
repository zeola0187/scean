# Single Writer 與文風切換：2026-10-21 主線更新

本次沿用 1.5.0，更新 main，不建立新 tag 或 GitHub Release。使用者已完成實玩並接受目前文風；這不代表所有模型、裝置或敘事品質均已驗收。今天另記錄的七項實玩改善尚未實作，不包含在本批。

## 玩家操作

新故事與未指定流程的故事預設採 Single Writer。曾明確保存舊流程的故事保留原選擇；在「設定 → 本局資料 → 寫作流程」切換至 Single Writer。Director 按需查證與諮詢角色，單一 Writer 產生正文，再做驗證、必要局部修復、post_stat 與原子提交。沒有固定 Prose 全文重寫，也沒有 Writer 回問 Director 的第二階段迴圈。

「本局文風」可匯入使用者有權使用的本機文風包，下拉選擇後保存；直接改寫會轉為自訂文風，清空保存回到原卡片／Preset 行為。選定風格與自訂內容使用同一份有效文字，Host 在 Writer 開始前完整載入。缺少或無效 Skill 會明確拒絕，不默默回退。

流程、文風與方法版本在每次請求開始前固定；切換從下一個新請求生效，同 requestId 重試保持原值。舊正文、卡片、Snapshot、State 和 Memory 不會因切換被修改。Director 工具、角色私密投影、上下文預算、最終正文 hash、post_stat 與單次原子提交均保留。

公開版本不附第三方預設或私人文風正文；它們也不在安裝包或這次新增 Git 歷史中。匯入入口與 SCEAN 原創敘事方法可公開使用。套件平台仍是 Windows／Node.js 24+，DSH 支援範圍見 README。

## 已有驗證與限制

cd2ff1d 功能來源的離線回歸：Runtime 1067/1075、Authoring 29/29、Studio 有效 312/319；Runtime 八項主機環境限制與 Studio 七項歷史素材缺失是既有基線，沒有刪除斷言。40/40 聚焦機制測試，以及桌面 1440×1000、窄窗 390×844 的合成 UI 流程已完成。scripted 模型僅驗證機制，不代表文學品質。

本批保留前兩批診斷／角色編輯修復、角色格式局部重試、Draft 收尾改善、自由文風與雙寫作方法。沒有宣告今日另查的重複回覆或七項實玩建議已修復。發布整理不新增模型或 Embedding 呼叫，也不重新安裝或寫入正式遊玩資料。

相關細節：[Single Writer](SINGLE-WRITER-PHASE1.zh-TW.md)、[文風 Skill](WRITER-STYLE-SKILLS.zh-TW.md)、[方法模式](WRITING-MODES-20261020.zh-TW.md)。
