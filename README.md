# Contrib Signals

**Find open-source work worth doing, then investigate it before you code.**

Contrib Signals checks current issue state, repository activity, outside-contributor
pull requests, maintainer responses, policies, and possible duplicate work. Every
important signal links back to GitHub evidence.

## Hosted scout

The full-stack app in apps/scout turns a small contribution profile into at most eight
current opportunities, categorical evidence states, visible coverage, a cited investigation brief,
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

## Product direction

Contrib Signals is the active product. Its long-term object is:

> Find worthwhile open-source work, contribute responsibly, and build a verified
> public record of what you accomplished.

The current release is the **Scout**: live discovery, cited evidence, readiness checks,
and a saved investigation worklist. The next product loop is deliberately outcome-led:

1. **Journey** - move an opportunity through investigating, maintainer contact,
   planning, work, pull request, review, and a final merged, declined, or abandoned
   outcome.
2. **Contribution Cards** - turn completed journeys into compact, shareable records
   backed by issue, pull-request, review, and merge evidence.
3. **Personal progress** - use predeclared quest points and private milestones to make
   sustained contribution enjoyable without pretending points measure engineering
   quality.
4. **Constrained boards** - only after verified journeys exist, test small seasonal or
   community boards with explicit rules and abuse resistance.

The ranking layer is not the product. Contrib Signals will not reward lines changed,
commit counts, comments, pull requests opened, self-owned repositories, or AI-estimated
quality. The valuable loop is discovery -> investigation -> attempt -> outcome -> verified
record -> better future recommendations.

## Public GitHub Pages preview

**[Try the browser-only Scout](https://legendairy93.github.io/contrib-signals/)**

The public build preserves the modern Scout interface and performs a bounded anonymous
GitHub issue search directly from the visitor's browser. Deep repository, policy,
outside-PR, and duplicate-work checks are explicitly marked unknown until the Worker phase.

## What it measures

- repository activity and archive state
- presence of contribution and conduct documentation
- sampled outside pull-request merge rate
- open `good first issue` and `help wanted` opportunities
- whether an issue is unassigned, recently updated, and maintainer-authored
- the exact collection timestamp behind every result

Raw observations remain queryable in SQLite. Missing evidence and negative evidence
are kept separate; the public product no longer presents a synthetic total.

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

The GitHub Pages entrypoint lives in `apps/scout/github-pages/` and reuses the production
Scout component and design system. It needs no API key, server, or database at view time;
the Pages workflow builds the static bundle before deployment. Anonymous rate limits are
reported rather than hidden, and no fallback result is substituted.

Create or refresh both browser artifacts from any collected database:

```bash
python -m contrib_signals snapshot \
  --db data/contrib-signals.sqlite \
  --out web/data/snapshot.json \
  --csv web/data/opportunities.csv
```

Snapshot age calculations are anchored to each repository's `collected_at` value. The
same evidence therefore keeps the same classification when reopened later.

## Example SQL

```sql
SELECT full_name, language, pushed_at,
       external_prs_merged, external_prs_sampled,
       has_contributing, collected_at
FROM repositories
ORDER BY pushed_at DESC, full_name;
```

Issue-level investigation:

```sql
SELECT repository, number, title, labels,
       assignee_count, maintainer_opened,
       updated_at, html_url
FROM issues
ORDER BY updated_at DESC, repository, number;
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

Promising evidence is not maintainer consent. Before coding, read the repository's contribution
and AI-assistance policies, check for competing work, and ask the maintainer when scope is
unclear. The purpose of this project is to reduce wasted investigation—not automate drive-by
contributions.

## Development

```bash
python -m unittest discover -s tests -v
```

MIT licensed.
