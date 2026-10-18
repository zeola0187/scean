# Studio 工具、保存與驗證

依 `packages/studio/lib/tool-definitions.js`、`card-service.js`、`authoring-scope.js`、`scean-audit-control.js`。工具參數仍以當前環境的註冊 schema 為準；未註冊即回報缺口，不改用 shell／DB／任意檔案路徑繞過。此處的 `document_id`、entry_id、revision 都必須來自當前 Session 真實讀取。

## 讀取與局部寫入

|工具|必要參數|可選參數／效果|
|---|---|---|
|`card_read`|`document_id`|`fields` 為字串陣列；讀相關卡欄位與 revision|
|`lorebook_get_config`|`document_id`|config 不帶條目正文|
|`lorebook_list_entries`|`document_id`|摘要及穩定 entry_id|
|`lorebook_search_entries`|`document_id,query`|文字搜尋結果仍是摘要|
|`lorebook_read_entry`|`document_id,entry_id`|單條完整 entry 及 revision|
|`lorebook_patch_entry`|`document_id,expected_revision,entry_id,changes`|`references`；合併局部改動，省略的未知欄位保留，禁止改 id／uid|
|`lorebook_upsert_entry`|`document_id,expected_revision,entry`|`entry_id,references`；省略 entry_id 才建立，已有 entry_id 必須真實存在|
|`lorebook_delete_entry`|`document_id,expected_revision,entry_id`|`references`；已宣告外部條目指入時拒絕刪除|
|`lorebook_patch_config`|`document_id,expected_revision,changes`|不能替換 entries；保存欄位不代表 Runtime 有相應機制|

新建內嵌 CC 條目至少提供 `keys:[]`、字串 `content`、布林 `enabled`、有限數字 `insertion_order`；id 可省略由工具產生，extensions 如需提供必須是物件。CCv2 id 須數字，CCv3 可數字或字串；讓工具保留來源格式及必要映射，不手改 ST dictionary 的 uid／disable／order aliases。只有 upsert 建立時可在原無 book 的卡上明確建立 book。

以下是原創合成檢查情境，非作品必用範本；替換為真實讀回 ID／revision 後才可呼叫：

```json
{"document_id":"<observed-document-id>","expected_revision":3,"entry":{"keys":["霧港潮鐘"],"secondary_keys":["維修"],"selective":true,"content":"霧港潮鐘每到整點響一次；維修員會先檢查鐘架的鬆動。此為器物與作業背景，沒有宣告本輪維修已完成。","enabled":true,"insertion_order":100,"extensions":{"selectiveLogic":0}}}
```

這是 `lorebook_upsert_entry` 參數。回條返回新 revision、entry_id 等有限變更資訊；用 `lorebook_read_entry` 讀回正文，不能把回條當完整內容。對既有條目只改內容時傳 `changes:{"content":"…"}`；改觸發詞與常駐設定前先檢查 Full scope。

`references` 若提供，使用 `[{"source_entry_id":"<observed-source>","target_entry_id":"<observed-target>"}]`。工具只檢查已宣告引用與 ID，不能理解所有散文引用；刪除前仍須讀相關內容。不要承諾自動維護所有文內關係。

## Revision 與授權邊界

所有修改沿用選中文件、Session／lease／generation、scope 及 `expected_revision` CAS；保存產生新快照並重讀驗證格式。`REVISION_CONFLICT` 時重新讀取，比較他人改動後只重做仍必要的局部修改，不重送整份舊資料。錯誤的 ID 不用陣列索引猜測。

Content scope 只允許既有普通 entry 的 `content`；新增、刪除、keys、config、原生 extensions 等需 Full。Full 由既有人類 UI 決定，不由 Agent 偽造 claim 或升權。受管 Gate 正文不能經普通工具改／刪；專用 `cardstudio_scean_worldbook_gate` 的讀取流程使用 `action:"inspect"|"read"`、`document_id`、需要時 `entry_id`，正文改動使用 `action:"edit_body"`、`document_id,expected_revision,entry_id,expected_source_hash,old_text,new_text`，且只能改一次普通正文片段。這不授權為 SCEAN 新增 Gate。

角色來源工具 `card_bind_scean_character` 使用 `document_id,expected_revision,character,sources`，其中世界書來源為 `{kind:"worldbook_entry",entryId:<原始 id/uid>}`；這裡是 entry 原始數字／字串 ID，**不是** lorebook 工具的穩定包裝 entry_id。移交給原生角色工作流程前一併提供兩者。源條目或 description 改動需要重新確認及綁定；過期來源在 handoff／Core 建立 Run 時會拒絕。

Blueprint／InitialState 可由已核對的 `cardstudio_scean_frontend` `action:"dynamic_read"` 取得，或從 `card_read` 的 extensions 讀取；不要臆造世界書專用 State 寫入工具。原生資料局部寫入由 `scean-native-authoring` 處理，本 Skill 不覆寫整份 `extensions.scean`。

## 依既有稽核取得 selector 證據

需要稽核時用 `scean-compatibility-audit` 的流程。其 `scean_compatibility_audit` 必填 `document_id,expected_revision`；可選 `baseline_revision,cases`。只接受目前 Session 已選中保存卡片，獨立世界書文件不能直接冒充卡片進稽核；無合法組合環境則標未測，不能為了稽核擅自建立正式 Run。

```json
{"document_id":"<selected-saved-card-id>","expected_revision":4,"cases":[{"id":"maintenance-context","playerInput":"我走到霧港潮鐘旁，詢問維修。","expect":[{"entry_id":"<returned-stable-entry-id>","selected":true}]},{"id":"missing-secondary","playerInput":"我聽著霧港潮鐘。","expect":[{"entry_id":"<returned-stable-entry-id>","selected":false}]}]}
```

這個 `cases` schema 使用 `id/playerInput/recentDialogue?/expect:[{entry_id,selected:boolean}]`，不是 target Gate 的 `name/values/expect:pass|fail` schema。上例只有在實際設定與歷史窗口支持預期時成立；有歷史維修字樣時第二例可能仍命中，應如實保留情境與結果。不要省略／修改原負例以求 PASS。最多 64 cases／64 KiB；baseline_revision 是同一文件較早已保存 revision。

普通製作至少讀回確認 ID／內容／條件／保存格式，並列出受影響的來源綁定。需要完整工程驗收則交既有稽核 Skill 回報靜態、純 selector、容量投影及其他適用領域，保持 PASS／FAIL／WARN／UNSUPPORTED／NOT_TESTED／NOT_APPLICABLE 的原始證據。selector 命中不證明角色知情、真模型語義遵循、GUI 呈現或正式遊玩。

匯入／匯出沿用既有工具及已選 target；不切平台、不清除未知 metadata。需要匯出時依 `cardstudio_scean_document` 現行 check／export 行為，保存回傳檔案位置；不能將 authoring backup 或未驗證 target 說成可直接遊玩。人類 handoff 後的新 Snapshot 才採用新 revision，既有 Run 不會隨此保存更新。
