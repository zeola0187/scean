# OpenRouter output default guard

Version `0.1.0-local.4`, for the exact reviewed DSH `0.2.2-rc.1` adapter only. Licensed under the repository's AGPL-3.0-only license.

When an OpenRouter chat-completions caller omits an output limit, the reviewed PiAiAdapter still derives one from the model catalog. This can exceed the remaining context budget. The guard removes only the implicit `max_tokens` / `max_completion_tokens` fields; it preserves configured limits, explicit caller limits, other providers, messages, tools and existing payload hooks.

`sdk-pin.json` records the reviewed adapter module and method SHA256. An unknown method fails closed without modification. Disposal restores this instance's method without overwriting a later replacement. This addon is separate from the SCEAN suite and is not automatically installed by building the suite.

The empty `cordis.patch.yml` config does not start a paid verification request. The implementation retains an optional `verifyOnce` operation; enabling it requires separate authorization for the provider call and account charges.

## Offline verification

From the repository root after installing the pinned SDK dependencies:

```powershell
node --require ./scripts/w19-offline-network.cjs --test addons/openrouter-output-default/*.test.mjs
```

The SDK integration tests use the actual PiAiAdapter, Cordis and LlmRuntime with intercepted HTTP and synthetic fixtures. They make no paid requests. `SDK_ROOT` may select another extracted SDK root containing `node_modules`; the default is this repository root. Test state stays under ignored `.test-addon` directories.

Both the official packaged Desktop SDK (pi-ai 1.3.0) and the npm-resolved dependency set (pi-ai 1.5.2) have been tested. This is not live OpenRouter account or provider acceptance. Runtime files match the locally deployed addon; this README and the portable SDK test lookup are documentation/test adaptations.
