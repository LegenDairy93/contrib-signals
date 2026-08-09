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
in 29 REST requests. The app is not described as publicly live until the hosted secret,
durable quota, and fresh-user gates in ../../docs/ACCEPTANCE.md pass.

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

The production Worker tests cover:

- no baked opportunity in the server-rendered page
- input, content-length, and same-origin validation
- explicit failure when a server credential is absent
- live-shaped GitHub discovery with mocked authoritative responses
- contribution-policy, duplicate-work, outside-PR, and maintainer-response evidence
- separate fit and readiness scores
- response caching and per-client request limits
- bounded GitHub timeouts and credential redaction

## Request budget

Each uncached run is bounded to:

- one recent public-issue search
- six returned issues across at most four repositories
- 48 GitHub REST calls
- four concurrent GitHub calls
- 25 seconds total evidence time
- three uncached scout profiles per client per ten-minute Worker-isolate window
- a five-minute normalized-profile cache

The in-memory rate window is a first deployment guard, not a globally durable quota.
A public deployment still requires the quota-risk gate in the acceptance document.

## Evidence boundary

Scores are deterministic and explained. Issue scope and policy text come from GitHub.
Likely code areas use explicit file mentions plus lexical path matching and are labeled
as uncertain. Pull-request statistics are a recent sample, not a complete repository
history. No model synthesis is currently used.
