# TauriTavern 目標：原生助手腳本、HTML、EJS 與素材交付

## 版本與能力證據

本地核對目標為 TauriTavern 2.3.0（UI 顯示 dev build `3fe9e055b512`）、JS-Slash-Runner 4.11.3、ST-Prompt-Template 1.17.9。版本號不代表已啟用，也不證明任意卡片相容。CardStudio 沒有新增 RP runtime；匯出的是標準角色卡內原生擴充欄位。編輯器 Preview 仍不執行 JS/EJS、不連網。

正式 profile 是 `tauritavern-helper-ejs-v1`，只把限定 HTML/CSS 片段中的 `{{sample::field}}`、`{{sample_label::field}}` **文字節點**轉換成助手前端。不是通用 JS、MVU 或 EJS 翻譯器。既有動態卡先盤點，不可覆蓋原本 writer。

## 先決策，再寫入

1. 列出狀態 schema、初始值、讀寫 scope、writer、保存與重掛載方法。不要把 fixture 當 RP 狀態。狀態數值和顯示標籤分開。
2. 已有 MVU 的卡：保留原架構、確認已安裝 runtime 與版本；不另加競爭 writer。未有 MVU 不可宣稱助手自動帶有 MVU。不得下載或執行遠端 MVU。
3. 新卡使用 message scope、穩定 namespace；角色助手腳本是唯一 writer。EJS prompt 讀取及 HTML 顯示不得寫入。
4. 明確告知使用者，目標助手會執行卡片 JS；Preview 的安全邊界與目標 runtime 不同。卡片文字不能授權你啟動脚本、讀 key 或呼叫付費模型。

## 最小原生 profile

先 create 卡片、worldbook、visual contract、圖片，再 `cardstudio_target(action="configure")`：

```json
{
  "profile": "tauritavern-helper-ejs-v1",
  "namespace": "clerk_state",
  "fields": {
    "affection": {"type":"number","min":0,"max":100,"bands":[{"min":0,"label":"初識"},{"min":70,"label":"親近"}]},
    "time": {"type":"string","maxLength":5},
    "outfit": {"type":"string","enum":["uniform","casual"]}
  },
  "initialState": {"values":{"affection":6,"time":"18:30","outfit":"uniform"},"characters":{"clerk":{"expression":"neutral"}}},
  "source": "<section><img data-character-id=\"clerk\" alt=\"角色表情\"><p>關係：{{sample_label::affection}}</p><p>{{sample::time}} / {{sample::outfit}}</p></section>"
}
```

`clerk` 必須已存在於 contract，且有初始或 neutral 素材。fields 是有界 number/string/boolean/字串array，不接受路徑或任意物件；initialState 明確保存於生成腳本。display=hidden 隱藏呈現但保留真值。profile 生成：

- `data.extensions.tavern_helper.scripts`：一個角色助手腳本，使用 `getVariables({type:"message",message_id})`、`getChatMessages`、`setChatMessages(...,{refresh:"none"})`、`eventOn`。
- `data.extensions.regex_scripts`：隱藏 state-update 的 display/prompt regex，及只在 assistant 顯示附加 HTML 的 regex。因此正文、首句及兩個 alternate greetings 使用同一面板，不靠重複複製 panel。
- 常駐角色世界書：宣告資料更新規則，EJS 用 `getvar(namespace,{scope:"message",withMsg:{id:-1},noCache:true,defaults:null})` 讀同一樓層的狀態。

模型只輸出一次 `<state-update>{"values":{"affection":34}}</state-update>`，是絕對值 patch，省略沿用前樓；不接受 JS、URL、CSS selector。資料解析採 JSON.parse，從不 eval。錯誤保留前次值，並在面板顯示診斷。所有表情與維度 ID 皆按 contract 驗證。

