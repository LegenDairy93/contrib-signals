# Hosted contribution scout acceptance

Contrib Signals is the evidence engine. The hosted product helps a contributor find and investigate realistic opportunities without automating drive-by contributions.

## Hosted scout progress — 2026-08-09

| Gate | Status | Evidence |
|---|---|---|
| CS-01 | Pass locally | A clean Python wheel installed and completed collect, report, export, and snapshot against live GitHub evidence; a disposable Node checkout completed `npm ci`, lint, production build, and five Worker tests. |
| CS-02 | Pass | The app accepts up to three languages plus skills, interests, experience, and time with useful defaults and validation. |
| CS-03 | Pass locally | Server-side GitHub search records source URLs and timestamps. A real unauthenticated smoke run returned five current Python issues in 29 calls. |
| CS-04 | Pass locally | Search and enrichment filter or explain assigned, stale, archived, disabled, forked, inactive, undocumented, and competing-work signals. |
| CS-05 | Pass locally | Recent outside-PR merges and maintainer-comment samples are returned with score components and citations. |
| CS-06 | Pass locally | Contribution, conduct, template, conventional security, and sampled AI-rule checks show found and not-found states without inventing policy. |
| CS-07 | Pass locally | Related issues and recent pull requests are surfaced through deterministic title overlap; linked PR issues are excluded at search time. |
| CS-08 | Pass locally | Fit and readiness are separate scores with reasons, negative signals, and explicit uncertainty. |
| CS-09 | Pass locally | The brief exposes scope, lexical code-area hints, evidenced setup/tests, discussion count, rules, risks, and source links. |
| CS-10 | Pass locally | Browser worklist supports save, remove, targeted evidence refresh, and CSV export using local storage. |
| CS-11 | Pass | No route comments, claims, writes repository content, creates branches, or opens pull requests. |
| CS-12 | In progress | Validation, same-origin rules, caching, per-isolate rate limits, four-call concurrency, 25-second deadline, and redaction tests pass. Hosted secret and durable quota review remain. |
| CS-13 | Pass | Current briefs are deterministic; no model synthesis is mixed into evidence. |
| CS-14 | Pass locally | Desktop and 390px mobile production views were checked for layout and overflow; keyboard focus, loading, explicit no-key error, reduced-motion CSS, and clean browser logs were verified. |
| CS-15 | In progress | A hosted fresh-user run remains after the secret and deployment gates. |

Ten Python tests and five built-Worker tests pass. The normalized Node lockfile has a
zero-vulnerability npm audit. The app is still intentionally unpublished.

## Required gates

| ID | Requirement | Required evidence |
|---|---|---|
| CS-01 | Fresh installation works | Install in a clean environment and run collection, report, export, and snapshot commands using only the README. |
| CS-02 | A stranger can describe fit | Hosted input accepts languages, skills, interests, experience, and available time with useful defaults and validation. |
| CS-03 | Discovery uses current GitHub evidence | Server-side collection searches repositories/issues and records source URLs and collection timestamps. |
| CS-04 | Bad opportunities are filtered | Archived/inactive repositories, assigned/stale issues, competing work, missing contribution paths, and unsuitable scopes are visible or excluded with reasons. |
| CS-05 | External-contributor evidence is auditable | Outside PR merge/response evidence, maintainer activity, contribution docs, and score components remain queryable and explained. |
| CS-06 | Policies are checked | CONTRIBUTING, code of conduct, issue templates, security policy, and detectable AI-assistance rules are linked and summarized without inventing policy. |
| CS-07 | Duplicate-work risk is checked | Related issues and open/recent PRs are surfaced before recommending an opportunity. |
| CS-08 | Results are personalized | Fit score and readiness score are separate, with evidence, uncertainty, and explicit reasons not to contribute. |
| CS-09 | Issue investigation brief is useful | Brief includes scope, likely code areas, setup/test commands when evidenced, relevant discussion, contribution rules, risks, and citations. |
| CS-10 | Saved worklist completes the loop | Users can save, remove, refresh, and export investigated opportunities without the system claiming them. |
| CS-11 | No-slop boundary is enforced | The product never automatically comments, claims issues, generates unsolicited patches, pushes branches, or opens PRs. |
| CS-12 | Hosted security and limits work | GitHub/model credentials stay server-side; validation, caching, rate limits, timeouts, origin rules, and safe error redaction are tested. |
| CS-13 | Grounded assistance is distinguishable | Deterministic evidence is separated from model-generated synthesis; every factual brief claim links to source evidence. |
| CS-14 | Accessible responsive UX passes | Keyboard, focus, loading, empty, error, mobile, and reduced-motion states are tested. |
| CS-15 | Fresh-user acceptance passes | A new user finds at least one live, plausible opportunity, understands why it fits, and can verify every important claim without developer guidance. |

## Publication rule

The hosted scout is not described as live or complete until CS-01 through CS-15 have direct evidence. Public deployment requires explicit approval and a quota-risk review.

## Non-goals for this release

- Autonomous contribution or maintainer outreach.
- Issue claiming, commenting, patch generation, or PR submission.
- Ranking maintainers or guaranteeing acceptance.
- Hiding score logic behind an unexplained model judgment.
