import type { Opportunity, ScoutInput, ScoutResponse } from "../worker/scout";
import type { ScoutTransport } from "../app/ScoutClient";

const SEARCH_API = "https://api.github.com/search/issues";
const RESULT_LIMIT = 8;
const REPOSITORY_LIMIT = 4;
const REQUEST_LIMIT = 2;

type SearchIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  repository_url: string;
  updated_at: string;
  comments: number;
  locked?: boolean;
  labels: Array<{ name?: string } | string>;
  author_association?: string;
};

type TaggedIssue = { issue: SearchIssue; language: string };

function labels(issue: SearchIssue) {
  return issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean);
}

function repositoryName(issue: SearchIssue) {
  return issue.repository_url.split("/repos/")[1] ?? "unknown/unknown";
}

function workType(issue: SearchIssue): Opportunity["contributionType"] {
  const text = `${issue.title} ${labels(issue).join(" ")}`.toLowerCase();
  if (/\b(doc|docs|documentation|readme|guide|typo|example)\b/.test(text)) return "documentation";
  if (/\b(test|tests|testing|coverage|spec)\b/.test(text)) return "tests";
  if (/\b(design|ux|ui|accessibility|a11y)\b/.test(text)) return "design";
  if (/\b(triage|reproduce|reproduction)\b/.test(text)) return "triage";
  return "code";
}

function ageState(updatedAt: string): Opportunity["readiness"]["activity"] {
  const age = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (age <= 30) return "recent";
  if (age <= 90) return "aging";
  return "stale";
}

function summary(issue: SearchIssue) {
  const plain = (issue.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`#>*_()!-]/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? `${plain.slice(0, 260)}${plain.length > 260 ? "…" : ""}` : "No issue description was returned. Open the discussion before choosing this work.";
}

function skillMatches(input: ScoutInput, type: Opportunity["contributionType"]) {
  const needles = type === "documentation" ? ["documentation"] : type === "tests" ? ["testing"] : type === "design" ? ["frontend"] : ["bug fixing", "backend", "frontend", "apis"];
  return input.skills.filter((skill) => needles.includes(skill.toLowerCase()));
}

function toOpportunity(tagged: TaggedIssue, input: ScoutInput): Opportunity {
  const { issue, language } = tagged;
  const repository = repositoryName(issue);
  const type = workType(issue);
  const activity = ageState(issue.updated_at);
  const matches = skillMatches(input, type);
  const maintainerOpened = ["owner", "member", "collaborator"].includes((issue.author_association ?? "").toLowerCase());
  const readinessState: Opportunity["readiness"]["state"] = issue.locked || activity === "stale" ? "pause" : "investigate";

  return {
    id: `${repository}#${issue.number}`,
    repository,
    repositoryUrl: `https://github.com/${repository}`,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    title: issue.title,
    summary: summary(issue),
    language,
    labels: labels(issue),
    updatedAt: issue.updated_at,
    contributionType: type,
    fit: {
      level: matches.length ? "strong" : "possible",
      languageMatch: true,
      skillMatches: matches,
      interestMatches: [],
      experienceMatch: "uncertain",
      timeMatch: "uncertain",
    },
    readiness: {
      state: readinessState,
      activity,
      outsiderEvidence: "unknown",
      contributionGuide: "not-found",
      competingWork: "not-found",
    },
    evidenceCoverage: { level: "thin", checksObserved: 3, checksPossible: 10, outsidePullSample: 0 },
    fitReasons: [
      `${language} matches your selected stack.`,
      ...(matches.length ? [`The issue text suggests ${matches.join(", ").toLowerCase()} work.`] : []),
    ],
    readinessReasons: [
      `The issue is currently open, unassigned, and labelled for contributors.`,
      `Its discussion was updated ${activity === "recent" ? "recently" : activity === "aging" ? "within the last three months" : "more than three months ago"}.`,
      ...(maintainerOpened ? ["The issue opener is associated with the repository."] : []),
    ],
    reasonsNotToContribute: readinessState === "pause" ? [issue.locked ? "The issue discussion is locked." : "The issue evidence is stale."] : [],
    uncertainty: [
      "The browser-only preview does not inspect repository setup, contribution policy, or duplicate pull requests.",
      "A good-first-issue label is not a difficulty guarantee or maintainer permission.",
      `${issue.comments} discussion comment${issue.comments === 1 ? "" : "s"} require manual review.`,
    ],
    duplicateRisk: [],
    brief: {
      scope: "Issue-level preview only",
      likelyCodeAreas: ["Not inspected in the browser-only preview"],
      setupCommands: ["Open the repository contribution guide before cloning"],
      testCommands: ["Not inspected in the browser-only preview"],
      contributionRules: ["Repository policies were not fetched in this two-request preview"],
      discussion: [`Read all ${issue.comments} existing comment${issue.comments === 1 ? "" : "s"} before starting`],
      policyChecks: [
        { name: "Contribution guide", status: "unknown", detail: "Not inspected in static preview" },
        { name: "Code of conduct", status: "unknown", detail: "Not inspected in static preview" },
        { name: "Security policy", status: "unknown", detail: "Not inspected in static preview" },
        { name: "AI-assistance policy", status: "unknown", detail: "Not inspected in static preview" },
      ],
      aiPolicy: "Unknown. Search the repository documentation and discussion before using AI assistance.",
      risks: ["Competing work and maintainer intent remain unknown"],
    },
    repositorySignals: { lastPush: "", stars: 0, communityHealth: null, sampledOutsidePulls: 0, sampledOutsideMerged: 0, sampledMaintainerResponses: 0 },
    evidence: [
      { label: "Current issue", url: issue.html_url, observedAt: new Date().toISOString(), detail: "Open, unassigned, labelled issue returned by GitHub search" },
      { label: "Repository", url: `https://github.com/${repository}`, observedAt: new Date().toISOString(), detail: "Repository requires manual investigation in static mode" },
    ],
  };
}

