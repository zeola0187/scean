# SCEAN 1.0.1 compatibility repair

This private repair is based on v1.0.0 commit `99d01ddf123d4e83f47149515c48f3c6c2b497b2`. It supports exactly DSH **0.2.0-rc.2** and **0.2.1-rc.1** on Windows/Node 24. The suite and SCEAN are 1.0.1; integrated Studio is 1.2.0-scean.5. The Native Authoring and Compatibility Audit Skills retain their existing versions and semantics.

## Observed failure and repair

On 2026-10-17 UTC, the updater downloaded 0.2.1-rc.1 at 08:30:12, wrote installer/update metadata at 08:31:22–25, and created the replacement EXE/ASAR at 08:31:39–40. The replacement Desktop started at 08:31:50. The retained prior Desktop evidence identifies 0.2.0-rc.2. These timestamps establish the update; they do not identify which user interaction initiated it.

The new official loader rejects the old suite and both nested plugins because their declared DSH version is exactly 0.2.0-rc.2. Widening only the outer suite would still leave nested compatibility checks. The new loader gives `engines.dsh` priority; the old loader checks SDK peer dependencies. All three package boundaries therefore declare the same explicit two-version set. There is no compatibility exemption or allow-all range.

After that gate, SCEAN's trusted UI check encounters a real SDK API change: the old `connection.operator` becomes `connection.browserPeer`; the new gateway also removes its old `operatorPeer()` fallback and requires an explicit Peer for RPC dispatch. The product fix accepts the exact authenticated browser Peer from either reviewed API. Foreign owner/API Peers and unscoped requests remain denied. The new SDK test also rejects a disposed Peer.

No changes are made to Director/Draft/Prose, CR, PostStat, Memory, Blueprint, fixed snapshots, atomic commit, card scope, authoring tools, Skill contents, data-root logic or model selection. The source-to-package rebuild preserves the guarded historical Studio overlays and applies version metadata afterward.

## Runtime identity

| Item | 0.2.0-rc.2 | 0.2.1-rc.1 |
|---|---|---|
| Desktop EXE SHA256 | `df4e91fd91f6f1bee19a1990b0e167bfe06abf8353279d82bbb8e60edb6ba0d3` | `a7c289da2f5d9f79a218d4b42fa72469efaacb01b758dc2e22a4d31d02a862f5` |
| app.asar SHA256 | `983ca71114e6dfd353fc79af5a1f9481a250ee64c2a3c757673029b811b23bc2` | `91434162c7b0393110b3c5d3f079c1ab3a33334fa636a104fc5e28d5affa606b` |

The new installed ASAR identifies build commit `ed75efeffee65f9fe93625bbd76a68cb219aaaf9` of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Tests use the SDK bytes extracted from that hash-verified ASAR. Old-version tests use the retained rc.2 SDK subset, without starting an old Desktop.

## Validation and boundaries

| Validation | Result |
|---|---|
| Full SCEAN suite, new rc.1 SDK | 552/552 pass |
| Full SCEAN suite, retained rc.2 SDK | 552/552 pass |
| Integrated Studio source suite, retained rc.2 SDK | 395/395 pass |
| Packaged Skill/tool/Audit integration, new SDK | 12/12 pass |
| Source-to-package runtime rebuild | 176/176 exact |
| Official new PluginManager local cold install | pass; no skipped bundles, no exemption |
| Official new PluginManager synthetic 1.0.0 upgrade | pass; user fixture data unchanged |
| Exact package/Profile restore rehearsal | pass; concurrent drift refused, upgraded copy preserved |
| Actual 0.2.1-rc.1 Desktop with separate home/userData | ready; 9 Skills and 27 tools advertised |
| Synthetic card save/bind/Audit/handoff | saved r3, Audit FAIL 0, fixed-snapshot Run created |
| Committed state and Memory | first turn and normal-restart second turn pass |
| Cancel and synthetic PostStat error | canonical bytes unchanged; input unlocked; successful retry commits turn/Memory 3 |

The GUI actions run through Chrome connected to the isolated current Desktop Host. Read-only inspection of the native Electron renderer confirms its app version, process and loaded plugin entry points. Native input control is unavailable in this environment; stale native capture images are not accepted as visual GUI proof. All model responses are a local scripted fixture. No real provider or embedding request is made. This validates integration and persistence, not real-model narrative quality or long play.

An attempted new-SDK run of legacy Studio tests could not satisfy six old fixture/import assumptions. It is not reported as 395/395 on the new SDK. Current-SDK integration instead uses the installed package, official loader and isolated Desktop workflow above. Historical v1.0.0 validation counts in other baseline documents remain historical.

## Install and recover deliberately

Use the explicit repair branch `[private source locator retained separately]#fix/dsh-0.2.1-compat`, preferably the exact verified commit supplied with the delivery receipt. The homepage/main branch and v1.0.0 tag are intentionally unchanged. Confirm the resolved lockfile commit and installed suite version 1.0.1; a manager `changed` flag by itself does not prove the selected code. Private Git access requires the owner's existing credentials.

This task does not install into, restart or replace the user's active Profile. Keep a current package/Profile snapshot and separately preserve cards, Runs and Sessions before a user-managed change. Never restore an old whole-data snapshot over newer user data, and never restore the deliberately quarantined old test cards/Runs. Close DSH normally before manual package/Profile recovery. The isolated restore rehearsal proves exact byte recovery of its fixture only; it does not certify booting v1.0.0 on the new SDK.

No complete verified old rc.2 Desktop installer was found in the scoped legal backups. A retained SDK subset is not a rollback installer. Other plugins, including AnySearch, remain outside this repair. An upstream package version alone is not evidence that it supports 0.2.1-rc.1.
