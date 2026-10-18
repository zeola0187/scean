# PNG / APNG 保全

來源：[SillyTavern 官方 PNG parser](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/character-card-parser.js#L49-L78)、[CCv3 PNG/APNG 規範](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md#pngapng)。核對日期：2026-10-04。

在 ST 的實作中，角色 JSON 以 UTF-8 → Base64 存於 PNG `tEXt` chunk，V2 關鍵字是 `chara`，V3 是 `ccv3`。依 SillyTavern 1.19.0 已核對的 reader，關鍵字不分大小寫，先選第一個 `ccv3` tEXt，沒有則選第一個 `chara` tEXt；不能因第一份無法驗證就偷偷改選另一份。不要將 PNG 直接當普通 JSON 文字讀寫。

先建立原始 chunk 清單，以區塊索引辨識主資料與其他版本。重複或不同內容會顯示相容提醒，依上述酒館規則使用主資料，其他區塊保留原始 bytes，不自動合併、同步覆寫或刪除。主區塊須通過格式驗證；無法解析的副區塊只作不執行的原始資料保留並提示，所有區塊的 CRC 與 PNG 結構仍須有效。此流程不建立或轉換另一個版本。

既有 `character_book: null` 原樣保留，讀取時視為沒有世界書。不要為了匯入而清空其他世界書結構；明確新增條目時才建立世界書。

圖片保全是本地編輯要求：保留所有非目標 chunk 的原始 bytes 與顺序，包括 `IHDR`、`IDAT`、色彩、透明度、其他 metadata 及 APNG 動畫 chunk。只更新指定角色 chunk，重新計算其 CRC，不重新繪製或壓縮圖像。保留另存副本。

完成後重新解析輸出；檢查 payload JSON、UTF-8、Base64、chunk 长度及 CRC。比較所有非目標 chunk 的雜湊，尤其是圖片及動畫資料；不能只看畫面近似就判定保全成功。

從 PNG 匯出的 JSON 只包含選定主資料，不含副區塊。JSON 副本不包含原 PNG 圖片；若只交付 JSON 或文字草稿，明確標示圖片仍在原始 PNG，尚未產出可匯入的 PNG 新版。
