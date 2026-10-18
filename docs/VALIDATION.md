# Validation and known limits

The 1.4.1 release preserves the existing source and synthetic regression assertions,
and adds player identity / UI coverage. The release's actual results, sealed hashes,
anonymous downloads and official isolated homepage installation are recorded in
the detached verification receipt and Release notes; this document does not certify
a future modified rebuild.

The candidate before release version alignment recorded Runtime 777/777 and
Native Authoring 28/28. Studio recorded 333 PASS / 6 FAIL, with the same six missing
historical SDK / SillyTavern fixtures reproduced on its unchanged baseline. These
failures remain failures; none are removed or converted to skip/pass. Re-run
applicable suites after source/version changes and retain the actual output.

Public source excludes separately licensed SDK binaries, historical extracted
application trees, user data and private traces. Obtain and verify a supported
DSH app.asar as described in README.md for offline SDK-dependent tests. The main
machine guard remains fail-closed; no paid model or external embedding is needed.

Synthetic Chrome checks cover the generated UI at desktop and 390px, independent
top-level tabs, name/default persistence and Host restart. They do not establish
physical phone/WAN/private HTTPS, native Desktop login flows, macOS/Linux or
real-provider literary quality. A successful TLS or authentication-required probe
does not establish authenticated application functionality.
