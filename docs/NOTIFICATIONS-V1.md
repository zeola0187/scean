# Saved-reply notifications V1

This candidate adds notifications only for newly watched turn / regenerate operations. Canonical active-turn and receipt identities, owning attempt, operation, snapshot, card and Session must all match. Progress, provisional prose, failed/cancelled-before-commit operations, rollback, summaries and imported history cannot establish a success event.

Foreground in-page notices are enabled. Background desktop notifications are disabled until the user explicitly enables them and the browser grants permission. Native permission requests occur on an explicit button in the parent origin. The opaque iframe sandbox stays unchanged. The OS preview contains only “SCEAN” and a generic saved message; no story, input, State, card name or model information is included.

The notification sidecar is separate from Run bundles. It stores bounded identities and dispatch state, not private narrative or credentials. A destination group consumes a durable claim before one presentation attempt. This is **at-most-once attempt**, not guaranteed exactly-once visible delivery: a crash or OS suppression can lose the popup. Saved content remains queryable. Sidecar failure or full capacity disables new notifications while story work continues. Defaults are 1024 watches, 24-hour observation and a five-minute dispatch window; there is no automatic ledger eviction.

The same parent-origin browser destination survives normal reload. All notifications can be disabled; pending watches are stopped. Re-enabling starts a new baseline. Clicking revalidates the current Session/card and exact active commit, then performs read-only selection and history navigation. Retired/replaced/cross-card targets fail safely. It never submits a model operation.

Only a live, executing page can attempt delivery. No service worker, Push subscription/service, VAPID key, new credential, cold-start route, public service or cross-Session automatic navigation is implemented. Closed/frozen mobile pages, phone lock/background behavior, OS Do Not Disturb and true desktop OS delivery are **NOT_TESTED**. Test adapters never request actual notification permission. WAN and private HTTPS still require the separately authorized environment validation in [W19 security](W19-SECURITY.md).

The N01–N24 acceptance matrix is retained in [validation](W19-VALIDATION.md). Notification code is a separate follow-up commit after the W19 + presentation core.
