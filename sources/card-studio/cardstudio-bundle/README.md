# SCEAN 1.6.3-local.w29.2d.rc3.1 — 正文後世界結算

已驗收的 poststat.1 完整成果，目標 DSH 0.2.1-rc.3。
Director 規劃 → Writer 定稿 → PostStat 裁定時間／狀態 → Host 機械驗證與原子提交。
時間可維持時段精度；正文完成後的結算失敗可有界續算，不重寫正文。
新保存格式 v13／續算 sidecar v2 不能直接交給舊 reader；升降版前請保全資料。
[版本下載](https://github.com/zeola0187/scean/releases/tag/v1.6.3-local.w29.2d.rc3.1) · [完整原碼](https://github.com/zeola0187/scean/tree/v1.6.3-local.w29.2d.rc3.1) · [使用與驗收限制](https://github.com/zeola0187/scean/blob/v1.6.3-local.w29.2d.rc3.1/docs/RELEASE-POSTSTAT.zh-TW.md)

以下保留先前版本的功能及相容性說明。

---

# SCEAN Studio 1.5.0

Native authoring bundle for the SCEAN suite. The stable package identity
@local/dsh-card-studio-scean-test is retained for compatibility. Nine active
Skills include scean-opening-authoring 1.0.0. Retired Arcamage and Palette bodies
are excluded; user-local files are not deleted or rewritten during activation.

Original SCEAN code and Skills: AGPL-3.0-only. The independently authored
advanced-tavern-card-authoring directory retains its complete MIT grant in
skills/advanced-tavern-card-authoring/SOURCE.txt. Preserve all notices.

Source: https://github.com/zeola0187/scean/tree/v1.6.3-local.w29.2d.rc3.1
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
