import { consumeQuota, type QuotaDatabase } from "./quota";

const API = "https://api.github.com";
const MAX_CALLS = 48;
const CACHE_MS = 300_000;
const MAX_RESULTS = 8;
const MAX_REPOS = 5;
const MAX_ISSUE_AGE_DAYS = 120;
const SEARCH_PAGE_SIZE = 25;
const REPO_ENRICHMENT_CALLS = 8;

const SEARCH_STRATEGIES = [
  {
    name: "beginner-entry",
    labels: ["good first issue", "beginner", "starter", "first-timers-only"],
    active: false,
  },
  {
    name: "active-help",
    labels: [
      "good first issue", "beginner", "starter", "first-timers-only",
      "help wanted", "low hanging fruit", "contributor friendly", "difficulty: easy",
    ],
    active: true,
  },
] as const;

export type ScoutInput = {
  languages: string[];
  skills: string[];
  interests: string[];
  experience: "beginner" | "intermediate" | "advanced";
  time: "one-hour" | "few-hours" | "weekend";
};

type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  repository_url: string;
  updated_at: string;
  created_at: string;
  state?: string;
  comments: number;
  assignee: unknown | null;
  labels: Array<{ name?: string } | string>;
  user: { login: string };
  author_association?: string;
  locked?: boolean;
  pull_request?: unknown;
};
type SearchCandidate = {
  issue: Issue;
  language: string;
  strategies: string[];
  pages: number[];
  activeHelpMatch: boolean;
};

type RankedCandidate = SearchCandidate & {
  score: number;
  rankReasons: string[];
};


type Repo = {
  full_name: string;
  html_url: string;
  description: string | null;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  pushed_at: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  owner: { login: string };
};

type Pull = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  author_association?: string;
};

type CommunityFile = { html_url?: string | null; url?: string | null };
type Community = {
  health_percentage?: number;
  files?: {
    code_of_conduct?: CommunityFile | null;
    contributing?: CommunityFile | null;
    issue_template?: CommunityFile | null;
    pull_request_template?: CommunityFile | null;
    readme?: CommunityFile | null;
  };
};
type Content = { content?: string; encoding?: string; html_url?: string };
type Tree = { truncated?: boolean; tree?: Array<{ path: string; type: string }> };
type Commit = { sha: string; html_url?: string };
type Evidence = { label: string; url: string; observedAt: string; detail: string };

export type Opportunity = {
  id: string;
  repository: string;
  repositoryUrl: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  summary: string;
  language: string;
  discovery?: {
    preRankScore: number;
    preRankReasons: string[];
    searchStrategies: string[];
  };
  labels: string[];
  updatedAt: string;
  contributionType: "code" | "tests" | "documentation" | "design" | "triage" | "other";
  fit: {
    level: "strong" | "possible" | "weak";
    languageMatch: boolean;
    skillMatches: string[];
    interestMatches: string[];
    experienceMatch: "supported" | "uncertain" | "stretch";
    timeMatch: "plausible" | "uncertain" | "unlikely";
  };
  readiness: {
    state: "promising" | "investigate" | "pause";
    activity: "recent" | "aging" | "stale";
    outsiderEvidence: "positive" | "mixed" | "negative" | "unknown";
    contributionGuide: "found" | "not-found";
    competingWork: "found" | "not-found";
  };
  evidenceCoverage: {
    level: "strong" | "partial" | "thin";
    checksObserved: number;
    checksPossible: number;
    outsidePullSample: number;
  };
  fitReasons: string[];
  readinessReasons: string[];
  reasonsNotToContribute: string[];
  uncertainty: string[];
  duplicateRisk: Array<{ title: string; url: string; state: string }>;
  brief: {
    scope: string;
    likelyCodeAreas: string[];
    setupCommands: string[];
    testCommands: string[];
    contributionRules: string[];
    discussion: string[];
    policyChecks: Array<{ name: string; status: "found" | "not-found" | "unknown"; detail: string; url?: string }>;
    aiPolicy: string;
    risks: string[];
  };
  repositorySignals: {
    defaultBranch: string;
    observedCommit: string;
    lastPush: string;
    stars: number;
    communityHealth: number | null;
    sampledOutsidePulls: number;
    sampledOutsideMerged: number;
    sampledMaintainerResponses: number | null;
  };
  evidence: Evidence[];
};

export type ScoutResponse = {
  generatedAt: string;
  query: string;
  queries: string[];
  input: ScoutInput;
  opportunities: Opportunity[];
  excluded: Array<{ issue: string; url: string; reason: string }>;
  coverage: {
    languagesRequested: string[];
    languagesSearched: string[];
    candidatesExamined: number;
    repositoriesInspected: number;
    repositoryLimit: number;
    resultLimit: number;
    labelFamilies: string[];
    searchStrategies?: string[];
    searchPages?: number;
    candidatesRetrieved?: number;
    candidatesDeduplicated?: number;
    eligibleCandidates?: number;
    preRankedCandidates?: number;
    repositoriesConsidered?: number;
    exclusionCounts?: {
      assigned: number;
      staleIssue: number;
      invalidRepository: number;
      unavailableRepository: number;
      inactiveRepository: number;
    };
    blindSpots: string[];
  };
  limits: { githubCalls: number; maxGithubCalls: number; cache: "hit" | "miss" };
  notice: string;
};

type EnvLike = { GITHUB_TOKEN?: string; DB?: QuotaDatabase };
type RepoEvidence = {
  repo: Repo;
  head: Commit;
  community: Community | null;
  pulls: Pull[];
  contribution: string;
  readme: string;
  security: string;
  tree: Tree | null;
  maintainerResponses: number | null;
  links: Evidence[];
};

