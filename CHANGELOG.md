# Changelog

## 1.5.0 — 2026-10-19

- Card Studio editor A: clearer selected working card, saved state and primary edit/play actions, with technical identity details in expandable areas.
- Stage-to-Studio diagnosis bound to an exact Run, immutable Snapshot, source revision and separate current edit target.
- Bounded Agent diagnostic reads with explicit scopes and revocation, distinct missing/failed/denied evidence and protected private context. Diagnosis and repair consent stay in the same controlled Session without fixed elapsed-time expiry; legacy timed grants are never silently upgraded.
- Natural discussion followed by fresh explicit human consent; existing edit tools preserve constraints and check expectedRevision before saving.
- New-version play uses the existing opening flow with durable receipt recovery; old Runs and Snapshots remain unchanged.
- Actual-model synthetic full-loop acceptance and offline exception tests completed. Source-missing cases remain read-only; complete historical working-copy recovery, old-Run migration and Hot Reload are not included. Physical phone and Safari validation remain outstanding.

Earlier 1.4.x releases and their published tags remain unchanged.
