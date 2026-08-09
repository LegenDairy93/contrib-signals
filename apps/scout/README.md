# Contrib Signals — hosted scout

This app turns the Contrib Signals evidence engine into a bounded product loop:

1. describe a contribution window,
2. search current GitHub issues,
3. inspect fit, repository readiness, duplicate-work risk, and policy evidence,
4. save a local worklist,
5. export the shortlist and do the contribution yourself.

It never claims an issue, posts a comment, generates an unsolicited patch, pushes a
branch, or opens a pull request.

## Status

The production build and mocked end-to-end API tests pass locally. A clean Node checkout
also completed `npm ci`, lint, the production build, and all five Worker tests. One
unauthenticated GitHub smoke run on 2026-08-09 returned five current Python opportunities
in 29 REST requests. The app is not described as publicly live until the hosted secret
and fresh-user gates in ../../docs/ACCEPTANCE.md pass.

## Run locally

Node.js 22.13 or newer is required.

    npm ci
    Copy-Item .dev.vars.example .dev.vars

Edit .dev.vars and replace the placeholder with a GitHub token. A fine-grained token
used only for public repositories should have read access to metadata, contents, issues,
and pull requests.

    npm run dev

The token is read only by the Worker. It is never returned to the browser or placed in
client assets. .dev.vars is ignored by Git.

## Verification

    npm run lint
    npm test

After deployment, run the bounded live acceptance probe:

    $env:SCOUT_BASE_URL="https://your-deployed-site.example"
    npm run test:hosted

It consumes two uncached quota operations: one discovery and one targeted refresh. It
requires a current opportunity, fresh timestamps, GitHub evidence links, stable refresh
identity, and a response with no credential-shaped text.

The production Worker tests cover:

- no baked opportunity in the server-rendered page
- input, content-length, and same-origin validation
- explicit failure when a server credential is absent
- live-shaped GitHub discovery with mocked authoritative responses
- contribution-policy, duplicate-work, outside-PR, and maintainer-response evidence
- categorical profile fit, contribution state, and evidence coverage
- response caching and per-client request limits
- bounded GitHub timeouts and credential redaction

## Request budget

Each uncached run is bounded to:

- one recent public-issue search per selected language
- eight returned issues across at most four repositories
- 48 GitHub REST calls across the complete bounded run
- four concurrent GitHub calls
- 55 seconds total evidence time
- three uncached GitHub operations per client per ten-minute durable window
- a five-minute normalized-profile cache

The quota ledger is stored in Sites-managed D1 and enforced atomically across Worker
instances. It stores a salted SHA-256 client identifier rather than a raw IP address,
cleans expired windows, and fails closed if D1 is unavailable. The GitHub provider's own
credential limit remains the final account-wide ceiling.

## Evidence boundary

Evidence states are deterministic and explained; no synthetic 0-100 total is returned.
Likely code areas use explicit file mentions plus lexical path matching and are labeled
as uncertain. Pull-request statistics are a recent sample, not a complete repository
history. No model synthesis is currently used.

## Dependency audit boundary

`npm audit --omit=dev` reports zero production dependency vulnerabilities. The full
development tree reports two high advisories in vinext's transitive image-size 2.0.2
dependency. npm has no patched image-size release as of 2026-08-09. This app accepts no
image upload or remote image input, and the affected ICNS/JXL/HEIF parser identifiers are
absent from the deployed JavaScript bundle. Do not describe the full tree as audit-clean
until vinext can consume a patched release.
