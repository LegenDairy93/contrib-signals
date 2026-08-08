# Contrib Signals

**An auditable SQLite dataset for finding open-source repositories where outside contributions are likely to be reviewed.**

`good first issue` is only a label. It does not tell you whether a repository is active,
whether outside pull requests are merged, whether the issue is already stale, or whether
the documented contribution path exists.

Contrib Signals collects public GitHub evidence, stores it in SQLite, and calculates its
rankings in readable SQL. It recommends places to investigate; it never claims issues,
posts comments, generates patches, or opens pull requests.

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
