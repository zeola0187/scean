# 前端共創與型別化樣本

## v0.1.4 工具與 binder 的精確介面

`cardstudio_frontend` actions 為 inspect／read／create／patch。Read 帶 component_id；create 用 target=first_mes，或 target=worldbook_entry＋工具回傳 entry_id，或 target=regex＋唯一既有 regex_id。Host 決定 ID／offset／path；create 不接模型自訂 component_id。它將一個平衡可辨識的 HTML 片段附加到指定來源，保留原文；source 最多 256 KiB。

Frontend create 參數範例；RETURNED_DOCUMENT_ID／revision 必須換成實際值：

```json
{
  "action": "create",
  "document_id": "RETURNED_DOCUMENT_ID",
  "expected_revision": 1,
  "target": "first_mes",
  "source": "<section class=\"cs-maliyah-panel\"><style>.cs-maliyah-panel{max-width:40rem;padding:1rem}.cs-maliyah-panel img{width:100%;max-width:18rem}</style><img data-character-id=\"maliyah\" alt=\"瑪莉雅\"><p>好感：{{sample_label::affection}}</p><p>時間：{{sample::time}}</p><p>物品：{{sample::inventory}}</p></section>"
}
```

寫後 inspect/read 取得 host 的 component_id 與 source_hash。Patch 帶 action=patch、document_id、expected_revision、component_id、expected_source_hash、old_text、new_text；old_text 必須在該 component 恰好一次，不提交整個修改後 source。Expected_revision 是 document revision，不是 component_revision。

`cardstudio_fixture` 僅 read／patch；patch 可建立指定 fixture_id，但是整個有界 fixture 的替換，不是 deep merge。先 read，保留其他 values／bindings，再 resubmit。Host 填 schemaVersion=1 與 fixtureId。精確參數範例：

```json
{
  "action": "patch",
  "document_id": "RETURNED_DOCUMENT_ID",
  "expected_revision": 2,
  "fixture_id": "default",
  "fixture": {
    "values": {"affection": 42, "time": "18:30", "location": "courtyard", "outfit": "casual", "mood": "embarrassed", "inventory": ["notebook"]},
    "bindings": {
      "affection": {"type": "number", "min": 0, "max": 100, "display": "label", "bands": [{"min": 0, "label": "尚在認識"}, {"min": 40, "label": "逐漸信任"}, {"min": 80, "label": "很親近"}]},
      "time": {"type": "string", "maxLength": 5},
      "location": {"type": "string", "enum": ["courtyard", "store"]},
      "outfit": {"type": "string", "enum": ["casual", "uniform"]},
      "mood": {"type": "string", "enum": ["neutral", "happy", "angry", "sad", "embarrassed", "surprised"]},
      "inventory": {"type": "array", "maxItems": 64}
    }
  }
}
```

Type 僅 number／string／boolean／array，array 為有界字串清單；display 為 value／label／hidden。Bands 按數值門檻選 label，不反寫 value；sourcePath 只是 inert 說明，不會讀真實 runtime。Values／bindings 各最多 64 欄，fixture 最多 65,536 bytes；missing value 產生 diagnostic，顯示缺值標記。**Time 目前僅 string／長度校驗，沒有 HH:mm 專用 validator**；maxLength=5 不能證明時間有效。

投影只解 `{{sample::name}}`／`{{sample_label::name}}` 並做文字編碼，這是 authoring binder，非 ST macro。`<img data-character-id="maliyah">` 使用 Visual State 的合法映射；固定本地圖可用 `<img data-asset-id="RETURNED_ASSET_ID">`。原始 src／外部 URL 不作回退。

`cardstudio_preview` 接 document_id、component_id、fixture_id（預設 default）、viewport（僅數值 360／390／768／1024）及可選 state，沒有 action／任意 source／任意 viewport 參數。模型只收到 metadata／hash／diagnostics／projection_bytes 與開啟 Preview tab 的提示；完整 HTML／raster base64 僅由受控 UI 呈現。**看不到畫面時不能依 metadata 宣稱視覺驗收**，依使用者反饋或已授權的 UI 驗證繼續共創。

