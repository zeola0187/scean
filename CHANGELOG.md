# Changelog

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
