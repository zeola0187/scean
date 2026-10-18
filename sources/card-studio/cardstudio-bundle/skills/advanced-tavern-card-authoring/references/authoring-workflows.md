# 兩條製卡流程

## v0.1.4 實際建卡介面

`cardstudio_create` 接有界 canonical 欄位，不接 full card、extensions、assets、任意 JSON 或 filesystem path。format 僅 v2／v3（預設 v3）；可提供 name、description、personality、scenario、first_mes、mes_example、creator_notes、system_prompt、post_history_instructions、alternate_greetings、tags、creator、character_version。name 最長 120 字元且不可空白，其他文字上限 65,536 字元；tags／alternate_greetings 最多 32 項，各項分別最多 128／16,384 字元。Plugin 建 JSON working copy、空 worldbook、預設 fixture 與共同 revision 0。以下是工具參數範例：

```json
{
  "format": "v3",
  "name": "Maliyah",
  "description": "成年運動用品店員，介紹商品時外向，受到個人稱讚時會害羞。",
  "personality": "主動、細心；能自在談運動，談自己時短暫移開目光。",
  "scenario": "傍晚的運動用品店，使用者正在挑選初學者用品。",
  "first_mes": "瑪莉雅把筆記本放在櫃檯，笑著問你想嘗試哪一種運動。",
  "alternate_greetings": ["店門鈴聲響起，她抬頭向你揮手。"],
  "tags": ["adult", "sports-store"],
  "character_version": "1"
}
```

後續使用回傳 document_id 與最新 revision；新卡沒有原始 PNG，不宣稱保留不存在的圖片。不要自行新增未列出的 create 欄位。

## A：匯入既有卡後最小修改

`cardstudio_import` 只接使用者已准入 imports 的 JSON/PNG，建立獨立 working copy。保留原始檔，不要求整卡全文進模型 context。先 `card_read` 讀目標欄位；worldbook 用 `lorebook_list_entries`／`lorebook_search_entries` 找到穩定 ID，再 `lorebook_read_entry`。前端透過 `cardstudio_frontend` inspect/read 建立可追蹤元件，不從猜測的 offset、class 或原始 entry 數字 ID 直接覆寫。

把需求轉成局部驗收：「390 px 不橫向溢位」「好感數字改成文字，但 underlying affection 不變」「立繪較大而不壓縮對話」。先做 dependency inventory，再 patch。修改 HTML/CSS 片段不能順手刪掉不支援的 macro、regex、JS/EJS、MVU 或 metadata。來源無法安全辨識就停止該元件寫入，說明未知原因；不得改成整個 first_mes／worldbook content 覆蓋。

原有基本內容使用 `card_patch_text`（old_text 必須唯一）或 `card_patch_fields` 的局部 JSON Pointer patch。worldbook 使用 `lorebook_patch_entry`／`lorebook_upsert_entry`，省略欄位保持原有值；不要自製 entry ID 或移除未知 extension。每次 mutation 後使用回傳 revision，並讀回相關片段。

## B：從概念開始

先用少量問題或可修改的假設建立概念：成年角色身分、動機與矛盾、與使用者的關係、場景、語氣、開場中的可互動事件。把「外向但害羞的運動用品店女店員」落成有區別的行為：介紹商品時主動，受到個人稱讚時迴避目光；不靠互相矛盾的性格標籤堆字。

使用 `cardstudio_create` 的合法欄位建立 CCv2 或 CCv3 最小卡。Plugin 決定標準骨架、document ID、初始 revision、working copy 與 sidecar；模型不用 filesystem 寫完整卡，也不以改 spec_version 假裝版本轉換。CCv2/v3 必要欄位、unknown preservation 與 PNG 規則另見既有 `tavern-card-format-preservation`。

循序補完：

1. 基本內容：name、description、personality、scenario、first_mes、需要時的 alternate_greetings／mes_example。先完成可 RP 的文本，再做 UI。
2. worldbook：用 upsert 建角色／店鋪／物品／狀態規則條目。有效觸發詞、enabled、insertion_order 等由 tool 驗證；空 worldbook 合法，不以空條目灌滿。
3. 狀態規劃：決定 affection、time、location、outfit、mood、inventory 的型別與規則，再建 fixture。規則是寫給目標 RP 系統的內容，不表示 Card Studio 已經執行更新。
4. 前端：由 host 支援 locator 建元件，先靜態 HTML/CSS；用 fixture binding 呈現樣本。沒有前端的卡也能 history、rollback 與 export。
5. Visual State：定義 stable character ID、六表情與合法素材 mapping；預製圖准入後才能對映。未有圖時 placeholder 合法，勿假造 asset ID。
6. 共創：固定 fixture，依反饋修改局部。檢查 desktop、360/390 px、長文字與長 inventory、高好感與缺值。
7. 回退與交付：確認共同 snapshot 恢復卡、fixture、contract、asset refs；另存 export 並說明 runtime adapter 邊界。

## 舊工具仍有效

13 個既有工具是 `cardstudio_import`、`card_read`、`card_patch_text`、`card_patch_fields`、`lorebook_list_entries`、`lorebook_search_entries`、`lorebook_read_entry`、`lorebook_patch_entry`、`lorebook_upsert_entry`、`lorebook_delete_entry`、`lorebook_get_config`、`lorebook_patch_config`、`cardstudio_document`。新工具補足 authoring 流程；不繞過既有 Session lease、revision、snapshot 或 export。

Worldbook 參照須以明確 source_entry_id／target_entry_id 交給工具；工具不會推測任意 extension 引用語法。遇到未提供的外部引用，保留並診斷，不宣稱引用已完整驗證。
