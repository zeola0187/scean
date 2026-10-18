# 世界資料與 selector 契約

依 `core/worldbook.mjs`、`core/engine.mjs`、`core/context-budget.mjs`、`core/state-blueprint.mjs`、`core/memory-policy.mjs`；適用本 Skill 所列基準。以下是 SCEAN 實作，不借用其他酒館 Runtime 的規則。

## 資料放在哪裡

|資料|位置與生命週期|避免的誤用|
|---|---|---|
|地理、制度、器物用途等公開固定背景|世界書條目；建立 Run 時凍結來源及版本，當輪 selector 決定背景上下文|寫成自動成立的事件、State 更新或強制劇情|
|正式世界或角色當前值|Blueprint 宣告 target、type、visibility；InitialState 給可追溯初值；後續由正式正文的 PostStat 提案驗證後提交|把「門已開」「燃料目前 20」同步硬寫成世界書常量|
|某回合發生之事及誰知道／相信|Run 的 Memory，帶 source／turn／commit 與 access、knowers、epistemic、credibility|把世界設定假造為回合記憶，或把傳聞當全世界確認事實|
|某 NPC 的固定背景、身份、關係及必要私人設定|`data.extensions.scean.characters` 中本人工作區，明確來源綁定|整本世界書複製給一個人，或以條目寫「只有甲知道」便宣稱權限已隔離|
|公開 State 的確定性衍生結果或畫面可見性|獨立 Host derivedFacts／W01 前端條件契約，由原生前端流程處理|用 Blueprint `derivedDescription` 文字冒充計算式，或期待條目讀 State 自動解鎖|

Blueprint `scope` 是 `world`／`character`，category 是 `locations/tasks/resources/equipment/time/effects/facts`，type 是 `number/string/boolean/enum/json`，visibility 是 `public/restricted`。InitialState 每筆值須對應宣告且帶 `source:{id,version}`；缺值仍是未知，不補成 0／false。`readOnly` 是寫入約束，`derivedDescription` 是描述，兩者不會自動計算值。不要為了方便默改作者的 `extensionPolicy`。

Memory schema v2 的 access 為 `world_public/known_event/private`，epistemic 為 `fact/experience/belief/rumor/unverified`，credibility 為 `confirmed/subjective/unverified/disputed`。只有 `world_public + fact + confirmed` 可自動進共享 Writer pipeline；其他依本人 knowers 權限。製卡沒有直接新增正式 Run Memory 的 lorebook 工具。Director 可讀必要作者設定，不代表 NPC 已知；結構化投影也不會自動辨認未標記散文中的秘密。

## 來源、公開性與掃描

- selector 讀固定 Snapshot 的 `card.data.character_book` 與 `worldbook/worldbooks` 等已支援來源。相同序列化 book **及版本** 精確去重；名稱、內容或版本不同不會語義合併。保留 sourceId、bookId、bookVersion、contentHash、entryId 以便定位。
- 私密 book／entry／history 在匹配前排除：包含 `visibility:private/restricted/characters`、`contextScope`、`access.kind:private/known_event`、player-only scope／player_history 等結構標記。未標記的「秘密」散文不能當安全隔離。不要把私密條目改公開求命中。
- 當輪 `playerInput` 一定加入掃描，包括 scan count=0。預設每本 `scan_depth` 是 **歷史 messages 數**；合法範圍 0–1000，未設／非法以 2 為預設（非法另警告）。不是歷史回合數，也不是遞迴深度。
- Core 支援 Snapshot `worldbookSelection.scanWindow:{unit:"messages"|"player_turns",count}` 覆蓋每本預設；還有 `maxEntries` 0–10000。這些是 Core 設定，並非 `lorebook_patch_config` 所有同名欄位都會接上。不要臆造 Studio 專用設定工具或任意改 Snapshot。
- history 以已提交公開 input／body 或 user／assistant 訊息作材料，failed 等未 committed 訊息不參與；player_turns 以 explicit／inferred 玩家輪次分組。條目內容、State、Memory、摘要不拿來做新的關鍵詞掃描，沒有連鎖遞迴。

