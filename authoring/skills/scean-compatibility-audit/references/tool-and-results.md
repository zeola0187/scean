# 工具與結果

真工具：`scean_compatibility_audit`。唯讀、確定性、無額外模型。

```json
{"document_id":"<current selected saved ID>","expected_revision":4,"baseline_revision":2,"cases":[{"id":"lamp-without-night","playerInput":"lamp","expect":[{"entry_id":"id:7","selected":false}]},{"id":"lamp-at-night","playerInput":"lamp night","expect":[{"entry_id":"id:7","selected":true}]}]}
```

`baseline_revision` 與 `cases` 可省略。最多 64 scenarios、64 KiB；預期必須用實際 `lorebook_list_entries` 穩定 ID。只可稽核當前 Session 選中卡；不接受路徑、任意卡 JSON、外部 URL。讀取前後驗 Session/cwd/live lease/generation/選中文件/revision/hash。changed/stale/unavailable 是工具錯誤，不能拿舊報告宣告新 revision 通過。舊 Runtime 缺方法時停在明確 unavailable。

每個結果包括 `itemID/status/objectID/layer/program/observed/reason/reproduce/correction`。六狀態用法：

|狀態|工程例子|
|---|---|
|PASS|真 selector 在明列情境中命中該條；或 validator 拒絕合成越界負例，與預期一致。|
|FAIL|保存初值超出宣告 min/max；來源 hash 漂移；明列前端參照不存在。|
|WARN|同 revision 比較顯示刪除 number 約束改自由字串；僅列差異，作者偏好不 FAIL。|
|UNSUPPORTED|use_regex、EJS/MVU／JS 依賴或 recursive_scanning 欄位無 Runtime 執行支援。|
|NOT_TESTED|無可證明情境預期、未真渲染、未隔離測 Memory、未正式遊玩。|
|NOT_APPLICABLE|無世界書條目、未宣告 Blueprint、無可辨識專屬前端。|

結果的 `counts` 只統計工程證據，沒有「全卡品質分數」或正式 ready Gate。包含原始文本的工具輸出仍屬私人資料；報告不得推進公開 repo。
