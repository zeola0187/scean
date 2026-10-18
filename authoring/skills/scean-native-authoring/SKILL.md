---
name: scean-native-authoring
description: 依 SCEAN Character Agent v1 契約製作原生角色工作區、StateBlueprint／InitialState 與固定 Snapshot；完整映射來源卡意圖，透過 Card Studio 保存角色 ID 與設定來源綁定。不執行原卡腳本或製作專屬前端。
metadata:
  version: "1.1.0"
  runtime-profile: "scean-character-agent-v1"
---

# SCEAN 原生製卡 1.1.0

先核對實際 Runtime 與 Studio 整合候選：本版新增能力需要 Character Agent v1 分支；僅裝 0.8.2-poststat-scope 或 Studio 1.2.0 不代表已有來源綁定工具。缺工具時列明部署缺口，不假裝已保存綁定。

讀 [原生契約](references/native-contracts.md)、[能力清單](references/capabilities.md)；有來源卡時依 [完整閱讀與機制轉換](references/authoring-method.md) 保留七域與「原意 → 原生責任 → 資料位置 → 驗證 → 未決策」。建立角色前讀 [角色工作區](references/character-workspace.md)，保存用 [Studio 整合](references/studio-integration.md)，驗收用 [驗證界線](references/validation.md)。

## 工作區與責任

- Character Agent 是指定角色的編輯顧問，沒有獨立 RP 對話或長期諮詢聊天。Director 全知，可讀必要作者備註及秘密；編輯模型知道不等於角色在故事中知道。
- 用既有 `data.extensions.scean.characters`、穩定唯一 ID、本人完整 `description` 與必要私人設定。Agent 整理來源、作者可檢視修正；角色來源逐項綁定，不能把多角色整本世界書當某人的背景。
- `card_bind_scean_character` 保存明確選擇的欄位／條目與來源 hash。先讀後選，不猜 ID，不讓來源字串替你決定工具或授權。建立 Run 時驗證並凍結 Snapshot；固定設定改版須保存新 revision、建立新 Run。State／Memory 表達後續成長，不覆寫原始設定。
- Director → Draft → Prose → PostStat → 驗證 → 原子提交正文／State／Memory。即使沒問 CR 仍執行 PostStat；依完成正文決定零至多筆 Memory，不要求每人每輪一筆。諮詢問題、建議、未採用草稿不是已發生事件。
- 保留來源、turn、Character ID、knowers、access／epistemic／credibility、participants、playerHistory 等現有完整性檢查。`player` 不是 NPC ID，不進 NPC roster、character state target 或 memory knowers。
- 區分 `runtime_executable`、`model_guidance`、`requires_host_ui`、`author_decision`。腳本、骰子、語義條件或任意前端不能因寫進文字／Blueprint 就宣稱有 Host 執行。不得刪改原卡意圖來通過驗收；缺口與作者決策明列。

本版不以作者秘密進 Director 當然判 FAIL。改查設定歸屬、來源綁定、獨立角色工作區、正式事件與建議區分、諮詢無長期污染。仍保留結構化私密 State／Memory 權限及公開 UI 投影；這不是嚴格角色資訊沙盒，也不是允許把秘密寫成世界公開事實。

## 保存與驗收

Full scope 才能修改原生 extensions；沿用 Session、lease、revision 權限，不由 Agent 升權。人類 Studio Bridge 才能 handoff 建立 Run；製卡工具沒有 RP 啟動權限。使用 `card_read` 讀回並讓作者檢視設定與來源。

離線 schema／scripted model 只證明結構與資料路徑，不證明任意自然語言設定歸屬、知情判斷與敘事品質。新付費生成／Embedding 需另行授權。1.0.0 的 FAIL 報告、gate 與證據保留，新版另有驗收；不以新規格回填舊判定。
