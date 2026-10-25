# W29 第二階段 Runtime 接口（隔離候選）

本版新增七日日曆、角色論壇及日記基礎接口。未正式安裝，沒有真模型驗收；不變更已封版第一階段的唯一時間權威。

## 開啟與來源

新 Run 的固定 Snapshot 可宣告 `worldRoutineDefinition`：`{schemaVersion:1,calendar:true,forum:true,medium:{id:'local-board',label:'符合世界設定的公共交流媒介'},authorIds:[角色ID]}`。已保存卡片的 `data.extensions.scean.worldRoutineDefinition` 由既有 handoff 路徑轉入 Snapshot。沒有宣告就不建立背景根資料。`authorIds` 可省略而使用 roster；媒介缺失、無可用角色、角色拒絕皆有明確狀態，不能假造貼文達成數量。

唯一可寫時間仍為 `run.storyClock`，State 時間是投影。日曆模型透過 Stat 路由，只提未規劃日期的公共事件；Host 驗證七日窗口與簡單公開條件，儲存不可變計畫，再於正文前依 Clock 結算開始、結束或未知條件。公告未來計畫與已發生結果分開。背景計畫不可倒填已過去的事件結果，不可排私人行程、寫 State 或 Clock。

## 論壇與回流

每個實際進入的故事日建立待辦。Host 選符合條件且較少發文的角色；Character 自行選主題、文字、立場，可拒絕。每角色每日最多一主文；預設目標是一篇而非全員每天發文。每天最多三次不同角色主文機會、兩次留言機會，含失敗，避免拒絕或服務故障造成無限工作。留言可跨日接續，並保留原文與來源。

Director、Character、Single Writer 的現有上下文路徑增加本地有界檢索：最多三項、3600 字元，附作者、故事位置及來源 hash。論壇只是角色聲稱，不自動寫成世界事實或 Memory。背景角色沿用既有公共卡片投影、自己的角色 State 與截點前最近八項合法 Memory；不新增 embedding 派送。讀不到的文章不表示它不存在。私人日記不進論壇或 RP 檢索。

## 調度、恢復與容量

`worldRoutinePulse` 一次最多三次模型生成，全 Runtime 同時一個背景工作；模型等待期間不占 Run 寫入鎖。正文優先；提交前核對 epoch、來源截點、父文、Clock／head 及輸入 hash。過期結果保留明確狀態，不發布。失敗不無限自動重試；`worldRoutineRetry` 顯式恢復，單工作最多兩次。prepared 結果可在重啟後不重新生成地提交，未知提交先讀 canonical receipt。

正常跨日依序保留每日待辦；長跳最多 366 日，每 pulse 仍最多三次，不把摘要當實際發文。尚未生成的歷史待辦保持可見；日曆僅規劃目前向後七日，過去缺口不冒稱已完成。每篇最多十二則留言；所有既有 v9 節點與大小上限保持原值。候選引用、來源重放、完整匯出／還原及回滾驗證保留。Activity 使用有完整內容 hash 的 append checkpoint；日曆出版集合使用內容定址引用，保留必要歷史。

## Runtime actions 與日記

授權 Host actions：`worldRoutineRead`（status/calendar/forum/thread/search）、`worldRoutinePulse`、`worldRoutineRetry`、`diaryRequest`。讀取不觸發模型或發文。此輪提供 Runtime API，未新增前端論壇畫面。可用 `worldRoutineRead` 的 thread cursor 讀取完整討論，不把有界 RP 檢索當全文頁。

日記共用背景工作與來源基建，但保留 `kind:diary` 與私有讀取權限。`diaryRequest` 只接受顯式請求；`automaticDiaryFrequency` 保持 null，未設定每日或劇情事件頻率。日記僅 player_backstage 且具私有診斷權限可讀，不授予角色全知。

尚未提供計畫取消／改期工作流，也不靠自然語言事件名稱推斷通訊媒介可用性；可用 authored public State binding 明確設定。這些屬後續產品擴充，不能從模型輸出悄悄新增權限。模型自然語言品質、實際路由和線上服務錯誤恢復須另經授權真模型驗收。
