# 合成資料的工具驗收

僅在已授權的隔離工作區／Profile 做此流程，不接付費模型、不用私人卡、正式 Profile 或既有正式 Run。下面是為此 Skill 自行撰寫的觀測手帳例子，沒有作品必須採用此介面或敘事的意思。文件中的 payload 只是測試輸入，執行後才有測試結果。

## 建立候選

先以現有 Studio 工具建立／選取合成卡，取得實際 document_id 及 revision。此例只用 world scope，不更動角色 roster 或來源綁定。記錄未修改前的卡資料，以便證明保存沒有碰到角色、開場白及未知 extension。

下列四段依序作為 `blueprint`、`initial_state`、`derived_facts`、`frontend`；第三段是獨立 Host 規則。不要把這些工具參數名直接當作卡片 extension 欄位名。

```json
{
  "schemaVersion": 1,
  "id": "field-notebook",
  "version": 1,
  "extensionPolicy": "deny",
  "variables": [
    {"scope":"world","category":"resources","key":"charge","displayName":"電量","type":"number","min":0,"max":100,"visibility":"public"},
    {"scope":"world","category":"facts","key":"sky","displayName":"天空","type":"enum","enumValues":["clear","cloudy"],"visibility":"public"},
    {"scope":"world","category":"facts","key":"privateNote","displayName":"PRIVATE_LABEL_CANARY","type":"string","visibility":"restricted"}
  ]
}
```

```json
{
  "schemaVersion": 1,
  "blueprintId": "field-notebook",
  "blueprintVersion": 1,
  "values": [
    {"scope":"world","category":"resources","key":"charge","value":62,"source":{"id":"synthetic-notebook","version":1}},
    {"scope":"world","category":"facts","key":"sky","value":"clear","source":{"id":"synthetic-notebook","version":1}},
    {"scope":"world","category":"facts","key":"privateNote","value":"PRIVATE_VALUE_CANARY","source":{"id":"synthetic-notebook","version":1}}
  ]
}
```

```json
{
  "schemaVersion": 1,
  "id": "notebook-rules",
  "version": 1,
  "bindings": [
    {"alias":"charge","target":{"scope":"world","category":"resources","key":"charge"},"type":"number"},
    {"alias":"sky","target":{"scope":"world","category":"facts","key":"sky"},"type":"enum"}
  ],
  "facts": [
    {"id":"measurement-ready","name":"量測條件","description":"公開電量至少25且天空為clear；只描述已儲存條件，不代表任何角色已採取行動。","provideToWriter":false,"expression":{"op":"and","args":[{"op":"gte","args":[{"ref":"charge"},{"literal":25}]},{"op":"eq","args":[{"ref":"sky"},{"literal":"clear"}]}]}}
  ]
}
```

```json
{
  "schemaVersion": 1,
  "id": "notebook-panel",
  "runtime": {"profile":"scean-html-bindings-v1","apiMajor":1},
  "html": "<article class=\"notebook\"><h2>觀測手帳</h2><p>電量 <strong data-scean-text=\"charge\"></strong></p><progress max=\"100\" data-scean-progress=\"charge\"></progress><p>天空 <span data-scean-text=\"sky\"></span></p><p class=\"indicator\" data-scean-state=\"measurementReady\">量測條件：<span data-scean-text=\"measurementReady\"></span></p><p data-scean-when=\"lowCharge\">公開電量低於25</p><details><summary>讀值說明</summary><p>此頁只顯示已知資料。</p></details></article>",
  "css": ".notebook{padding:20px;background:#edf4ec;color:#173d32;border-radius:12px}.indicator{padding:12px}.scean-true{background:#c2e6c5}.scean-false{background:#efc9a6}.scean-unknown,.scean-unavailable,.scean-stale{background:#d6d5cb}@media (max-width:600px){.notebook{padding:12px}}",
  "bindings": [
    {"alias":"charge","target":{"scope":"world","category":"resources","key":"charge"},"type":"number"},
    {"alias":"sky","target":{"scope":"world","category":"facts","key":"sky"},"type":"enum"}
  ],
  "derivedBindings": [{"alias":"measurementReady","factId":"measurement-ready"}],
  "conditions": {"lowCharge":{"op":"lt","args":[{"ref":"charge"},{"literal":25}]}},
  "capabilities": {"network":"none","worldActions":[],"derivedDisplays":[]}
}
```