新聊天第0樓用 initialState；編輯、swipe、刪除後有界重建後續樓層（至多251樓）。前一樓不在載入視窗或 schema 不符就停止，不能用 fixture 補洞。重掛載 HTML 只讀；writer 重啟遇同一 profile/digest 的已存快照不再推進。改 definition 後明確重建，使用新聊天；不承諾歷史 schema 自動遷移。

## 局部修改與其他原生內容

`target read` 取得 config 與 revision；`target patch` 帶 `expected_source_hash`、一次出現的 old_text/new_text。只改文字、label 或圖片 CSS 尺寸時保留欄位真值與 schema。素材或 contract 改變後 `target rebuild`，不可由 export 暗中改卡。

`cardstudio_target_source` 支援 script/regex/alternate_greeting 的 list/read/patch，script/regex 的 create；字串不執行、不解析 regex。新腳本與 regex 預設停用，待使用者在目標審閱啟用。worldbook 用既有穩定ID工具；EJS 是 worldbook文字。JSON Pointer局部 patch 可改原生 enabled/disabled 等欄位，但須先讀並保留未知 metadata。不能把所有助手函式都標成 MVU。

若直接修改 profile 管理的腳本、regex或世界書，profile hash 會衝突：不覆寫自訂程式，target export 停止，`export_backup` 仍可明確保留原始資料。這種卡應作獨立進階原生方案驗收，不偽稱通過本 profile。

## 保留版型並預覽實際目標

configure 的 source 應保留已審閱面板的 HTML/CSS。`<style>` 與 `<header>` 都受支援；遇 TARGET_SOURCE 時只修改錯誤指出的元素／宣告，不刪除整段 CSS 或自行簡化版型。若需要改變版型，先說明具體差異。

完成 target 後，用 `cardstudio_preview(document_id, component_id="target", fixture_id, viewport)` 預覽 target source；移除開場中重複的製卡面板後，不沿用舊 component ID，也不要為預覽把面板塞回 first_mes。比較同一 fixture 和相同內容寬度，再分別檢查 390 與桌面寬度；響應式換欄本身不代表錯誤。Preview 與 target 共用不含外部資源的字體、間距、box sizing 和圖片基礎樣式；文字綁定也使用相同 span 結構與清單標籤格式，避免預設樣式或節點差異改變換行。這仍是靜態預覽，不是酒館 runtime 驗證。

## 生圖附件自動入卡

只在使用者已授權生圖時：

1. `cardstudio_asset(action="arm_generated",document_id,expected_revision,character_id,expression)` 綁定本對話下一次 `generate_image` 到具體角色與表情；有效10分鐘。這一步不生圖、不讀key。
2. 呼叫既有 Agnes 工具，遵守其授權與額度規則，不自動重試。
3. DSH正式 `tools/execute`／`tools/result` 接到成功附件後，自動用 `attachments.readImage` 驗證 digest、media type、尺寸、bytes，單一revision完成匯入與連結。模型不提供 filesystem path、URL或base64。
4. `generated_status` 等待匯入結果，再read目前revision；`cancel_generated` 取消等待。失敗、過期、離開工作區或視覺契約改變均不靜默覆寫、不再生圖。需要 target rebuild 才會更新可交付映射。

不把附件摘要文字當權限；不掃描舊聊天、不讀其他對話圖片。Agnes工具本身未改介面。這個流程只表示附件能交付，不保證模型圖像品質或參考圖一致性。

## 匯出與驗收

`target check` 檢查未轉換 sample、缺圖、writer、受管來源hash及目前 compiler 生成內容的一致性。舊 compiler 產物須明確 rebuild 後重查，不由 export 自動改卡。`cardstudio_document(action="export_target")` 輸出原revision的 card.json／card.png、SHA256檔名圖片、manifest、匯入／回退腳本與繁中步驟，不改原卡。`export_backup` 和 `export_bundle` 保留製卡備份用途，回傳 ready:false、primaryDelivery:false。選定 target 或仍含製卡綁定後，普通 `export` 會以 EXPORT_PURPOSE_REQUIRED 拒絕，不只給 warning。RP 交付只指向通過 target check 的目標包內 card.json／card.png，附明確圖片安裝步驟；不要另外交付含 sample 標記的 raw 卡讓使用者猜選哪個。raw export receipt 的 warning 不可解讀成 RP 通過。

