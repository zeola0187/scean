# W19: security and deployment boundary

The implementation targets one owner and trusted browsers sharing one DSH Host
operator. Page, Session, operation and draft identifiers are consistency IDs,
not independent account principals. It does not establish a public multi-user
service. Do not expose a production Profile to untrusted users.

Host-owned durable jobs provide one writer per Run, bounded concurrency, exact
retry identities, reconnect reconciliation and cancellation. Saved receipts,
not provisional prose, establish a completed operation. See the synthetic
contracts in tests/w19-host.test.mjs and tests/w19-client.test.mjs.

Offline HTTP security tests use synthetic cookies and the official reviewed DSH
SDK: tests/w19-security.test.mjs. They cover Host/Origin fencing, cookie/token
validation and a TLS seam. The historical independent playable server binds
loopback only. Real private HTTPS, firewall/VPN/WAN, physical secondary devices
and OS notification behavior require separate environment validation; source
integration and a mock TLS seam do not establish those results.

Use a fresh DSH_HOME/Profile and synthetic cards. The standard DSH home remains
protected in isolated helpers. SCEAN_PRIMARY_MACHINE is a deliberate fail-closed
acceptance override, never an instruction to select a live Profile. Optional
SCEAN_PROTECTED_ROOTS_JSON adds protected roots. No test needs real credentials,
paid generation or external embeddings. Follow docs/VALIDATION.md for commands.