const cache = new Map<string, { expires: number; value: ScoutResponse }>();

function usableGitHubToken(value?: string) {
  const token = value?.trim();
  if (!token || /replace_me|your_(?:github_)?token/i.test(token)) return undefined;
  return token;
}

function localPreviewHost(request: Request) {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(request.url).hostname);
}


export class ScoutError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const unique = <T,>(values: T[]) => [...new Set(values)];
const safeText = (value: unknown, max: number) =>
  typeof value === "string"
    ? value.trim().replace(/\p{Cc}/gu, " ").slice(0, max)
    : "";
const safeList = (value: unknown, count: number, max: number) =>
  Array.isArray(value)
    ? unique(value.map((item) => safeText(item, max)).filter(Boolean)).slice(0, count)
    : [];

export function validateInput(raw: unknown): ScoutInput {
  if (!raw || typeof raw !== "object") throw new ScoutError(400, "Send a JSON scout profile.");
  const body = raw as Record<string, unknown>;
  const languages = safeList(body.languages, 3, 24);
  const skills = safeList(body.skills, 5, 32);
  const interests = safeList(body.interests, 5, 40);
  const experience = safeText(body.experience, 20);
  const time = safeText(body.time, 20);
  if (!languages.length) throw new ScoutError(400, "Choose at least one language.");
  if (!["beginner", "intermediate", "advanced"].includes(experience)) {
    throw new ScoutError(400, "Choose a valid experience level.");
  }
  if (!["one-hour", "few-hours", "weekend"].includes(time)) {
    throw new ScoutError(400, "Choose a valid time budget.");
  }
  return { languages, skills, interests, experience, time } as ScoutInput;
}

const normalized = (input: ScoutInput) =>
  JSON.stringify({
    languages: [...input.languages].sort(),
    skills: [...input.skills].sort(),
    interests: [...input.interests].sort(),
    experience: input.experience,
    time: input.time,
  });

const tokens = (value: string) =>
  unique(
    value
      .toLowerCase()
      .replace(/[^a-z0-9+#.\-/]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );

const overlap = (left: string, right: string) => {
  const seen = new Set(tokens(left));
  return tokens(right).filter((word) => seen.has(word)).length;
};

const repoFromUrl = (url: string) => {
  const marker = "/repos/";
  const index = url.indexOf(marker);
  return index < 0 ? "" : url.slice(index + marker.length);
};
const issueLabels = (issue: Issue) =>
  issue.labels
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .filter(Boolean);
const daysSince = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
const isOutside = (association?: string) =>
  !["OWNER", "MEMBER", "COLLABORATOR"].includes(association ?? "NONE");

const decode = (file: Content | null) => {
  if (!file?.content || file.encoding !== "base64") return "";
  try {
    return atob(file.content.replace(/\n/g, ""));
  } catch {
    return "";
  }
};

const summary = (body: string | null) => {
  const cleaned = (body ?? "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/\x60{3}[^]*?\x60{3}/g, " ")
    .replace(/[#>*_\x60[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    ? cleaned.slice(0, 260)
    : "The issue does not provide a usable written scope yet.";
};

const commands = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[$>]\s*/, ""));
  return {
    setup: unique(
      lines.filter((line) =>
        /^(npm|pnpm|yarn|bun|pip|uv|poetry|cargo|go)\s+(install|sync|setup|fetch|mod download)/i.test(line),
      ),
    ).slice(0, 4),
    tests: unique(
      lines.filter((line) =>
        /^(npm|pnpm|yarn|bun)\s+(run\s+)?test|^(pytest|python -m pytest|cargo test|go test)/i.test(line),
      ),
    ).slice(0, 4),
  };
};

const rules = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*#>]+\s*/, "").trim())
    .filter(
      (line) =>
        /before|must|should|required|test|issue|pull request|sign|format|lint/i.test(line) &&
        line.length >= 20,
    )
    .slice(0, 4);

const detectedAiPolicy = (text: string) => {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) =>
      /\b(ai|llm|chatgpt|copilot|generated code|artificial intelligence)\b/i.test(item),
    );
  return line
    ? "Detected policy text: " + line.slice(0, 220)
    : "No explicit AI-assistance rule was detected in the sampled contribution document.";
};

class GitHub {
  calls = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  private deadline = Date.now() + 55_000;

  constructor(private token?: string) {}

  private async enter() {
    if (this.active >= 4) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }

  async get<T>(pathOrUrl: string, optional = false): Promise<T | null> {
    if (++this.calls > MAX_CALLS) {
      throw new ScoutError(503, "The evidence budget was exhausted; narrow the search and retry.");
    }
    const release = await this.enter();
    try {
      const url = pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "forkyssey/0.2",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (this.token) headers.Authorization = "Bearer " + this.token;
      const remaining = this.deadline - Date.now();
      if (remaining <= 0) {
        if (optional) return null;
        throw new ScoutError(504, "The bounded GitHub evidence window expired.");
      }
      let response: Response;
      try {
        response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        });
      } catch {
        if (optional) return null;
        throw new ScoutError(504, "GitHub did not respond within the evidence timeout.");
      }
      if (optional && response.status === 404) return null;
      if (response.status === 403 || response.status === 429) {
        throw new ScoutError(
          503,
          "GitHub rate-limited this scout run. Try again after the cache window.",
        );
      }
      if (!response.ok) {
        throw new ScoutError(502, "GitHub evidence request failed (" + response.status + ").");
      }
      try {
        return (await response.json()) as T;
      } catch {
        if (optional) return null;
        throw new ScoutError(504, "GitHub returned an incomplete response before the evidence timeout.");
      }
    } finally {
      release();
    }
  }
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await run(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return output;
}

