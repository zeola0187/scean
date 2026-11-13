# DSH 0.2.2-rc.3 local compatibility candidate

Candidate Suite/Runtime/Studio: `1.6.4-local.w29.2d.rc3.1.dsh022.3`.
Separate optional guard: `0.1.0-local.5`.
This prerelease was validated in an isolated profile. It has not been installed into the user's production desktop profile or activated in the running Desktop. Publication is recorded by the detached release receipt.

## Source and actual host

The baseline is the published `v1.6.4-local.w29.2d.rc3.1.dsh022.2` corresponding-source archive, SHA256 `00c3871ea918fe4b31728f225ec2721c256bc0514cf40965c1ce9109cc119e2b`, release revision `a11d851652531ae1ac38119ea245f2e6f5fcb231`. The rc.3 source commit is recorded in the detached release receipt.

The actual installed Desktop, DSH and PluginManager all report `0.2.2-rc.3`. The reviewed packaged archive SHA256 is `14cfd81c9135bf0afb89417543c94f9ecfe09266574452a9b106890c698725ae`. Tests use SDK files extracted from that archive and its unpacked payload. No SDK is redistributed in the candidate packages or source ZIP.

## Changes and evidence

- Add exactly `0.2.2-rc.3` to the three canonical package engine/peer boundaries; retain refusal of unreviewed rc.2, rc.4 and stable 0.2.2. No version exemption is added.
- Pin development dependency declarations and the resolved lockfile to rc.3. The runtime checks use the packaged SDK, not a claim of equivalence to every npm transitive dependency.
- Update the guard's exact method/module fingerprints. Its runtime wrapper is unchanged. The rc.3 adapter adds prefix digests and signed-thinking replay handling; regression tests compare guarded and unguarded actual adapter behavior, preserve matching-prefix signed thinking, preserve SDK omission after prefix changes, and verify the completions-only output omission. Old and unknown method fingerprints remain refused.
- Keep the existing NativeExecutor registration, trusted browser identity, scoped tools, leases and disposal checks. The gateway, connection, scope, native executor and approval modules relevant to those checks are unchanged between the reviewed packaged rc.1 and rc.3 snapshots. Other SDK differences are exercised by actual SDK integration tests.
- Make two synthetic test receipt writers use an explicitly supplied evidence directory or their own temporary fixture directory. Add useful export failure details to test assertions. No product data path or permission policy changes.

`RELEASE-VERIFICATION.json` records the actual test counts and limitations. In the first attempt, the execution sandbox denied local junction/hardlink operations and loopback HTTP. The same affected tests passed with local host operations permitted while retaining isolated HOME/data paths and the outbound network blocker. The isolated HTTP server also requires its explicit machine-identity test environment; no production configuration is changed by supplying this environment to test processes.

Three pre-existing historical dependencies remain unavailable in the published source: the legacy playback fixture preparation script, the sealed timecal3 reader and the timecal4 reader. One test file is excluded because its absent static import prevents loading; the two reader-specific tests are explicitly skipped. Other tests in those reader files still run. These exclusions are not rc.3 compatibility passes.

## Reproduction and limits

Use a fresh checkout and the exact reviewed archive with `python scripts/prepare-test-sdk.py --asar <archive> --version 0.2.2-rc.3`, then build with `python scripts/build-candidate.py --stage=build-suite-source-rc3-check`. Do not run the extraction command over an existing dependency directory. Run tests with `scripts/w19-offline-network.cjs` preloaded, a separate DSH_HOME, and synthetic providers only. Run `python scripts/validate-rc3-offline.py --node <Node24-or-Desktop-executable>` for the isolated offline suite. On Windows the test process must be allowed to create local links and loopback sockets.

The empty guard configuration performs no verification model request. Do not set `verifyOnce` or `verifyCorpus` as part of installation. Suite installation does not automatically install the separate guard.

No production restart, UI interaction, live model request, audio change or server operation is part of this validation. Real Desktop rendering and live provider behavior remain separate acceptance steps. The four pre-existing unselected desktop bundles remain untouched.

The release provides a fixed source tag, the matching source ZIP and a detached receipt. Anonymous remote verification is recorded after publication in that receipt.
