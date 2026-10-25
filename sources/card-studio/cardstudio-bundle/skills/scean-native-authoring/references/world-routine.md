# W29：新卡時間、七日日曆與論壇

保存位置是 `data.extensions.scean`。用現有 `card_patch_fields` 精確保存 `extensions`，保留其他 extension，再 `read` 核對保存版本；只在描述文字寫「啟用論壇」不會生效。送出前由既有準備／固定劇本流程建立 Snapshot，Host 建新 Run 時驗證及固定設定。舊 Run 不會套用新卡 revision。

時間可省略（故事第 1 日、日精度），或設定 `storyTimeDefinition` schemaVersion=1：calendar、hoursPerDay、minutesPerHour、periods、initial。支援 relative 與 fixed-month；不能把電腦日期當故事日期。公共固定事件可用 `publicEvents`。讀日曆不會推進 Clock。

原角色論壇／公共七日規劃：

```json
{"schemaVersion":1,"calendar":true,"forum":true,"medium":{"id":"local-board","label":"地方論壇"}}
```

新卡額外明確選用路人氣氛主文：

```json
{"schemaVersion":2,"calendar":true,"forum":true,"medium":{"id":"local-board","label":"地方論壇"},"ambientPosts":{"schemaVersion":1,"enabled":true,"publicContext":"只寫此世界可公開的生活背景；不要放角色秘密、私人設定或未發生結果。"}}
```

以上物件寫入 `worldRoutineDefinition`；`authorIds` 可省略表示已保存角色名冊，或明列名冊中的有效角色 ID。`medium.availability` 可選用公開 State 等值條件。沒有合格角色、媒介不可用或條件未知時不補路人文章。

Host 沿既有有界 pulse 邀請最多 3 位合格 Character；至少一位受邀，已選邀請全部有有效明確 decline，且已達 3 位或合格名單用完，才有路人主文機會。queued/running/failed/interrupted/unknown/stale 都不是拒絕。所有路人合計每故事日最多一篇；路人仍可 decline。沿原最多 3 次 pulse，不增加自動續接，因此三次邀請耗盡 pulse 後，路人工作等下一個既有機會，不保證一開舞臺立即完成。

路人使用 Forum 模型設定與臨時網路 ID；不建立 Character、個人記憶、embedding 或路人留言。模型只收到作者明確公開摘要、SourceCut 公共 State／日曆及有界論壇片段；不傳原卡、RP Prompt、角色 owner 記憶或整本世界書。自由文字的語義秘密仍須作者避免放進 publicContext。UI 以中性「路人」標示區別角色上色。Character 可自主回覆或拒絕，不扣其主文額度。

日曆只規劃公共世界事件；未發生計畫與已結算結果分開。論壇言論是有作者、故事時間與來源的主觀聲稱，不會直接成為 State 事實。Director／Character／Writer 透過有界檢索回流，不必玩家先打開論壇，也不會每輪注入所有文章。

設定中「日曆」未指定時繼承 Stat，「論壇」未指定時繼承 Character。指定路由後不偷偷 fallback；工作建立即固定 routePin。玩家閱讀入口在舞臺右面板的日曆／論壇；開啟、切日、翻頁及閱讀皆零模型派送。玩家第一版只讀，無發文管理能力。

日記只有資料結構、Character 背景工作接口和有權限的讀取能力；沒有預設自動生成頻率。不要要求不存在的自動日記或用論壇讀取取得私人日記。

保存：舊策略 schemaVersion=1 維持 v9；新策略使用 worldRoutine schemaVersion=2、`author.kind=character|ambient` 與 save v10 capability `worldRoutine.v2.ambientPosts.v1`。舊讀取器明確拒絕新版本，不遷移舊歷史。300000 nodes／16 MiB 上限不變。
