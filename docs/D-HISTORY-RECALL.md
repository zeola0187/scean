# D original-history Search / Read and bounded paging

`core/history-recall.mjs` exports pure, read-only `searchHistory`, `readHistory`,
`pageHistory`, `historyLocator`, `HISTORY_RECALL_LIMITS` and
`HISTORY_REFERENCE_LABEL`. Host is responsible for authenticating and authorizing
the selected Run before calling these functions. A locator or cursor grants no
access. None of these functions starts a model, embedding, filesystem read or
network request.

## Authority and knowledge boundary

Only the aggregate's effective committed `turns[].input` and `turns[].body` are
searchable or readable. Safe results allowlist Run ID, public story turn number,
commit ID, stable locator, active marker and original input/body; search instead
returns bounded excerpts and offsets. State, Memory, playerHistory, receipt
payloads, traces, CR packets and failed/provisional attempts are never projected.
An aggregate that contradicts its head or includes a retired/duplicate active
commit fails closed. The durable aggregate remains the authority; no history
index or receipt is promoted into narrative truth.

Each result carries `Historical reference — not a current event`. Historical
reference is evidence available to the Director, not an assertion that every NPC
knows the passage. Host/engine must not route History results into owner CR context
or treat them as new State/Memory events. The core has no mechanism to mutate
State, Memory, summaries or story. A deliberately incorrect summary can therefore
be checked against exact original prose without automatically rewriting anything.

Stable locators are `scean-history:<safeRunId>:<safeCommitId>`. They do not contain
OS paths or URLs and are never opened or executed. A locator from another Run,
a conflicting locator and commit ID, a missing commit, or a retired commit is
rejected. Turn numbers can be reused after rollback; commit IDs cannot. Replacing
prose with identical text still creates a different source identity.

## Search

`searchHistory(run, {query, limit=5, mode='literal', caseSensitive=false, runId?})`
returns `{kind:'history_search',label,runId,head,mode,hits,hasMore}`.

- Query: nonblank string, at most 512 UTF-16 code units; limit: 1–10 hits.
- Literal matching escapes all regex metacharacters. It is deterministic, uses
  original-text offsets, and defaults to Unicode case-insensitive matching.
- `bm25` uses the existing ZEOLAS sparse tokenizer/scorer with empty entity and
  keyword boosts. No Memory collection, vector index, rerank or embedding is
  used. It ranks active public story documents only. BM25 normalization is
  case-insensitive regardless of `caseSensitive`; that option affects displayed
  exact token positions. Ties use the established scorer's story-position order.
- Literal results retain active chronological order. BM25 results retain score
  order. Search scans at most the existing C capacity of 1,000 active turns;
  there is no silent history truncation.
- A hit contains `{runId,turn,commitId,active:true,locator,snippet,snippetField,
  snippetStart,hitPositions,score}`. Excerpts are at most 400 code units, beginning
  up to 100 code units before the first match. Up to 32 positions identify field
  (`input` or `body`) and half-open original UTF-16 offsets `[start,end)`.
  `snippetStart` relates the excerpt to its source; positions outside the excerpt
  remain original-source positions. BM25 normalized matches may have no exact
  original token position, in which case the body excerpt starts at zero.
- Search snippets are discovery aids, not replacement original text. Search and
  Read are separate operations; no search response returns ten full turns.

## Read

`readHistory(run, {locator?, commitId?, radius=0, maxChars=12000, runId?})`
requires a locator or commit ID. The response is
`{kind:'history_read',label,runId,head,targetCommitId,chars,turns}`.

Radius is 0 or 1 and reads at most three active adjacent turns in chronological
order. `maxChars` must be 1–12,000 and counts combined original input/body UTF-16
code units, excluding the bounded structural metadata. If the selection exceeds
that bound, `HISTORY_READ_TOO_LARGE` is returned. It does not silently truncate
original prose or retry with a larger limit. The caller may explicitly request a
smaller radius; a single oversized turn cannot be read through this bounded tool.

## Paging and navigation

`pageHistory(run, {cursor?, limit=10, anchorCommitId?, runId?, presentation=false})` returns
`{kind:'history_page',label,runId,head,status,turns,hasMore,beforeCursor,
anchorCommitId,totalActive}`. Each `turns` item contains only
`{runId,turn,commitId,active:true,locator,input,body}`. The player Host requests
`presentation:true`, adding only validated `bodyHash` and `dialoguePresentation`
when available. Search/Read and Agent history keep their existing projections.

Initial requests return the latest 10 turns, ordered oldest to newest. Limit is
1–20. `beforeCursor` fetches the immediately preceding page, so callers prepend
that page. `hasMore:false` with null cursor identifies the beginning of history.
An empty Run has `status:'empty'`; nonempty pages use `status:'page'`. A validated
cursor positioned before the first turn yields `status:'end'`. Passing a cursor
and anchor together rejects. Anchor navigation returns a page ending at the
specified active commit, which necessarily includes that target.

