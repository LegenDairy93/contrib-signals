PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collection_runs (
    id INTEGER PRIMARY KEY,
    collected_at TEXT NOT NULL,
    collector_version TEXT NOT NULL,
    repository_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repositories (
    full_name TEXT PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES collection_runs(id),
    html_url TEXT NOT NULL,
    description TEXT,
    language TEXT,
    stars INTEGER NOT NULL,
    forks INTEGER NOT NULL,
    open_issues_count INTEGER NOT NULL,
    archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
    pushed_at TEXT,
    license_spdx TEXT,
    has_contributing INTEGER NOT NULL CHECK (has_contributing IN (0, 1)),
    has_code_of_conduct INTEGER NOT NULL CHECK (has_code_of_conduct IN (0, 1)),
    external_prs_sampled INTEGER NOT NULL,
    external_prs_merged INTEGER NOT NULL,
    collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
    repository TEXT NOT NULL REFERENCES repositories(full_name) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    html_url TEXT NOT NULL,
    labels TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    comments INTEGER NOT NULL,
    assignee_count INTEGER NOT NULL,
    author_association TEXT NOT NULL,
    maintainer_opened INTEGER NOT NULL CHECK (maintainer_opened IN (0, 1)),
    beginner_labeled INTEGER NOT NULL CHECK (beginner_labeled IN (0, 1)),
    PRIMARY KEY (repository, number)
);

DROP VIEW IF EXISTS opportunity_scores;
CREATE VIEW opportunity_scores AS
SELECT
    i.*,
    CAST(julianday(r.collected_at) - julianday(i.updated_at) AS INTEGER) AS days_since_update,
    CASE WHEN i.beginner_labeled = 1 THEN 25 ELSE 0 END AS label_score,
    CASE WHEN i.assignee_count = 0 THEN 20 ELSE 0 END AS assignment_score,
    CASE WHEN i.maintainer_opened = 1 THEN 20 ELSE 0 END AS maintainer_score,
    CASE
        WHEN julianday(r.collected_at) - julianday(i.updated_at) <= 30 THEN 20
        WHEN julianday(r.collected_at) - julianday(i.updated_at) <= 90 THEN 10
        ELSE 0
    END AS freshness_score,
    CASE WHEN i.comments BETWEEN 1 AND 12 THEN 15 ELSE 5 END AS discussion_score,
    (
        CASE WHEN i.beginner_labeled = 1 THEN 25 ELSE 0 END +
        CASE WHEN i.assignee_count = 0 THEN 20 ELSE 0 END +
        CASE WHEN i.maintainer_opened = 1 THEN 20 ELSE 0 END +
        CASE
            WHEN julianday(r.collected_at) - julianday(i.updated_at) <= 30 THEN 20
            WHEN julianday(r.collected_at) - julianday(i.updated_at) <= 90 THEN 10
            ELSE 0
        END +
        CASE WHEN i.comments BETWEEN 1 AND 12 THEN 15 ELSE 5 END
    ) AS readiness_score
FROM issues i
JOIN repositories r ON r.full_name = i.repository;

DROP VIEW IF EXISTS repository_scores;
CREATE VIEW repository_scores AS
WITH issue_summary AS (
    SELECT
        repository,
        COUNT(*) AS labeled_issues,
        SUM(CASE WHEN readiness_score >= 70 THEN 1 ELSE 0 END) AS ready_issues,
        MAX(readiness_score) AS best_issue_score
    FROM opportunity_scores
    GROUP BY repository
), repo_base AS (
    SELECT
        r.*,
        CASE
            WHEN r.external_prs_sampled = 0 THEN 0.0
            ELSE CAST(r.external_prs_merged AS REAL) / r.external_prs_sampled
        END AS external_merge_rate,
        CAST(julianday(r.collected_at) - julianday(r.pushed_at) AS INTEGER) AS days_since_push
    FROM repositories r
), scored AS (
    SELECT
        b.*,
        COALESCE(s.labeled_issues, 0) AS labeled_issues,
        COALESCE(s.ready_issues, 0) AS ready_issues,
        COALESCE(s.best_issue_score, 0) AS best_issue_score,
        CASE WHEN b.archived = 1 THEN -100 ELSE 0 END AS archive_score,
        CASE
            WHEN b.days_since_push <= 14 THEN 25
            WHEN b.days_since_push <= 45 THEN 20
            WHEN b.days_since_push <= 120 THEN 10
            ELSE 0
        END AS activity_score,
        CASE
            WHEN b.external_merge_rate >= 0.60 THEN 30
            WHEN b.external_merge_rate >= 0.30 THEN 20
            WHEN b.external_merge_rate > 0 THEN 10
            ELSE 0
        END AS external_merge_score,
        CASE WHEN b.has_contributing = 1 THEN 10 ELSE 0 END +
        CASE WHEN b.has_code_of_conduct = 1 THEN 5 ELSE 0 END AS documentation_score,
        CASE
            WHEN COALESCE(s.ready_issues, 0) >= 3 THEN 30
            WHEN COALESCE(s.ready_issues, 0) >= 1 THEN 20
            WHEN COALESCE(s.labeled_issues, 0) >= 1 THEN 10
            ELSE 0
        END AS opportunity_score
    FROM repo_base b
    LEFT JOIN issue_summary s ON s.repository = b.full_name
)
SELECT
    s.*,
    (
        s.archive_score +
        s.activity_score +
        s.external_merge_score +
        s.documentation_score +
        s.opportunity_score
    ) AS contribution_score
FROM scored s;
