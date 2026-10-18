# W01 Host derived facts v1

Independent card extension `data.extensions.scean.derivedFacts` is copied into
the saved Snapshot as `derivedFacts`. It is not an HTML component or State key.
Existing W01 packages and Runs without this field keep their previous behavior.

```json
{"schemaVersion":1,"id":"public-observations","version":1,"bindings":[{"alias":"ready","target":{"scope":"world","category":"facts","key":"ready"},"type":"boolean"}],"facts":[{"id":"safe-to-observe","name":"Observation conditions permit","description":"The declared public readiness condition is true; unknown is not permission.","provideToWriter":true,"expression":{"ref":"ready"}}]}
```

Only declared public Blueprint fields are admitted. The bounded W01 AST is shared
between Host and browser through one source module and a byte-identical generated
browser mirror. Results are boolean or explicit unknown/unavailable. Malformed
State and invalid rules fail closed. No restricted input, memory lookup, JavaScript,
action, clock or additional State write exists in this projection.

Host projects results from the same effective committed context the existing
Writer pipeline consumes. Director and Draft get `assembly.derivedFacts` and
`context.derivedFacts`, respectively, only for facts with `provideToWriter:true`.
Metadata includes readable names/descriptions, rule/config hashes and versions,
Run/card/revision/Snapshot identity and canonical head/version. These world facts
do not establish NPC knowledge, completed new events or character Memory.
No field is sent to Prose, PostStat, CR or extra model stages. PostStat continues
to be the only existing State proposal path, committed by Host as before.

The packet is mandatory indivisible Budget core. Insufficient capacity rejects
via `CONTEXT_CORE_OVERFLOW`, records source diagnostics and prevents that stage's
model dispatch. Trace status distinguishes assembled-for-port from completed
model-port execution, never claims an external provider receipt.

Normal next turn sees the latest valid committed State. Cancel/fail do not
change it. Rollback uses the restored committed State at its new version.
Regenerate retains the existing pipeline's in-memory committed predecessor
context (current operation version, predecessor head); it does not publish that
candidate or predict the regenerated outcome. Restart/import recompute from the
fixed Snapshot and committed State; no derived-result cache is persisted.

Frontend optional `derivedBindings:[{"alias":"safe","factId":"safe-to-observe"}]`
adds boolean aliases usable by existing text/state/when bindings. Host projection
supplies the exact result and provenance. No frontend, disabled iframe, or browser
is needed for Writer facts. Legacy frontend `conditions` remain compatible.

Authoring uses existing `cardstudio_scean_frontend` with actions `derived_read`,
`derived_validate`, `derived_save` and `derived_facts` JSON. Full human scope and
expected_revision are required to save. Optional blueprint/initial_state can be
updated in the same revision. Existing dynamic_save/preview accepts derived_facts
too; the existing JSON editor retains `derivedFacts` when present. Saving a new
version requires a new Run. Removing/changing referenced facts must also repair
frontend bindings; invalid intermediate revisions are rejected atomically.

This candidate is for isolated synthetic tests only. No live deployment or paid
model/Embedding use is authorized. Existing W01 UX limitations are unchanged.
