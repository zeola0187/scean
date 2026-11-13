# SCEAN 舞台 v2 · DSH Desktop 預覽版使用說明

預覽版是一份獨立的 DSH Desktop 複本，裝好了新版 SCEAN。它和你平常用的 DSH 完全分開：

- 不讀寫 `E:\DSH`，也不讀寫 `C:\Users\USER\.dsh`（正式設定、插件、作品與存檔）。
- 可以和正式 DSH **同時開著**，各自有自己的視窗與資料。
- 預覽複本移除了自動更新設定，不會自己升級，也不會動到正式安裝。

所有東西都在 `E:\SCEAN-work\dsh-desktop-preview\`：

| 位置 | 內容 |
|---|---|
| `SCEAN-preview-user.cmd` | **雙擊啟動預覽版** |
| `app\` | DSH Desktop 0.2.2-rc.3 的複本（不含更新設定） |
| `user\home\` | 預覽版的 DSH 資料：對話、作品、演出、模型設定 |
| `user\userdata\` | 預覽版的視窗與瀏覽器資料 |
| `packages\*.tgz` | 預覽用的 SCEAN 套件，版本號帶 `stagev2-<提交>` |
| `stage-next-desk-*\` | 我做自動驗收用的測試環境（合成資料，可刪） |

## 第一次使用

1. 雙擊 `SCEAN-preview-user.cmd`。
2. **設定模型**：預覽版沒有你的帳號或 API key，請在預覽版的設定裡登入或填入 key。之後的模型呼叫會用你的帳號、照常計費；自動驗收沒有發出任何付費請求。
3. **帶入角色卡**：在預覽版按「創作入口」→「使用現有角色卡」，匯入 PNG／JSON。正式 DSH 裡的作品和演出不會自動出現在預覽版。
4. **每張 Seed 卡用一個創作對話**：要做另一部作品，按「開始新作品」，它會開一個新的創作對話。同一張 Seed 的不同劇本版本都留在同一個對話裡；舞台會標出「最新」和保存時間。

## 新版與舊版舞台

- **從新版切到舊版**：舞台右上「⋯」→「顯示設定」→「切換到舊版舞台」。
- **從舊版切回新版**：舊版舞台設定區的「改用新版舞台」。
- 兩者讀寫同一份演出資料；在一邊送出的回合，另一邊也看得到。
- 進階設定（模型分派、摘要、文風、禁用詞、備份、診斷）目前仍在舊版。

## 更新預覽版

我之後提交新修改時，關掉預覽版，在 `E:\SCEAN-work\scean-p0` 執行：

```bash
node scripts/desktop-preview.mjs pack
```

```bash
node scripts/desktop-preview.mjs update --label=user
```

更新只換 SCEAN 套件，你的對話、作品和演出都保留。預覽版開著時，`update` 會拒絕執行。

## 回復與移除

- **只是不想用**：不要再啟動預覽版就好，正式 DSH 不受影響。
- **完全移除**：關掉預覽版後，刪除 `E:\SCEAN-work\dsh-desktop-preview\`。要保留預覽期間的作品或演出，先備份 `user\home\`。
- **回到上一個預覽套件**：`packages\` 會保留每次打包的 tgz；用 `update --label=user --tgz=<檔案>` 指定舊檔。

## 裝進正式 DSH（尚未執行，需要你決定）

正式 DSH 目前從 GitHub 發行版安裝 SCEAN。如果之後想直接在正式環境使用新版：

1. 先備份 `C:\Users\USER\.dsh\profiles\desktop\package.json` 與 `pnpm-lock.yaml`。
2. 在正式 DSH 的插件管理裡，把 `@local/dsh-scean-suite` 換成 `packages\` 裡的預覽 tgz。
3. **回復**：還原上面兩個檔案，或把套件來源改回原本的發行版網址，然後重新啟動 DSH。

**相容性注意**：

- 使用時段名稱（`label`）的作品，以及文字以「/」開頭（例如單位 `/24`）的演出，只能由這一版或更新版開啟。
- 匯出這類存檔後，舊版 SCEAN 會拒絕匯入，因為舊版會把它們當成檔案路徑。
- 一般作品與演出沒有這個限制。
