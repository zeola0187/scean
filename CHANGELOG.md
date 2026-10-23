# 1.6.0 — 2026-10-24

- Card Studio 固定對話工作卡、完整 Preset 獨立保存與版本衝突保護；檢查後保存固定劇本，選擇或另開演出。
- 還原創作入口／工作台與書架分組；章節摘要統一到原文向後分頁；保留舊演出來源相容。
- 桌面與手機頂部可收合、輸入區自適應、三個操作在右側；收合左右欄釋放正文寬度。
- 三頁共用可保存的 SCEAN 底色；原生對話只顯示創作入口與舞臺，其他工作區和插件維持獨立。
- 限制與實測範圍見 docs/RELEASE-1.6.0.zh-TW.md。未進行新正式安裝或付費模型驗收。

## 開發候選：章節與上下文整合（未發布）

## 1.5.0 — 書架與 Card Studio 純讀閱覽補充

- 新增本輪協作公開紀錄與本人固定 Snapshot 完整世界書閱覽。
- 動態面板保存後可在聊天回合尾按需預覽，固定當次 Revision。
- 保留既有 Agent 公私投影、正文／State／Memory 提交與模型階段；未加入 Research Logging Mode。


- 單一持久開關接通自動命名摘要及 Director／Writer 3＋8 章節上下文，避免重複注入已摘要原文。
- 約 16k token 章界、軟性近期緩衝、有界超長場景歸檔及明確失敗原文保留。
- 保留世界書、State、私密投影、模型路由及原子提交；不含 post_stat 階段恢復。

# Changelog

## 1.5.0 main player experience — 2026-10-21

- Keep successful notifications briefly, preserve manual reading positions, and recover committed-body reads independently from generation.
- Add optional five-direction ideas, public Snapshot worldbook reading and valid chapter recap navigation.
- Preview and explicitly apply a saved working-card presentation to an eligible existing story, using separate durable presentation revisions without changing story data.
- Make the saved per-story automatic chapter-summary preference authoritative, default it ON only for new stories, and separate optional recall services from summary generation.
- Summarize oversized existing chapters through bounded UTF-8/context-aware batches and one final merge; retain source identities, usage, cancellation, failure and idempotent publication.
- Preserve Single Writer, privacy, final-body hashes and atomic State/Memory transactions. No post-stat recovery, worldbook hot reload, paid acceptance calls or production RP data changes. See [player guide](docs/PLAYER-EXPERIENCE-20261021.zh-TW.md).

## 1.5.0 main fixes — 2026-10-20

- Recover the first Stage-to-Studio diagnosis handoff and same-Session reopening when no complete editor view was cached. Keep drafts and source identities separate from display recovery.
- Keep explicit diagnosis consent, status and revocation responsive while the working card loads. Pending consent blocks duplicate presses; denied requests remain visible and retryable.
- Retain read-only Snapshot diagnosis when the selected source is missing, with the existing scope, consent and revision controls unchanged.
- Add synthetic UI/RPC, touch, keyboard, delayed-response, denial and recovery regressions. The installed fixes were checked on existing Sessions and confirmed usable by the user; physical Safari and model-semantic acceptance are not claimed. Existing fixture and primary-machine baseline failures remain visible.
- Keep package version 1.5.0 and existing tags; no new GitHub Release. See [repair notes](docs/W02-REPAIRS-20261020.zh-TW.md).

## 1.5.0 — 2026-10-19

- Card Studio editor A: clearer selected working card, saved state and primary edit/play actions, with technical identity details in expandable areas.
- Stage-to-Studio diagnosis bound to an exact Run, immutable Snapshot, source revision and separate current edit target.
- Bounded Agent diagnostic reads with explicit scopes and revocation, distinct missing/failed/denied evidence and protected private context. Diagnosis and repair consent stay in the same controlled Session without fixed elapsed-time expiry; legacy timed grants are never silently upgraded.
- Natural discussion followed by fresh explicit human consent; existing edit tools preserve constraints and check expectedRevision before saving.
- New-version play uses the existing opening flow with durable receipt recovery; old Runs and Snapshots remain unchanged.
- Actual-model synthetic full-loop acceptance and offline exception tests completed. Source-missing cases remain read-only; complete historical working-copy recovery, old-Run migration and Hot Reload are not included. Physical phone and Safari validation remain outstanding.

Earlier 1.4.x releases and their published tags remain unchanged.