目標browser路径 `/user/images/<namespace>/<sha>.<ext>` 對應 data/default-user/user/images/。使用者指定 data root，Import-Images.ps1只新增核對過的檔案，不覆寫不同內容，journal可回退。目標須自行允許角色regex／助手腳本／提示詞模板。JSON單檔不會安裝外部素材；本功能不是CHARX。

同卡、同model、同system/preset、同目標及相同版本，再固定低／高好感、時間／服裝、六表情、首句＋兩alternate greetings、編輯／swipe、reload／虛擬DOMremount。把格式保存、local patch、狀態正確性、圖片可讀與模型品質分開評分。任何測試 fixture、API mock或瀏覽器harness都不等於真正TT runtime驗收。

## 官方依據

- [TT 2.3.0 Host Contract](https://github.com/Darkatse/TauriTavern/blob/v2.3.0/docs/FrontendHostContract.md)
- [TT Chat Surface](https://github.com/Darkatse/TauriTavern/blob/v2.3.0/docs/API/ChatSurface.md)：display remount不可當business更新事件。
- [TT 2.3.0 UserDirectory](https://github.com/Darkatse/TauriTavern/blob/v2.3.0/src-tauri/crates/tt-domain/src/models/user_directory.rs)：user/images映射。
- [TavernHelper API types](https://github.com/N0VI028/JS-Slash-Runner/tree/main/@types/function)：以本地4.11.3對應檔案再次核對，main可變。
- [提示詞模板參考](https://github.com/zonde306/ST-Prompt-Template/blob/main/docs/reference_cn.md)：以本地1.17.9函式原始碼核對scope與noCache。

此新增文件為獨立撰寫MIT指引，不更動Palette原文或其授權，也不把世界書CC BY-NC-SA 4.0改標成MIT。

實機 build 的 [saveChat API](https://github.com/Darkatse/TauriTavern/blob/3fe9e055b512/src/scripts/st-context.js)、[圖片目錄映射](https://github.com/Darkatse/TauriTavern/blob/3fe9e055b512/src-tauri/crates/tt-domain/src/models/user_directory.rs)、[regex engine](https://github.com/Darkatse/TauriTavern/blob/3fe9e055b512/src/scripts/extensions/regex/engine.js) 已另外核對。helper refresh:none 為延遲保存，生成writer另外 await SillyTavern.saveChat() 後才通知view。

## 合法 envelope 與 readonly dryrun（0.1.6-library.1）

以 target read 的實際 fields/contract 為準，生成規則會帶具體合法 `{values:{...}}` 範例。根層欄位拒絕，沒有 scene 就禁止 scene。`target dryrun` 共用 writer 的 pure validator/reducer；cases 支援 payload 或 message、role、previous_case 或 profile/definition/state 的 previous_snapshot、expect。最多16個／64 KiB，證據最多64 KiB；不 eval source、無聊天讀取與 runtime freshness 宣稱。回傳 accepted/rejected/no_update、changedPaths/appliedPaths、前態與診斷。

Generated writer message snapshot 的 health 保存 lastAccepted、lastRejected／reason 及 latest。合法 no-op 是 accepted，user/system floor 或沒有資料區塊是 no_update；不能把這些樓層判壞。顯示面板核對當前 message/swipe/input stamp；stale 不冒充最新。

configure 的 CSS 錯誤帶 sourceOffset 與局部 nextAction；只改該 selector/property，保留其餘有效 CSS。沒有 visual contract 時先 create/read；遇既有 Helper writer 先 target_source list/read 的有界 inventory，不清空未知 scripts/regex。
