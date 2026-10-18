---
name: advanced-tavern-card-authoring
description: "在 Card Studio 中從概念建立 CCv2/v3 角色卡，或保留既有 JSON/PNG 後局部共創前端、型別化樣本狀態與六表情素材契約；以受控工具、手機／桌面靜態 Preview、revision 與共同回退驗證修改。明確區分 SillyTavern 原生訊息、TavernHelper、MVU、製卡 Preview 與尚未驗證的 runtime adapter。"
references:
  - references/worldbook-conditions.md
  - references/tauritavern-target.md
  - references/authoring-workflows.md
  - references/runtime-and-dependencies.md
  - references/frontend-and-fixtures.md
  - references/visual-state-and-assets.md
  - references/validation-and-lifecycle.md
  - references/primary-sources.md
---

# 進階酒館製卡共創

本技能教設計與驗證；Card Studio Plugin 負責受控讀寫、合法性與資產管理，Preview 呈現製卡樣本。RP 模型將來只表達合法 state ID，renderer 選用既有素材。本技能不提供 SillyTavern、TavernHelper、MVU 或 EJS runtime，也不授予指令碼、網路、檔案或帳號許可權。

## 何時使用與按需閱讀

- 要依自訂變數分段解鎖／鎖回世界書：先讀 [worldbook-conditions](references/worldbook-conditions.md)。使用 `cardstudio_worldbook_gate`，不是前端隱藏或任意手寫 EJS；先 inspect 已宣告變數、read 條目，寫入後以合成資料試算並 target check。

- 沒有初始卡、要從概念建立角色：讀 [authoring-workflows](references/authoring-workflows.md)。
- 已有卡要改狀態列／HTML／regex replacement：先讀 [runtime-and-dependencies](references/runtime-and-dependencies.md)，再讀 [frontend-and-fixtures](references/frontend-and-fixtures.md)。
- 要六表情、多角色、服裝或圖片對映：讀 [visual-state-and-assets](references/visual-state-and-assets.md)。
- 每次交付、rollback 或 export：讀 [validation-and-lifecycle](references/validation-and-lifecycle.md)。
- 判斷平臺行為或授權：查 [primary-sources](references/primary-sources.md)。不用一次載入全部 references。

SCEAN 世界書、對話與 W01 前端製作分別使用 `scean-worldbook-authoring`、`scean-dialogue-authoring`、`scean-frontend-authoring`。本技能保留酒館格式與既有 target 製作責任；角色設計依人類選定的獨立方法，開場白方法保持原樣。不要把任何特定創作方法當成 CCv2/v3 強制規範。

## 必須執行與主文告知（0.1.8）

「模型必須執行／核對」與「主文必須告知」分開。必要局部 read、revision／source hash、scope epoch／lease、已授權寫入、交付前 check 及實際匯出的 fresh preflight 照常執行；不逐步播報工具、JSON、CCv2/v3、token budget、hash 或 PASS／NA 清單。纯構思不動卡，也不每輪重跑全卡檢查。安靜處理不增加修改權。

已授權交付中，只有宿主明示 `repair.kind="gate_rebind"` 且當前 scope 允許才走既有有限修復；沿用同一交付意圖與 cases，整個交付最多三輪、每輪最多64個 eligible rebind 且完整重查。遵守實際 stop/result；fingerprint 重現、FAIL 增加、patch 失敗、無 eligible、上限或已停止即停，不换 Session、製造 revision 或另用 patch 繞過。

主文談角色、劇情、一致性及具體改動。修復停止、非白名單 FAIL、缺素材、缺授權／scope、無法安全解決的版本或來源衝突、需要改作者意圖／條件／素材，或尚未完成儲存／匯出時，短述「影響＋目前結果＋需要的決定」。不得掩飾 FAIL。WARN 若影響此次目標也須告知，例如要求連封面卻選 JSON；不單靠 severity 判斷可見性。

