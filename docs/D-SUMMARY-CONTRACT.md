> Historical stage c04aa40. The user later selected 3+8 chapter retrieval and removed platform Token quotas. Current behavior: [CHAPTER-CONTEXT-RELEASE.zh-TW.md](CHAPTER-CONTEXT-RELEASE.zh-TW.md).

# D rolling summary contract

D-final 0.7.1 preserves rolling compression separately from independent chapter summaries. The automatic long-story candidate adds an explicitly armed Host chain from successful chapters to `summary`; see [the current chapter contract](CHAPTER-CONTEXT-RELEASE.zh-TW.md). Narrative schema 1/2 and portable save 1/2/3 remain unchanged. Optional `chapter_analysis`/`chapter_summary` retain separate capability and settings; see [current chapter contract](CHAPTER-CONTEXT-RELEASE.zh-TW.md).

The Run aggregate remains the authority. `run.narrative` schema 1 is optional,
source-versioned **derived public story compression**. It is neither a fourth
authoritative store nor character memory. C Runs without this field remain valid.
The immutable `snapshot.chapterSummary` remains an independent static source;
the engine delivers current derived compression through `rollingSummary`.

## Explicit execution and capacity

`updateSummary(engine, request, { enabled: false, model: engine.model })` is
disabled by default. The Host must explicitly enable the summary adapter and the
operator must request the operation or explicitly opt into automatic Writer
maintenance for this launch. Automatic maintenance needs both summary and chapter
Host capabilities and fresh `chapterSettings` consent `writerSummaryEnabled:true`.
The UI explains the additional compression call. Successful automatic chapter
work then chains one rolling delta; existing closed ranges can catch up without
another chapter analysis. A cycle is bounded to one chapter and one rolling delta.
Restart/import never arm this capability, and failures disarm it. A new explicit
settings operation can authorize recovery; replaying an old consent receipt cannot.
This milestone uses only
deterministic synthetic adapters. Real summary quality is **NOT_RUN**.

The request contains Run ID, operation ID, expected version and Head, optional
end turn, and recent window (1–50, default 6). The end must be no later than the
active story length minus that window. With no explicit end, one operation
advances at most 50 turns. The input consists only of the previous still-valid
summary plus newly covered public committed player input and prose. It never
loads private Memory, playerHistory, State, diagnostic packets or CR context.
The previous summary is attributed compression, not newly established facts.

The single `summary` stage uses existing model description, multilingual capacity
estimation, configured output reserve and adapter capacity guard. All summary
sources are mandatory: overflow fails instead of silently dropping part of the
declared range. Delta bounds are 50 turns and 200,000 UTF-8 bytes. Output is
nonempty plain text, at most 16,000 JavaScript string units, with no tool calls
or incomplete finish reason. The call timeout defaults to 60 seconds; the
internal option is bounded to 1–120,000 ms. Both capability description and
generation receive a linked deadline signal: parent cancellation aborts the
adapter with `CANCELLED`, and a deadline aborts it with a recorded `MODEL_TIMEOUT`.
A late response cannot publish. No scripts, EJS or model-provided operations execute.

The prompt asks to preserve promises, tasks, exchanges, important objects and
locations, sourced relationship changes and unresolved plots, while retaining
attribution and uncertainty. Host validation verifies structure, bounds and
source identities. It cannot establish semantic fidelity or narrative quality.
An inaccurate summary can be checked against original History Read; that does
not automatically rewrite the summary or authoritative State.

## Persistent operation and recovery

The aggregate contains `{schemaVersion, currentSummaryId, summaries, chapters,
operations}`. There are at most 128 summary versions, 128 chapter records and
256 narrative operations. Narrative operations also count toward the unchanged
4,096 combined C receipt bound. No automatic receipt eviction, story truncation
or save-size enlargement occurs.

