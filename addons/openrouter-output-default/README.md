# OpenRouter output default guard

Prerelease `0.1.0-local.5`, for the exact reviewed DSH `0.2.2-rc.3` adapter only. Validated in an isolated profile; production Desktop and live-provider acceptance are not claimed. Licensed under the repository's AGPL-3.0-only license.

When an OpenRouter chat-completions caller omits an output limit, the reviewed PiAiAdapter still derives one from the model catalog. This can exceed the remaining context budget. The guard removes only the implicit `max_tokens` / `max_completion_tokens` fields; it preserves configured limits, explicit caller limits, other providers, messages, tools and existing payload hooks.

`sdk-pin.json` records the reviewed adapter module and method SHA256. An unknown method fails closed without modification. Disposal restores this instance's method without overwriting a later replacement. This addon is separate from the SCEAN suite and is not automatically installed by building the suite.

The empty `cordis.patch.yml` config does not start a paid verification request. The implementation retains an optional `verifyOnce` operation; enabling it requires separate authorization for the provider call and account charges.

## Offline verification

From the repository root after installing the pinned SDK dependencies:

```powershell
node --require ./scripts/w19-offline-network.cjs --test addons/openrouter-output-default/*.test.mjs
```

The SDK integration tests use the actual PiAiAdapter, Cordis and LlmRuntime with intercepted HTTP and synthetic fixtures. They make no paid requests. `SDK_ROOT` may select another extracted SDK root containing `node_modules`; the default is this repository root. Test state stays under ignored `.test-addon` directories.

The rc.3 candidate is tested against the SDK extracted from the installed Desktop archive, whose SHA256 is recorded in `dsh-compatibility.json` at the repository root. The rc.3 method adds signed-thinking prefix binding; the additional replay tests verify unchanged matching-prefix replay, changed/missing-prefix omission, and completions history with only the implicit output limit removed. The wrapper implementation remains unchanged; the reviewed exact method/module fingerprints are updated. The former rc.1 method is rejected by this candidate. npm dependency lockfile resolution is recorded separately and is not a second SDK runtime acceptance claim. No live OpenRouter account or provider acceptance is claimed.
