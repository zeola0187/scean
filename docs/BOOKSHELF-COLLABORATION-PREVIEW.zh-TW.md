# 書架協作紀錄、完整世界書與聊天面板預覽

三項功能均不新增模型階段、模型請求或向量查詢。Research Logging Mode 未實作。

## 操作

- 舞臺書架的「本輪協作」讀取已保存的公開工具問答、Director 交接、State／Memory 資料參考及提交狀態。主動 Stat 裁定與回合尾固定 post_stat 分開呈現。可切換已知歷史 attempt，或明確跳至已核對提交的正文。
- 書架「世界書（完整含劇透）」讀取本局固定 Snapshot 的完整條目，包括隱藏、未標公開、停用及尚未觸發的設定。可切回公開版；不會改讀工作卡最新版，也不會觸發條目。
- Card Studio Agent 成功執行 `dynamic_save`／`dynamic_patch` 後，聊天回合尾可展開已保存面板。預覽固定當次卡片 Revision 和面板 hash，以作者保存的初始 State 呈現，並明示不是遊玩狀態。舊訊息不會換成新版本。

## 權限與來源

`playerCollaboration`、`ownerWorldbook` 是已認證玩家操作端的純讀 RPC，不是 Agent 工具。完整世界書另要求既有本人診斷權限；不新增長期憑證。Host 在資料讀取前後核對操作端、Session 工作卡範圍、固定 Snapshot 和 Run 生命週期。回收區 Run 不接受這些讀取。

協作只投影既有公開 envelope。Character 的 withheld、internal、owner Memory／State、完整 Prompt 與原始私密模型回覆不會送到視窗。Memory／State 資料參考不冒稱獨立 Agent 對話；Advice、交接與未提交候選不冒稱事件。Writer 入包有保存證據與模型完成紀錄時才作相應標示，不能藉文字相似度推定語義採納。

完整世界書與 Agent 輸入使用不同投影。本人看見隱藏設定，不會改變 Director／Writer 的輸入、觸發規則或角色知識。

聊天預覽使用有界保存回執定位 immutable revision。回執不是授權，解析時仍需目前合法 Session、租約、工作卡關聯與未回收來源。解析不呼叫會更新 Session 關聯的一般預覽操作。預覽不可用不代表保存失敗，不得因此自動重送寫入或開局。

## 安全呈現與閱讀

協作及世界書以純文字呈現，長內容按需分片。分頁與續讀綁定來源版本；更新只提示，由玩家決定何時顯示。背景、關閉及切換來源會停止查詢／使晚回覆失效。世界書不因新正文 head 而被替換。

面板沿用舞臺 renderer，僅讀公開 Blueprint 綁定。iframe 為無 scripts／same-origin 的 sandbox，CSP 禁止腳本和網路；不提供工具 RPC 或正式資料寫入。聊天僅在展開且接近可視範圍時讀取預覽，不掃描整份私人聊天。

## 已知限制

- 普通回合依既有磁碟 checkpoint 顯示已保存部分；尚未保存不等於沒有呼叫。regenerate 的中間 raw checkpoint 原本只在記憶體，完成前可能顯示來源待保存。沒有新增大型持久化或 Logging 系統。
- 清單主要來自 Host 有界 operation journal 及 canonical 歸屬；很舊、未被 journal 記錄的失敗 attempt 不會自動掃描整個 raw 資料夾。已知精確 attempt 可核對讀取。
- 每次內容回應最多 48 KiB；單一 raw attempt 超過 16 MiB 明示無法讀取。世界書最多 20,000 條，過量、壞資料、來源缺失及受遮蔽內容均明示部分／不可用。
- 結構投影與已知憑證模式遮蔽不能自動判斷自由文字所有語義秘密；權限仍以既有來源契約為準。
- 面板首版支援成功保存的動態面板；不自動為舊保存紀錄補產回執，也不替舊遊玩回合建立呈現資料。
- 合成模型、桌面與窄視窗測試證明機制；不代表真模型每次遵循、實體手機觸感或敘事品質已驗收。

實作入口：`core/collaboration-reader.mjs`、`core/owner-worldbook.mjs`、`plugin/reader-host.mjs`、`isolated/web/player-readers-ui.mjs`、`isolated/web/collaboration-reader-ui.mjs`、Studio 的 `lib/saved-panel.js`／`lib/chat-panel-preview.js`。
