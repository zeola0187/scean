# SCEAN 1.5.0

SCEAN combines native Card Studio authoring with saved story openings, dynamic
card fronts, durable story operations, independent reading sidebars and chapter
memory. Original SCEAN material is **AGPL-3.0-only**; the existing
advanced-tavern-card-authoring Skill retains its MIT grant. See [LICENSE](LICENSE),
[scope](LICENSE-SCOPE.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

**完整對應原碼／Source:** https://github.com/zeola0187/scean/tree/main

## 2026-10-21：Single Writer 與文風切換

新／未設定故事預設採單一 Writer；已明確保存的舊流程維持原選擇。本局文風可匯入、下拉選擇或自由改寫，從下一新請求生效，重試與既有資料保持原值。公開版只附原創方法與通用能力，不包含私人第三方文風包。使用方式、驗證與限制見 [本批說明](docs/WRITER-MAIN-20261021.zh-TW.md)。

## 1.5.0：Card Studio 診斷回修

編輯室方案 A 與舞臺診斷閉環：檢查這局 → 和 AI 討論 → 明確同意修卡 → 保存新版 → 用新版另開局。來源身份、明確範圍讀取、expectedRevision與開局回執均有核對。診斷與修卡同意沒有固定倒數，僅限同一受控對話、對象與範圍，直到你撤銷或生命週期失效；不跨重啟繼承舊授權。來源缺失暫採唯讀；實體手機與Safari仍待驗收。

2026-10-20 main 修正首次診斷進入／重開，以及工作卡載入時無法操作診斷授權；使用者已回報可用。詳細測試邊界見 [修正說明](docs/W02-REPAIRS-20261020.zh-TW.md)。

詳見 [玩家操作與工具契約](docs/W02-USER-GUIDE.zh-TW.md) 與 [Changelog](CHANGELOG.md)。本次更新公開main分支，不另建立GitHub Release；舊標籤維持原內容。

## 安裝與更新

在 DSH 的插件／bundle 安裝介面輸入本倉庫主頁網址：

`https://github.com/zeola0187/scean`

無需分支、私有 GitHub token 或 runtime build。套件身分保留為
`@local/dsh-scean-suite`、`@local/dsh-scean`、
`@local/dsh-card-studio-scean-test`，三者版本同步為 1.5.0。
最後一個歷史名稱保留以維持既有工作區及升級相容性。
從先前 1.3.0 使用 DSH 更新操作；舊鎖檔固定的私人 commit 不屬於新的
公開歷史，不能把重建舊鎖檔當成取得本公開版本的方法。

支援已核對的 DSH 0.2.0-rc.2、0.2.1-rc.1、0.2.1-rc.2；Node.js 24+，
目前套件平台為 Windows。保留卡片、Run、Profile 與模型工作授權邊界；
安裝或設定頁不授權付費生成。先在獨立 Profile 驗證，不覆寫現役資料。

## 從原碼重建

Python 3.11+、Node.js 24+；確定性 client build 不需安裝依賴或網路：

```text
python scripts/build-candidate.py
python tests/release-support.test.py -v
python tests/license-distribution.test.py -v
python scripts/package-candidate.py --output NEW_INSTALL_DIRECTORY
python tools/export-clean.py --source . --output NEW_SOURCE_DIRECTORY --zip NEW_SOURCE.zip
```

修改 `sources/card-studio/cardstudio-bundle` 的 canonical Studio source，以及
`isolated/web`／`plugin` player source；重新生成 clients，勿合併生成檔。
`EXPORT-MANIFEST.json` 固定白名單位元；SDK、測試輸出、私人資料和 Git
歷史不會由導出工具帶入。已封存原碼若有修改，須先更新並審核白名單。

離線 SDK 回歸額外需要自行取得並核對的 DSH app.asar，SDK 不隨本案分發：

```text
python scripts/prepare-test-sdk.py --asar PATH_TO_REVIEWED_APP_ASAR
node --require ./scripts/w19-offline-network.cjs --test tests/*.test.mjs
node --require ./scripts/w19-offline-network.cjs --test authoring/tests/*.test.mjs
```

[驗收與限制](docs/VALIDATION.md)、[W19 安全邊界](docs/W19-SECURITY.md)、
[全域章節設定](docs/GLOBAL-CHAPTER-SETTINGS.zh-TW.md)、
[3＋8 召回](docs/CHAPTER-CONTEXT-RELEASE.zh-TW.md)、
[原碼取得](SOURCE-AVAILABILITY.md)。原生 Desktop、實體手機／WAN、
真模型文學品質未因合成測試通過而宣稱完成。原八項主機限制仍保留。

## 1.4.1

主角名稱可設通用預設並在每局覆寫；舊局可補名一次，僅影響後續生成。
本版亦整合舞臺入口對齊及可還原的素材回收。
有姓名的故事使用 v4 備份；降版須配對還原升級前 runtime 與資料，
不可讓舊版寫入較新的姓名／v4 資料。詳見 [姓名與升級說明](docs/PLAYER-NAME.zh-TW.md)。

## 1.4.2

緊湊閱讀版面、邊緣側欄標籤與單一設定入口，將空間留給正文。
卡片動態面板跟在最新有效正文之後；每局保留一份面板，W01 與 Snapshot 契約不變。
RP 七個階段沿用該 provider／model 的 DSH 輸出預設，背景摘要與章節額度保持原樣。
詳見[閱讀介面與輸出設定](docs/READER-AND-RP-OUTPUT.zh-TW.md)。升級前備份資料，等待回合與保存結束後，使用 DSH 官方停用、卸載與安裝流程。
