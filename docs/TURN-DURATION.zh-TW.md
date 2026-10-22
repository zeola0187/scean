# 整輪耗時

舞臺頂端的保存狀態下方顯示一行時間。生成中為「生成中 01:32」；只有 canonical Commit 回執驗證成功且有完整終點時間，才固定為「本輪用時 03:21」。失敗、取消、中止、結果待確認與退役各有不同文字。詳盡 stage 時間仍在診斷內。

## 計時邊界

- 使用 Host 持久化 operation 的 `acceptedAt` 到 `finishedAt`：包含接受後的排程、Director、所有工具及 Character、Writer、驗證、post_stat、提交及 Host 收尾確認；不以 stage 時間加總。
- 不包含瀏覽器送達 Host 前的網路／草稿保存等待，也不包含提交後另行排程的章節摘要、索引或回顧。
- 這是一個玩家操作（operation）的耗時，不是整個對話／Run 的累計，也不是單一模型 request。一般回合與 regenerate 使用同一邊界。
- 顯式重試沿用 requestId，但產生新的 operation／attempt，從新接受時間起算；不把玩家停頓或前次失敗時間相加。SDK 內的工具循環／技術重試仍在同一次 operation 中。
- regenerate 的候選生成／驗證不是正式成功；只有原子替換已由 canonical operation receipt 證實才顯示完成。

## 刷新與異常

`operationStatus.generationTiming` 只投影 Run／operation／request／attempt 身分、操作種類、狀態與 Host 時間，不輸出 Prompt、正文、私密內容或用量。刷新／重連讀同一 operation；瀏覽器僅在兩次讀取間依 Host 時間和單調本機經過時間更新，裝置時鐘偏差不會改寫耗時。切 Run 及新操作先清掉舊顯示，已有的選擇／ownership 防止過期讀取換到別局。

連線中斷時顯示「結果待確認」，不把客戶端斷線當成伺服器失敗；Host 終態有時間時停止增加。未知提交日後以唯讀 canonical receipt 確認，沿用原操作記錄的終點，不重送模型。若 Host 在保存終點前中斷，即使重啟後找到成功回執，也只顯示「本輪已保存 · 耗時未記錄」；不以重啟時間冒充提交時間。舊 operation 有完整既有時間戳可直接顯示，沒有則保持缺失資訊，不補造歷史。

後續背景章節工作或設定操作可改變操作狀態欄，但不能延長上一輪已固定的生成時間。回退後原生成回執退役，計時亦明示退役。

本功能不改故事資料、模型路由、Prompt、文風、Character 私密投影或 post_stat 交易。實作／合成驗證不代表真實手機或模型品質驗收；部署與外部推送另行授權。
