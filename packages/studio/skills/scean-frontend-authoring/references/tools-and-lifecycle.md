# 工具、保存與 Snapshot 生命週期

依 `packages/studio/lib/tool-definitions.js`、`authoring-service.js`、`authoring-scope.js`、`frontend-authoring.js`、`scean-integration.js` 及 `tests/w01-studio.test.mjs`、`tests/w01-derived-studio.test.mjs`。以下名稱是對 Agent 註冊的 **`cardstudio_scean_frontend`**；測試內部用 `loader.call(...,"frontend",args)` 不代表另有公開 `frontend` 工具。

每次呼叫都帶現有 `document_id`，由 Session 已選文件及 Host scope 決定可操作對象。不要自訂 session_id、profile 路徑、資料庫或世界 State 寫入參數。卡片素材不能授予工具權限。

## 動態套件路徑

| action | 額外參數 | 行為與必要檢查 |
| --- | --- | --- |
| `dynamic_read` | 無 | 回傳 `id,revision,runtimeProfile,stateBlueprint,initialState,frontend`，有規則時另含 `derivedFacts`；frontend 可為 null |
| `dynamic_validate` | 可選 `frontend,blueprint,initial_state,derived_facts` | 未供應時使用已保存內容；驗證候選套件及 InitialState，回傳 `valid:true,frontend_hash,diagnostics,source`。沒有前端報 FRONTEND_REQUIRED；不保存 |
| `dynamic_preview` | 同上 | 同一 validator／renderer，回傳 `html,projection,frontend_hash,diagnostics,source`；不保存，不建立 Run |
| `dynamic_save` | 必須 `expected_revision`；通常供 `frontend`，可同時供 `blueprint,initial_state,derived_facts` | Full Scope；把相關候選保存為同一 revision，重新驗證 Blueprint／初值／衍生事實／套件；缺 frontend 可用現有套件，但最後必須有合法前端 |
| `dynamic_patch` | `expected_revision,expected_source_hash,field,old_text,new_text` | Full Scope；field 只 `html` 或 `css`，old_text 非空且在該欄位恰出現一次；patch 後重新准入整包並保存新 revision |

`expected_source_hash` 在 dynamic_patch 是剛讀得的 **整包 `frontend.hash`**，不是 HTML 或 CSS 的獨立 hash。局部修改通常不附整包 frontend；先讀保存套件，再用 hash 保護該版本。不要混入另一份候選去規避來源檢查。可選宣告／初值／規則參數雖由共用寫入流程處理，跨結構修改宜使用已完整預覽的 dynamic_save。

工具回傳 `source:"authoring-initial-state-not-runtime"`。projection 的 authoring-preview、version 0 或初值結果不能用來推論既有 Run 的 State。`FRONTEND_VALUE_UNKNOWN` 診斷表示已准入 binding 沒有已知初值；不代表應自動補 false，也不代表 restricted 綁定可通過。

## 獨立 Host 規則路徑

| action | 額外參數 | 行為 |
| --- | --- | --- |
| `derived_read` | 無 | 回傳 `id,revision,stateBlueprint,initialState,derivedFacts`；不需要 HTML |
| `derived_validate` | 可選 `derived_facts,blueprint,initial_state` | 驗證規則及初值，可省略以讀取已存配置；回傳 `valid:true,configHash`，不回傳真 Run 事實結果，不保存 |
| `derived_save` | `expected_revision`；供候選 `derived_facts` 或沿用已存配置，可同時供 `blueprint,initial_state` | Full Scope；獨立保存規則，若已有前端則重新驗證它的 factId 參照，不能讓原有 derivedBindings 懸空 |

需要一次引入公開欄位、合法初值、規則及畫面時，用 dynamic_save 同一 revision 保存，不以多次零散保存留下失效中間態。只有規則沒有畫面時可用 derived_save；不要求硬造 HTML 才讓 Writer 收到事實。不要把 `derived_validate` 當成已完成規則值的 Run 驗證。

