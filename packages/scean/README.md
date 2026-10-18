# SCEAN 1.4.0

SCEAN combines native Card Studio authoring with saved story openings, dynamic
card fronts, durable story operations, independent reading sidebars and chapter
memory. Original SCEAN material is **AGPL-3.0-only**; the existing
advanced-tavern-card-authoring Skill retains its MIT grant. See [LICENSE](LICENSE),
[scope](LICENSE-SCOPE.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

**完整對應原碼／Source:** https://github.com/zeola0187/scean/tree/v1.4.0

## 安裝與更新

在 DSH 的插件／bundle 安裝介面輸入本倉庫主頁網址：

`https://github.com/zeola0187/scean`

無需分支、私有 GitHub token 或 runtime build。套件身分保留為
`@local/dsh-scean-suite`、`@local/dsh-scean`、
`@local/dsh-card-studio-scean-test`，三者版本同步為 1.4.0。
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
