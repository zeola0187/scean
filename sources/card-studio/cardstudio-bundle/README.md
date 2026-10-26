> 1.6.2-local.w29.2d.rc3.2: TIME_TOOL declaration-only repair on the public RC3.1 baseline. Source branch: https://github.com/zeola0187/scean/tree/fix/time-tool-contract-20261026. No new tag, Release page or assets. This backport excludes separate local timecal.1 calendar/display fixes and all nlruntime experiments; it is not the full local timecal.2 installation package.

# SCEAN Studio 1.5.0

Native authoring bundle for the SCEAN suite. The stable package identity
@local/dsh-card-studio-scean-test is retained for compatibility. Nine active
Skills include scean-opening-authoring 1.0.0. Retired Arcamage and Palette bodies
are excluded; user-local files are not deleted or rewritten during activation.

Original SCEAN code and Skills: AGPL-3.0-only. The independently authored
advanced-tavern-card-authoring directory retains its complete MIT grant in
skills/advanced-tavern-card-authoring/SOURCE.txt. Preserve all notices.

Source: https://github.com/zeola0187/scean/tree/main
Install/update the complete suite from https://github.com/zeola0187/scean
Build and regression commands live at the full source checkout root; installed
component packages have no historical standalone build scripts. Existing
Session, Content/Full scope, revision CAS, Snapshot and author-confirmation
contracts remain. No new Runtime or host enforcement is introduced by the Skill.

## 1.4.1

主角名稱可設通用預設並在每局覆寫；舊局可補名一次，僅影響後續生成。
本版亦整合舞臺入口對齊及可還原的素材回收。
有姓名的故事使用 v4 備份；降版須配對還原升級前 runtime 與資料，
不可讓舊版寫入較新的姓名／v4 資料。詳見 [完整來源與升級說明](https://github.com/zeola0187/scean/blob/v1.4.2/docs/PLAYER-NAME.zh-TW.md)。

## 1.4.2

緊湊閱讀版面、邊緣側欄標籤與單一設定入口，將空間留給正文。
卡片動態面板跟在最新有效正文之後；每局保留一份面板，W01 與 Snapshot 契約不變。
RP 七個階段沿用該 provider／model 的 DSH 輸出預設，背景摘要與章節額度保持原樣。
詳見[閱讀介面與輸出設定](https://github.com/zeola0187/scean/blob/v1.4.2/docs/READER-AND-RP-OUTPUT.zh-TW.md)。升級前備份資料，等待回合與保存結束後，使用 DSH 官方停用、卸載與安裝流程。
