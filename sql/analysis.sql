-- Repositories with at least one issue worth investigating.
SELECT
    full_name,
    language,
    contribution_score,
    ready_issues,
    labeled_issues,
    ROUND(external_merge_rate * 100, 1) AS external_merge_pct,
    days_since_push,
    has_contributing
FROM repository_scores
WHERE ready_issues > 0
ORDER BY contribution_score DESC, best_issue_score DESC;

-- Highest-readiness individual opportunities.
SELECT
    repository,
    number,
    title,
    readiness_score,
    maintainer_opened,
    assignee_count,
    days_since_update,
    html_url
FROM opportunity_scores
ORDER BY readiness_score DESC, repository, number;

-- Data-quality checks: every result should return zero rows.
SELECT 'merged_prs_exceed_sample' AS check_name, full_name
FROM repositories
WHERE external_prs_merged > external_prs_sampled;

SELECT 'negative_counts' AS check_name, full_name
FROM repositories
WHERE stars < 0 OR forks < 0 OR open_issues_count < 0;