async function collectRepo(
  github: GitHub,
  fullName: string,
  observedAt: string,
): Promise<RepoEvidence> {
  const encoded = fullName.split("/").map(encodeURIComponent).join("/");
  const repo = await github.get<Repo>("/repos/" + encoded);
  if (!repo) throw new ScoutError(502, "Repository evidence was unavailable.");
  const [community, pulls, rootSecurity, tree, head] = await Promise.all([
    github.get<Community>("/repos/" + encoded + "/community/profile", true),
    github.get<Pull[]>("/repos/" + encoded + "/pulls?state=all&sort=updated&direction=desc&per_page=20", true),
    github.get<Content>("/repos/" + encoded + "/contents/SECURITY.md", true),
    github.get<Tree>(
      "/repos/" + encoded + "/git/trees/" + encodeURIComponent(repo.default_branch),
      true,
    ),
    github.get<Commit>(
      "/repos/" + encoded + "/commits/" + encodeURIComponent(repo.default_branch),
    ),
  ]);
  if (!head?.sha) throw new ScoutError(502, "The repository head commit was unavailable.");
  const securityPath = (tree?.tree ?? [])
    .map((entry) => entry.path)
    .find((entry) => [".github/security.md", "docs/security.md"].includes(entry.toLowerCase()));
  const security = rootSecurity ?? (securityPath ? {
    html_url: repo.html_url + "/blob/" + repo.default_branch + "/" + securityPath,
  } : null);
  const profile = community ?? null;
  const contributionUrl = profile?.files?.contributing?.url ?? null;
  const readmeUrl = profile?.files?.readme?.url ?? null;
  const [contributionFile, readmeFile] = await Promise.all([
    contributionUrl ? github.get<Content>(contributionUrl, true) : Promise.resolve(null),
    readmeUrl ? github.get<Content>(readmeUrl, true) : Promise.resolve(null),
  ]);
  const pullList = pulls ?? [];
  const maintainerResponses = null;

  const links: Evidence[] = [
    {
      label: "Repository",
      url: repo.html_url,
      observedAt,
      detail: "Last pushed " + repo.pushed_at + ".",
    },
  ];
  const files = profile?.files;
  const policyLinks: Array<[string, CommunityFile | null | undefined]> = [
    ["Contribution guide", files?.contributing],
    ["Code of conduct", files?.code_of_conduct],
    ["Issue template", files?.issue_template],
    ["Pull request template", files?.pull_request_template],
    ["README", files?.readme],
  ];
  for (const [label, file] of policyLinks) {
    if (file?.html_url) {
      links.push({
        label,
        url: file.html_url,
        observedAt,
        detail: label + " detected by GitHub community profile.",
      });
    }
  }
  if (security?.html_url) {
    links.push({
      label: "Security policy",
      url: security.html_url,
      observedAt,
      detail: "SECURITY.md found at the repository root.",
    });
  }
  return {
    repo,
    head,
    community: profile,
    pulls: pullList,
    contribution: decode(contributionFile),
    readme: decode(readmeFile),
    security: decode(security),
    tree: tree ?? null,
    maintainerResponses,
    links,
  };
}

function likelyAreas(issue: Issue, repo: Repo, tree: Tree | null): string[] {
  const body = issue.title + "\n" + (issue.body ?? "");
  const explicit = [...body.matchAll(/\x60([^\x60\n]+\.[a-z0-9]{1,8})\x60/gi)].map(
    (match) => match[1],
  );
  const paths = (tree?.tree ?? [])
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path);
  const words = tokens(body).filter((word) => word.length > 3).slice(0, 20);
  const inferred = paths
    .filter((path) => words.some((word) => path.toLowerCase().includes(word)))
    .sort((left, right) => left.length - right.length)
    .slice(0, 4);
  const values = unique([...explicit, ...inferred]).slice(0, 5);
  return values.length
    ? values
    : ["No code path is evidenced yet; inspect " + repo.default_branch + " before committing."];
}

function relatedPulls(issue: Issue, pulls: Pull[]) {
  return pulls
    .map((pull) => ({ pull, relevance: overlap(issue.title, pull.title) }))
    .filter(({ relevance }) => relevance >= 2)
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 4)
    .map(({ pull }) => ({
      title: "#" + pull.number + " " + pull.title,
      url: pull.html_url,
      state: pull.merged_at ? "merged" : pull.state,
    }));
}