## 元件契約與局部操作

`cardstudio_frontend` inspect/read 的 host 結果決定可編輯片段，包含 stable component identity、source locator、source hash 與 revision。初期候選來源為 first_mes、指定 worldbook entry、可安全辨識的 regex replacement HTML。來源不唯一或 HTML 邊界不明時不能 fallback 成整欄重寫。

建立時使用工具支援的 locator；修改時提供回傳 ID 與需要的 hash/revision，限定 HTML/CSS 片段。保留 namespace、class/id 與所有外部引用契約；若要改名，先列出 CSS、regex、macro、script 文字中的引用。文字搜尋沒找到不能證明 dynamic JS 沒有引用。

無前端的新卡不必硬塞 UI。希望原有卡能在 ST 或 TavernHelper 跑的部分可保留原碼；P0 Preview 中指令碼被阻擋是 diagnostic，不是應該移除原碼的理由。

## Fixture 是樣本，不是真實角色狀態

用 `cardstudio_fixture` 定義 schema 與值，工具回傳為準。下列為設計語義例，**不是未經核對即可呼叫的 tool input**：

```json
{
  "affection": 42,
  "time": "18:30",
  "location": "courtyard",
  "outfit": "casual",
  "mood": "embarrassed",
  "inventory": ["notebook"]
}
```

規劃 affection 為有範圍的 number、time 為有效 HH:mm、location/outfit/mood 為合法 ID 或 enum、inventory 為有界字串／物品 ID 陣列。拒絕 wrong-type，不用 Number(任意字串) 掩蓋錯誤；缺值與 null/reset 語義按工具契約處理，不把缺值默默當成 0。文字長度、陣列數量及範圍都需有界。

Binding 僅使用產品支援的唯讀型別化機制；不把 fixture 字串當 HTML、CSS、URL 或可執行程式拼接。Value 與 display label 分離：「affection=42」可顯示「逐漸信任」，但不能把 label 反寫成值。使用者說不要數字時移除顯示數字，保留數值與更新規則。若現有 binding 不支援所需轉換，明示缺項，不能用卡 JS 繞過。

## 手機與桌面共創

在 `cardstudio_preview` 中使用同一 fixture 與 source revision 比較 360、390 CSS px 與桌面；不要一邊改狀態一邊宣稱排版改善。至少涵蓋：高好感、缺值、長地名、長 inventory、多角色、無圖與 asset decode 失敗。

UI 建議採內容流動、合理 max-width、可換行的 flex/grid、`min-width:0`、圖片 aspect-ratio 與 `object-fit`；避免固定大寬度、把狀態列設成全螢幕 `100vh`、以 overflow:hidden 掩蓋必需內容。iframe 的 viewport 是容器，不能套用第三方直接操作 parent/frameElement 的 resize 程式。[來源 S3](primary-sources.md)

「太擠」先減少非必要 ornament／間距並調整分欄；「圖太小」增加圖區比例與可用高度，不重寫角色設定；「不要數字」改 label。每次修改維持其他 component 與 underlying fixture 不變，讀回／diagnostics 確認 patch 沒有誤碰內容。

## P0 投影與限制

只投影淨化後 HTML/CSS。卡 JS、inline handlers、EJS、MVU、remote script、外部圖片與任意 URL 不執行。Preview 不可取 DSH RPC、filesystem、env、key 或真聊天；opaque-origin iframe 不具有 host API。

產品自身審核的 renderer 不等於準許卡 JS。iframe sandbox 本身不能封所有 network／navigation；必須配合實際 CSP、sanitizer 與資產准入。若 DSH CSP 阻擋 srcdoc／blob／data image，診斷實際能力，不要求關閉整體 Desktop 安全設定。[來源 S9](primary-sources.md)
