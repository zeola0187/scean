# Milestone C history contract

Status: implemented contract. Exact engineering results and limits are recorded in
ACCEPTANCE-C.md and the committed safe evidence summary. This does not establish
real-model narrative validation or formal Desktop deployment.

## Authority and identity

`DurableStore`'s `runs/<safe Run ID>/current.json` aggregate is the sole authority.
Host lists, attempt files, progress, browser state and embedding indexes are
derived data. No repair may infer story truth from them.

The aggregate includes the immutable Snapshot, current state, active turns,
active Memory, playerHistory, stateProvenance, request receipts, history operation
receipts and bounded retirement audit. The effective story head is the final
active turn's commit ID, or null when there are no active turns. A failed,
cancelled or provisional attempt is never a story head.

`run.version` is a safe nonnegative integer. Every published mutation advances it
exactly once, including rollback and replacement; it never rolls back with the
story. Active turn numbers describe story order and may be reused after a
rollback; globally unique commit IDs distinguish the replaced histories.
Snapshot card revision/hash, worldbooks, Preset, roster, Blueprint and InitialState
remain fixed. Studio saving another revision creates a separate Run.

Each effective turn records input, body/hash, request ID, commit ID, attempt ID,
stateBefore/stateAfter, memoryIds, playerHistoryIds and commit time. Provenance
for turn updates is attributable to its commit ID; initial provenance remains
separate. The current state equals the effective final turn's stateAfter, or the
original baseline when no effective turn remains.

## Exclusion, compare-and-swap and receipts

All mutations use the existing nonblocking cross-process Run writer lock.
Generating, regenerating, rollback and other exclusive operations cannot overlap
for one Run. A contender receives `RUN_BUSY`; it does not silently queue a
different mutation. The lock remains held across candidate generation and final
publication. Store publication also checks the expected current version.

History requests carry a stable operation ID, expectedVersion and expectedHead
(including explicit null), and regeneration carries a stable candidate request
ID. IDs are bounded safe IDs. An operation receipt binds the operation kind and
all semantic arguments, including target head/version and optional writing
guidance. Identical retry returns the durable receipt before rechecking stale
expectations. Reusing an ID for different arguments rejects. A new operation
whose version or head changed rejects before any publication or generation.

`operationReceipts[id]` stores `{kind,request,fingerprint,result}`. The bounded
request envelope contains kind, Run/operation ID, expectedVersion/expectedHead
and, for regeneration, candidate requestId and guidance. Its hash must match the
fingerprint; import also cross-checks the envelope against retirement audit and
result. This audit envelope never enters normal narrative context or recall.

Request receipts distinguish active committed results from retired/replaced
results. Retired requests return retirement status or a fixed error, never their
old body and never a new generation. Retirement is durable across restart and
import. Attempt recovery checks the actual receipt owner and active/retired
status; it must not resurrect retired turns by relabelling an attempt.

Receipts are not evicted to make room: doing so would permit an old operation to
run again. The aggregate has bounded capacity; when its receipt/audit/history
limit would be exceeded, reject before mutation. Rollback is not an undo of the
operation log. The save contract defines shared bounds.

## C.1: rollback the final effective turn

1. Under the Run lock, resolve an existing identical operation receipt or validate
   exact expectedVersion/head and the presence of a committed head.
2. Validate the target's stateAfter against the current state and its ownership
   records. Restore its complete stateBefore. Remove exactly its commit-owned
   Memory, playerHistory and stateProvenance; preserve earlier data, including
   pre-existing private knowledge. Remove only the final active turn.
3. Retire the original request receipt. Add a bounded retirement summary and an
   operation receipt. Advance version; head becomes the predecessor commit ID.
4. Atomically publish the entire aggregate once, then invalidate derived caches.

Audit stores structural lineage and operation outcome, not copies of withdrawn
body, private memory text or private state. Ordinary inspection exposes only a
safe summary. Audit is never included in PromptAssembly, worldbook KEY scanning,
Memory retrieval or normal story rendering. In particular, a word found only in
the retired body cannot activate a worldbook entry in the next turn.

