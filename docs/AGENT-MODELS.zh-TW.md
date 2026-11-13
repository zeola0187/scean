# Agent 模型設定（本地候選，尚未安裝）

SCEAN 可以按職責選用 DSH 已有的供應商與模型。本功能不建立供應商、模型、網址或金鑰，也不更改 DSH 本身的預設選擇。

## 操作

1. 開啟「閱讀與舞臺設定」→「舞臺全域設定」→獨立的「Agent 模型」分頁。
2. 分別選擇 Director、Character、Writer、Stat、摘要、靈感的現有模型，或保留「沿用既有預設」。按「保存模型設定」才會寫入。
3. 某局需要不同模型時，開啟「玩家、完整文風與面板」，按「讀取本局 Agent 模型」，選擇覆寫後保存。
4. 設定從下一個新請求生效。生成中、局部修復及同一請求重試都保持原模型；取消或重新讀取不會自動發出生成。

「一般」「Agent 模型」「進階摘要服務」是三個獨立分頁。Agent 模型頁沒有金鑰或新增模型欄位；桌面與手機共用同一套設定及權限規則。

## 職責與繼承

| 設定 | 控制的階段 |
|---|---|
| Director | 全部導演往返 |
| Character | 所有被諮詢角色共用的顧問模型；角色的私人資料仍分開 |
| Writer | 單一 Writer、局部修復；舊流程的 draft/prose/prose_repair |
| Stat | 唯讀裁決 adjudicate 與回合後結算 post_stat；兩者 Prompt 與驗證仍分開 |
| 摘要 | rolling summary、章節分析與章節摘要；長章各批次沿用同一次作業的選擇 |
| 靈感 | 玩家明確要求的獨立單次生成，不自動重試 |

新請求依序採用：本局職責覆寫 → 舊局已保存的階段／共用選擇 → 全域職責預設 → 既有 Host／DSH 預設。介面顯示下一個新請求的路由及來源；清空本局職責覆寫會恢復這條繼承鏈。

章節排序仍由「進階摘要服務」的既有設定管理，Agent 模型頁只說明其來源，不保存第二份排序設定。摘要模型不會覆蓋排序模型。DSH current/model 排序路由同樣在回合開始時固定；既有 HTTP 排序與 embedding 設定不由此功能自動改寫。

## 失效與重試

- 已保存模型不在清單時，介面保留它並標示不可用；保存或呼叫會明確拒絕，不會改成沿用預設。
- 供應商被移除、模型未知、設定無效、推理強度不支援，都不當成暫時性傳輸錯誤重試。
- 暫時性技術重試保留原路由及已準備的有效控制值；每次實際派送仍有獨立用量收據。
- 變更設定不會重選失敗請求的模型。要採新模型，須另送新請求，例如改寫待送出的輸入；若提交結果未知，先查回原請求結果，不能直接以新編號重送。
- 清單與 metadata 可讀不等於真模型連線、工具或 JSON 品質已驗證。

## 實作邊界

模型設定與 request pin 是 Host 本機中繼資料，不是卡片、Prompt 或權威故事狀態。全域設定保存於 `store/settings/agent-models.json`；本局偏好與 pin 在對應 Run 目錄的獨立檔案中。請求 pin 綁定 requestId/operationId、輸入 hash、固定 snapshot、故事版本與 head，損壞或來源改變就拒絕沿用。

原有 request 去重、原子提交、未知結果恢復與取消流程保留。設定只讀與保存不呼叫生成；未被呼叫的 Agent 不會因路由快照而產生額外生成。重播已提交請求仍直接回原收據。

DSH `prepareCall` 用於同一派送的描述、context diagnostics 與 stream；互動 RP 繼承 DSH 模型輸出預設，背景工作保留既有上限。沒有新增 token 配額或模型管理平台。

SCEAN 維持 direct LLM capability，沒有接入 DSH Session System Prompt assembly。請求的 system/messages/tools 深層不可變；其他模型的 Preset、全域助理 Prompt 不因選模而加入。`llm/stream` middleware 仍是 SDK 邊界，不能據此宣稱任意第三方插件都已完成相容性驗收。

用量收據包含 provider/model/stage、request/operation 身份、pin hash 與設定版本；主回合 stage trace 另保存 requested/effective route。背景完整路由可由本機 pin 與 usage journal 對照。未知回應模型與未知費用保持未知，不以 requested model 或 0 代填。舊摘要 provenance 欄位未擴成新的計費／路由資料庫。

Portable save 不攜帶這些本機設定或 pin；匯入故事依本機可用設定選模。舊卡片、正文、Run snapshot、狀態、記憶及 DSH 正式設定沒有遷移寫入。

## 驗證與交付

主要新測試為 `tests/agent-model-routing.test.mjs`；原生 UI 驗收為 `scripts/test-agent-models-ui.mjs`，透過新的合成 DSH profile、兩個 scripted 路由及真正的 native iframe/RPC 執行。Playwright 由 `SCEAN_PLAYWRIGHT_MODULE` 指向既有依賴，不安裝新套件。

本輪精確 commit、測試計數、固定基準比較、UI 證據與剩餘限制記錄在獨立交付報告。真供應商、正式 Desktop、實體手機及正式安裝均不屬於本輪已驗收項目；尚未 push 或 Release。
