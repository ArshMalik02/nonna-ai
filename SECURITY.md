# Security

Nonna handles sensitive data about older adults: phone numbers, addresses, call transcripts,
medical reports and payment flows. Treat every change with that in mind.

## Reporting

Please do **not** open a public issue for a vulnerability. Contact the maintainers directly
(GitHub: @ArshMalik02) and include steps to reproduce.

## Rules for this codebase

- Never commit secrets. `.env` is git-ignored; use `.env.example` for new variables.
- Verify `X-Dial-Signature` on every webhook and reject stale timestamps.
- Authorize every Context MCP request by `X-Dial-User-Number`.
- Do not log message bodies, transcripts or medical content. Log ids.
- Card data and credentials never pass through messages or our database.
- Demo and test data must be fake.