The UI shows the target effective turn and explains removal of its story/state/
knowledge effects. An explicit confirmation is required. A failed or uncertain
response causes an authoritative status refresh; it never optimistically removes
another turn or invents a new operation ID to retry an uncertain operation.

## C.2: regenerate without retiring the original prematurely

The original committed turn remains authoritative while generation is pending.
Create an isolated candidate aggregate from the predecessor state/history/Memory/
playerHistory/provenance, with the same frozen Snapshot and original player
input. Its publication version base remains the current monotonic version, not
the historical predecessor version. Optional bounded writing guidance applies
only to this regeneration's Writer context and does not rewrite input or Snapshot.

Reuse the existing Director → optional CR/Stat → Draft → Prose → mechanical
BanList → PostStat pipeline and all existing validation. A virtual Store is
permitted: its read/commit operations clone and capture the candidate in memory;
they never publish to the authoritative Store. Its nested lock is local only.
Private working packets remain isolated, and CR advice remains advice_not_event.
No new Reviewer, retry-for-style loop or paid provider is introduced.

Candidate traces are provisional. A captured candidate commit is not a successful
Run mutation and must not be reported as authoritative committed progress. After
all candidate validations, verify current version/head and cancellation again,
replace the final active turn plus its owned data, retire the old request, add
replacement lineage and the operation receipt, and publish once. New Memory may
be empty: old turn Memory is still removed. The result contains the new commit ID
and version; only then does the UI replace the old story.

Invalid PostStat, Blueprint mismatch, model/tool failure, timeout, cancellation,
CAS conflict or pre-publication write error preserves the complete old aggregate.
Late model responses cannot publish. A candidate request may not reuse the old
head's request ID. Switching the selected UI Run cannot change which Run an
already-started operation owns; late progress/results are routed by Run and
operation identity.

## Atomicity and recovery

Store writes serialize a complete candidate to a same-directory temporary file,
flush it and atomically rename it to current.json. No delete-destination fallback
is permitted. `beforeRename` faults leave the old aggregate; `afterRename`
acknowledgement loss leaves the new aggregate and its durable receipt. On any
uncertain failure, reread the aggregate and return the matching receipt if it
exists. If reread is unavailable, report an unknown outcome and retain the same
operation identity for later reconciliation. Cancellation after publication
cannot erase an already committed result.

Restart discards unfinished candidate work, reconciles attempt audit from
authoritative receipts, rebuilds Host's Run list from Store and never decrements
version. No background recovery process performs another rollback or replacement.

## ACL and derived indexes

Memory candidates are drawn only from the current authoritative active records.
Owner ACL filtering precedes embeddings, BM25 corpus statistics, RRF and rerank.
Cached vectors never add candidates and never grant visibility. Mutation clears
the cache epoch; an index task started on an older epoch cannot publish cache
entries after invalidation. Any returned retrieval result remains tied to its
operation's frozen view and cannot become new authority on its own.

The same exclusion applies to persisted/reloaded indexes, partially prepared
indexes, cancelled late responses and empty replacement Memory. Import starts
with no trusted derived index. ZEOLAS algorithms remain unchanged.

## Required acceptance

Automated evidence must cover no-head and busy rollback, duplicate rollback,
retired cache, KEY exclusion, old request replay, zero-Memory regeneration,
invalid PostStat, failed regeneration preserving original, late cancellation,
stale head/version, before/after publication faults, restart receipts and the
save/import negatives in C-SAVE-FORMAT.md. The synthetic research-ship scenario
must prove Kalt's original private equipment knowledge survives while withdrawn
communication ceases to be recallable by Xio.艾兒 remains a distinct roster actor.

Tests are offline/synthetic; true model is NOT_RUN. Chrome acceptance is isolated
browser evidence and does not claim formal Desktop UI or narrative quality.
