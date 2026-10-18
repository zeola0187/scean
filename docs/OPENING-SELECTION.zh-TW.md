# 正式舞臺選開場（功能分支候選）

版本：`1.3.1-opening-selection.1`。基線：`f2d7e78693cfb8d82b7e4f52c5f09f1436d4e77d`（v1.3.0）。未部署、未合併 main、未 Release。

## 使用方式

1. Card Studio 選取並保存角色卡，展開「SCEAN 舞台測試與唯讀 Inspector」，確認名冊後按「交接已保存 r… 到舞臺／開新故事」。
2. 多個有效開場時，舞臺顯示「選擇新故事的開場」；選主開場或替代開場，預覽後按「以此開場建立新故事」。取消不建立 Run。只有一個非空開場時直接使用；空白主開場略過，替代開場保留原索引。全部空白會要求回 Studio 保存。
3. 已有故事可在舞臺書架按「用目前故事的保存版本另開新局」，重新選另一個開場。這會使用原保存版本的卡、世界書、Preset 與名冊，建立獨立 Run。
4. 切換既有 Run 只是繼續原故事。卡片保存版本若已變更，舊選項及舊版本的另開請求會拒絕；請回 Studio 交接新版本。

## 契約與限制

- 正式 Studio 所有交接都進入 `SceanHost.startFromStudio()`；有效 CC 卡有多開場時先建立待選記錄，尚無 Run。正式舞臺的通用 `create` 仍拒絕客戶端自帶 Snapshot。
- 舞臺只傳待選 ID、卡片 ID、revision、Snapshot hash 及原始 openingIndex。Host 再讀目前 Session／選卡／generation／保存 revision／卡片雜湊；客戶端不能提供開場正文或改寫卡片。
- 待選記錄在 Host 記憶體內保留 10 分鐘；取消、過期、重新交接、切卡或更新版本後，舊選項不能開局。Host 重啟後待選記錄失效，可重新交接或從符合目前版本的既有故事另開；既有 Run 不受影響。
- 同一選擇重試使用固定 Run ID；並行點擊、送出後回應遺失或已受理後取消不會建立重複 Run。已受理的開局會完成保存；重試查回同一故事。
- `snapshot.opening` 固定所選開場，`sources.selectedOpening` 明確優先。完整卡及其他開場仍保存為來源；Director 明確把未選開場視為可能情境，不能當成已發生事件。`group_only_greetings` 不列入本次單局開場。
- 沒有修改正式卡、既有 Run、Profile、安裝或開場白 Skill，也沒有加入多開場編輯器。

## 驗證與建置

見 `OPENING-SELECTION-VALIDATION.json`。新增 Host／實際 Studio Loader-Control／共用 UI／跨 Run 渲染測試，涵蓋單、多、空主開場，非法／過期／跨卡／跨版本選擇，新 revision、舊 Run、取消、回應遺失及重試。

GUI 使用實際產生的 native iframe、正式 Studio Loader-Control 與 Host-Core-Store，外層 DSH React／Session 掛載為合成測試介面；已實際操作 Chrome 與 390px iframe。正式 DSH 視窗、真手機及真實模型未測。瀏覽器截圖擷取逾時，GUI 證據為實際操作、可見文字與 DOM 尺寸。

重建：`python scripts/build-candidate.py --stage=build-suite-source-opening-check`。使用已整合的 canonical Studio 與 player source；生成的 runtime 必須逐檔相符，不需歷史 overlay 腳本。

## 與配色／側欄分支整合

本分支未讀寫其工作區或採用未提交成果。可能同檔衝突：`isolated/web/app.mjs`、`isolated/web/index.html`、`plugin/player-native-bridge.mjs`、`packages/studio/client-template.js`，以及生成的 `plugin/client.js`、`packages/scean/plugin/client.js`、`packages/studio/client.js`。新樣式獨立在 `isolated/web/opening-selection.css`。

整合時先合併來源與 overlay；依合併後的確切前置檔案重算新增 overlay 的 base hash，再重建生成檔。保留既有歷史 overlay／Skill 雜湊檢查，不直接拼接生成檔。
