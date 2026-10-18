# Palette 移除候選分支 — 2026-10-18

本分支依使用者明確授權，從後續來源與 runtime 移除使用者提供的 Palette。
這是供整合的私有候選修改，尚未發布或安裝。main、既有 branches/tags、
Release、現役 Profile、私人卡及 Runs 都未變動；舊內容仍可由 Git 回復。

後續內建角色設計方法只保留 character-authoring。舊對話若保存了 Palette
選擇，會拒絕載入方法內容，不會自動切換其他方法；可另開新對話。
啟動時不刪除或改寫舊工作區的 Palette 檔案，但 loader 不登錄也不讀取它們。
人工方法選擇的 schema 同樣不接受 Palette。

開場白 opening-narrative-crafter 與 character-authoring 的完整檔案樹維持原始
位元組，26 個來源／runtime 檔案皆以 SHA256 核對。四個先前退役的 Arcamage
來源樹仍保留，24 個來源檔完全不變；最終原生 overlay 仍排除它們。
SCEAN 世界書、對話及前端替代 Skill 保有各自的來源紀錄。
本修改不代表整體授權問題已解除，也沒有調整 Memory 的 SPDX 或授權。

原始 Palette ZIP 的 SHA256 為
2a1995b20fa6fb26b06cf37c574b449bf49af92df25ebae0174e26b1e3245152.
本候選來源與 runtime 已刪除 Palette 的 18 個檔案（兩份各 9 檔），並移除
有效 catalog／sources 清單及方法選項。歷史證據、Git 定位與既有授權紀錄仍保留。
乾淨重建比對 188 個 runtime 檔案通過；16 項核心 SDK／方法／生命週期測試通過。
額外的負向檢查確認：來源若再出現 Palette 目錄，建置會在 staging 及更新 runtime
之前失敗。現役環境與真人對話的 UI 並未在本分支操作驗證。
