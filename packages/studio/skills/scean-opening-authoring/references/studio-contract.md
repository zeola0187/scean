# 本版 Card Studio 工具對應

以下依目前註冊工具與來源契約核對，是對使用者規格的工程接入說明。工具不存在或不符目前版本時，保留草稿並說明缺口，不以 shell／資料庫／檔案系統繞過。本文不新增工具權限，不宣稱 Host 會檢查文學語意或作者是否已口頭確認。

## 讀取及編輯

1. 使用當前 Session 選中的 `document_id`。`card_read({document_id})` 回傳 card 與 revision；`fields` 是 `first_mes`、`alternate_greetings`、`extensions` 等現存 data 欄位名稱，不是 JSON Pointer。需要初始設定時讀取 `extensions.scean.stateBlueprint`／`initialState`，不能把取得權限當成更改授權。
2. 世界書先用 `lorebook_get_config`、`lorebook_list_entries`，必要時 `lorebook_search_entries` 與 `lorebook_read_entry({document_id,entry_id})`。使用工具回傳的穩定 `entry_id`，不將陣列位置當 ID，也不以摘要取代完整目標條目。
3. 作者確認後，非空 `first_mes` 優先 `card_patch_text({document_id,expected_revision,field:'first_mes',old_text,new_text})`；`old_text` 必須恰好出現一次。空舊值、零次或多次匹配不能硬套此工具。刷新後修正局部替換，不重建整張卡。
4. 空正文或多開場使用 `card_patch_fields({document_id,expected_revision,patches})`。路徑從 `/data/` 開始，例如 `/data/first_mes` 或 `/data/alternate_greetings/0`；可用 `test` 再 `replace`。新增其他開場時讀取完整現有陣列，以最新 revision 寫回只增加已確認篇章的陣列；不重排或改寫未指定的篇章。省略的其他欄位維持原狀。
5. 世界書正文局部改動用 `lorebook_patch_entry({document_id,expected_revision,entry_id,changes:{content}})`；建立新條目用 `lorebook_upsert_entry({document_id,expected_revision,entry})`，既有條目則帶穩定 ID。由當前 CC 格式驗證必填欄位，保留未知 metadata。Content scope 可以編輯允許的普通正文；新條目／結構需要既有的人類 Full scope。Agent 不自設 scope、lease 或審核憑據。
6. 每次成功寫入都取得新 revision；下一步重新讀取或使用已確認的最新回執。版本過期、目標改變、匹配失敗或權限拒絕時不能盲重送。若必要共用歷史尚未寫入，明確標示未完成。

Content scope 只接受允許的純文字／Markdown 與 `{{char}}`／`{{user}}` 佔位符；正文或待寫入陣列包含 HTML、CSS、EJS 等混合來源時，即使只改一個詞，也可能是唯讀。這時保留原始標記與草稿，由人類切到既有 Full scope 後才局部編輯；不得剝除 HTML、改寫來源形式或換工具來避開拒絕。Full scope 仍不代表可以執行來源腳本。

## 讀回、記錄及部分完成

`cardstudio_scean_document` 的 `action:'history'`／`'diff'` 回傳既有版本與差異；`diff` 使用 `from`、`to`。需要回退時用 `action:'rollback',expected_revision,to`；回退本身也產生新 revision。此工具沒有 `snapshot` 動作，不發明這個參數。

開場寫入與 lorebook 工具寫入是多個獨立 revision，沒有跨工具原子交易。保存前留存原 revision／目標全文／預期變更；逐步讀回。中途失敗不能宣稱已同步；只有在確認其後版本全屬本次操作、沒有其他作者修改時，才以可用的受控回退修復，否則停止覆寫並報告現況。既有版本與 bounded 回執不是全文；要審閱內容用讀回或明確 diff。

若編輯了角色綁定來源而產生來源漂移，交由既有 Native Authoring 工作流程確認該角色的來源；不自動刷新 hash 來掩蓋修改。本 Skill 不擴大人物核心背景改寫範圍。

## 舞台與創作規則的界線

- `first_mes` 和 `alternate_greetings` 是正文字串；本版 Stage 只顯示主／替代入口，沒有獨立的作者標題／不劇透簡介欄位。保留這些說明為對話交付資料，不混入正文或新造 extensions。
- 透過人類 Studio handoff 才建立保存版本的選擇；多開場先預覽，確認後建立固定 Snapshot 的新 Run。`group_only_greetings` 不列入此選擇。Skill 的保存動作不等於開始遊戲；既有 Run 不隨改卡更新。
- 各開場共用原 Blueprint、InitialState、世界書與人物設定。共用資料是否在程式層保留可以用合成測試驗證；文字是否違反該設定、讀者／角色知識是否分離，仍是創作判斷與實際模型語意觀察，不能僅因 schema 通過就稱為強制保證。
- 作者確認、文風試寫不保存、只修指定篇章，是本 Skill 的行為規範。沒有新的 `author_confirmed` 寫入參數，也沒有新增的 Host 全域攔截器；其他合法 Native Authoring 工作仍可使用它原有的工具與權限。
