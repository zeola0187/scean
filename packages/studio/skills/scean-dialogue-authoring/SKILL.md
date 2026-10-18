---
name: scean-dialogue-authoring
description: 依 SCEAN 實際 Prompt Assembly 與 Character Agent 契約，編修角色對話風格、互動習慣、示例及敘事指引，並用 Card Studio 保存可追溯版本。適用於製卡時的對話與 Prompt 設計，不改 Writer Runtime 或代寫開場白方法。
metadata:
  version: "1.0.0"
  runtime-profile: "scean-character-agent-v1"
---

# SCEAN 對話與敘事指引製作

先讀 [模型輸入與資料責任](references/prompt-contracts.md)；實際修改時讀 [受控編輯與驗證](references/editing-workflow.md)。本 Skill 的能力基準是包含 W01 Host 衍生事實的 `32f8630fbb0f3ecfa0a393bd9be8004ac3759082`，不是所有安裝環境的保證。以當前工具註冊、Runtime 與保存資料再核對；差異列為缺口，不為了讓文字生效改 Runtime 或增設模型階段。

本 Skill 協助作者把已有創作意圖寫到會被使用的位置。角色設計方法仍由作者選用的 `character-authoring` 或 Palette 負責，保持既有互斥選擇。角色工作區、來源歸屬、Blueprint 與 Snapshot 交給 `scean-native-authoring`；世界設定與 selector 交給世界書 Skill；HTML/CSS 與公開 State 綁定交給前端 Skill。要求工程相容性證據時使用 `scean-compatibility-audit`，不在此另造一套 gate。開場白 Skill 與原文保持不變。

## 將作者意圖落到輸入

1. 用 `card_read` 讀取當前 Session 選中工作副本、revision 與相關欄位；列出作者要改善的可觀察差異，例如說話節奏、稱呼、如何表達不同意、何時主動提出建議。已有資料足夠便直接編修；只有會改變作者意圖的歧義才確認。不把固定衝突、反轉、高潮、人物弧線或固定句型設成作品通用規則。
2. 依參考表區分角色設定、整體敘事風格、持久現況、角色主觀認知與作者備註。先找出實際讀者：Director／Draft、指定角色顧問，或 Prose。不要把 `system_prompt`、`post_history_instructions` 當作取代系統指令的開關，也不要承諾 `mes_example` 會成為獨立對話輪。
3. 對作者要求的角色整理足夠且可辨識的語氣、注意焦點、價值取捨、與他人的互動習慣；使用作者已定的背景，不重新發明人格方法。示例可依作品需要自由選擇情境與篇幅，明示為示範而非已發生事件。讓語氣差異服務人物，不要求每人每輪發言，也不靠重複口頭禪代表完整角色。
4. 讓 NPC 能基於自己的目的、資訊與承諾採取合理主動、拒絕或保留意見；是否對抗與如何親近由作品意圖決定。分清玩家已指定的行動、NPC 已接受的工作及仍待玩家選擇的新決定。等待已接受工作完成可推進至指定終點；不得把玩家的沉默補成授權，或替玩家決定未選的行動、台詞與內心。安靜、停頓與少數人參與同樣可成立。
5. 以現有 Studio 局部工具保存，讀回核對。更新被綁定的來源文字後，依原生製卡契約重新綁定受影響角色，防止來源 hash 漂移。Full scope、Session、lease、Revision CAS 都由 Host 決定；不要用 shell／資料庫繞過。不能把本 Skill 的選用視為升權或正式開 Run 的授權。
6. 分開交付保存證據與創作評估：記錄實改欄位、revision、來源綁定、仍有歧義的效果，以及靜態／Scripted Model／工具整合／GUI／真模型語意各層結果。沒有真模型測試時將角色語氣遵循、資訊歸屬與敘事品質列為 `NOT_TESTED`。合成測試不能證明任意文字都會被正確理解，也不需要為驗證此 Skill 新增付費呼叫。

## 不能混淆的邊界

- Director 是全知編輯，可讀必要作者備註。編輯模型看過秘密，不代表角色知道；自由文字沒有自動秘密分類，標上「秘密」二字也不會自動建立 ACL。需要本人專屬資料時使用既有角色工作區與結構化投影。
- Character Agent 只在 Director 呼叫時提供指定角色的編輯建議，沒有獨立 RP 或持續諮詢聊天。它的公開建議可包含主動提議或刻意揭露，但問題、意圖、建議與未採用草稿不成立事件。Host 的結構投影不會語意審查每句話是否洩密。
- Director → Draft → Prose → PostStat 是現有主流程。Prose 修辭不能補造草稿未發生的回歸、完成或玩家決定；PostStat 以完成正文為唯一新增事件來源，經驗證後才原子提交正文、State 與 Memory。無角色諮詢也會執行 PostStat。
- 已保存卡片改版須經人類現有 Studio handoff 建立新 Run／固定 Snapshot；舊 Run 不熱更新。不要用改寫設定假裝既有 Run 已經歷成長或記得新事件。

維護本 Skill 時從實際程式、契約與測試重核對輸入路徑。來源依據及自行撰寫紀錄見 [SOURCE.json](SOURCE.json)；這項紀錄不等於整個專案的授權審查結論。