The page data object's serialized UTF-8 JSON is at most 131,072 bytes (128 KiB),
including its metadata, cursor and presentation. This is a SCEAN page budget,
not model tokens or the enclosing RPC/HTTP envelope. Default 10 and maximum 20
turns remain unchanged; actual returned counts can be smaller because of bytes.
If necessary, reduce the page by whole turns **with their valid presentation**
first. Its preceding cursor still covers every earlier turn without omission
or duplication; colors do not disappear merely because several turns share a page.

If a single turn plus its sidecar still exceeds the budget, the page may omit
that one sidecar and returns `presentationWarning` containing
`{code:'HISTORY_PRESENTATION_TOO_LARGE',turn}`. The UI explicitly says it retained
the full prose with neutral color. The warning also counts toward the budget.
A single complete plain turn that still cannot fit returns
`HISTORY_PAGE_TURN_TOO_LARGE`; neither original prose nor input is truncated.
This does not promise every possible turn length or enlarge stored Run capacity.

Late presentation updates repaint existing story elements only when their valid
display data changes. Identical projections retain their text nodes. A logical
text offset accompanies reading Ranges so changing inline color spans cannot
relocate the saved reading anchor. No story/bodyHash/State/Memory mutation is
part of paging or repainting.

Cursor schema 1 is a bounded opaque base64url JSON value (at most 1,024 chars),
bound to Run ID, active head, ordered active commit digest and the first returned
commit. It is a consistency token, not a signature or authorization credential.
Append, rollback or regeneration changes the active history and rejects old
cursors with `HISTORY_CURSOR_STALE`; reload the recent page. A summary-only or
other non-story version increment preserves the cursor. Locator reads remain
valid across appends if their source commit is still active. No stale cursor can
reveal a retired passage. Switching Runs requires the UI to cancel/ignore its old
response; the response's Run ID is available for that check.

Paging bounds transport and frontend work. It does not claim an O(page-size)
backend: DurableStore still reads the full aggregate, and the pure helper scans
active identities and computes their digest. BM25 also tokenizes all active
story input/body per search. Actual backend versus transfer/render measurements
are recorded separately in `D-LONGRUN-PERFORMANCE.md`.

## Explicit errors and reproducibility

Contract errors include `HISTORY_CROSS_RUN`, `HISTORY_INCONSISTENT`,
`HISTORY_QUERY_INVALID`, `HISTORY_SEARCH_MODE_INVALID`, `HISTORY_SEARCH_LIMIT`,
`HISTORY_LOCATOR_INVALID`, `HISTORY_LOCATOR_MISMATCH`, `HISTORY_COMMIT_RETIRED`,
`HISTORY_COMMIT_NOT_FOUND`, `HISTORY_READ_RADIUS`, `HISTORY_READ_LIMIT`,
`HISTORY_READ_TOO_LARGE`, `HISTORY_PAGE_LIMIT`, `HISTORY_PAGE_ARGUMENTS`,
`HISTORY_CURSOR_INVALID`, `HISTORY_CURSOR_STALE` and
`HISTORY_PAGE_TURN_TOO_LARGE`. Invalid host IDs can also produce the shared
`INVALID_ID` contract error.

Run `node --test tests/d-history-recall.test.mjs`. The safe synthetic cases cover
literal and sparse multilingual retrieval, canary exclusion, exact original
Read, retired/replaced identity, invalid arguments, bounded snippets/positions,
100/500/1,000-turn gap-free pagination, byte-bound reductions, stale and cross-Run
cursors and summary-only cursor stability. These tests establish deterministic
engineering behavior, not real-model summary quality or formal Desktop UI.

## Director integration

The Director's existing optional tool menu includes `search_history` and
`read_history`. They take the Search/Read arguments above except `runId`, which
is fixed by the executing Run. Unknown argument fields reject; an explicit
foreign Run ID rejects as cross-Run access. At most three History calls and a
cumulative 6,000 estimated tokens of successful History results are permitted
per story turn, within the existing six-total-tool limit. The multilingual B
estimate is a capacity heuristic, not a provider-token measurement. The normal
Director packet and its accumulated tool conversation are still subject to B
stage capacity budgeting. An exceeded History limit aborts the attempt before
publication; no partial new story/State/Memory is committed.

Only Director receives the retrieved reference packet in its tool conversation.
Draft continues to receive the public Director brief and ordinary public source
assembly, not the raw History tool transcript. Prose/PostStat and character
consultation packets receive no History tool results or rolling summary. Owner
CR retrieval and private context remain governed by the existing ACL. No History
call is mandatory; a normal turn still performs Director → Draft → Prose →
PostStat without extra calls. `tests/d-engine.test.mjs` captures the actual
synthetic model port to verify these boundaries and the per-turn budgets.
