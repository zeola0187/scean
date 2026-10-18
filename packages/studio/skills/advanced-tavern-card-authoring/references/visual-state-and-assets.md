# Visual State 與預製素材

## v0.1.4 精確契約、更新與素材介面

`cardstudio_visual_contract` actions 為 create／read／validate／patch。Create 接 contract 的 characters／scene；Host 填 schemaVersion=1、contractRevision=1、六表情、defaultExpression=neutral 與空 variants。最多 16 角色，stable ID 為小寫開頭的英數／底線／連字號，最長 64 字元。角色 dimensions 僅 outfit／pose／location／lighting；scene 是頂層 locations／lighting，不是角色 dimension。參數範例：

```json
{
  "action": "create",
  "document_id": "RETURNED_DOCUMENT_ID",
  "expected_revision": 3,
  "contract": {
    "characters": {"maliyah": {"displayName": "瑪莉雅", "dimensions": {"outfit": ["casual", "uniform"]}}},
    "scene": {"locations": ["courtyard", "store"], "lighting": ["day", "evening"]}
  }
}
```

Patch 接 changes 的 characters／scene；提供的 map 整體替換，不 deep merge。先 read，保留其他角色、六表情、defaultExpression、dimensions 與 variants。修改單一 expression mapping 優先 asset link；patch／link／unlink 均增加 contractRevision，後續 state 要用新值。

State mode **僅 patch／snapshot，沒有 full**。Patch 缺欄維持前一合法 state；snapshot 先 neutral 所有角色並清空維度／scene，再套更新。characters.maliyah=null 明確 reset 該角色；expression=null 非法；其他維度 null 刪除該維度；scene=null 清空場景，scene.location／lighting=null 刪除該項。Validate 接 state、可選 previous／sequence；檢查 accepted，不能只見 normalized state 就稱輸入合法。非法輸出回 neutral defaults 並保留 anti-replay watermark；stale sequence／contractRevision 維持前一合法 state。Preview 記憶僅限同 Session／document／revision；孤立 validate 不證明真 RP 回合順序。

`cardstudio_asset` actions 為 list／import／link／unlink。Import **只接 GUI 已選擇、屬於同 Session／document／expected_revision 的 upload_id token**，不接 path／URL／bytes／base64／模型自製 attachment。GUI 已完成匯入就 list 使用既有 asset_id，不再 import。上傳是 UI 受控流程，不授權模型讀任意檔案。單圖最多 16 MiB，僅 PNG/JPEG/WebP；JPEG/WebP 的結構檢查仍需 UI browser decode，diagnostic 未解除不稱完整解碼驗證。

Link 參數範例；ID 和 revision 必須換成 list／read 回傳值：

```json
{
  "action": "link",
  "document_id": "RETURNED_DOCUMENT_ID",
  "expected_revision": 4,
  "asset_id": "RETURNED_ASSET_ID",
  "character_id": "maliyah",
  "expression": "neutral"
}
```

Unlink 同樣帶 asset_id／character_id／expression；只移除映射，不刪歷史 blob。簡單 link 建 expression-only variant；帶 outfit／pose 等維度的 variant 用合法 contract patch，asset tool 沒有 dimensions 參數。依六張圖逐次 mapping，每次拿前次 receipt 的 document revision。

Visual State 是預先製作角色／場景變體，非 before/after diff，也非每回合即時生圖。Card Studio 定義合法契約與管理素材；RP 模型將來表達 ID，resolver 對應到准入圖片，renderer 呈現。製卡 Preview 先用 fixture 驗證這條資料流，不連真 RP runtime。

## 契約設計

`cardstudio_visual_contract` 用 create/read/validate/patch；工具實際 schema 是權威。至少有識別版本、contract revision、stable character ID 與完整六表情：`neutral`、`happy`、`angry`、`sad`、`embarrassed`、`surprised`。outfit、pose、scene、location、lighting 可擴充，但不要把沒有素材與需求的全部維度相乘。

以下是 state 設計語義例，欄位與版本值應以工具讀出的契約核對：

```json
{
  "schemaVersion": 1,
  "contractRevision": 3,
  "sequence": 12,
  "mode": "patch",
  "characters": {
    "maliyah": {"expression": "embarrassed"}
  }
}
```

不是輸出 `C:\\synthetic-assets\\portrait.png`、URL、script、selector，也不是以模糊比對修正表情。提示詞說「只輸合法值」不能代替 validator；未知 character、非法 enum、錯誤版本／型別、stale sequence、過大 payload 均需實際拒絕或回傳明確 diagnostic。

Missing／null／reset 與 patch／snapshot 依上面的實作契約處理，不混成空字串。不接受舊 contractRevision；多角色使用明確 stable ID，非法輸出依 validator 回退，不推測另一個角色或模糊對應素材。

## 素材與對映

`cardstudio_asset` 僅管理 GUI 使用者選擇且已准入的 validated PNG/JPEG/WebP raster bytes。模型用 asset ID；Plugin 維護 assetId→digest→immutable blob。禁止傳任意 filesystem path、UNC、file://、URL、SVG 或 HTML 來 import。把 base64 字串看成圖片不夠，必須由實際 tool 驗證 raster bytes 與尺寸／大小限制。

匯入六張預製表情圖，再將合法 variant 對映到回傳 asset ID。不得猜 digest、真路徑或虛構 asset。Link/unlink 修改對映，不覆寫 immutable blob。來源／授權資訊與作者意圖保留；外部圖片不會自動永久可用，不能把未准入的外部 URL 當可靠本地素材。

固定 resolver 順序：完整合法 variant 的有效 asset → 該角色 neutral 有效 asset → 產品 placeholder＋diagnostic。非法 state 不成為任意檔名；驗證失敗不靠 fuzzy 修正或 URL 回退。主動檢查六表情 coverage、neutral 缺圖、wrong asset type、已 unlink 與 rollback 後 refs。

切換前先 decode/preload；保留可用畫面與穩定 aspect-ratio，避免空白閃爍。以 revision／sequence 保證最後合法更新勝出，晚到的圖片結果不能覆蓋新狀態。多角色／scene 各自有 stable ID；手機以有限圖區與可換行版面呈現，不以巨大圖片淹沒互動內容。

## Runtime 不是自動相容

原生 ST expressions 使用 joy／anger／sadness／embarrassment／surprise 等 labels，固定 snapshot 預設 fallback 為 joy，expression-set 有 fuzzy 行為；不同於此產品的六 enum 與 neutral 回退。需另建 target adapter 明確對映，不因 ST 有 sprites 就聲稱本契約可以直接執行。[來源 S8](primary-sources.md)

現有 Agnes image 工具的已知介面是文字生成。本技能不宣稱 reference-image 差分可用，不修改正式 Agnes 工具，不為切換 state 呼叫生圖 API。先用合成無害或使用者合法預製素材走通 import／mapping／Preview，真實模型對話與目標 runtime 測試另行區分。
