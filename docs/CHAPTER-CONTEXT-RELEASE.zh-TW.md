> 1.3.0 的模型、Key 與三個全域開關已改由「舞臺全域設定」操作，見 [新設定指南](GLOBAL-CHAPTER-SETTINGS.zh-TW.md)。本頁手動 YAML／環境變數說明保留為舊版相容記錄；3＋8 與來源契約仍適用。

# SCEAN 1.2.1：每輪 3＋8 章節上下文

本版依 2026-10-18 使用者定案調整：固定最近 3 個有效章節摘要，較早章節
經 BM25、向量、RRF 合併及 rerank 選最多 8 章，去重後與全部未摘要原文
一起送給 Director。Draft 使用相同選集。Director 的 `search_history` /
`read_history` 保留按需呼叫；CR、Prose、PostStat 不會取得整個章節檢索封包。
舊 rolling 資料與備份仍相容，新模式不重複注入 rolling。

## 自動分章與成本

沿用既有 Aventuras 式分析器，預設累積估算 16000 tokens 才檢查分章，
保護最近 6 回合；門檻可設 4000–32000、緩衝可設 0–50 回合。這是
分章工作的觸發設定，不限制 Director 的輸入量。每個已成功提交的故事
回合之後，最多啟動一個有界分章工作：分析最多 50 回合／200000 bytes，
只能選合法已提交且在緩衝之外的自然終點，之後產生該章結構化摘要。
未達門檻不呼叫分章分析；找不到自然終點時沿用既有冷卻規則，沒有
每輪強迫切章，也不額外產生另一份 rolling 摘要。

3+8 模式另有逐回合檢索成本：有較舊章節時，冷快取會分批向量化舊章，
每輪向量化玩家查詢並呼叫一次 rerank。最近三章固定帶入，不參與這次
舊章檢索。沒有舊章時不呼叫 embedding 或 rerank。費用沿既有用量紀錄
登記；此次驗收全部用合成資料與 scripted transport，外部付費生成與
embedding 均為 0。初次啟用、重啟後重新啟用與重建快取都可能增加用量。

## 資料與選取契約

`core/chapter-recall.mjs` 是獨立章節索引，不把角色 Memory 當成章節資料。
先檢查 Run、public_story/public、current/completed、章版本、摘要版本、
producing operation、完整 commit 範圍與內容 hash，排除退休／跨 Run／失效
資料後才建立 BM25 corpus 或送向量服務。只索引獨立 `chapterSummaries`。

最近 3 章按時間固定；舊章候選各取 BM25 前 40（正分）與向量 cosine 前 40，
以 `1/(60+rank)` 做 RRF，前 24 個候選的完整摘要交 rerank。
rerank 必須回覆所有候選合法且不重複的 index/score；正分最多取 8，
沒有相關結果或資料不足不填滿。3 章與 8 章來源互斥；額外章按 rerank 排序，
固定章按時間排序，保留來源章／摘要 ID、版本、起訖 commit 與 hash。
這些是明示的檢索候選數量，不是 Token 配額。

快取 key 包含模型、Run、章／摘要版本、來源 hash 與文字 hash；不寫入
portable save。回退／重新生成清除該 Run cache；每次召回亦清掉失效來源。
每輪保留有界的向量快照，共用 512 筆快取淘汰不會破壞正在進行的召回。
既有 portable schema 最多 128 章，達結構上限會明示拒絕，不以裁剪偽裝成功。
取消、逾時、重啟或晚到結果不能恢復舊章。備份恢復使用合法章節重建冷索引。
章節沒有有效摘要的所有原文（包括舊手動章的缺口）仍完整帶入，不只留尾端 6 輪。

## 沒有平台 Token 預算或自動裁剪

使用者已取消平台自訂 Token 配額。`budgetStage` 名稱保留供舊介面相容，
現在只做 Stage 合法欄位／ACL 邊界、結構安全與估算診斷。

- 不再用 32768 fallback 拒絕或裁剪，未知能力記為 unknown。
- 不刪低優先世界書、已選 Memory、章節、必要事實或未摘要原文。
- 不扣掉整個最大輸出預留量製造輸入配額；已選 3＋最多8 章全部交付。
- 取消歷史工具累計 6000 estimated tokens 配額；保留最多 3 次工具呼叫、
  Read 每次 12000 字元／鄰接各 1 回合等資料與迴圈界限。
