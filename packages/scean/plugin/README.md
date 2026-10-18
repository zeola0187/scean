# SCEAN native plugin

This directory is part of the project-root package `@local/dsh-scean` 0.2.0, targeting Desktop **0.2.0-rc.2**. It is not a DSHRuntime update. The package must include `core/`, `adapters/`, and `plugin/` at the same level. Do not install this directory alone.

## Package metadata

The root package exports `.` as `./plugin/index.js`, `./client` as `./plugin/client.js`, and `./package.json`. Set `dsh.bundle.patch` to `./plugin/cordis.patch.yml`; `dsh.client` is `{ "platform":"web", "immediately":true, "inject":["@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-layout"] }`. Peer `@deepseek-ai/dsh-typert-protocol` must be 0.2.0-rc.2. This source-mode client is plain JavaScript; no build framework or browser credential is required.

## Isolation and configuration

- Package `@local/dsh-scean`; service/RPC `scean`; panel `local-scean`; dock `local-scean-entry`.
- `dataRoot` defaults to the new `~/.dsh/scean-mvp-0.2.0`, with `store/` for canonical runs, `host/` for read-only inspection grants, and `runtime-status.json` for non-private load evidence.
- `usagePath` defaults to `dataRoot/usage-r2.jsonl`. The historical `budgetPath` is ignored; historical ledgers cannot be appended. No monetary reservation or cost cap remains.
- Native generation uses existing `ctx.llm` authentication for `deepseek-official/deepseek-flash`. No key is read or exposed by the native model adapter. No model call occurs during load.
- `enableExistingEmbedding: true` enables only the existing OpenRouter environment configuration through the shared adapter. Missing existing credential fails plugin initialization; false/omitted explicitly exposes degraded BM25-only memory rather than claiming hybrid success. No new persistent credential is installed.
- Prose defaults to 8192 tokens; other stages default to 4096. `stageMaxTokens` overrides global `maxTokens`, which overrides stage defaults. Incomplete/truncated output fails closed. Hidden reasoning chunks are discarded. Usage is recorded; unavailable actual cost is null. No automatic retries.

The native port explicitly sets `reasoningEffort:'off'`; only `deepseek-official` and `deepseek-flash` / its existing `deepseek-v4-flash` alias are accepted. Configured output limits are integers from 1 to the verified provider ceiling 384000; this is not unlimited output. See `docs/model-r2.md` in the source project for official specification and fixed SDK evidence.

### Native retry accounting verification

The formal `dsh-llm` 0.2.0-rc.2 implementation at `lib/index.js:2367` calls `streamWithRegistration`, then the `llm/stream` waterfall and `adapterStream`; its iteration dispatches one adapter stream and converts errors to terminal chunks, without retrying. The formal `dsh-llm-retry/lib/index.js:175` registers only `ctx.on('agent/request-error', ...)`, **not** `llm/stream`; SCEAN's native port does not create an Agent loop or emit that event. Independent read-only ASAR verification found SHA-256 `cbb99f1c5038e4a9167aedf333343cb3e3adfb5c9f45a37ef7562b024429d050` for that retry implementation, package 0.2.0-rc.2. DeepSeek's adapter has one replacement attempt for a stale attached-file id; SCEAN sends only one text user message with no file/image blocks or replay history, so that recovery is inapplicable. Thus the fixed formal text-only native path makes one generation HTTP attempt per ledger reservation; this conclusion must be rechecked before supporting attachment inputs or a new Runtime/middleware version. No global provider retry or security setting is changed.

## Operation

Open **SCEAN 舞台** from the conversation dock. Select a saved run or paste a complete saved snapshot in the independent JSON form. Submit player text, cancel a pending turn, inspect source snapshot/state/memory/attempt trace, or maintain the mechanical BanList. UI unmount/panel switching does not cancel RP; explicit Cancel or unloading SCEAN cancels its own active work. The Studio test-copy return button targets `local-cardstudio-scean` and never changes the native authoring Session.

Studio's human-only, lease-validated adapter calls `ctx.scean.startFromStudio({snapshot,authoringSessionId,generation,signal})`. It receives `{runId,binding}`. `inspectFromStudio` requires the same run/session/exact generation (including Studio's UUID generation) and unexpired random binding; it is read-only. `attachInspection({runId,priorBinding,authoringSessionId,generation})` explicitly renews a still-valid same-session grant after page generation changes. Grants last 24 hours and remain independent of RP cancellation. They are not exposed through the public generic request action. UI navigation can dispatch `CustomEvent('scean:open',{detail:{runId}})` then select `local-scean`.

The generic SCEAN RPC verifies `ctx.invocation.peer` is the formal Connection's operator Peer (Gateway's operator only in the in-process test composition). Direct unscoped service calls and forged peers are refused; no Agent tools or commands expose these actions. The authenticated human operator can inspect their SCEAN runs through SCEAN's own panel; Studio uses only its binding-scoped adapter. DSH's formal Connection has one operator identity, not a per-plugin security sandbox: an already trusted installed plugin is not isolated from other host services. This boundary is verified with the actual formal Typert Gateway, not asserted from a comment. Late Inspector responses are tied to the selected Run and selection epoch, preventing an older Run's state from appearing under a new Run's identity.

On startup `store.listRuns()` reconstructs the UI run index from canonical aggregates. A crash after canonical creation but before host metadata publication therefore leaves a discoverable run. The core aggregate remains authoritative; host indices and inspection grants do not become gameplay truth.

## Disable, remove, recover

Use the project receipt-checked upgrade/rollback procedure. Leave pre-existing CardStudio 1.2.0, its data and Runtime payloads untouched. Disabling SCEAN does not delete data. Reinstall using the same dataRoot/usagePath to reload canonical commits and grants. Never distribute runtime data, credentials or production Sessions with plugin packages. The acceptance report distinguishes offline/native SDK checks from actual Desktop UI evidence.
