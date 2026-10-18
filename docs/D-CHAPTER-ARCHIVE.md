# D chapter archive

D-final 0.7.1 extends this manual-boundary contract with optional natural endpoints and independent structured chapter summaries. The original manual rules below remain strict. See [current implementation](CHAPTER-CONTEXT-RELEASE.zh-TW.md) and [source provenance](../licenses/aventuras-chapter-provenance.json).

Chapters are explicit Host/player boundaries over the existing active story.
`closeChapter(engine, {runId, operationId, expectedVersion, expectedHead, title})`
closes the unarchived range through the current last committed turn. It does not
generate a summary, call a model, modify prose, copy private Memory, or delete
original active turns. An empty range or empty/overlong title rejects. There is
no mandatory fixed chapter length or automatic paid chapter generation.

The chapter record contains stable ID, Run ID, creation order, record version,
title, start/end turn, ordered commit IDs, source hashes and combined hash,
base Head/version, public-story perspective/visibility, completed/stale status,
current validity, an optional reference to the then-current rolling summary and
its version, and explicit-close provenance. A referenced rolling summary is a
prefix compression; it is not represented as covering every turn of the chapter.
If no summary exists, both reference fields are null. Chapter close is a separate
atomic aggregate update, increments Run version, leaves Head unchanged and has an
idempotent operation receipt. Stable creation orders are not reused.

The first chapter starts at turn 1. A subsequent chapter begins immediately after
the last still-valid archived chapter. Retiring a source commit marks affected
chapters stale; their IDs and audit order remain stable. A newly closed chapter
after rollback can cover the replacement range under a new chapter ID. A stale
chapter is not valid navigation into retired prose. Active chapter locators use
commit identity, and History Read validates each anchor again before returning
original input/body. Reading does not execute story text or modify State.

Import validation reconstructs the earlier chapter that was still valid at each
close's base version, using operation publication versions and retirement
versions. It checks that start is the previous valid end plus one, and end is
exactly the captured Head's turn. Re-signing source hashes cannot legalize a
first-turn gap, later gap/overlap or shortened end. A chapter that became stale
later remains valid historical audit; legitimate rollback/reclose sequences are
accepted. The ordinary chapter view transmits only first/last commit locators,
not the full source-ID array; full sources remain in the canonical record and
explicit backup.

The UI can display chapter title/range/status and jump to an active source anchor.
Original active prose remains in the authoritative aggregate, even after
summarization or archiving. C retirement behavior remains unchanged: rollback and
replacement remove withdrawn prose from active history and keep bounded audit
metadata, not a second playable story. D does not silently resurrect or retain
withdrawn events as active chapter content.

The maximum is 128 chapter records, including stale audit rows. Reaching the
bound rejects the next close without evicting a chapter or rewriting the past.
The overall story limit (1,000 active turns), C audit/receipt bounds and 16 MiB
save limit remain unchanged. Chapter and summary payloads count toward the same
save bound. Their source/version relationships are validated before backup import
is atomically published; source indexes remain rebuildable derived data.

`tests/d-summary.test.mjs` covers three chapters, stable order and ranges, source
invalidation and zero implicit generation. `tests/d-save.test.mjs` covers chapter
and summary preservation across clean-root import, restart and continued play.

## D-final structured chapters

`chapter_auto` is a distinct operation/algorithm (`bounded-auto-close-v1`). Its selected end may precede the captured head, but must be an integer endpoint in the bounded, committed, unarchived candidate outside the protected recent buffer. Candidate source membership and prior boundary are validated at the operation's creation version, including retirement timing. The manual rule end=head is not relaxed.

`chapter_backfill` generates an independent seven-field summary without changing the original chapter identity, title or boundary. `chapterSummaries` stores versioned derived records; `chapterSettings` stores threshold/buffer/detail/autoEnabled. Both live in narrative schema2. Auto publishes the boundary and summary together; no endpoint or failure produces no half chapter. Manual close remains zero model; its missing summary may be filled separately.

Public chapterStatus lists metadata and explicit status; passing chapterId returns only that chapter's structured content. The interface shows title, fields, source navigation, missing/backfill, failure/cancellation/stale state, auto configuration and current-launch arming. Full canonical source arrays remain outside ordinary list payloads. See df-chapter, df-host, df-save and df-adversarial tests plus actual isolated Chrome evidence.
