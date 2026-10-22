# 刪除與恢復遊玩副本

書架的每一筆遊玩副本是獨立 Run。按該列「刪除副本」，確認後移入書架的「回收區」。當前副本移入後回到書架，不自動開局；可返回 Card Studio，從來源卡交接已保存版本另開新局。

在回收區按「恢復」並確認，即恢復同一 Run 與進度，不自動切入或送出回合。來源卡、其他 Run、固定 Snapshot、世界書、正文、State、Memory、章節摘要、文風及展示設定均不刪除。此功能沒有永久清除，也不釋放正文占用的磁碟空間。

## 保護與結果確認

- 生成、post_stat、Commit、章節／摘要背景工作及保存尚在執行時拒絕刪除，不強制取消。未確認的提交結果、未完成 attempt 或摘要操作也須先釐清。
- 刪除與恢復使用與正文提交相同的 canonical Run writer lock，並排除獨立文風／工作模式保存的競態。移入後，Store 普通讀取與提交會拒絕該 Run；不是僅從前端列表隱藏。
- 請求固定 `operationId`，核對故事 `expectedVersion`、`expectedHead` 與獨立的 `expectedLifecycleRevision`。恢復後舊頁面的寫入須重新讀取才能操作；重複舊刪除回執不會再刪一次已恢復 Run。
- 網路錯誤或回執遺失時顯示未知結果，可按「查回結果」唯讀核對。只在玩家明確重試時重用同一 operationId，不自動重送寫入。刷新後以 Host 的書架／回收區為準；原生 iframe 不保證保留尚未確認的頁面內操作提示。
- Inspector binding 及診斷授權在刪除時撤銷，恢復不重新啟用舊授權。原保存草稿保留；取消確認不改草稿。其他仍開著的舊頁面若被拒絕，先保留其未保存文字，再重新整理讀取狀態。

## 資料與介面契約

`current.json` 保留原有聚合，新增 Host 本機生命週期欄位 `recycle`：schemaVersion、revision、active／trashed、changedAt 與冪等操作回執。生命週期原子替換不增加故事 version、不改 head 或 updatedAt，不改寫舊正文交易；一般 canonical commit 也不能覆蓋此欄位。

新增的正式操作為 `runRecycleList`、`runLifecycleStatus`、`runTrash`、`runRestore`，只沿用已驗證玩家 UI 的 operator 與卡片身份範圍。回收列表僅給顯示與衝突核對資料；不把完整私人故事放入回收 API。不新增 Card Studio Agent 工具、任意檔案能力、私人診斷授權或模型呼叫。

生命週期與完整內容在同一 Run 檔發布；Host 列表及 binding 清理為可重建資料。原子 rename 後若回執遺失，讀回同一回執確認成功；讀回也失敗才回報未知。保留最多 1024 次生命週期操作，超過時拒絕新操作，不偷偷移除冪等記錄。

## 相容性與部署

既有 Run 無此欄位時視為 active，不需遷移。恢復保留原 UUID、正文交易、Snapshot 與設定 sidecar。可攜故事備份不含本機回收 metadata；同 UUID 的備份不可覆蓋回收中的 Run。此版與既有 Single Writer、計時、章節上下文、書架閱讀器及 Studio 重連修復共存。

舊二進位未理解此生命週期，不提供跨版本／同資料根目錄的舊 Host 並行寫入保證。若日後要降版，應先在支援版本恢復所有回收副本、備份最新資料並正常關閉所有 Host，再依部署流程處理；不要讓舊程式直接管理回收中的 Run。

測試採合成 Store、scripted 模型及獨立 DSH Profile 的實際原生播放器。scripted 成功不代表正式手機實玩或真模型品質。此功能候選沒有安裝、推送、Release、關機或改動正式遊玩資料。