## 實際執行與可觀察結果

1. dynamic_read 取得當前版；對上述同一組候選呼叫 dynamic_validate、dynamic_preview。驗證成功、source 為 authoring-initial-state-not-runtime；projection 的 charge 為 known 62、sky 為 known clear、measurementReady 為 known true。預覽產生 scean-true，lowCharge 區塊隱藏；公開投影與渲染輸出不得出現兩個 PRIVATE canary。觀察 JSON／HTML 和實際 GUI 要分開標示。
2. Full Scope 下 dynamic_save 帶最新 expected_revision 及四份候選；dynamic_read／card_read 讀回新 revision、frontend.hash、derivedFacts.hash，確認原角色、開場白、其他 extension 沒有變。保存後再次 dynamic_preview，與候選預覽相符。
3. 從讀回 frontend.hash 用 dynamic_patch 改 HTML 中唯一 `觀測手帳` 為 `觀測手帳・修訂`；再讀回確認只改該文字且 hash/revision 更新。用舊 revision 與舊 hash 分別嘗試重複 patch，預期 REVISION_CONFLICT 與 FRONTEND_SOURCE_CONFLICT；失敗不得新增 revision。
4. 僅在預覽候選移除 charge 初值：charge 應 unknown，measurementReady 不能被視為 true。改為合法 0 仍是 known 0、規則 false；改 sky 為 cloudy 時規則 false。恢復原始合成候選，不拿測試修改覆蓋作者資料。
5. 若另外獲准走隔離人類 handoff，記錄卡 revision／Snapshot hash／新 Run ID，確認新 Run 固定該套件；再保存一個新 revision，舊 Run hash 不變。沒有走此流程就標手動 handoff／實際 Runtime GUI 為 NOT_TESTED。不要為完成這一步使用正式 Profile 或 paid model。

## 逐一拒絕案例

以候選副本每次只改一項；優先呼叫不保存的 dynamic_validate。每項都記錄實際 code 與保存 revision 未改變，不能只讀文件推定通過。

| 單一變更 | 既有拒絕契約 |
| --- | --- |
| binding.target.key 改成 absent | FRONTEND_BINDING_MISSING |
| 加入 privateNote 的 string binding | FRONTEND_BINDING_UNAUTHORIZED |
| charge binding.type 改成 string | FRONTEND_BINDING_TYPE |
| charge 初值改為字串 `"62"` | BLUEPRINT_VALUE_RANGE |
| conditions 的 not 接 charge number | FRONTEND_EXPRESSION_TYPE |
| derivedBindings.factId 改成 absent | FRONTEND_DERIVED_MISSING |
| facts.expression 改引用 privateNote 並加入其 binding | DERIVED_BINDING_UNAUTHORIZED |
| HTML 加 script、img、iframe、onclick 或 style | FRONTEND_HTML_UNSUPPORTED 或 FRONTEND_ATTRIBUTE_UNSUPPORTED，按實際輸入記錄 |
| CSS 改成 `.notebook{background:url(https://invalid.example)}` 或 var()／position:fixed／@import | FRONTEND_CSS_UNSUPPORTED |
| capabilities.worldActions 改為非空陣列 | FRONTEND_CAPABILITY_UNSUPPORTED |
| 過期 expected_revision 保存／patch | REVISION_CONFLICT |
| 目前 revision 搭配舊 frontend.hash patch | FRONTEND_SOURCE_CONFLICT |
| old_text 不存在或出現兩次 | FRONTEND_PATCH |

Host 規則是否送進 Writer 的額外驗收必須使用 Scripted Model 及真實 model port 截取，在合成副本將 provideToWriter 設 true，確認只在 Director/Draft 收到已 Commit 來源包，Prose/PostStat 沒有該包，且沒有新增 State／Memory。不得把前端燈號當作此證據。真模型語意始終獨立標示；未接真模型即 NOT_TESTED。

可供維護者在原始碼 checkout 使用的既有測試：`node --test tests/w01-frontend.test.mjs tests/w01-renderer.test.mjs tests/w01-studio.test.mjs tests/w01-derived-studio.test.mjs tests/w01-derived-facts.test.mjs`。這不是卡片 Agent 的 shell／檔案權限；要在獲准施工環境由維護者執行。引用測試時附命令、實際結果、日期與基準，不把測試檔存在當作本輪已測。