function searchUrl(language: string, label: string) {
  const query = [`is:issue`, `is:open`, `no:assignee`, `label:"${label}"`, `language:"${language.replace(/[^A-Za-z0-9+#. -]/g, "")}"`].join(" ");
  const params = new URLSearchParams({ q: query, sort: "updated", order: "desc", per_page: "12" });
  return `${SEARCH_API}?${params}`;
}

async function requestIssues(language: string, label: string, signal?: AbortSignal): Promise<SearchIssue[]> {
  const response = await fetch(searchUrl(language, label), { signal });
  if (response.status === 403 || response.status === 429) throw new Error("GitHub temporarily rate-limited anonymous discovery on this network. Try again later; no cached result was substituted.");
  if (!response.ok) throw new Error(`GitHub discovery stopped with HTTP ${response.status}.`);
  const payload = await response.json() as { items?: SearchIssue[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function diversify(items: TaggedIssue[]) {
  const unique = new Map<string, TaggedIssue>();
  for (const item of items) unique.set(`${repositoryName(item.issue)}#${item.issue.number}`, item);
  const groups = new Map<string, TaggedIssue[]>();
  for (const item of unique.values()) {
    const repository = repositoryName(item.issue);
    if (!groups.has(repository) && groups.size >= REPOSITORY_LIMIT) continue;
    groups.set(repository, [...(groups.get(repository) ?? []), item]);
  }
  const selected: TaggedIssue[] = [];
  for (let depth = 0; selected.length < RESULT_LIMIT; depth += 1) {
    let added = false;
    for (const group of groups.values()) {
      if (group[depth]) { selected.push(group[depth]); added = true; }
      if (selected.length === RESULT_LIMIT) break;
    }
    if (!added) break;
  }
  return selected;
}

async function scout(input: ScoutInput): Promise<ScoutResponse> {
  const searched = input.languages.slice(0, REQUEST_LIMIT);
  const tagged: TaggedIssue[] = [];
  const queries: string[] = [];
  let calls = 0;
  for (const language of searched) {
    const label = "good first issue";
    queries.push(searchUrl(language, label));
    const issues = await requestIssues(language, label);
    calls += 1;
    tagged.push(...issues.map((issue) => ({ issue, language })));
  }
  if (searched.length === 1 && diversify(tagged).length < RESULT_LIMIT) {
    queries.push(searchUrl(searched[0], "help wanted"));
    const issues = await requestIssues(searched[0], "help wanted");
    calls += 1;
    tagged.push(...issues.map((issue) => ({ issue, language: searched[0] })));
  }
  const selected = diversify(tagged);
  return {
    generatedAt: new Date().toISOString(),
    query: queries[0] ?? "",
    queries,
    input,
    opportunities: selected.map((item) => toOpportunity(item, input)),
    excluded: [],
    coverage: {
      languagesRequested: input.languages,
      languagesSearched: searched,
      candidatesExamined: tagged.length,
      repositoriesInspected: 0,
      repositoryLimit: 0,
      resultLimit: RESULT_LIMIT,
      labelFamilies: searched.length === 1 && calls === 2 ? ["good first issue", "help wanted"] : ["good first issue"],
      blindSpots: [
        "Static preview: repository files, policies, pull requests, and duplicate work are not inspected.",
        ...(input.languages.length > searched.length ? [`Anonymous mode searched only ${searched.length} of ${input.languages.length} selected languages.`] : []),
      ],
    },
    limits: { githubCalls: calls, maxGithubCalls: REQUEST_LIMIT, cache: "miss" },
    notice: "Anonymous issue-level preview. Deep evidence checks require the later Worker phase.",
  };
}

async function refresh(input: ScoutInput, saved: Opportunity[]): Promise<ScoutResponse> {
  const refreshed: Opportunity[] = [];
  const targets = saved.slice(0, 6);
  for (const item of targets) {
    const response = await fetch(`https://api.github.com/repos/${item.repository}/issues/${item.issueNumber}`);
    if (response.status === 403 || response.status === 429) throw new Error("GitHub temporarily rate-limited quest log refresh on this network.");
    if (!response.ok) continue;
    const issue = await response.json() as SearchIssue & { state?: string; assignee?: unknown; pull_request?: unknown };
    if (issue.state === "open" && !issue.assignee && !issue.pull_request) refreshed.push(toOpportunity({ issue, language: item.language }, input));
  }
  return {
    generatedAt: new Date().toISOString(), query: "targeted quest log refresh", queries: [], input,
    opportunities: refreshed, excluded: [],
    coverage: { languagesRequested: input.languages, languagesSearched: [], candidatesExamined: targets.length, repositoriesInspected: 0, repositoryLimit: 0, resultLimit: 6, labelFamilies: [], blindSpots: ["Refresh checks current issue state only."] },
    limits: { githubCalls: targets.length, maxGithubCalls: 6, cache: "miss" },
    notice: "Issue-state refresh only.",
  };
}

export const staticScoutTransport: ScoutTransport = {
  modeLabel: "GITHUB PAGES / LIVE PREVIEW",
  scout,
  refresh,
};
