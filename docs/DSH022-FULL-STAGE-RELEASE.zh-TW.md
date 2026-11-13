# DSH 0.2.2 完整舞台安裝候選

版本 `1.6.4-local.w29.2d.rc3.1.dsh022.2`，獨立 guard `0.1.0-local.4`。目前只在本機準備，沒有合併、推送、標籤、Release 或 Latest 變更。

## 與 PR #1 的差異

以公開相容提交 `62bc2bb151ac969956b6a1b064554c564f95dc78` 為基礎，補回已部署舞台的章節召回、協作讀取、PostStat 時間入口及失敗後目前模型設定重做修補。原有版本准入、NativeExecutor 驗證與獨立 guard 保留。

最近 3 篇有效摘要固定帶入；有效舊章最多 8 篇時全部納入，不啟動 embedding 或 rerank。超過 8 篇沿用有界混合檢索。只使用已提交的公開場景組裝 query，保留來源身份及容量失敗診斷。

協作讀取器只針對 `post-body-v1` 接受合法省略的逐項引用；有提供引用時仍檢查型別。時間入口文字不改變結算規則。明確重試保留原模型 pin，新提交才採用目前設定。不修改故事 schema、正文、State／Clock 權威、私人資料權限或既有模型工作授權。

目前模型／故事生成的核心修補與正式部署來源逐檔比對。生成 clients 由相同 canonical 輸入重建；來源連結、版本與發布文件屬本候選的預期差異。沒有從正式 Profile、故事、資料庫或憑證取材。

## 打包與安裝界線

Suite 包含 Runtime 與 Studio；guard 為獨立安裝包，不自動加入 Suite。guard 只核對 DSH 0.2.2-rc.1 的精確 adapter 指紋，保留呼叫者與模型明確設定的輸出限制。空白 config 不啟動付費驗證。

固定 TGZ、完整 source ZIP、SHA256SUMS 與 detached receipt 在發布授權前只保存在隔離目錄。首頁草稿清楚標示未發布的下載連結；沒有用舊 Latest 冒充新版。

乾淨安裝使用全新依賴目錄、全新 DSH home／Profile 和合成資料。不得對正式服務執行安裝，不啟動會改寫 `dsh://` 的封裝 Desktop，也不使用私人正式故事測試。此輪沒有付費模型授權。

## 未驗與發布鎖定

尚未公開下載，因此「從 GitHub 下載後安裝」須在日後明確授權發布、核對遠端附件 SHA 後再驗證。主力機實際路徑、宿主版本、現有故事及重啟仍需現場核對。沒有宣稱新的真模型、跨版本舊 reader、手機或 WAN 驗收。

保留歷史 legacy fixture 與缺少 timecal3／timecal4 reader 的明確測試排除。舊 W29 發布專用測試記錄其原版指紋，不能當成本版的發布通過證明。本版使用當前 release-support、license-distribution、完整可用核心／作者測試及乾淨安裝證據。

最終報告須分列：離線測試、fresh frozen-lockfile 安裝、本機 TGZ 安裝／重載、SDK／模型 mock 邊界、實際未驗項目與公開操作所需授權。`release-source.json` 的公開驗證旗標在授權前保持 false。

## 本次續驗

完整回歸為 1,717 通過、2 跳過。原本一次競態失敗已用真實檔案系統重現：非阻塞 bakery lock 在交錯進入時，兩個請求都可回覆 `RUN_BUSY`。原測試誤要求一定有一個立即成功。本次僅修正測試契約並加入固定交錯案例；20 次驗證均確認初次零寫入、明確重試僅提交一次、舊預覽被拒、故事正文位元不變。沒有修改正式鎖或 PresentationHost 行為。

新增本機來源驗證器：`python scripts/check-prepared-source.py --receipt <固定版本-source-receipt.json> --repository <此 Git 工作樹>`。它核對所有附件的大小與 SHA256、完整 source ZIP 與 manifest、每個檔案對應提交的 Git blob，以及七處固定版本來源入口；7 項測試涵蓋錯誤目標、過時版本標示、路徑逸出與雜湊錯誤。此工具不連線，不會把本機通過視為已公開取得。

乾淨安裝的 Web 介面已實際看到舞台與 Studio 的 AGPL 來源入口，目標均為本候選固定標籤；Studio 過時的 1.5.0 標示已改為 SCEAN 通用標示。尚未點開公開目標，來源公開證據旗標保持 false。公開來源 HOLD 仍需在另行授權發布後，匿名取得精確標籤與附件、核對 SHA256，並驗證已安裝介面的連結確實到達同版公開來源。

真實封裝 Desktop 仍需獨立作業系統的 Sandbox／VM 驗收。原封裝會註冊 `dsh://`，單獨指定 DSH_HOME 與 userData 不會隔離宿主 HKCU 協定。因此不得在有既有 DSH 的主力機直接假設路徑隔離足夠。應在乾淨客體中使用原封裝、唯讀映射經雜湊核對的套件、停用網路與剪貼簿，驗證 About、安裝、舞台／Studio、合成資料保存與重開；不要映射宿主正式 Profile、故事或金鑰。本次未啟動封裝 Desktop、未修改協定、安全設定或正式資料。
