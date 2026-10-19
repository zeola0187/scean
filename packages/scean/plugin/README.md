# SCEAN native plugin

This directory is a canonical source of the `@local/dsh-scean-suite` bundle. The canonical builder copies it with `core/` and `adapters/` into `packages/scean`. Do not install this directory alone. This change does not update DSH Runtime; supported SDK versions remain declared in the root package metadata.

## Package metadata

Install the complete Suite through its root `dsh.bundle` declaration. The generated SCEAN client is built from `native-client-source.mjs` and the shared `isolated/web` player. Native Desktop and DSH Web use the same Host model port; never patch generated clients independently.

## Isolation and configuration

- Package `@local/dsh-scean`; service/RPC `scean`; panel `local-scean`; dock `local-scean-entry`.
- `dataRoot` defaults to `~/.dsh/scean-mvp-0.7.1-milestone-d-final`, with canonical `store/`, Host operation metadata and `runtime-status.json`.
- `usagePath` defaults to `dataRoot/usage-a1.jsonl`. The historical `budgetPath` is ignored. Usage journaling does not impose a monetary reservation or token quota.
- Native generation uses existing `ctx.llm` authentication and explicit Run/stage/plugin model routes, otherwise the DSH Profile default. No key is read or exposed by this native port. Model capability lookup is distinct from generation; plugin load does not generate.
- Existing optional embedding configuration is separate. Missing embedding configuration is reported as BM25 degradation; this output-setting change does not enable or call embeddings.
- Interactive RP stages (`director`, `character`, `adjudicate`, `draft`, `prose`, `prose_repair`, `post_stat`) omit `maxTokens` and inherit the exact SDK prepared-call defaults. Former plugin `maxTokens`/`stageMaxTokens` do not override these RP calls. An undisclosed SDK default remains omitted/unknown.
- Native background summary/chapter/rerank calls retain their 4096 defaults and existing explicit overrides. Incomplete/truncated output still fails closed; partial output cannot commit. Hidden reasoning is discarded, unknown actual cost stays null, and technical retries remain disabled by default.

Explicit reasoning follows the selected route; otherwise the SDK resolves the model default and validates support. The historical direct adapter's 384000 constant is not a universal native-provider limit. `route.outputBudget` distinguishes SDK-resolved output from the unknown final provider wire limit, and safe receipts record SDK finish kind. See `docs/READER-AND-RP-OUTPUT.zh-TW.md` for scope and diagnostics.

### Historical native retry accounting verification (0.2.0-rc.2)

The following is retained historical evidence, not a claim that this candidate reran paid requests or updated Runtime. Current 0.2.1-rc.2 prepared-call behavior is covered by the offline SDK tests.

The formal `dsh-llm` 0.2.0-rc.2 implementation at `lib/index.js:2367` calls `streamWithRegistration`, then the `llm/stream` waterfall and `adapterStream`; its iteration dispatches one adapter stream and converts errors to terminal chunks, without retrying. The formal `dsh-llm-retry/lib/index.js:175` registers only `ctx.on('agent/request-error', ...)`, **not** `llm/stream`; SCEAN's native port does not create an Agent loop or emit that event. Independent read-only ASAR verification found SHA-256 `cbb99f1c5038e4a9167aedf333343cb3e3adfb5c9f45a37ef7562b024429d050` for that retry implementation, package 0.2.0-rc.2. DeepSeek's adapter has one replacement attempt for a stale attached-file id; SCEAN sends only one text user message with no file/image blocks or replay history, so that recovery is inapplicable. Thus the fixed formal text-only native path makes one generation HTTP attempt per ledger reservation; this conclusion must be rechecked before supporting attachment inputs or a new Runtime/middleware version. No global provider retry or security setting is changed.

## Operation

Open **SCEAN 舞台** from the conversation dock. Select a saved run or paste a complete saved snapshot in the independent JSON form. Submit player text, cancel a pending turn, inspect source snapshot/state/memory/attempt trace, or maintain the mechanical BanList. UI unmount/panel switching does not cancel RP; explicit Cancel or unloading SCEAN cancels its own active work. The Studio test-copy return button targets `local-cardstudio-scean` and never changes the native authoring Session.

Studio's human-only, lease-validated adapter calls `ctx.scean.startFromStudio({snapshot,authoringSessionId,generation,signal})`. It receives `{runId,binding}`. `inspectFromStudio` requires the same run/session/exact generation (including Studio's UUID generation) and unexpired random binding; it is read-only. `attachInspection({runId,priorBinding,authoringSessionId,generation})` explicitly renews a still-valid same-session grant after page generation changes. Grants last 24 hours and remain independent of RP cancellation. They are not exposed through the public generic request action. UI navigation can dispatch `CustomEvent('scean:open',{detail:{runId}})` then select `local-scean`.

The generic SCEAN RPC verifies `ctx.invocation.peer` is the formal Connection's operator Peer (Gateway's operator only in the in-process test composition). Direct unscoped service calls and forged peers are refused; no Agent tools or commands expose these actions. The authenticated human operator can inspect their SCEAN runs through SCEAN's own panel; Studio uses only its binding-scoped adapter. DSH's formal Connection has one operator identity, not a per-plugin security sandbox: an already trusted installed plugin is not isolated from other host services. This boundary is verified with the actual formal Typert Gateway, not asserted from a comment. Late Inspector responses are tied to the selected Run and selection epoch, preventing an older Run's state from appearing under a new Run's identity.

On startup `store.listRuns()` reconstructs the UI run index from canonical aggregates. A crash after canonical creation but before host metadata publication therefore leaves a discoverable run. The core aggregate remains authoritative; host indices and inspection grants do not become gameplay truth.

## Disable, remove, recover

Use the project receipt-checked upgrade/rollback procedure. Leave pre-existing CardStudio 1.2.0, its data and Runtime payloads untouched. Disabling SCEAN does not delete data. Reinstall using the same dataRoot/usagePath to reload canonical commits and grants. Never distribute runtime data, credentials or production Sessions with plugin packages. The acceptance report distinguishes offline/native SDK checks from actual Desktop UI evidence.
