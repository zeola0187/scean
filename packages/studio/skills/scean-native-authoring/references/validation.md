# 1.1.0 獨立驗收

L0 核對原碼／安裝／hash；L1 契約與來源完整性；L2 真 Studio 工具／保存／人類 Bridge／Core scripted model；L3 真製卡 Agent 理解；L4 真 RP 敘事。本次 L3/L4 NOT_RUN；付費生成與 Embedding 0。

必查單角色 description、多角色／同本世界書分離、穩定角色與來源 ID/hash、錯配／過期來源拒絕、沒有 CR 仍保存記憶、真正 Model Port 收到本人 State/Memory／現場／最新正式回合、前問答不回灌、建議不自動成事件、新 revision 不改既有 Run、原子提交／取消／回退／重生成／權限與 provenance 回歸。

Director 看見必要作者備註不是失敗。角色設定是否歸屬正確、正文中的經歷與知情是否合理，包含需要人類／語義審查的部分；hash 和 canary 不能證明任意自然語言判斷。保留 UI 私密投影、knowers 與來源鏈負例。不能將自由文字型的 author metadata blocked 誤稱為 Runtime gate。

原 1.0.0 Skill 在 authoring/archive/1.0.0，舊 validator 為 validate-plan-v1.0.0.mjs；原 authoring/live/L3-REPORT.md 與 ledger、判準未改。舊 FAIL 是歷史結果，不能套新版規格倒改。

執行 `node --test tests/*.test.mjs` 及 `node --test authoring/tests/*.test.mjs`，先準備獨立 SDK 與 Studio 測試包。新版來源綁定與 CR 案例在 tests/character-workspace-v1.test.mjs，真工具案例在 authoring/tests/agent-integration.test.mjs。manifest source hashes 需隨版本更新，原卡／私人 RP／Prompt Trace 不入提交。
