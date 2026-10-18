# W19 reproducible validation

From a full source checkout after scripts/build-candidate.py and the separately
reviewed SDK extraction described in README.md:

```text
node --require ./scripts/w19-offline-network.cjs --test tests/w19-host.test.mjs tests/w19-client.test.mjs tests/w19-presentation.test.mjs tests/w19-security.test.mjs tests/notifications.test.mjs
```

These synthetic tests cover durable admission, two-browser writer exclusion,
lost acknowledgments, exact cancellation, restart reconciliation, stale UI
responses, safe notification claims and official SDK HTTP fences. They do not
establish physical-phone/WAN/private-HTTPS/OS-popup delivery. Notifications are
at-most-once presentation attempts while a page executes, with no Push service
or service worker. No private test report, raw trace or model transcript is
part of this public source. Current release validation and environment limits
are summarized in VALIDATION.md.
