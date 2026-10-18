# Milestone D save compatibility

D adds a source-versioned narrative compression domain to the existing portable
Run format. It does not change the immutable Snapshot or promote summaries,
chapters, search results or indexes into story authority.

## Version negotiation

The format remains `scean.run`. Export emits independent bundle schema **1** when
`run.narrative` is absent, retaining C's manifest and authority layout. Export
emits bundle schema **2** for the original D `narrative.schemaVersion: 1`, and
schema **3** only for `narrative.schemaVersion: 2`, which adds independent chapter
summaries and chapter settings. The inner authoritative Run schema remains 1.
A v1 payload with hidden narrative rejects. Bundle v2 must contain narrative v1;
bundle v3 must contain narrative v2. Missing domains, mismatched versions and
unsupported versions reject, even when the outer SHA256 is recomputed.

Valid C v1 and original D v2 backups restore without rewriting their narrative
schema, inventing chapter summaries, changing Snapshot hashes, starting a model
job or making an embedding request. Re-export retains the legacy bundle version
until an explicit chapter feature operation creates the newer narrative domain.

All three versions validate all original canonical data: Snapshot, active committed
input/body and state chain, Memory source/ACL, playerHistory, Blueprint provenance,
request receipts, history-operation fingerprints and retirement lineage. Manifest
SHA256 covers the entire portable aggregate including D data in v2 and the chapter extension in v3. Integrity is
not authenticity or access authorization.

## Derived narrative domain

V2 and v3 bundles carry the strict, bounded `run.narrative` schemas defined in
[D-SUMMARY-CONTRACT.md](D-SUMMARY-CONTRACT.md) and
[D-CHAPTER-ARCHIVE.md](D-CHAPTER-ARCHIVE.md). Its validator is shared with the
runtime; save/import cannot accept a looser narrative representation. Sources are
commit identities and input/body hashes in the same Run, not text similarity.
Current claims must resolve to valid active ranges. Withdrawn sources may only
survive in explicitly stale derived records; a rehashed outer manifest does not
make them current. Retired C audit does not retain input/body text, so a stale
source hash cannot be independently recomputed from that audit. It is retained
as historical metadata, excluded from current context, and never treated as
verified current source. Ordinary narrative views omit stale summary text. Unknown fields, environment configuration and working packets
inside the narrative domain reject instead of being silently dropped.

The bundle contains no search index, embedding cache, model working trace,
provider selection/credentials, Host grant, lease, SDK or filesystem handle. The
original C root allowlist still excludes those environment fields. The C bounded
portable-data scan still rejects recognized credential fields, absolute OS paths,
unsafe/external-load references, duplicate JSON members and prototype keys.
Unknown legitimate story metadata inside the original Snapshot remains subject
to C's established rules; D does not apply a new semantic secret scanner.

## Independent chapter summaries in v3

The optional extension preserves the original manual chapter IDs, titles,
order, boundaries and source identities. Backfilling an old chapter adds a
versioned `chapterSummaries` record; it does not repurpose or mutate the original
rolling summary. Each completed record binds its chapter ID, exact committed
range, source hashes, public-story visibility, structured payload and operation
provenance. The payload contains title, summary, keywords, characters, locations,
plot threads and emotional tone. Nullable and array fields follow the shared
strict chapter contract; arbitrary model output is not accepted as metadata.

`chapterSettings` persists bounded chapter preferences (`autoEnabled`,
`tokenThreshold`, `bufferTurns`, `detail`). Its enabled flag is data,
not provider or spending authorization. The destination Host must separately
allow chapter model use and explicitly arm automatic chapter processing for its
current launch. Import/restart never arms processing merely because a saved flag
is true. Pending chapter operations are terminalized without retrying the model.
There is no imported lease, permission token, model route or API key.
Chapter operation receipts retain their validated public analysis/summary result,
stage status, safe model label, numeric usage and capacity estimates. These are
strictly typed derived records; raw prompts, private working packets and arbitrary
provider metadata are rejected. Summary provenance must agree with its owning
completed operation and final stage; future versions or invented captured heads
cannot be accepted merely by recomputing a bundle digest.

Automatic chapter endpoints bind a captured story head and a selected source
endpoint separately; imports validate both against canonical commit identities.
Old manual chapters retain their original end-at-captured-head contract. A
rollback or replacement retires dependent chapter summaries; same text at a new
commit cannot make old records current. Previous completed records can remain
bounded audit, with no automatic semantic recomputation. Validators establish
structure and source consistency, not the truthfulness of model-written prose.

## Bounds and publication

C limits remain unchanged: 1,000 active turns, 256 retired audit rows, 4,096 total
durable request/operation receipts, 16 MiB encoded bundle, depth 64 and 300,000
JSON nodes. Derived data counts toward byte/depth/node limits. D additionally
bounds rolling summaries to 128, chapters to 128, independent chapter-summary
records to 128, and shared narrative operations to 256. D
operation receipts also count toward the unchanged combined 4,096 receipt limit.
Capacity errors reject the complete operation or backup. No history truncation,
receipt eviction or silent omission is used to fit a bundle.

Import validates the entire bundle before Store publication. Existing Run IDs
still reject with `RUN_EXISTS`; no overwrite, merge, renaming or external read is
performed. Atomic publication and acknowledgement recovery are unchanged from
[C-SAVE-FORMAT.md](C-SAVE-FORMAT.md). Host import and startup terminalize imported/interrupted pending summaries without a model call; import reports the resulting aggregate version. Opening a Run does not resume pending paid work. Indexes rebuild only from active canonical records.

## Privacy and reproducibility

Full Run backup remains sensitive and unencrypted: it legitimately includes
private State and private/known-event Memory. Only the separate acknowledged
operator backup entry can export it. Ordinary Inspector and Studio readonly
access do not acquire backup authority. D summary sources are public committed
input/body; their presence does not disclose private Memory or make all NPCs
know an event. CR retains its owner-scoped private working context.

`node --test tests/c-save.test.mjs tests/d-save.test.mjs tests/df-save.test.mjs` runs compatible C
roundtrips, original D v2 compatibility, v3 chapter backfill/retirement, strict
source and format negatives, and deterministic research-ship
A-to-clean-B/restart/continue replay. All fixture data is invented; model calls
are local synthetic and paid generation/embedding calls are zero. No real Run
backup, private card, provider configuration, SDK or raw working trace belongs in
Git or distributable evidence. Exact observed results are recorded in the D
acceptance report rather than inferred from this design contract.
