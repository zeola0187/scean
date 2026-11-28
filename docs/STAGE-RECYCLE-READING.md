# Stage recoverable Runs and reading position

Version: 1.7.2-local.stagev2.recycle-reading.1.dsh022.3. Source update only; no tag or GitHub Release.

The current native Stage documents are `isolated/web/stage-next.html` and
`stage-legacy.html`. They preserve the deployed Compass/performance baseline.
Shared lifecycle and source-text anchoring modules live beside them. Regenerate
with `node scripts/build-player-native.mjs`; the normal suite build calls the
same entry point. It hashes scripts into CSP and requires no SDK or model.

The new shelf offers Run-only recycle/restore, including the latest Run and the
reader menu. A canonical lifecycle revision and receipt protect stale requests;
world workers and automatic inspiration block recycle while active. Recycle
retains scripts, working cards, other Runs, notes and sidecars. No permanent
removal or empty-bin operation is provided. Visible pages poll the same Host
for lifecycle changes; independent Hosts do not replicate this state.

Frozen prose is promoted only for the same Run, lifecycle, request, attempt and
body hash. Source-text anchors preserve the visible character across separate
reload and operation-clear frames. The fourth composer control scrolls to the
current frozen body or latest committed prose; it cannot send or generate and
is disabled when no body exists. No State or persisted save schema changes.

Offline checks: lifecycle, notes/cursors, native bridge, chapter/background and
post-body regressions. Real Chromium checks at 1100 and 390 pixels use synthetic
Hosts and long prose. They cover start/mid-body promotion, split frames, earlier
turns, failure, rewrite, rollback, adoption, late replies, and simulated visibility
changes. Real mobile OS suspension and paid model behavior are not asserted.

Browser tests (install Playwright normally or set SCEAN_PLAYWRIGHT_MODULE):
`node tests/stage-scroll.browser.mjs`, `node tests/stage-lifecycle.browser.mjs`,
`node tests/stage-reading-edge.browser.mjs`. All use synthetic local data only.

The public update is projected onto the public repository's own main history.
No private Git history, cards, Runs, credentials, traces, SDKs or production
backups are included. Compass and performance code are necessary prerequisites;
existing notices and license boundaries remain in force.
