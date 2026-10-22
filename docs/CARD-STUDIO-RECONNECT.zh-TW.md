# Card Studio 自動恢復連線

同一對話的編輯畫面與臨時連線租約使用不同的生命週期。連線恢復時不重新掛載編輯器，也不需要匯出卡片、改 UUID 或開新對話。

- acquire、capabilities、renew 最多等待 15 秒，並向正式 RPC 傳遞取消訊號。舊回覆不能覆蓋新的連線 epoch；晚到的 acquire 回執只清理自己的租約。
- 失敗後在可見頁面以 1、2、4、8、16、30 秒上限退避重試；返回前景或 online 事件也可以啟動合法握手。背景頁面不取得新租約。
- 同一對話恢復時保留編輯器 DOM、草稿、游標、IME 與本地編輯 revision。若其他頁已保存新版本，顯示版本差異並保留草稿；不自動覆蓋或保存。
- Host 的 90 秒 page lease、10 分鐘已接納 Agent task、Session／scope／revision 驗證保持不變。封存、刪除或離開工作區需要玩家處理，不繞過授權。
- 恢復連線只處理能力握手，從不重播卡片寫入或「送往舞臺」。開局回執遺失時明示尚未確認，保留 request ID；玩家先核對舞臺，再決定是否以相同請求確認。
- 解除掛載、切 Session 或關頁會取消連線工作及重試計時器；正常換編輯面板不產生持續的全權能力。

核心來源：`sources/card-studio/cardstudio-bundle/lib/client-controller.js`、`client-template.js`。一般錯誤／指引不再將工具暫未註冊描述為卡片損壞或必須搬到新對話。

回歸包含純 controller 時鐘與晚回覆、原生 DSH Tools／Cordis registry、完整隔離 Host、多頁籤及舊卸載回調。`scripts/studio-reconnect-ui-host.mjs` 與 `scripts/test-studio-reconnect-ui.mjs` 僅操作全新合成 profile，用真實 Web UI／RPC 驗證桌面及窄窗，不需要憑證、付費模型或使用者 RP。

修復證明的是已重現的恢復缺口；不代表已證明所有歷史卸載事件的最初觸發原因。實體 Android、真實網路環境及正式安裝後使用仍須與隔離驗收區分。交付狀態、SHA 及部署授權以本次 receipt 為準。
