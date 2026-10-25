# 版本化能力索引

機械版 `../capability-manifest.json` 含 source hash、symbol、行號與測試檔。路徑相對驗證過的 checkout；.integration 是已記錄來源的隔離 Card Studio 副本，須以 stage-integration 重建。本索引不是 Host 功能開關；runtime_executable 的 prompt 傳送也不代表模型必然遵從。

| ID | 分類 | 契約與限制 | 證據 |
|---|---|---|---|
| snapshot | runtime_executable | 固定 revision/hash；新 Run 凍結，舊 Run 不熱更新 | `core/contracts.mjs:41` / `tests/studio-bridge.test.mjs` |
| pipeline | runtime_executable | Director→Draft→Prose→Post-Stat 單一提交；CR/前 Stat 按需 | `core/engine.mjs:184` / `tests/core.test.mjs` |
| owner-context | runtime_executable | 本人完整背景、ownState、owner recall；其他人僅身分 | `core/engine.mjs:330` / `tests/a1-character-context.test.mjs` |
| cr-projection | runtime_executable | 刪除 withheld/internal，保留公開意圖與發言；非語義防洩密 | `core/character-advice.mjs:22` / `tests/a1-character-context.test.mjs` |
| memory-acl | runtime_executable | ACL 先於 embedding/DF/ranking；known_event/private 僅 owner | `core/memory.mjs:197` / `tests/a1-memory.test.mjs` |
| memory-policy | runtime_executable | knowers、權限與真假分開；playerHistory 不注入 NPC | `core/memory-policy.mjs:14` / `tests/a1-integration.test.mjs` |
| typed-state | runtime_executable | Blueprint型別、範圍、enum、visibility、readOnly；缺值未知 | `core/state-blueprint.mjs:47` / `tests/b-state-blueprint.test.mjs` |
| initial-state | runtime_executable | 來源版本化 InitialState 物化，restricted wrapper | `core/state-blueprint.mjs:110` / `tests/b-blueprint-integration.test.mjs` |
| stat-delta | runtime_executable | 合法 scope/全key替換/未指定保留/公開delta不能改private | `core/stat-contract.mjs:59` / `tests/stat-contract-r3.test.mjs` |
| atomic-commit | runtime_executable | 正文/State/Memory/playerHistory/來源/receipt 一次原子提交 | `adapters/store.mjs:77` / `tests/core.test.mjs` |
| worldbook-literal | runtime_executable | literal/keyword/constant/scan 選擇；不執行正則或腳本 | `core/worldbook.mjs:130` / `tests/b-worldbook.test.mjs` |
| context-capacity | runtime_executable | 按階段有界容量；必要核心超限拒絕 | `core/context-budget.mjs:48` / `tests/b-context-budget.test.mjs` |
| studio-handoff | runtime_executable | 人類有效 lease/saved revision；nested state 欄位驗hash後提升 | `plugin/studio-handoff.mjs:10` / `tests/formal-handoff.test.mjs` |
| public-ui | runtime_executable | 通用UI/Inspector公開投影，未知呈現；不是任意HTML runtime | `core/inspection.mjs:97` / `tests/b-inspector-privacy.test.mjs` |
| rollback-regen | runtime_executable | expectedVersion/head/operationId，候選成功才替換，失敗保留 | `core/regenerate.mjs:5` / `tests/c-regenerate.test.mjs` |
| save | runtime_executable | 有來源鏈及hash的保存／新Run匯入；私密資料需既有grant | `core/save-bundle.mjs:8` / `tests/c-save.test.mjs` |
| derived-history | runtime_executable | 章節/rollingSummary衍生；rollback失效，原文優先 | `core/narrative.mjs:29` / `tests/df-save.test.mjs` |
| story-rules | model_guidance | 人物演繹、文風、因果、事件知情判斷靠模型 | `core/prompt-r3.mjs:3` / `tests/r3-handoffs.test.mjs` |
| semantic-secrecy | model_guidance | 自由文字披露無語義保密保證，作者分域＋模型遵循 | `core/character-advice.mjs:20` / `authoring/tests/acceptance.test.mjs` |
| arbitrary-scripts | requires_host_ui | 不執行任意 JS/EJS/MVU/TavernHelper/regex replacement | `studio/cardstudio-bundle/lib/scean-integration.js:30` / `authoring/tests/acceptance.test.mjs` |
| deterministic-rules | requires_host_ui | 沒有通用骰子、消耗公式或任意規則引擎；StoryClock／公共事件已有 Host 契約 | `core/engine.mjs:106` / `authoring/tests/acceptance.test.mjs` |
| custom-ui | requires_host_ui | 專屬控制臺/地圖/操作按鈕需另實作Host/UI；本輪不做 | `plugin/player-native-bridge.mjs:2` / `tests/milestone-a-ui.test.mjs` |
| owner-summary-writer | requires_host_ui | 只有ownerSummaryContext契約，無產生及儲存流程 | `core/memory-policy.mjs:136` / `tests/a1-memory.test.mjs` |
| missing-author-choice | author_decision | 未定初值/公式/披露/性別等不可杜撰；ready必須解決 | `core/contracts.mjs:44` / `authoring/tests/acceptance.test.mjs` |
| studio-agent-discovery | runtime_executable | catalog/readSkill/loadSkills→Session addon skills.register；真SDK發現/載入/釋放已驗證；非真模型語義 | `authoring/.integration/cardstudio/lib/workspace-setup.js:70` / `authoring/tests/agent-integration.test.mjs` |
| studio-agent-save | runtime_executable | 真Agent工具create/card_patch_fields保存原生extensions；Content拒絕，不自動handoff | `authoring/.integration/cardstudio/index.js:51` / `authoring/tests/agent-integration.test.mjs` |
| host-operator | runtime_executable | 正式一般控制需authenticated operator；Studio獨立lease/identity契約 | `plugin/index.js:41` / `tests/formal-runtime.test.mjs` |
| player-history | runtime_executable | 與NPC記憶分離，Host提供來源；不自動進NPC/Writer | `core/memory-policy.mjs:123` / `tests/a1-integration.test.mjs` |
| poststat-output-contract | runtime_executable | 具體npcStateIds供模型；仍是prompt_contract_only；Host全輪拒絕非法scope | `core/post-stat-output.mjs:6` / `tests/post-stat-scope.test.mjs` |
| player-shared-shell | runtime_executable | 既有responsive共用前端、native bridge；本輪無專屬frontend | `isolated/web/player-shell.mjs:4` / `tests/milestone-a-ui.test.mjs` |


W29 現行能力：唯一 StoryClock、公共七日規劃、角色論壇主文／跨日留言、附來源的 RP 回流、零模型日曆／論壇閱讀、獨立日曆／論壇模型選擇，以及新卡顯式選用的有界路人氣氛主文。見 [world-routine.md](world-routine.md)。日記自動頻率尚未決定，不可宣稱自動日記已啟用。