Under the Run lock, expected version/Head and operation fingerprint are checked.
A pending operation is published atomically at `version + 1`, then the lock is
released during generation. A completed result is published only after checking
the exact pending version, Head and source commit/hash range. Completion advances
the version once more without changing story Head. A concurrent story mutation,
rollback, regeneration or other version change prevents the old result becoming
current. Operation states are pending, completed, failed, stale or cancelled;
absence means not started.

The same operation ID and request returns the durable state/receipt without
calling the model again; conflicting request data rejects. Post-publication ack
loss reads back the committed aggregate. Pre-publication failure leaves the
story intact. If a terminal status cannot be saved, the durable pending marker is
left for explicit startup recovery. `recoverNarrative` marks interrupted pending
operations failed or stale; it never retries a provider call. It must be used
for startup/import recovery, not to interrupt an active operation on every view.
History and narrative operation IDs cannot collide, including in imported
receipts. The public operation list sorts by request version, not JSON object-key
or UUID order, so the latest displayed state remains chronological after restart.

Each summary records a stable ID, monotonic summary version, prefix turn range,
ordered commit IDs, hashes of `{commitId,input,body}`, combined source hash,
base Head/version, public story perspective, public visibility, status/current,
text and provenance. Provenance links the producing operation and preceding
summary, timestamp, algorithm, safe model label (or `not_recorded`) and optional
numeric usage. Raw prompts, provider configuration and adapter working packets
are not portable narrative data. Unknown usage remains unknown.

## Selection, invalidation and privacy

Ordinary appends preserve still-valid earlier compression. Rollback/regeneration
invalidates any summary containing a removed or replaced commit; identical text
under a new commit ID cannot revive it. The latest valid earlier summary may be
selected again. No current summary is selected if none remains valid. The source
validator checks active input/prose hashes; retired source hashes are retained
only as explicit non-current audit, with their commit identities checked against
the bounded C retirement records. Retired input is not reconstructed from hashes.

`selectNarrative` returns the chosen summary plus all uncovered active turns up
to 50 turns / 200000 UTF-8 bytes. The configured window is a preference, never
permission to omit an unsummarized gap. Summary-covered turns are excluded, so
overlap is zero. A larger gap returns bounded diagnostic data with
`coverageStatus:blocked`; the engine refuses Writer dispatch with
`NARRATIVE_COVERAGE_REQUIRED`. Full originals remain in History Search/Read.
Rolling summary and recent originals are mandatory at Writer capacity checks;
Stat's already authorized recent originals are also mandatory. Capacity overflow
rejects the stage. General Memory remains subject to its existing optional
Budget policy. Prose and PostStat do not receive the archive.

All D summaries are public-story summaries. No private or per-character summary
mode exists. They do not establish NPC knowledge and are not inserted into CR
owner memory. The ordinary narrative view shows text only for the current valid
summary. Older/stale summary versions expose status/range metadata, not withdrawn
summary text. Full derived audit is handled by the explicit sensitive backup
boundary together with the rest of the Run.

## Reproducible checks

Run `node --test tests/d-summary.test.mjs tests/d-save.test.mjs` from the source
root. The summary suite exercises opt-in, delta-only input, private canaries,
mandatory budget overflow, output bounds, cancellation, timeout, unlocked Head
changes, duplicate requests, pending restart, persistence faults, earlier-summary
fallback, same-text/new-commit invalidation, chapter sources and save validation.
All fixtures and model ports in these tests are synthetic and make no network
requests. The final acceptance report records executed results separately.

## D-final model packet bound

The actual Director/Draft rollingSummary packet contains id, version, text, startTurn, endTurn, startCommitId, endCommitId and label. It does not contain the full commitIds array. Canonical source/hash validation and authorized inspector retain it. This is a transport change, not loss of provenance or a new source of authority.

Independent structured chapter summaries are never all injected into normal Writer calls. A chapter-summary operation may receive at most three prior chapter summaries and 4000 characters total, together with its own bounded committed public input/body range. Full record/provenance, settings/operation pairing and retirement timing are validated on save3 import. No semantic Reviewer was added.