完整 object／fingerprint／nextAction／rounds／fullCheck／stop、diff 與 receipt 留既有有界工具紀錄及可展開診斷，不裁掉模型必需資料或省略標記。Card Studio 面板只保存自己的明確 check，不宣稱同步 Agent 每次修復。主文沒有固定技術報告；使用者要求格式、原因或證據時正常提供。再嘗試受阻操作仍短述失敗，回到無關創作不反覆播同一提醒。交付時簡述影響用途的未測 runtime 限制；NA／未測不可說 PASS。本規範只作用於助手 Session，不寫入角色卡或限制角色 RP 文風。

## 工作規律

1. 先辨識工作副本、使用者目標與目標平臺。零起步用 `cardstudio_create`；既有卡用 `cardstudio_import`。模型不以 filesystem 手寫整張未知 JSON。
2. 小範圍讀取：`card_read(fields=...)`；worldbook 先 list/search 再讀指定 `entry_id`。使用 `cardstudio_frontend` inspect/read 取得 host 回傳的 component ID、source locator/hash 與目前 revision。
3. 判斷依賴，標示 unsupported／unknown。不執行卡內 JS、EJS、MVU、regex 或遠端資源來「測看看」。未知 metadata、macro、script、regex 物件與圖片維持原樣。
4. 先提出最小具體改動，再以受控 create/patch 工具寫入。每次寫入帶目前 revision；frontend 帶工具要求的 source hash／component identity。衝突就重讀、重新擬定 patch，不盲目重試或重寫整欄。
5. 用 `cardstudio_fixture` 建立型別化製卡樣本；以 `cardstudio_preview` 比較同一 fixture 的 360、390 CSS px 與桌面呈現。使用者說「太擠／不要數字／圖太小」時，只改相關排版、label 或圖片尺寸。
6. 用 `cardstudio_visual_contract` 驗證 state，再以 `cardstudio_asset` 管理已准入 raster 素材與對映；不得讓模型輸出實際路徑、URL、script 或 CSS selector。
7. 檢查局部 diff、diagnostics、共同 history／rollback 與 export receipt。沒有製卡綁定的一般卡可用 `cardstudio_document(action="export")`。已選目標或仍含製卡綁定時，一般 export 會拒絕；保留原始卡須明確選 `action="export_backup"`，含 sidecar／素材的備份用 `action="export_bundle"`。兩者均非 RP 主交付，也不標 ready。若使用者要在 TauriTavern 實際 RP，先讀 target reference，以 `target check`、`preview(component_id="target")` 和 `export_target` 完成交付。含 sample 標記或未綁定圖片的 raw export 只作製卡備份，不同時當成可遊玩的替代卡。交付以創作成果為先，簡述影響此次用途的限制；格式邊界與完整證據按需展開。

工具的實際 schema、action、限制與回傳值以本次 session 發現的定義為準。工具不可用時明確報缺項，提供局部設計草案；不要假造成功、工具名別名或 runtime 許可權。寫入 receipt 是有界摘要，需要內容時另作小範圍 read，勿因摘要省略內容就重建全卡。

## TauriTavern 原生目標與自動素材交付

使用目標工具前，完整閱讀 [tauritavern-target](references/tauritavern-target.md)。它定義助手單一 writer、message scope、EJS 唯讀、原生前端、明確初值、有界編輯、正式 Agnes 附件自動匯入及匯出資產方法。此 profile 不安裝私有 runtime，也不翻譯任意卡片 JS。

## 能力邊界

P0 Preview 是淨化 HTML/CSS 的隔離投影，預設不執行卡 JS、不解 EJS、不啟動 MVU、不讀真實聊天／global settings、不載遠端 scripts 或圖片。fixture 不是 RP 現況，Preview 通過不是酒館 runtime 通過。sandbox 不代表已封網；必須依產品的淨化、CSP 與資產准入政策。

完整 ST runtime、任意指令碼、完整 MVU editor、TavernHelper API 模擬器、拖拉式 WYSIWYG、runtime 即時生圖與 CHARX 全支援不屬於 v0.1.4。現有 Agnes 工具只有文字生圖，不宣稱它能以基準圖生成差分；本流程用外部預製、合法取得且由使用者准入的圖片。


## 匯出前檢查與有限修復（0.1.5）