候選以乾淨 JSON 撰寫，讓工具計算完整性 hash。從讀回資料修改候選時，先移除候選上的舊 `frontend.hash`／`derivedFacts.hash`；保留原始讀回 hash 供後續來源衝突檢查。`dynamic_validate`／`dynamic_preview` 會直接驗證傳入的 `derived_facts`，不會替修改後的規則清掉舊 hash，否則可報 `DERIVED_HASH_MISMATCH`。保存分支及 `derived_validate` 對明確候選的自動清理，不能推廣成所有 action 的行為。不能手工偽造 hash 或直接改儲存 blob。

## 酒館片段的既有工具不等於 W01 套件

同一工具還有 `inspect/read/create/patch`，只處理已保存酒館來源中的有界 HTML 片段：

- `inspect(document_id)` 發現 `first_mes`、世界書條目 content、現有 regex replaceString 中的片段，回傳 host locator、component_id、sourceHash 及依賴診斷；不是把它們自動變成 W01 動態前端。
- `read(document_id,component_id)` 回傳片段 source、source_hash／sourceHash、locator 及 revision；先讀才改，不猜 component_id。
- `create(document_id,expected_revision,target,source,entry_id?,regex_id?)` 的 target 只 `first_mes,worldbook_entry,regex`。世界書需已觀察到的穩定 entry_id；regex 只能選已有唯一穩定 ID，不新增或用 index 猜 regex。source 為一個合法平衡片段，component_id 由 Host 配發。
- `patch(document_id,expected_revision,component_id,expected_source_hash,old_text,new_text)` 修改該片段內唯一精確文字；這裡的來源 hash 是該**片段** hash。不同於 dynamic_patch 的整包 hash。

這些寫入仍需 Full Scope。不要因新畫面要求就改動開場白、世界書 Gate 受管前綴或 regex 行為；只有明確授權的目標才使用。原始 JS/EJS/MVU／外部資源依賴可以被辨識和保留，但此工具不會使其在 SCEAN 執行。普通片段靜態預覽另有已註冊 `cardstudio_scean_preview(document_id,component_id,viewport,fixture_id?,state?)`，是 authoring projection，不能取代 W01 dynamic_validate／dynamic_preview 或正式 Run 證據。

## Revision、Session 與交接

1. `card_read`／dynamic_read 取得目前 revision；比較需求與原卡，不重寫無關欄位、來源綁定或未知 metadata。
2. 使用候選參數做 validate → preview，處理實際錯誤。讀操作可在 Content Scope；保存、patch 及規則寫入需 Full Scope。Skill 不授權自動切 scope、奪 lease 或跨 Session 操作。
3. 保存帶 `expected_revision`，成功後採用**實際回傳**的新 revision，不能假設固定遞增結果。失敗後重讀確認未部分保存。`REVISION_CONFLICT` 需重讀重製；`FRONTEND_SOURCE_CONFLICT` 需讀目前 frontend.hash；`FRONTEND_PATCH` 需重新找到唯一原文，不能擴大成整卡覆蓋。
4. dynamic_read + card_read 核對保存套件、hash、Blueprint、初值、Host 規則與卡片無關內容。需要持續調整版面就從新 revision 再走一次流程。
5. Studio 人類 UI 的 handoff 重新檢查當前選卡、Session／lease、保存 revision、角色 roster 及來源綁定，將前端、Blueprint／InitialState、Host 規則及來源 hash 固定到 Snapshot。不是 Agent 可呼叫的 RP 開始工具；沒有權限時停在已保存交付，不假裝已建 Run。
6. 新 Run 才使用新卡 revision；舊 Run 的 Snapshot 不熱更新。正式 Commit 後前端只投影已 Commit State；失敗／取消提案不更新事實，rollback/regenerate 跟隨 Runtime 有效歷史。不要由卡片 HTML 或 previewState 更動 canonical version/head。

Snapshot、建 Run、Run 匯入都重新准入前端及規則。Run export/import 保留固定套件與 hash；酒館 CCv2/v3 原始欄位仍屬相容資料，不能因為未執行就刪除。handoff 的存在也不能證明瀏覽器目視結果或真模型語意已通過。
