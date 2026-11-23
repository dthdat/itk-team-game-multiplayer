# Groq integration — implemented 2026-11-12

The previously planned integration is now implemented and deployed. See [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md) for its provider contract, strict schema validation, durable leases, retries, queue and quotas, bilingual evaluation, verified XP transactions and rollback.

The configured model is openai/gpt-oss-20b on the owner-confirmed Free plan. No billing upgrade, paid storage or additional VM was created. The API key stays only in protected Oracle configuration. The provider adapter returns untrusted structured criteria; the server validates them and computes score/XP. Mock, invalid, failed and interrupted work cannot award production XP.

All eight English reference examples, a Vietnamese example and an irrelevant injection example were evaluated using real Groq calls without real player records. Metadata is in reports/groq-live-evaluation.json. Public graphical integration evidence is in reports/ai-browser-production.json. These checks do not establish universal grading accuracy or 70-player grading capacity. Continue collecting consented evaluation examples and reviewer agreement before treating AI feedback as anything beyond demo training feedback.

Future improvements: larger independent bilingual answer sets, measured false-pass/false-fail rates, instructor appeals/manual review, and optional provider adapters. They are not enabled as hidden grading providers or paid fallback services.