交付前使用 `cardstudio_document(action="check", document_id, expected_revision)`；可用 `export_action` 明確指定 export/export_target/export_backup/export_bundle，或用 `cases` 提供作者預期。實際匯出時由 `action="export|export_target|export_bundle|export_backup"` 選入口，必須省略只供 check／repair 使用的 `export_action`；不可放寬參數准入以忽略錯誤。每個案例是 `{name, values, expect:{entry_id:"pass|fail|unknown"}}`，最多16個、總計64 KiB。未提供預期不算行為驗收。查看每個 FAIL 的 object、fingerprint、nextAction，確認結果綁定目前 document/revision/target。作者案例只驗證合成条件，不證明酒館的 message/swipe freshness 或最終注入。

宿主在每個實際匯出入口重新完整檢查：PASS/WARN 可匯出，FAIL 阻擋。WARN、NA、untested 不得轉述成 runtime PASS。check 唯讀，不建立快照或修改素材。不要因舊檢查曾通過而略過新檢查。

只有結果帶 `repair.kind="gate_rebind"` 時才可呼叫 `cardstudio_document(action="repair", document_id, expected_revision, export_action, cases)`。宿主自行重算修復計畫，用既有 Gate patch 鏈、revision/source hash 和快照保護，保持相同規則與本文，最多三輪；每輪完整重查，修復對象同 fingerprint 再現或 FAIL 數增加即停。同一未變 revision 的停止結果不能再次啟動該修復鏈。這是宿主對單次修復鏈的強制界限；不代表可以換 Session、重啟宿主或任意改卡後規避三輪。

Agent 協定：整個交付工作最多三輪修復；停止後回報作者，保留完整診斷，不用其他 patch 工具繞過限制。其他 FAIL 應先讀對象，提出最小修改供作者決定。不得自動變更作者意圖、target、故事條件或素材内容，不刪資料，不為了通過檢查改預期。即使 FAIL 數未增加，也不能越過白名單。Skill 提供此工作協定；宿主硬限制僅涵蓋 repair 白名單、每輪重查及匯出攔截，不宣稱限制所有一般編輯。

## Session Authoring Scope（0.1.6-library.1）

先讀 capability 的 `authoring_scope`。Content／Full 由人類在同一 Session 的 UI 選擇；模型沒有切換或升權工具。既有 Session 預設 Full 以維持相容，明確切換後持久保存。Content 可完整讀 runtime，但僅能修改敘述欄位、Opening 純文字與既有普通 worldbook 本文。混合 HTML／JS／EJS／macro 保持唯讀；Gate、target、Helper、regex、metadata、fixture、visual contract／asset bindings 和未知欄位都受保護。不得用 ancestor patch、import/create、rollback 或其他工具繞過限制。Scope epoch 改變時重讀；不要重試舊寫入。此政策限 Card Studio 控制的 tools／bridge，不是整個 DSH shell/filesystem sandbox。

有受管 Gate 的本文只能在 Full 使用 `cardstudio_worldbook_gate(action="edit_body", entry_id, expected_source_hash, old_text, new_text)` 精確改純文字；通用 book/card/frontend patch 不得替換其 wrapper。先 read；保留規則、前綴與 metadata。

Target payload 用 `cardstudio_target(action="dryrun", document_id, cases)` 作 readonly 合成驗證，案例最多16個、總計64 KiB。合法外層為 `{values:{實際宣告欄位:合法絕對值}}`；不能把欄位放在根層，也不會自動包裝。characters／scene 僅可用實際宣告契約。`previous_case:true` 延續上一合成結果；`previous_snapshot` 需有相符 profile／definition／state，仍不證明 runtime freshness。accepted 的空 changedPaths 是合法 no-op；user/system/no_update 與 rejected 分開。非法 payload 整筆保留前態。不要執行來源卡程式來做 dryrun。

Safe repair 每輪批次處理本次全部 eligible Gate rebind（最多64），共同快照、一次 revision、可共同 rollback；仍最多三輪、每輪完整重查、曾修復 fingerprint 再現或 FAIL 增加立即停。
