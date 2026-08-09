# Contrib Signals

**Find open-source work worth doing, then investigate it before you code.**

Contrib Signals checks current issue state, repository activity, outside-contributor
pull requests, maintainer responses, policies, and possible duplicate work. Every
important signal links back to GitHub evidence.

## Hosted scout

The full-stack app in apps/scout turns a small contribution profile into at most six
current opportunities, separate fit and readiness scores, a cited investigation brief,
policy checks, duplicate-work warnings, and a refreshable local worklist.

Its production build, deterministic API tests, and one real GitHub smoke run pass.
It is not advertised as publicly live until the hosted secret and fresh-user gates in
docs/ACCEPTANCE.md pass.

    cd apps/scout
    npm ci
    Copy-Item .dev.vars.example .dev.vars
    npm run dev

The GitHub credential stays server-side. The scout never claims issues, posts comments,
generates unsolicited patches, pushes branches, or opens pull requests.

## Evidence dataset and static snapshot

**[Explore the dated public snapshot](https://legendairy93.github.io/contrib-signals/)**

The Python and SQLite surface remains useful for reproducible research, scheduled
datasets, and auditing the scoring logic. The public snapshot is dated evidence, not a
live recommendation service.

## What it measures

- repository activity and archive state
- presence of contribution and conduct documentation
- sampled outside pull-request merge rate
- open `good first issue` and `help wanted` opportunities
- whether an issue is unassigned, recently updated, and maintainer-authored
- the exact collection timestamp behind every result

The score is deliberately transparent. Read [`sql/schema.sql`](sql/schema.sql) to see
every weight and threshold.

## Quick start

Python 3.11 or newer is sufficient; there are no runtime dependencies.

```bash
python -m pip install -e .

python -m contrib_signals collect \
  --repo vercel/ai \
  --repo pandas-dev/pandas \
  --db data/contrib-signals.sqlite

python -m contrib_signals report --db data/contrib-signals.sqlite --limit 20
python -m contrib_signals export --db data/contrib-signals.sqlite --out data/opportunities.csv
```

Set `GITHUB_TOKEN` for higher API limits. Without it, GitHub's public unauthenticated
limit applies.

## Browser dashboard

The static dashboard in `web/` reads a committed JSON snapshot, so it needs no API key,
server, or database at view time. Repository cards expose every score component, filters
operate entirely in the browser, and the matching issue evidence is downloadable as CSV.

Create or refresh both browser artifacts from any collected database:

```bash
python -m contrib_signals snapshot \
  --db data/contrib-signals.sqlite \
  --out web/data/snapshot.json \
  --csv web/data/opportunities.csv
```

Snapshot age calculations are anchored to each repository's `collected_at` value. The
same evidence therefore keeps the same score when reopened later.

## Example SQL

```sql
SELECT
  full_name,
  language,
  contribution_score,
  ready_issues,
  ROUND(external_merge_rate * 100, 1) AS external_merge_pct
FROM repository_scores
WHERE ready_issues > 0
ORDER BY contribution_score DESC;
```

Issue-level investigation:

```sql
SELECT
  repository,
  number,
  title,
  readiness_score,
  maintainer_opened,
  days_since_update,
  html_url
FROM opportunity_scores
ORDER BY readiness_score DESC, repository, number;
```

## Data model

```text
collection_runs  1 ─── * repositories  1 ─── * issues
                              │
                              └──── sampled pull-request evidence
```

Generated databases and CSV exports are ignored by Git. A small reproducible snapshot can
be published as a release asset without committing personal tokens or an ever-growing DB.

## Important limitation

A high score is not maintainer consent. Before coding, read the repository's contribution
and AI-assistance policies, check for competing work, and ask the maintainer when scope is
unclear. The purpose of this project is to reduce wasted investigation—not automate drive-by
contributions.

## Development

```bash
python -m unittest discover -s tests -v
```

MIT licensed.
