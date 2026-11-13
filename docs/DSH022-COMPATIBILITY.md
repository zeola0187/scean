# DSH 0.2.2-rc.1 compatibility source port

This branch adds the exact DSH `0.2.2-rc.1` version to SCEAN and Studio package boundaries and keeps other unreviewed versions rejected. Studio integration tests register the SDK's separate NativeExecutor and exercise real scoped dispatch, argument validation and lease release. There is no story engine, schema, prompt, permission or production-profile change in this port.

## Source boundary

The public baseline is `0d77f8b`, tag `v1.6.4-local.w29.2d.rc3.1`, on `fix/studio-tool-recovery-1.6.4`. Public `main` still has an older baseline. The compatibility changes were reviewed from isolated candidate commits `b1c2644` and `3d26cc6`; these local snapshot commits are provenance references, not ancestors added to public history.

The branch version is `1.6.4-local.w29.2d.rc3.1.dsh022.1`. It intentionally ports the DSH compatibility delta onto the existing public baseline. The separately deployed local suite also contains unpublished chapter recall, collaboration reader, time UI and context-switch changes; those changes are outside this push. This branch is not a complete reproduction or release of that deployed feature tree.

The separate addon at `addons/openrouter-output-default` supplies the reviewed `0.1.0-local.3` guard, its SDK fingerprints and offline tests. Its runtime source matches the deployed guard. It is not silently added to the suite bundle. Seeker belongs to a separate project and is not included.

SDK development dependencies are pinned at `0.2.2-rc.1`, with Cordis `4.1.0` and a lockfile. Synthetic fixtures are updated to the existing Writer/PostStat contracts. The local feature branch's retry-behavior change and fixture-recovery/browser diagnostic scripts are excluded.

## Validation boundary

The original isolated deployment candidate passed 1,712 core/authoring tests, with one existing skip and three excluded legacy tests; it also passed 26 guard tests against the packaged SDK. Those numbers describe the original local feature tree, not an automatic pass for this public port.

Separate local deployment acceptance confirmed packaged Desktop `0.2.2-rc.1`, Studio, persisted stories and sessions, Seeker report preview, restart and the existing weekend scheduler. An explicitly authorized synthetic DeepSeek Flash turn subsequently completed Director, Writer and PostStat with three HTTP 200 responses; save/reload and duplicate-request suppression passed. No private production story or report was sent. This live test used the local deployed suite baseline and is not a live-generation test of this public port.

No deployment credentials, authenticated URLs, user profiles, story data, report contents, databases, local backups or Seeker changes are part of this source branch. There is no new release tag or downloadable release artifact, and no production restart is needed to push it.

Port-specific commands and outcomes are recorded in `DSH022-PORT-VERIFICATION.json`. Full legacy acceptance, live OpenRouter, a production Desktop model turn, real-news bulk generation and wall-clock weekend dispatch are not claimed by this port.

## Reproduce offline checks

Use Node 24 or newer. Install dependencies using the pinned `pnpm-lock.yaml`, then generate the compatibility imports from canonical source:

```powershell
pnpm install --frozen-lockfile
python scripts/build-candidate.py --stage=build-suite-source-dsh022-check
node --require ./scripts/w19-offline-network.cjs --test tests/dsh-version-compatibility.test.mjs tests/deepseek-flash-compatibility.test.mjs tests/w01-sdk.test.mjs
node --require ./scripts/w19-offline-network.cjs --test authoring/tests/agent-integration.test.mjs authoring/tests/w02-agent-integration.test.mjs
node --require ./scripts/w19-offline-network.cjs --test addons/openrouter-output-default/*.test.mjs
```

These checks use synthetic data and blocked/intercepted provider networking. They do not use a production DSH home. Building the suite does not package SDK dependencies or the separate guard addon.
