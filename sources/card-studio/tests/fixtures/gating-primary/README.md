# Pinned primary-source test fixtures

`manifest.json` identifies every source URL and SHA-256. Prompt Template files
are copied from the installed 1.17.9 source checkout at commit
`d6f520d149aba146305b0b781ddd691d449c28d2`. TauriTavern source is fetched from
the observed 2.3.0 build `3fe9e055b512`. Their original licenses are retained
separately; these files are test evidence, not bundled into the application.

The test extracts the unchanged official loader handler, decorator parser and
condition evaluator, strips TypeScript annotations with Node, and runs them on
synthetic entries. EJS rendering is a narrow interpolation test double that
evaluates only the generated single expression, not arbitrary card templates.

The native TT `WorldInfoBuffer`, `getSortedEntries`, decorator parser and
`checkWorldInfoInternal` execute on those filtered synthetic entries. Host
storage, timed effects, groups and tokenization use explicit doubles (token
count is string length). Tests establish pre-scan exclusion and demonstrate
native keyword, probability, budget and recursive selection. They do not
certify real-model token counts, group/timed effects, all extensions, a whole
prompt, or a live TT installation. No actual chat, account or runtime settings
are accessed and no network access occurs in the tests.
