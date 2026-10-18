# 本版原生契約（Character Agent v1；基於 45ff63f）

## Core、Host 與 Writer

Snapshot schemaVersion=1 包含 cardId/revision/card/worldbook/preset/characters，validateSnapshot 計算並核對 hash。validateRoster 要求穩定唯一 id、非空 name、專屬 description；player 保留。可選 identity 必須源自 user-explicit/card-explicit。Host 接收已保存 Studio 版本後 normalizeStudioHandoffSnapshot 驗證 hash，將保存於 data.extensions.scean 的 stateBlueprint/initialState 及 first_mes 提升為新 Run 契約，不改舊 Run。

Director → Draft → Prose → Post-Stat → commit。Director 至多 5 round／6 tool calls，歷史搜尋有獨立界限。consult_character、adjudicate_action 是按需工具；前 Stat 僅裁定建議，沒有配置數值骰子執行器，需骰則應回 UNRESOLVED。Prose 無工具，局部禁詞修復有限重試。Provider outputContract 是 prompt_contract_only，不是 provider-enforced schema。

## CR 與 Memory

CR owner packet 是該角色的 character、ownState、owner recall，加公開世界與當輪輸入；角色全背景不自動送給共享 Writer。公開建議結構：adviceVersion:1, characterId, observable:{attitude,intent}, publicUtterances:[], withheld:[], internal:{notes:[]}, intendedDisclosures:[{topic,publicText}]。projectCharacterAdvice 移除 withheld/internal，保留公開建議，標為 advice_not_event；保留的自由文字仍可能洩密，無語義保密證明。

Memory schemaVersion=2：access.kind=world_public|known_event|private；epistemic.kind=fact|experience|belief|rumor|unverified；credibility=confirmed|subjective|unverified|disputed。knowers 與 characterIds 需同一 NPC 集合；world_public 只能 fact+confirmed、visibility=public，其他 visibility=characters 且 knowers 非空。participants 分 speakers/actors/decisionMakers，可包含 player；不能把聽者當說者。quotes.text 必須為 finalBody 的實際子字串，歸屬語義仍靠模型。

ACL 在 embedding、DF/BM25、RRF、rerank 之前；owner 只能讀有權記錄。旁觀玩家看到正文不代表所有角色知道。ownerMemory 是責任概念；實際 CR 欄位名是 memory，retrieve audience='owner'。玩家私有歷史用 playerHistory，Host 加 role=player_history/scope={kind:player_only}/來源，不自動注入 NPC／Writer。人物摘要目前僅有 ownerSummaryContext 輸入契約，沒有自動產生／儲存 pipeline。

## Blueprint、InitialState 與 Stat

Blueprint：schemaVersion:1,id,version 正整數,extensionPolicy:allow|deny,variables[]（最多300）。每個變數為 key/displayName/scope/category/type/visibility；character scope 另有 characterId。category 限 locations/tasks/resources/equipment/time/effects/facts；type 限 number/string/boolean/enum/json；visibility=public|restricted。number 可 min/max/unit；enum 用 enumValues；json 可 requiredFields。readOnly 禁止變更；derivedDescription 是說明，不執行公式。

InitialState：schemaVersion:1,blueprintId,blueprintVersion,values:[{scope,category,key,value,source:{id,version},characterId?}]。不在此塞 visibility；由 Blueprint 決定落點。world restricted 值物化為 {visibility:'private',value}；character restricted 位於 characters[id].private。缺值保持未知，0、false 是已知。初值來源 receipt 不等於已發生事件。

Post-Stat contractVersion:2,stateChanges:[],memories:[],playerHistory?。每個 change 為 scope/category/key/operation(set|remove)，set 有 value；world 禁 characterId/visibility；character 要合法 NPC characterId 與 public|private visibility。現有 Engine 以 publicView:true 驗證；不能由公開 Post-Stat 更新 private。完整 key 替換，json/task 不深合併；tasks 至少 status 非空、assignees 合法 NPC 或 player、progress 0..100。Blueprint 型別範圍、readOnly、extensionPolicy 與 private 目標一起檢查。

Host 的 DurableStore 使用 current.json aggregate、版本鎖、原子 rename、idempotency receipt；正文、狀態、記憶、playerHistory 與 bodyHash/commitId/turn 來源一次 commit。驗證失敗全輪不提交，attempt 保留。模型對消耗／法則／因果的理解不是確定性 Host 規則。

## 世界書與玩家前端

worldbook selector 是有界 literal、constant/keyword/scan 與容量選擇，會投影私密資料；不能執行 regex key 或 JS/EJS。完整閱讀來源不代表每輪注入全部條目。容量超限核心 fail closed；低優先條目可省略並有診斷。通用 UI 顯示公開狀態、宣告未知、歷史、章節及錯誤；restricted 連 label 都不進普通 Inspector。這不是任意卡 HTML runtime，沒有專屬船艦控制臺或 custom action Host。

## 生命週期

Snapshot、Blueprint、初值以新 Run 固定；新卡 revision 不覆蓋舊 Run。rollback 需 expectedVersion/expectedHead/operationId，退役最後回合與其記憶／playerHistory，衍生資料失效；regen 用前一狀態生成候選後一次替換，失敗不撤舊回合。save bundle 檢查來源鏈與 hash、選項與授權，匯入成新 Run；不可繞過現有私密 save grant。章節與 rollingSummary 都是衍生資料，原文與 State 才是權威；章節啟用不代表 rollingSummary 啟用。

新增 sourceBindings、card_bind_scean_character、lastCommittedTurn 的確切契約見 [角色工作區](character-workspace.md)。Director 必要作者備註可以包含秘密；保留結構化私密投影並不構成嚴格 RP Host 沙盒承諾。
