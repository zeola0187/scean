# 模型輸入與資料責任

基準：`32f8630fbb0f3ecfa0a393bd9be8004ac3759082`。下表描述程式實際組裝的資料位置；能到達模型不等於保證被遵循。`budgetStage` 還會依容量裁掉可選來源；必要核心溢位則在該階段生成前拒絕。

## 階段實際讀到什麼

| 階段 | 實際輸入與使用界線 |
| --- | --- |
| Director | `assembly` 與當輪工具 `conversation`。assembly 含 playerInput、可選 writingGuidance、公開投影後的 sources（卡、selector 選中世界書、preset、固定 selectedOpening）、摘要、近期完成對話、公開 Blueprint／worldState、共享可讀 Memory、身分資訊，以及允許提供 Writer 的 Host 衍生事實。產出公開 writing brief；可選歷史查讀、角色顧問與 Stat 諮詢。 |
| Character Agent | 僅受詢角色本人的完整定義／關係與合法私人資料、ownState、本人可讀 Memory，加上 publicWorld、選中世界書、當輪 playerInput／question／currentEvent、lastCommittedTurn 與角色身分參照。其他人的私密資料不因被談到就成為本人資料。lastCommittedTurn 也不證明本人目擊其中一切。 |
| Draft | `context: assembly` 與 `directorBrief`；沒有 Director 工具權限。角色顧問公開建議先回 Director，未另設「所有顧問原文直送 Draft」的輸入。Draft 決定供下一階段使用的事件序列。 |
| Prose | 只有 `draft`、`playerInput`、公開投影後的 `preset`、`characterIdentities`。沒有整份卡、世界書、State、Memory 或角色顧問私人輸入；卡欄位只能經前階段產生間接影響。保留草稿中的行動者、決策者、事件與結果。 |
| Prose repair | 禁詞機械命中的局部範圍、bodyHash、bannedTerms。只修指定字句，不增加事件或新狀態；這不是可由卡片 Prompt 自訂的語意重審。 |
| PostStat | 完成 `finalBody`、公開 `previousState`、角色身分、公開 Blueprint 與模型可見 outputContract。沒有 Director／顧問私人推理或未採用草稿。提出 contractVersion 2 delta；Host 驗證再提交。 |

`writingGuidance` 是 `engine.turn` 的可選當輪入參，進 Director／Draft assembly；它不是新卡欄位，也沒有本 Skill 可擅自呼叫的 Studio RP 工具。`preset` 在 handoff 固定，會進 Director／Draft／Prose；現有 Agent 卡片工具不提供任意改 Run preset 的權限。若作者要求直接調整 Prose 敘事風格，確認目前人類入口與固定 preset 是否能完成，不能杜撰 `card_set_preset` 或把卡片欄位改名冒充它。

## 卡片欄位的實際效果

| 資料 | 在此基準的作用 | 編寫判斷 |
| --- | --- | --- |
| `data.description`／`personality`／`scenario` | 作為卡片故事資料經公開投影送進 Director／Draft。未標示的自由文字不會自動判斷秘密。 | 角色性格與互動習慣要標清歸屬；場景前提與作者限制分開寫清。不要把暫時事件覆寫成永久背景。 |
| `data.mes_example` | 保留字串並作為卡片資料送進 Director／Draft；原生模型埠以 JSON 文字送 user message，沒有把此字串解析成額外 chat turns。 | 可以寫角色語氣示例，但標示情境與說話者。`<START>`、`{{char}}`、`{{user}}` 在此路徑沒有保證展開或消息分段效果，保留匯出相容文字也不能據此宣稱 Writer 機制。 |
| `data.system_prompt`／`post_history_instructions` | 作為卡片資料保留在 Director／Draft sources；沒有替換 `SYSTEMS`、追加成系統角色、或依酒館位置插入歷史的實作。Prose 不直接收到它們。 | 既有酒館欄位可以保留供匯出。將 SCEAN 期望描述為故事／寫作指引及其可到達階段，不保證高優先權或直接控制 Prose。不要為了「啟用」欄位改 Writer。 |
| `data.creator_notes` | 可到達 Director／Draft 的作者資料，Director 全知編輯使用必要秘密合法。 | 不能當秘密保管庫，也不能把備註中的未來安排寫成已發生事件或強制每作必備安排。 |
| `data.extensions.scean.characters[]` | 共享 sources 中的 roster 只投影 `id/name/identity` 與有明確 `publicDescription` 才存在的公開 description；Character Agent owner packet 才有本人完整 description、relationships 及合法私密內容。 | 對話相關本人完整背景依原生製卡 Skill 綁定。若作者要在沒有諮詢的普通回合也提供某項公開語氣指引，放在已核對會進 Director／Draft 的公開卡資料，不假設 owner description 每輪全量送 Writer。 |
| `first_mes`／`alternate_greetings` | 卡片資料仍保留；若 Run 有 `sources.selectedOpening`，Director 指引以固定選中版本作初始場景。 | 本 Skill 不改開場白原文或方法；示例、選中開場與後續已提交歷史不要混為同一事件。 |

