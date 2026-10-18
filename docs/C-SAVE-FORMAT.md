# Current save compatibility: SCEAN 1.4.1

Named or adopted Runs use bundle v4. Unnamed v1/v2/v3 saves remain readable;
Run/Snapshot/Memory schema versions are unchanged. Old runtimes must not write
newer named/v4 data. See [player names and rollback](PLAYER-NAME.zh-TW.md).
The original v1 contract below remains historical background.

# Milestone C portable Run save contract

Status: implemented save v1 contract. Exact engineering evidence is recorded in
ACCEPTANCE-C.md. Format ID is `scean.run`; independent `schemaVersion` is 1.

The top-level bundle is `{format,schemaVersion,manifest,run}`. Manifest fields are
`runId`, `version`, `head`, `snapshotHash` and `sha256`. Operation receipts include
their bounded semantic request envelope; its fingerprint is recomputed and its
target/version/replacement lineage cross-checked, including retired replacements.

## Format and trust boundary

Use one bounded UTF-8 JSON bundle with an explicit format ID and independent
schema version. It contains a manifest and one portable Run aggregate. The
manifest identifies Run ID/version/head/Snapshot hash and a SHA-256 digest of the
canonical aggregate. Canonical JSON uses recursively sorted object keys and
preserves array order. SHA-256 detects corruption; it is not an authenticity
signature and does not authorize data access.

The bundle is data only. No scripts, EJS, MVU, shell fragments or embedded
templates are executed during validation, import, inspection or export. A story
may contain those strings; they remain inert text. No URL, path or external
reference supplied in the bundle is fetched, evaluated or opened.

## Portable authority and explicit omissions

Export an explicit allowlist of authoritative Run fields:

- Run schema/ID/version/head and creation/update metadata;
- fixed Snapshot, including saved card revision, character roster, worldbooks,
  Preset, Blueprint, InitialState, opening and bounded story metadata;
- active turns with input/body/hash, stateBefore/stateAfter and ownership IDs;
- current complete WorldState, Memory with source/ACL/epistemic metadata,
  playerHistory and stateProvenance;
- BanList, necessary retired lineage summaries, request tombstones/receipts and
  history operation receipts required for idempotency after restart/import.

Do not serialize host.json, leases, grants, bearer/CSRF tokens, locks, attempts or
model working traces, drafts, provider configuration, modelSelection or
stageModelSelections, credentials, API keys, Profile, SDK, runtime files,
unrelated Sessions, OS data paths, temporary paths or embedding caches. Model
routing after import comes from the destination Host's existing configuration.
Exporting does not change any source Run or destination environment configuration.

Snapshot author metadata is story data. Preserve bounded unknown story fields;
do not silently strip arbitrary keys that happen to resemble technical terms.
The serializer uses an explicit top-level authority allowlist, then validates
the portable payload. If prohibited environment credential fields or absolute
OS path data occur in the portable payload, reject the export/import with a
specific safe validation code. Do not silently redact part of a Snapshot and
claim a complete backup or recompute a different Snapshot hash. Plain narrative
text is never executed. The implemented detector's exact supported spellings
and scope must be documented in the review; it is not a semantic secret scanner.

Private character Memory, private State, playerHistory and authored private card
data are legitimate Run content and are included without public projection.
Consequently a full save is sensitive and unencrypted. Ordinary inspect/trace,
turn responses and Studio readonly capabilities cannot obtain it. Export uses
an explicit operator-authorized entry point, tied to the selected Run, with a UI
warning and explicit acknowledgement. Diagnostic grants do not silently grant
backup authority. No authorization token is serialized in the save.

## Bounds and validation order

Initial hard bounds: 16 MiB encoded bundle; 1,000 active turns; 256 retirement
audit rows; 4,096 total durable request/history-operation receipts. Additional
object depth, node count, string, Memory/playerHistory count and per-record bounds
must be finite and enforced before publication. Existing roster, body, state,
Blueprint and Memory validation limits continue to apply. Do not evict receipts
or truncate history to fit limits. Reject a new mutation or export when it would
exceed the applicable bound.

Validation completes before any Run becomes visible:

1. Enforce byte bound before parsing. Reject truncated JSON, duplicate object
   member names, invalid Unicode/JSON values, unsafe keys/prototype payloads,
   excessive nesting and unsupported bundle/Run schema versions.
2. Validate exact bundle/manifest structure, safe IDs and numeric ranges. Reject
   unexpected environment fields, path traversal/absolute path references and
   external-load directives; do not perform external reads.
3. Recompute canonical digest, manifest identity and Snapshot hash. Validate the
   roster, Blueprint and InitialState through the same creation contracts.
4. Reject duplicate commit/request/Memory/playerHistory/operation IDs and invalid
   ownership. Every active record source must resolve to this Run, frozen
   Snapshot/card revision/roster and the correct active commit/body hash/turn.
   Baseline records, if supported, require an explicit baseline source contract;
   an unresolved arbitrary source cannot be silently accepted.
5. Check active turn order and predecessor state continuity, final state/head,
   Memory/playerHistory ID membership, stateProvenance and receipt consistency.
   Removed/retired commit records cannot remain in active candidates. Receipt
   versions are bounded by the current version and never imply a later state.
6. Validate complete state and Memory ACL/epistemic schemas and known owners.
   Preserve private versus known_event versus world_public; do not infer global
   knowledge from text or normalize persisted ACL into broader permissions.
   Validate Blueprint values/visibility, whole set values and task subfields.

Import does not rerun model stages, reapply PostStat to fabricate missing data,
reroll outcomes, write character advice as events, or fetch embeddings. It either
accepts the complete validated aggregate or rejects the entire bundle.

## Collision, atomic publication and restart

Preserve original Run ID, version, effective head and source provenance. If that
Run ID exists at the destination, reject with `RUN_EXISTS`; there is no overwrite,
merge, automatic renaming, fork or replace mode in Milestone C.

After complete in-memory validation, acquire the target Run writer lock, recheck
collision and atomically publish the complete aggregate using DurableStore. A
temporary staging file or directory is not a listed/openable Run. A pre-rename
fault leaves no visible partial Run; a post-rename acknowledgement loss is
resolved by rereading and matching imported identity/digest. Cleanup may remove
only the operation's own temporary files, never an existing Run.

Host's Run list is derived from canonical Store and can be refreshed immediately
or rebuilt on restart. Importing into an empty isolated data root therefore
supports list/open/continue after Host restart, with unchanged Run ID and
monotonic future version. Destination has no imported grants/leases/provider
selection. No derived index is trusted or restored from the bundle; rebuild
only from eligible active authoritative records. Rebuilding may remain BM25-only
when no embedding provider is enabled; this task makes zero paid calls.

## UI and evidence

The export UI shows the selected Run and private-data warning before explicit
confirmation. The import UI accepts a file, presents validation outcome or a
safe specific conflict reason, and lists the imported Run only after successful
publication. It never renders untrusted save content as executable HTML.

Required negatives include truncation, digest corruption, duplicate members and
IDs, unsupported version, ID collision, path/external read attempts, invalid
source linkage, ACL/Blueprint drift, unauthorized export, private data leaking
through ordinary inspection, and no partial Run after failed import. Required
positive replay: synthetic root A with multiple turns, rollback and regeneration
→ export → empty root B import → Host restart → compare all active story/state/
Memory/provenance/version/ACL and retired exclusion → continue a new turn.

Only safe synthetic fixtures, reproducible commands, readable safe result
summaries and evidence hashes may enter Git. A real/private full backup, original
card, private trace, SDK or credential never enters the repository or package.
