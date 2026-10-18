# Card-scoped native stage

Source base: `c7da7770e3222a56b5c673c40294911493f545e3`.
Candidate: `0.8.4-card-scope.1`, paired with Studio `1.2.0-scean.4`.

The formal authenticated `SceanService.request` requires card context for Run
operations. The Host resolves the supplied DSH Session through the installed
Studio Bridge's host-only `resolveSceanScope`; it reads the live Session owner,
workspace generation, page lease and persisted working-copy selection. Requests
must match that current context. Canonical saved Run snapshots determine list
membership and authorization for reads and writes, including imports. Index rows
and client-side filtering do not confer access. Diagnostic token revocation is
allowed after navigation because it only removes the viewer's existing grant.

Identity is `(source.provider, snapshot.cardId)` with an exact matching
`source.card.id` and `source.card.revision === snapshot.revision`. Names, actor
IDs, card text and snapshot hash do not identify a card lineage. Revisions share
the working-copy UUID, while every Run retains its fixed snapshot. A new import
creates a new UUID even with identical content or name. An exact cloned working
copy retaining its UUID/provenance is indistinguishable from the same lineage;
this contract cannot infer an independent logical card identity for such clones.
Missing or inconsistent legacy provenance is excluded without migration, deletion
or name-based reassignment. Its saved files and backups remain intact.

Native Session changes, Studio selection changes, reopen and explicit entry
refresh the context. They immediately clear old story/state/diagnostics and
invalidate delayed responses. Native playback never reads or writes the global
`scean-selected-run` storage key. There is no cross-card fallback. No card or no
related Run gives an empty list and the explicit Studio handoff entry. New games
retain the existing human lease + saved revision + immutable snapshot admission.
Same-card private backup imports retain existing validation/consent; foreign or
unattributable imports fail before creating files. Navigation does not cancel an
already admitted operation in another card. Core narrative and atomic store
implementation are unchanged.

Rebuild: `node scripts/build-player-native.mjs`.
Offline tests: `node --test tests/card-scope.test.mjs tests/plugin-client.test.mjs
tests/plugin-native.test.mjs tests/plugin-host.test.mjs`.
Browser layout checks use `node --require ./scripts/w19-offline-network.cjs scripts/test-ui-layout-gui.mjs` after the separately reviewed SDK setup. They validate layout only. The historical card-scope browser harness is not shipped; the included card-scope/native integration tests above remain the reproducible data-boundary checks. Formal Desktop acceptance is a separate observed step.

Deploy both packages only after the user closes DSH. No live deployment, provider
generation, embeddings, card edits or private Session changes were performed by
this source change. No push, merge or Release is part of this delivery.
