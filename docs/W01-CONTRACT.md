# W01 phase 1: card-specific dynamic frontend candidate

This private candidate is based on main `d64fa154a0558aefd2a0e806eda70af44f59e908` (SCEAN 1.1.0-w19.1, Studio 1.2.0-scean.7-w19.1), not the historical 1.0.0 baseline. Author authorization on 2026-10-17 selects research option C. No production installation or deployment is authorized by this document.

## Data and trust boundary

`Studio Agent/human → existing Full scope + revision CAS → card.data.extensions.scean.frontend → saved revision → human lease Handoff → fixed Snapshot.frontend → canonical Run state → public Blueprint allowlist → trusted renderer → empty-sandbox iframe`.

The package is embedded in the existing saved card, not a second mutable asset database. This deliberately reuses CardService immutable revisions, joint authoring receipts, Snapshot hashing and Run export/import. Card/Blueprint/frontend changes can be saved in one operation. Existing Runs retain exact bytes; there is no frontend hot reload. No Memory B, Writer, PostStat or DSH Runtime behavior is changed.

`runView.cardFrontend` is assembled from one canonical store read. Only public declared Blueprint tuples matching each binding are projected. No wildcard, arbitrary path, otherState, private Inspector grant or other Run lookup is exposed to authored content. The trusted official player already has authenticated Run authority; the card frame gets only a rendered document, zero RPC, zero messages, zero credentials. Existing Session/card/Run checks and player selection/version guards apply before delivery. Inspector gets bounded alias/status/type/canonical diagnostics, without restricted names or values.

## Versioned package

```
{
  schemaVersion: 1,
  id: "author-selected-safe-id",
  runtime: {profile: "scean-html-bindings-v1", apiMajor: 1},
  html: "<section>...any admitted composition...</section>",
  css: ".panel{display:grid;gap:12px}",
  bindings: [{alias:"fuel",target:{scope:"world",category:"resources",key:"fuel"},type:"number"}],
  conditions: {ready:{op:"gte",args:[{ref:"fuel"},{literal:30}]}},
  capabilities: {network:"none",worldActions:[],derivedDisplays:[]},
  hash: "Host-generated SHA256; optional for new authoring input"
}
```

Character targets also require `characterId`. Types reuse Blueprint number/string/boolean/enum/json. Conditions reference source bindings only (no cycles), support AND/OR/NOT and typed eq/ne/lt/lte/gt/gte. JSON is text-only, never an executable predicate. Comparison does not coerce strings into booleans or numbers. All expressions, HTML, CSS and JSON have finite resource limits. Shared validators are copied byte-for-byte into Studio by the build; they are not independent implementations of State.

HTML markers:

- `data-scean-text="alias"`: escaped text, including false/zero/empty string.
- `data-scean-state="booleanAlias"`: `data-state` and `scean-true/false/unknown/unavailable/stale` classes.
- `data-scean-when="booleanAlias"`: visible only when known true.
- `<progress max="100" data-scean-progress="numberAlias">`: bounded value, indeterminate when absent/stale.
- Native `<details><summary>`: local disclosure only.

HTML has an allowlist of standard structural/text/table/disclosure/progress tags. No script, event attributes, forms, links, SVG/MathML, embedded frames or arbitrary style attributes. CSS reuses Studio's bounded declarations, layout/grid/flex/colors/gradients/width media-query subset. A diagnostic rejects unsupported CSS rather than silently marking a design ready. This retains arbitrary combinations and themes rather than official prefab status panels. V1 does not package raster, font or remote assets.

## Status and freshness

The projection identifies run/card/snapshot/frontend and canonical version/head. A missing authorized value is `unknown`; a value that cannot be supplied is `unavailable`. Restricted bindings fail authoring admission and are not enumerated to the frame. AND false dominates unknown; OR true dominates unknown; otherwise uncertainty propagates. Stale transport overrides evaluation and never retains a current green lamp.

The official player's existing polling is the single canonical owner. A successful, matching canonical heartbeat refreshes a 15-second display freshness window; network failure marks stale immediately. Rollback may restore an older head but increments version. Failed/cancelled/provisional turns never enter this projection. Resume/restart reconcile canonical state. This is transport freshness, not an invented per-variable observation timestamp or expiration policy.

V1 rebuilds the card iframe only when its committed version/asset/freshness changes. Native disclosure state can reset on such rebuilds. The frame has no JS and an empty sandbox plus CSP (`default-src/script-src/connect-src/font-src/img-src none`). The trusted outer native player retains its existing authenticated bridge; its CSP admits nested about: frames. Actual official rc.2 Electron and Web CSP composition was exercised with synthetic cards; see the W01 GUI evidence. Broader device/browser coverage remains separate.

Rendering/manifest errors stay in the frontend panel. The official story, composer and State panel remain available; the user can choose official display. No change to canonical State is needed to recover.

## Extension contracts, disabled in v1

`runtime.profile` + `apiMajor` and explicit capability arrays form admission boundaries. Unknown profiles or nonempty worldActions/derivedDisplays are rejected. These are extensibility slots, not implemented handlers and not a permanent ban on JavaScript.

An isolated JS profile would need a separate sandbox/SDK, immutable scripts and dependency hashes, CSP/network policy, frame identity/channel revocation, time/memory quotas/watchdog, browser compatibility and security regression. It must consume only the same approved projection.

A future Host Action descriptor should carry action ID/input schema/handler version/capability/confirmation class. Intent needs run/snapshot/frontend/instance identity, expectedVersion/head, bounded payload and idempotency key. Host-owned principal and human confirmation cannot come from the card. Validation, durable receipt, atomic commit, duplicates, late results and rollback retirement must be specified before enabling it. No rule engine or WorldState write button exists in v1.

Authorized derived displays need separately reviewed release policy and provenance; public output must not reveal restricted inputs. V1 accepts no such declarations. W09/W10 remain separate.

## Audit and build

W03 remains DONE and Audit `0.1.0` stays identified as that historical baseline. Additive `W01.frontend-contract` checks shared admission; `W01.browser` remains NOT_TESTED in static reports; world actions are UNSUPPORTED. Static PASS never certifies browser or true-model play.

`python scripts/build-candidate.py --stage=build-suite-source-NEW` rebuilds both clients from the included canonical W01 sources and compares packaged runtime bytes to their source. New labels preserve failed builds. SDK extraction, test Profiles, logs and model fixtures remain outside the install package.