## 啟用、匹配及順序

1. `enabled:false` 或 `disable:true` 排除，即使 `constant:true`；空白 content 排除。
2. keys／key、secondary_keys／keysecondary 取字串並 trim。`use_regex/useRegex:true` 或任一 `/…/flags` 形狀 key 使整條排除，即使 constant；沒有執行作者正則。
3. enabled 的 `constant:true` 跳過關鍵詞要求；其他條目至少命中一個 primary key。預設忽略大小寫、字面子字串匹配，沒有語義／詞幹／同義詞擴張。`case_sensitive/caseSensitive`、`match_whole_words/matchWholeWords` 可在 entry／其 extensions 設定，優先於 Core config，再到 book 預設。整詞邊界用 Unicode 字母、數字、組合標記及 `_`；單一漢字 key 自動要求邊界，多字漢字預設可子字串命中。
4. `selective:true` 時還須有非空 secondary keys；secondary 在整份掃描材料中統計，可與 primary 來自不同訊息。`selectiveLogic/selective_logic` 可在 entry 或 extensions，預設 0：

|值／別名|primary 已命中後的 secondary 要求|
|---|---|
|0／and_any|至少一個命中|
|1／not_all|不是全部命中|
|2／not_any|一個也未命中|
|3／and_all|全部命中|

未知 logic 排除並警告。常駐條目不執行 secondary 篩選，勿靠 selective 限制 constant。

5. 入選 priority 優先用 entry／extensions 的 `priority`，否則 `order ?? insertion_order`，有限數值才採用，預設 100。先按 priority **由高至低**，同值按 displayIndex、book／entry 原順序決定 `maxEntries` 准入。
6. 展示時依 `before_char`（或 0）／`after_char`（或 1）分桶，同桶 priority **由低至高**，同值按來源 book／entry 順序；不等於入選排名。其他 position 警告後退回 after_char。這是 selected entries 的粗略排列，不是酒館的任意深度、訊息角色或獨立 system slot。

## 注入與容量

Engine 先移除原始世界書容器，只將選出的公開 entries 放入 assembly：Director、Draft 可讀；有實際諮詢時 Character Agent、adjudicate 也可讀。Prose 透過 Draft 間接接觸內容，不再直接取得全書；PostStat 依完成正文、前一 State、角色與 Blueprint 工作，不讀整本世界書或未採用建議。

每個模型階段還有 Context Budget。世界書是可裁切來源；較低優先內容可被刪，常駐亦無豁免。該層把 book priority 對應到 10–30 的有界容量優先值；不能以無限提高 insertion_order 保證常駐。估算是可重現的多語 heuristic，並非供應商 tokenizer 或計費結果；核心上下文塞不下時拒絕，不能靠截斷核心硬送模型。

看 `diagnostics.selectionOrder/presentationOrder`、各 entry 的 reason／hits、`contextBudget.sources` 及 `worldbookUse` 所列 refs。`assembled_for_port`／`completed` 與 providerDispatch 的紀錄只支持對應資料路徑，不保證真模型理解或遵循。

## 保存相容欄位與現行能力分開

Studio codec／匯出可保留未知 metadata、原始 CCv2/v3／獨立世界書格式及既有 nullable book settings；保存成功不等於 selector 支援。`token_budget`、`recursive_scanning`、depth、機率、cooldown 等不能宣稱由目前 Core 執行。JS、EJS、`{{…}}`、`@@` 內容目前只是文字，會診斷其執行式語法，不能當程式效果。

`cardstudio_scean_worldbook_gate` 管的是明確 TauriTavern target 的 message-snapshot 條件與編譯前綴；其 evaluate 的 eligible 也不是最終 prompt 注入。它不是 SCEAN World State selector，也不是 W01 顯示條件或 Host derivedFacts。遇到受管條目先讀 Gate，正文修改依專用 `edit_body` 與 hash；不得用普通 entry patch 抹掉前綴。若作品要在 SCEAN 中依正式 State 強制改變條目注入，記為目前未實作／待作者決策，不私增 Runtime 機制。