function buildOpportunity(
  issue: Issue,
  evidence: RepoEvidence,
  input: ScoutInput,
  now: Date,
  candidateIssues: Issue[] = [],
): Opportunity {
  const repo = evidence.repo;
  const language = repo.language ?? "Not reported";
  const issueAge = daysSince(issue.updated_at, now);
  const repoAge = daysSince(repo.pushed_at, now);
  const labels = issueLabels(issue);
  const haystack = (
    repo.full_name +
    " " +
    (repo.description ?? "") +
    " " +
    issue.title +
    " " +
    (issue.body ?? "") +
    " " +
    labels.join(" ")
  ).toLowerCase();
  const languageMatch = input.languages.some(
    (item) => item.toLowerCase() === language.toLowerCase(),
  );
  const skillMatches = input.skills.filter((item) =>
    haystack.includes(item.toLowerCase()),
  );
  const interestMatches = input.interests.filter((item) =>
    haystack.includes(item.toLowerCase()),
  );
  const complexity = tokens(issue.body ?? "").length;
  const beginnerSignal = labels.some((label) =>
    /good first|beginner|starter|easy/i.test(label),
  );
  const experienceMatch: Opportunity["fit"]["experienceMatch"] =
    input.experience === "advanced"
      ? "supported"
      : beginnerSignal
        ? "supported"
        : input.experience === "intermediate"
          ? "uncertain"
          : "stretch";
  const timeMatch: Opportunity["fit"]["timeMatch"] =
    input.time === "one-hour"
      ? complexity <= 120 ? "plausible" : complexity <= 260 ? "uncertain" : "unlikely"
      : input.time === "few-hours"
        ? complexity <= 350 ? "plausible" : complexity <= 650 ? "uncertain" : "unlikely"
        : complexity <= 900 ? "plausible" : "uncertain";
  const profileMatches = skillMatches.length + interestMatches.length;
  const fitLevel: Opportunity["fit"]["level"] =
    languageMatch && profileMatches > 0 && experienceMatch !== "stretch" && timeMatch !== "unlikely"
      ? "strong"
      : languageMatch && timeMatch !== "unlikely"
        ? "possible"
        : "weak";
  const typeText = issue.title + " " + (issue.body ?? "") + " " + labels.join(" ");
  const contributionType: Opportunity["contributionType"] =
    /docs?|documentation|readme|guide/i.test(typeText) ? "documentation"
      : /test|testing|coverage|fixture/i.test(typeText) ? "tests"
        : /design|ux|ui|accessibility|a11y/i.test(typeText) ? "design"
          : /triage|reproduce|investigate/i.test(typeText) ? "triage"
            : /fix|bug|feature|implement|refactor|code|api/i.test(typeText) ? "code" : "other";

  const relatedIssues = candidateIssues
    .filter((candidate) =>
      candidate.number !== issue.number &&
      repoFromUrl(candidate.repository_url) === repo.full_name &&
      overlap(issue.title, candidate.title) >= 2,
    )
    .slice(0, 3)
    .map((candidate) => ({
      title: "Issue #" + candidate.number + " " + candidate.title,
      url: candidate.html_url,
      state: "open",
    }));
  const duplicates = unique(
    [...relatedPulls(issue, evidence.pulls), ...relatedIssues].map((item) =>
      JSON.stringify(item),
    ),
  ).map((item) => JSON.parse(item) as { title: string; url: string; state: string });
  const external = evidence.pulls.filter((pull) => isOutside(pull.author_association));
  const merged = external.filter((pull) => pull.merged_at);
  const contributionPresent = Boolean(
    evidence.community?.files?.contributing?.html_url,
  );
  const templatesPresent = Boolean(
    evidence.community?.files?.issue_template?.html_url,
  );
  const competingWork = duplicates.some((item) => item.state === "open");
  const activity: Opportunity["readiness"]["activity"] =
    issueAge <= 14 && repoAge <= 14 ? "recent" : issueAge <= 45 && repoAge <= 45 ? "aging" : "stale";
  const outsiderEvidence: Opportunity["readiness"]["outsiderEvidence"] =
    external.length === 0
      ? "unknown"
      : external.length < 3
        ? "mixed"
        : merged.length === 0
          ? "negative"
          : merged.length / external.length >= 0.5
            ? "positive"
            : "mixed";
  const foundCommands = commands(evidence.readme + "\n" + evidence.contribution);
  const foundRules = rules(evidence.contribution);
  const checks = [
    issueAge <= 45,
    repoAge <= 45,
    Boolean(evidence.community),
    contributionPresent,
    external.length > 0,
    foundCommands.setup.length > 0,
    foundCommands.tests.length > 0,
  ];
  const checksObserved = checks.filter(Boolean).length;
  const coverageLevel: Opportunity["evidenceCoverage"]["level"] =
    checksObserved >= 6 && external.length >= 5 ? "strong" : checksObserved >= 3 ? "partial" : "thin";
  const readinessState: Opportunity["readiness"]["state"] =
    competingWork || issue.locked || activity === "stale" || outsiderEvidence === "negative"
      ? "pause"
      : contributionPresent && activity === "recent" && coverageLevel !== "thin"
        ? "promising"
        : "investigate";

  const fitReasons = [
    languageMatch
      ? language + " matches your selected stack."
      : language + " is outside your selected primary stack.",
    skillMatches.length
      ? "Matched skills: " + skillMatches.join(", ") + "."
      : "No exact skill keyword match was found.",
    interestMatches.length
      ? "Matched interests: " + interestMatches.join(", ") + "."
      : "No exact interest keyword match was found.",
    experienceMatch === "supported"
      ? "The issue carries an entry signal compatible with your selected experience."
      : experienceMatch === "stretch"
        ? "No beginner-oriented entry signal was found for your selected experience."
        : "Experience fit is uncertain from the available labels.",
    "Time fit is " + timeMatch + "; this is inferred from written scope only, not a duration promise.",
  ];
  const readinessReasons = [
    "Issue updated " +
      issueAge +
      " day(s) ago; repository pushed " +
      repoAge +
      " day(s) ago.",
    contributionPresent
      ? "A contribution guide is present."
      : "No contribution guide was detected by GitHub community profile.",
    merged.length +
      "/" +
      external.length +
      " sampled outside-contributor pull requests were merged.",
    evidence.maintainerResponses +
      "/" +
      Math.min(external.length, 3) +
      " sampled outside pull requests had a maintainer comment.",
  ];
  const reasonsNotToContribute: string[] = [];
  if (competingWork) {
    reasonsNotToContribute.push(
      "A similar open pull request may already be in progress.",
    );
  }
  if (!contributionPresent) {
    reasonsNotToContribute.push(
      "The expected contribution process is not documented in the community profile.",
    );
  }
  if (issueAge > 45) {
    reasonsNotToContribute.push("The issue has not been updated recently.");
  }
  if (repoAge > 45) {
    reasonsNotToContribute.push("The repository has not been pushed recently.");
  }
  if (issue.locked) reasonsNotToContribute.push("The issue conversation is locked.");

  const uncertainty = [
    "Search labels and issue prose are maintainer-provided; difficulty is not independently verified.",
    evidence.tree?.truncated
      ? "GitHub truncated the repository tree, so code-area hints are incomplete."
      : "Code-area hints are lexical, not a code-understanding claim.",
    "Pull-request evidence is a recent sample, not the repository complete history.",
  ];
  const issueEvidence: Evidence = {
    label: "Issue #" + issue.number,
    url: issue.html_url,
    observedAt: now.toISOString(),
    detail: "Open, unassigned, updated " + issue.updated_at + ".",
  };

  return {
    id: repo.full_name + "#" + issue.number,
    repository: repo.full_name,
    repositoryUrl: repo.html_url,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    title: issue.title,
    summary: summary(issue.body),
    language,
    labels,
    updatedAt: issue.updated_at,
    contributionType,
    fit: {
      level: fitLevel,
      languageMatch,
      skillMatches,
      interestMatches,
      experienceMatch,
      timeMatch,
    },
    readiness: {
      state: readinessState,
      activity,
      outsiderEvidence,
      contributionGuide: contributionPresent ? "found" : "not-found",
      competingWork: competingWork ? "found" : "not-found",
    },
    evidenceCoverage: {
      level: coverageLevel,
      checksObserved,
      checksPossible: checks.length,
      outsidePullSample: external.length,
    },
    fitReasons,
    readinessReasons,
    reasonsNotToContribute,
    uncertainty,
    duplicateRisk: duplicates,
    brief: {
      scope: summary(issue.body),
      likelyCodeAreas: likelyAreas(issue, repo, evidence.tree),
      setupCommands: foundCommands.setup.length
        ? foundCommands.setup
        : ["No setup command was evidenced in the sampled README or contribution guide."],
      testCommands: foundCommands.tests.length
        ? foundCommands.tests
        : ["No test command was evidenced in the sampled README or contribution guide."],
      contributionRules: foundRules.length
        ? foundRules
        : ["Read the linked contribution sources before starting; no concise rule was extracted."],
      discussion: [
        issue.comments
          ? issue.comments + " issue comment(s) are part of the scope; read them at the cited issue."
          : "No issue comments were present when collected.",
      ],
      policyChecks: [
        {
          name: "Contribution guide",
          status: contributionPresent ? "found" : "not-found",
          detail: contributionPresent ? "GitHub community profile links a guide; sampled rules are shown above." : "No guide was reported by GitHub community profile.",
          url: evidence.community?.files?.contributing?.html_url ?? undefined,
        },
        {
          name: "Code of conduct",
          status: evidence.community?.files?.code_of_conduct?.html_url ? "found" : "not-found",
          detail: evidence.community?.files?.code_of_conduct?.html_url ? "A code of conduct is linked in the community profile." : "No code of conduct was reported.",
          url: evidence.community?.files?.code_of_conduct?.html_url ?? undefined,
        },
        {
          name: "Issue template",
          status: templatesPresent ? "found" : "not-found",
          detail: templatesPresent ? "An issue template is linked in the community profile." : "No issue template was reported.",
          url: evidence.community?.files?.issue_template?.html_url ?? undefined,
        },
        {
          name: "Security policy",
          status: evidence.security ? "found" : "not-found",
          detail: evidence.security ? "A SECURITY.md file was found in a conventional location." : "No SECURITY.md file was found in sampled conventional locations.",
          url: evidence.links.find((link) => link.label === "Security policy")?.url,
        },
      ],
      aiPolicy: detectedAiPolicy(evidence.contribution + "\n" + evidence.readme),
      risks: unique([...reasonsNotToContribute, ...uncertainty]).slice(0, 6),
    },
    repositorySignals: {
      defaultBranch: repo.default_branch,
      observedCommit: evidence.head.sha,
      lastPush: repo.pushed_at,
      stars: repo.stargazers_count,
      communityHealth: evidence.community?.health_percentage ?? null,
      sampledOutsidePulls: external.length,
      sampledOutsideMerged: merged.length,
      sampledMaintainerResponses: evidence.maintainerResponses,
    },
    evidence: [issueEvidence, ...evidence.links],
  };
}

