# SCEAN 1.0.2 / DSH 0.2.1-rc.2

The accepted source baseline is 1.0.1 commit `893d6ff75e051ca879768e85d6a62c6a3ffede89`. Validation below uses the actual official rc.2 Windows binaries and SDK, with synthetic data and provider responses. v1.0.0 and the accepted 1.0.1 branch remain historical; this revision is delivered on its own private branch.

The suite/SCEAN version is 1.0.2 and Studio is 1.2.0-scean.6. The exact support set is 0.2.0-rc.2, 0.2.1-rc.1 and 0.2.1-rc.2. Future/unknown versions remain rejected without an exemption. Product code, Skills, model routing, CR, PostStat, State, Memory, snapshot and card scope are unchanged from accepted 1.0.1; Studio generated clients change only version strings.

The official Windows rc.2 installer was obtained from the [installed updater's official feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml), with the exact SHA512 verified and Authenticode status Valid for Hangzhou DeepSeek Artificial Intelligence Co., Ltd. The installer was not executed. Its embedded 7z archive was unpacked into a task-only directory using an official hash-verified portable extraction tool.

- Installer SHA256: `72e4a8579f11b5428dd0a1506532777924adba7ecaacc710a7e429085796537f`.
- Desktop EXE SHA256: `9c789407850773ce7d914a3ec0476852bf1ceea69789d8ccf4e39be953f4bf52`, signature Valid, FileVersion 0.2.1-rc.2.
- app.asar SHA256: `47874618bf5b3011fcaac10cd4c85f69da333e70d4f99b921207c78d0999512a`.
- Embedded build commit: `332895e0f7c9d4dbfb29729f5eb367fa263ff986`.
- 11,644 SDK/runtime files extracted with per-file ASAR integrity checks.

The actual shipped compiled entries for app-boot, api-gateway, client-connection, typert-protocol, typert-registry, llm and llm-deepseek are byte-identical to the reviewed rc.1 binaries; their manifests identify rc.2. This binary observation is separate from the earlier public release-tag source comparison. No new Peer implementation change is needed. The current 1.0.1 manifests were first tested as a negative control against the actual rc.2 loader and rejected at all three package boundaries.

[Official rc.2 notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2) announce DeepSeek-V4.1-Flash-1017 and optional DeepSeek Search/Fetch APIs. The shipped model catalog retains wire ID `deepseek-flash`; a separate client plugin adds the 1017 badge. Capability lookup uses SDK metadata without authentication or transport dispatch. The reviewed catalog advertises 1,000,000 context tokens, 256,000 default maximum output tokens, addition-only tool updates and in-history system-prompt updates; SCEAN retains its smaller stage output limits and rejects unsupported reasoning before dispatch. Offline synthetic SSE tests exercise the real Messages adapter and route without contacting a provider. These are catalog and protocol facts, not measured model quality or a new model-ID guarantee for arbitrary gateways.

## Validation

| Check | Result |
|---|---|
| Full SCEAN suite, actual rc.2 SDK | 555/555 pass, including three new offline model capability/routing/negative cases |
| Focused rc.1 regression | 32/32 pass: Peer/version guards, real adapter, capacity, card scope and Audit |
| Retained 0.2.0-rc.2 SDK compatibility | 8/8 pass; no old Desktop boot |
| Actual registered Skill/tools/Audit, rc.2 SDK | 12/12 pass across ten synthetic card classes and authority failures |
| Source rebuild | 176/176 packaged runtime files exact |
| Actual rc.2 PluginManager cold install | 185/185 initial candidate files exact, no skipped bundle or exemption |
| Synthetic upgrade and restore | 1.0.1 to 1.0.2; user fixture data unchanged; exact restore; concurrent drift refused; upgraded copy retained |
| Actual signed rc.2 Desktop + separate home/userData | Studio 1.2.0-scean.6 ready, 9 Skills and 27 tools advertised |
| GUI card/save/bind/Audit/handoff | original synthetic card saved r3; Audit FAIL 0; matching saved hash frozen in a new Run |
| GUI RP and persistence | State and Memory commit on turn 1; normal exit 0/restart preserves canonical bytes; turn 2 commits |
| GUI cancel/error/retry | cancel and synthetic PostStat failure preserve turn-2 canonical bytes and unlock input; retry commits turn/Memory 3 |
| Source preservation | 913 prior tracked files exact; product runtime changes are Studio version strings and package metadata |

The GUI is controlled by CUA Chrome connected to the actual isolated rc.2 Desktop Host. The running Electron app reports version 0.2.1-rc.2, unpacked resources path and task-only userData; its native windows are hidden. No native input automation is claimed. Fixed snapshot/card-scope and cross-session negatives also run in the full suite. The synthetic generic adapter error appears as `model / UNKNOWN`; it is an intentional failure fixture, and the no-partial-commit and input-recovery checks pass.

All validation uses independent data roots and synthetic cards/Runs. The active user installation is not updated, restarted or modified. No real model, Search/Fetch or embedding API is invoked. Real-model semantics are NOT_RUN. Existing roster-draft refresh and UI readability/navigation debts remain outside this revision. Final exact-SHA remote install and reproducible archive results are recorded in the delivery receipt after publication; these are separate from the initial GUI candidate's document bytes.

Use the explicit branch `[private source locator retained separately]#fix/dsh-0.2.1-rc2-compat`, preferably the exact verified commit from the delivery receipt. Check the installed version and resolved lock commit. Preserve current package/Profile snapshots and separately back up user data before a user-managed installation. Never restore an older full data snapshot over newer cards, Runs or Sessions, and never restore deliberately quarantined test data. A synthetic restore rehearsal is not authorization to modify the live Profile.