## 資料不是同一種真實

| 問題 | 適合的既有責任 | 不能推導出的結論 |
| --- | --- | --- |
| 作者知道某人的秘密或未來構想 | 作者備註／角色工作區，按需要提供編輯者；真正權限須依結構標籤 | 角色已知、現在已發生或一定要執行 |
| 角色本人有特定語氣、顧慮、錯誤信念或不願透露的過往 | 本人 definition／relationships／合法私人 State、owner Memory；公開語氣資料另按需要映射 | 其他人知道；顧問一定每輪出場 |
| 當前耐久現況改變 | 已宣告 State 契約，由完成正文與 PostStat 建議經 Host 驗證 | 只靠一句 Prompt 就寫入正式 State |
| 一段往事或見聞 | Memory 的 access 與 knowers 決定可讀者；epistemic 與 credibility 保留事實／經驗／信念／傳言／未確認及可信狀態 | `confirmed` 等於人人知情；正文被玩家看見等於全世界公開 |
| Host 由公開已提交 State 算出條件結果 | W01 `derivedFacts`，僅 `provideToWriter=true` 的結果投影給 Director／Draft，攜帶來源與版本 | 新的 State 寫入、NPC 記憶、同輪未提交事件的預測；unknown／unavailable 也不是真 |

共享 Writer 自動召回只接合法 `world_public` Memory；`known_event`／`private` 需本人 owner recall。`world_public` 必須 fact／confirmed；相信一件事、聽聞或錯認不能因此升成世界客觀事實。`player` 不是 NPC roster ID，也不能塞進 NPC memory knowers；玩家專屬經驗走既有 `playerHistory`，不自動注入 Writer／NPC。

Character Agent 回應的 `observable`、`publicUtterances`、`intendedDisclosures` 可公開供 Director 參考，`withheld` 與 `internal` 留在私人紀錄。這是結構邊界；Host 不會語意判定公開文字有沒有轉述秘密。只有完成正文真的描寫了揭露，才可能形成後續正式事件與知情記憶。不要把這套機制說成嚴格隔離一切自然語言知識的沙盒。

## 程式依據

- `packages/scean/core/engine.mjs`：`assembleSources`、`publicSources`、`SYSTEMS`、`characterIdentities`、`SceanEngine.turn`。
- `packages/scean/core/prompt-r3.mjs`：`withR3Prompts` 的有效 Director／Draft／Prose／Character／PostStat 指引，優先於 engine 內被替換的歷史底稿。
- `packages/scean/core/context-budget.mjs`：`topFields`、`assemblyFields`、`budgetStage`。
- `packages/scean/core/memory-policy.mjs`：`publicData`、`publicCharacter`、`ownerCharacterContext`、`ownerStateForModel`、`eligibleMemory`。
- `packages/scean/core/character-advice.mjs`：`projectCharacterAdvice`。
- `packages/scean/core/derived-facts.mjs`：`projectDerivedFacts`。
- `packages/scean/plugin/native-model.mjs`：`createNativeModelPort.generate` 的 system 與 JSON user message 組裝。
- `packages/studio/lib/scean-integration.js`：`buildSavedSnapshot`、`createSceanControl`。