type SearchRequest = {
  query: string;
  language: string;
  strategy: string;
  page: number;
};

function makeSearchRequests(input: ScoutInput, now: Date): SearchRequest[] {
  const cutoff = new Date(now.getTime() - MAX_ISSUE_AGE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const base = "is:issue is:open is:public archived:false no:assignee -linked:pr ";
  const firstPages = input.languages.flatMap((selectedLanguage) =>
    SEARCH_STRATEGIES.map((strategy) => ({
      query:
        base +
        "updated:>=" +
        cutoff +
        ' label:"' +
        strategy.labels.join('","') +
        '" language:"' +
        selectedLanguage.replace(/["\\]/g, "") +
        '"' +
        (strategy.active ? " comments:>=1" : ""),
      language: selectedLanguage,
      strategy: strategy.name,
      page: 1,
    })),
  );
  const requests = [...firstPages];
  for (const request of firstPages) {
    if (requests.length >= MAX_CALLS - MAX_REPOS * REPO_ENRICHMENT_CALLS) break;
    requests.push({ ...request, page: 2 });
  }
  return requests;
}

function mergeCandidates(
  requests: SearchRequest[],
  pages: Array<{ items?: Issue[] } | null>,
): { candidates: SearchCandidate[]; retrieved: number } {
  const byUrl = new Map<string, SearchCandidate>();
  let retrieved = 0;
  requests.forEach((request, requestIndex) => {
    for (const issue of pages[requestIndex]?.items ?? []) {
      retrieved += 1;
      if (issue.pull_request) continue;
      const existing = byUrl.get(issue.html_url);
      if (existing) {
        existing.strategies = unique([...existing.strategies, request.strategy]);
        existing.pages = unique([...existing.pages, request.page]);
        existing.activeHelpMatch ||= request.strategy === "active-help";
        continue;
      }
      byUrl.set(issue.html_url, {
        issue,
        language: request.language,
        strategies: [request.strategy],
        pages: [request.page],
        activeHelpMatch: request.strategy === "active-help",
      });
    }
  });
  return { candidates: [...byUrl.values()], retrieved };
}

function preRankCandidate(candidate: SearchCandidate, now: Date): RankedCandidate {
  const { issue } = candidate;
  const labels = issueLabels(issue);
  const text = (issue.title + "\n" + (issue.body ?? "") + "\n" + labels.join(" ")).toLowerCase();
  const bodyTokens = tokens(issue.body ?? "").length;
  const age = daysSince(issue.updated_at, now);
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push((points > 0 ? "+" : "") + points + " " + reason);
  };

  if (candidate.activeHelpMatch) add(18, "matched the active help-wanted query");
  if (labels.some((label) => /good first|beginner|starter|first.?timers/i.test(label))) {
    add(16, "has a beginner entry label");
  } else if (labels.some((label) => /help wanted|contributor friendly|low hanging|difficulty.?easy/i.test(label))) {
    add(8, "has a contribution-ready label");
  }
  if (/\b(test|testing|coverage|fixture|docs?|documentation|readme|docstring)\b/i.test(text)) {
    add(8, "looks like bounded test or documentation work");
  }
  if (/acceptance criteria|done when|expected behavior|steps to reproduce/i.test(text)) {
    add(7, "states acceptance or reproduction evidence");
  }
  if (/`[^`\n]+\.[a-z0-9]{1,8}`/i.test(issue.body ?? "")) {
    add(7, "references a concrete file");
  }
  if (["OWNER", "MEMBER", "COLLABORATOR"].includes(issue.author_association ?? "")) {
    add(5, "was opened by a maintainer");
  }
  if (issue.comments <= 6) add(5, "has a low coordination load");
  else if (issue.comments > 20) add(-10, "has a crowded discussion");
  if (age <= 30) add(5, "was updated recently");
  else if (age > 90) add(-4, "is an older maintained candidate");
  if (bodyTokens <= 320) add(4, "has bounded written scope");
  else if (bodyTokens > 700) add(-12, "has broad written scope");
  if (/\b(epic|roadmap|tracker|advisory report|north star|call for|working group)\b/i.test(text)) {
    add(-28, "looks like a tracker, program, or coordination issue");
  }
  return { ...candidate, score, rankReasons: reasons };
}

function rankCandidates(candidates: SearchCandidate[], now: Date): RankedCandidate[] {
  return candidates
    .map((candidate) => preRankCandidate(candidate, now))
    .sort(
      (left, right) =>
        right.score - left.score ||
        new Date(right.issue.updated_at).getTime() - new Date(left.issue.updated_at).getTime() ||
        left.issue.html_url.localeCompare(right.issue.html_url),
    );
}

export async function runScout(
  input: ScoutInput,
  token: string,
): Promise<ScoutResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const searchRequests = makeSearchRequests(input, now);
  const queries = searchRequests.map((request) => request.query);
  const github = new GitHub(token);
  const pages = await mapLimit(searchRequests, 3, (request) =>
    github.get<{ items?: Issue[] }>(
      "/search/issues?q=" +
        encodeURIComponent(request.query) +
        "&sort=updated&order=desc&per_page=" +
        SEARCH_PAGE_SIZE +
        "&page=" +
        request.page,
    ),
  );
  const merged = mergeCandidates(searchRequests, pages);
  const candidates = merged.candidates;
  const excluded: ScoutResponse["excluded"] = [];
  const exclusionCounts = {
    assigned: 0,
    staleIssue: 0,
    invalidRepository: 0,
    unavailableRepository: 0,
    inactiveRepository: 0,
  };
  const eligible: SearchCandidate[] = [];
  const repos = new Set<string>();

  for (const candidate of candidates) {
    const { issue } = candidate;
    const repository = repoFromUrl(issue.repository_url);
    if (!repository) {
      exclusionCounts.invalidRepository += 1;
      continue;
    }
    if (issue.assignee) {
      exclusionCounts.assigned += 1;
      excluded.push({ issue: issue.title, url: issue.html_url, reason: "Already assigned." });
      continue;
    }
    if (daysSince(issue.updated_at, now) > MAX_ISSUE_AGE_DAYS) {
      exclusionCounts.staleIssue += 1;
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Not updated in the last " + MAX_ISSUE_AGE_DAYS + " days.",
      });
      continue;
    }
    eligible.push(candidate);
  }

  const ranked = rankCandidates(eligible, now);
  const selected: RankedCandidate[] = [];
  for (const candidate of ranked) {
    const repository = repoFromUrl(candidate.issue.repository_url);
    if (!repository || repos.has(repository) || repos.size >= MAX_REPOS) continue;
    repos.add(repository);
    selected.push(candidate);
  }
  for (const candidate of ranked) {
    if (selected.length >= MAX_RESULTS) break;
    const repository = repoFromUrl(candidate.issue.repository_url);
    if (
      !repos.has(repository) ||
      selected.some((item) => item.issue.html_url === candidate.issue.html_url)
    ) {
      continue;
    }
    selected.push(candidate);
  }

  const pairs = await mapLimit([...repos], 2, async (name) => {
    const evidence = await collectRepo(github, name, generatedAt);
    return [name, evidence] as const;
  });
  const byRepo = new Map(pairs);
  const opportunities: Opportunity[] = [];

  for (const candidate of selected) {
    const { issue } = candidate;
    const repoName = repoFromUrl(issue.repository_url);
    const evidence = byRepo.get(repoName);
    if (!evidence) {
      exclusionCounts.unavailableRepository += 1;
      continue;
    }
    if (evidence.repo.archived || evidence.repo.disabled || evidence.repo.fork) {
      exclusionCounts.unavailableRepository += 1;
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Repository is archived, disabled, or a fork.",
      });
      continue;
    }
    if (daysSince(evidence.repo.pushed_at, now) > 90) {
      exclusionCounts.inactiveRepository += 1;
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Repository has not been pushed in 90 days.",
      });
      continue;
    }
    const opportunity = buildOpportunity(issue, evidence, input, now, candidates.map((item) => item.issue));
    opportunity.discovery = {
      preRankScore: candidate.score,
      preRankReasons: candidate.rankReasons,
      searchStrategies: candidate.strategies,
    };
    opportunities.push(opportunity);
  }

  const fitOrder = { strong: 0, possible: 1, weak: 2 } as const;
  const readinessOrder = { promising: 0, investigate: 1, pause: 2 } as const;
  const coverageOrder = { strong: 0, partial: 1, thin: 2 } as const;
  opportunities.sort(
    (left, right) =>
      readinessOrder[left.readiness.state] - readinessOrder[right.readiness.state] ||
      fitOrder[left.fit.level] - fitOrder[right.fit.level] ||
      coverageOrder[left.evidenceCoverage.level] - coverageOrder[right.evidenceCoverage.level] ||
      (right.discovery?.preRankScore ?? 0) - (left.discovery?.preRankScore ?? 0) ||
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  return {
    generatedAt,
    query: queries.join(" | "),
    queries,
    input,
    opportunities,
    excluded: excluded.slice(0, 12),
    coverage: {
      languagesRequested: input.languages,
      languagesSearched: input.languages,
      candidatesExamined: candidates.length,
      repositoriesInspected: repos.size,
      repositoryLimit: MAX_REPOS,
      resultLimit: MAX_RESULTS,
      labelFamilies: unique(SEARCH_STRATEGIES.flatMap((strategy) => [...strategy.labels])),
      searchStrategies: unique(searchRequests.map((request) => request.strategy)),
      searchPages: searchRequests.length,
      candidatesRetrieved: merged.retrieved,
      candidatesDeduplicated: candidates.length,
      eligibleCandidates: eligible.length,
      preRankedCandidates: ranked.length,
      repositoriesConsidered: new Set(
        ranked.map((candidate) => repoFromUrl(candidate.issue.repository_url)).filter(Boolean),
      ).size,
      exclusionCounts,
      blindSpots: [
        "Projects without searchable GitHub issue labels are outside this run.",
        "External trackers and repository-specific difficulty taxonomies are not indexed yet.",
        "Only a recent pull-request sample is inspected for outsider evidence.",
      ],
    },
    limits: {
      githubCalls: github.calls,
      maxGithubCalls: MAX_CALLS,
      cache: "miss",
    },
    notice:
      "Forkyssey recommends investigation, not contribution. Verify scope and ask before coding when maintainers request it.",
  };
}

export type RefreshItem = {
  repository: string;
  issueNumber: number;
};

function validateRefresh(raw: unknown): { profile: ScoutInput; items: RefreshItem[] } {
  if (!raw || typeof raw !== "object") {
    throw new ScoutError(400, "Send a JSON quest log refresh request.");
  }
  const body = raw as Record<string, unknown>;
  const profile = validateInput(body.profile);
  if (!Array.isArray(body.items)) {
    throw new ScoutError(400, "Send quest log items to refresh.");
  }
  const items = body.items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const repository = safeText(value.repository, 100);
      const issueNumber = Number(value.issueNumber);
      if (
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        !Number.isInteger(issueNumber) ||
        issueNumber < 1
      ) {
        return null;
      }
      return { repository, issueNumber };
    })
    .filter((item): item is RefreshItem => Boolean(item));
  if (!items.length) throw new ScoutError(400, "Choose at least one saved issue.");
  if (items.length > MAX_RESULTS || new Set(items.map((item) => item.repository)).size > MAX_REPOS) {
    throw new ScoutError(400, "Refresh at most eight issues across four repositories.");
  }
  return {
    profile,
    items: unique(items.map((item) => JSON.stringify(item))).map(
      (item) => JSON.parse(item) as RefreshItem,
    ),
  };
}

async function runRefresh(
  profile: ScoutInput,
  items: RefreshItem[],
  token: string,
): Promise<ScoutResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const github = new GitHub(token);
  const issues = await mapLimit(items, 4, async (item) => {
    const encoded = item.repository.split("/").map(encodeURIComponent).join("/");
    return github.get<Issue>(
      "/repos/" + encoded + "/issues/" + item.issueNumber,
      true,
    );
  });
  const validIssues = issues.filter((issue): issue is Issue => Boolean(issue && !issue.pull_request));
  const repositories = unique(items.map((item) => item.repository));
  const pairs = await mapLimit(repositories, 2, async (name) => {
    return [name, await collectRepo(github, name, generatedAt)] as const;
  });
  const byRepo = new Map(pairs);
  const opportunities: Opportunity[] = [];
  const excluded: ScoutResponse["excluded"] = [];

  for (const issue of validIssues) {
    const repository = repoFromUrl(issue.repository_url);
    const evidence = byRepo.get(repository);
    if (!evidence) continue;
    if ((issue.state && issue.state !== "open") || issue.assignee) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: issue.state !== "open" ? "Issue is no longer open." : "Issue is now assigned.",
      });
      continue;
    }
    if (evidence.repo.archived || evidence.repo.disabled) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Repository is archived or disabled.",
      });
      continue;
    }
    opportunities.push(
      buildOpportunity(issue, evidence, profile, now, validIssues),
    );
  }

  return {
    generatedAt,
    query: "Targeted refresh of " + items.length + " saved issue(s).",
    queries: ["Targeted refresh of " + items.length + " saved issue(s)."],
    input: profile,
    opportunities,
    excluded,
    coverage: {
      languagesRequested: profile.languages,
      languagesSearched: [],
      candidatesExamined: validIssues.length,
      repositoriesInspected: repositories.length,
      repositoryLimit: MAX_REPOS,
      resultLimit: MAX_RESULTS,
      labelFamilies: [],
      blindSpots: [
        "A targeted refresh rechecks saved issues; it does not search for new projects.",
        "Only a recent pull-request sample is inspected for outsider evidence.",
      ],
    },
    limits: {
      githubCalls: github.calls,
      maxGithubCalls: MAX_CALLS,
      cache: "miss",
    },
    notice:
      "Refreshed evidence does not claim an issue. Reopen the cited sources before starting work.",
  };
}

export async function handleRefreshRequest(
  request: Request,
  env: EnvLike | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Use POST to refresh a quest log." }, 405, { Allow: "POST" });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Cross-origin refresh requests are not allowed." }, 403);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4096) return json({ error: "Refresh requests must be 4 KB or smaller." }, 413);
  const text = await request.text();
  if (text.length > 4096) return json({ error: "Refresh requests must be 4 KB or smaller." }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Send valid JSON." }, 400);
  }

  try {
    const { profile, items } = validateRefresh(raw);
    const key =
      "refresh:" +
      normalized(profile) +
      ":" +
      items.map((item) => item.repository + "#" + item.issueNumber).sort().join(",");
    const now = Date.now();
    const githubToken = usableGitHubToken(env?.GITHUB_TOKEN);
    if (!githubToken) {
      return json(
        { error: "Live GitHub discovery is not configured on this deployment." },
        503,
      );
    }
    const cached = cache.get(key);
    if (cached && cached.expires > now) {
      return json({ ...cached.value, limits: { ...cached.value.limits, cache: "hit" } });
    }
    if (!env.DB) {
      return json(
        { error: "Durable quota protection is not configured on this deployment." },
        503,
      );
    }
    let wait: number;
    try {
      wait = await consumeQuota(env.DB, clientKey(request), githubToken, now);
    } catch {
      return json(
        { error: "Live GitHub discovery is unavailable because quota protection could not be verified." },
        503,
      );
    }
    if (wait) {
      return json(
        { error: "Refresh limit reached. Keep the current evidence and retry shortly." },
        429,
        { "retry-after": String(wait) },
      );
    }
    const value = await runRefresh(profile, items, githubToken);
    cache.set(key, { value, expires: now + CACHE_MS });
    return json(value);
  } catch (error) {
    if (error instanceof ScoutError) return json({ error: error.message }, error.status);
    return json({ error: "The saved evidence could not be refreshed." }, 500);
  }
}

function json(
  payload: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function clientKey(request: Request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

export async function handleScoutRequest(
  request: Request,
  env: EnvLike | undefined,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }
  if (request.method !== "POST") {
    return json(
      { error: "Use POST with a scout profile." },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Cross-origin scout requests are not allowed." }, 403);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4096) {
    return json({ error: "Scout profiles must be 4 KB or smaller." }, 413);
  }
  const text = await request.text();
  if (text.length > 4096) {
    return json({ error: "Scout profiles must be 4 KB or smaller." }, 413);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Send valid JSON." }, 400);
  }

  try {
    const input = validateInput(raw);
    const key = normalized(input);
    const now = Date.now();
    const githubToken = usableGitHubToken(env?.GITHUB_TOKEN);
    if (!githubToken) {
      return json(
        { error: "Live GitHub discovery is not configured on this deployment." },
        503,
      );
    }
    const cached = cache.get(key);
    if (cached && cached.expires > now) {
      return json({
        ...cached.value,
        limits: { ...cached.value.limits, cache: "hit" },
      });
    }
    if (!env.DB) {
      return json(
        { error: "Durable quota protection is not configured on this deployment." },
        503,
      );
    }
    let wait: number;
    try {
      wait = await consumeQuota(env.DB, clientKey(request), githubToken, now);
    } catch {
      return json(
        { error: "Live GitHub discovery is unavailable because quota protection could not be verified." },
        503,
      );
    }
    if (wait) {
      return json(
        {
          error:
            "Scout limit reached. Reuse the current evidence or try again shortly.",
        },
        429,
        { "retry-after": String(wait) },
      );
    }
    const value = await runScout(input, githubToken);
    cache.set(key, { value, expires: now + CACHE_MS });
    return json(value);
  } catch (error) {
    if (error instanceof ScoutError) {
      return json({ error: error.message }, error.status);
    }
    const detail = error instanceof Error
      ? error.message.replace(/(?:github_pat_|ghp_)[A-Za-z0-9_]+/g, "[REDACTED]").slice(0, 180)
      : "Unknown local error";
    return json(
      { error: localPreviewHost(request) ? "Local scout failed: " + detail : "The scout could not complete this run." },
      500,
    );
  }
}