- 保留 16MiB 授權封包的傳輸結構安全界限、canonical Run／備份容量限制，
  以及單次章節／rolling 壓縮 50 turns／200000 bytes 的有界工作量。
  既有 canonical Run 上限仍是 1000 turns，不宣稱無限歷史。

DSH 0.2.1-rc.2 `dsh-llm/lib/index.js` 的能力資料只有總 `contextWindow`，
`defaultMaxTokens` 是生成預設，不是最大輸出預留或輸入配額。
Native `prepareCall` 的有效設定與 provider 實際限制仍是權威。
估算只會顯示可能超限；不是 tokenizer，也不能精確預判 provider 拒絕。
真正超過硬上限時記錄安全錯誤，故事、State、Memory 不半提交；不重送
無限次、不剪內容假裝成功。生成長度設定不代表要求模型每次輸出最長文章。

## 正式接線與啟用

有生產 adapter，並非只有測試替身：

- 章節向量使用既有 `createOpenRouterEmbedding` 的 OpenRouter／Nebius
  `qwen/qwen3-embedding-8b` HTTP adapter。沿用既有 `OpenRouter API Key`
  環境設定，UsageLedger case 為 `native-scean-chapter-embedding`。
- rerank 使用既有 `createNativeModelPort`，新增 `chapter_rerank` stage，
  沿用 DSH 當前模型選擇；也可透過既有 `stageModelSelections` 指定。
  UsageLedger、GenerationGate、原生模型路由／實際上限錯誤處理保留。
- `chapterEmbeddingEnabled` 可單獨開章節向量，無須啟用角色 Memory 向量。
  舊 `enableExistingEmbedding:true` 也可提供已存在的向量能力。

作者在 SCEAN Host 的既有配置入口明示：

```yaml
chapterModelsEnabled: true
chapterRetrievalEnabled: true
chapterEmbeddingEnabled: true
```

然後玩家在自動分章區勾選 3＋8 上下文並保存，才授權本次啟動／本 Run。
既有 Run 不會自動開啟付費功能；普通 RP 仍可沿用舊路徑。
缺向量／rerank 設定會清楚拒絕啟用；embedding／rerank 失敗會顯示狀態，
不把 BM25 降級冒充完整三路。查明服務／設定後，由玩家明示重試。

本輪用真實生產 adapter 搭 scripted HTTP／DSH transport 驗收，未讀真模型憑證、
未呼叫付費生成或外部 embedding。真服務連通與模型品質 **NOT_TESTED**。
若目前沒有既有 API Key／DSH 模型選擇，必須先由作者配置；安裝不代建服務
或憑證，也不擅自更新現役 Profile 或私人 Run。

## 安裝、驗收與回復

私有倉庫首頁 URL：`[private source locator retained separately]`，不帶分支 ref，
使用所有者既有 GitHub 權限。根 bundle 一次安裝 Runtime 與 Studio；不需
手工組裝第二個插件。新版本 tag `v1.2.1`，保留舊 Release/tag 與原來源。
實際首頁 URL 安裝／鎖定 SHA、資產 SHA256 與遠端讀回，以新 Release 的
安裝回執為準，不能只由上傳 Release 推斷安裝成功。

完整測試、source/runtime byte 比對與環境失敗見
`docs/chapter-context-evidence/verification.json`。固定基線與前一版
`c04aa40` 的證據保留；那版全局 rolling／50-turn Writer fallback 的設計已被
本次使用者定案取代。`docs/DIRECTOR-CHAPTER-RECALL-AUDIT.zh-TW.md` 的
自用 0.8 來源限制仍適用；本版 3＋8 是使用者的明確契約，不冒稱已驗回
自用 0.8 完整原碼。

回復時正常安裝保留的舊 tag／固定 SHA；不 forcepush、不改寫既有 tag。
新模式不改 State／Memory 權威或備份 schema；既有完整私人備份仍由使用者
保管，測試與發布不讀取私人 RP。
