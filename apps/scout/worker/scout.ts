const API = "https://api.github.com";
const MAX_CALLS = 48;
const CACHE_MS = 300_000;
const RATE_MS = 600_000;
const RATE_MAX = 3;
const MAX_RESULTS = 6;
const MAX_REPOS = 4;

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
  labels: string[];
  updatedAt: string;
  fitScore: number;
  readinessScore: number;
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
    policyChecks: Array<{ name: string; status: "found" | "not-found"; detail: string; url?: string }>;
    aiPolicy: string;
    risks: string[];
  };
  repositorySignals: {
    lastPush: string;
    stars: number;
    communityHealth: number | null;
    sampledOutsidePulls: number;
    sampledOutsideMerged: number;
    sampledMaintainerResponses: number;
  };
  evidence: Evidence[];
};

export type ScoutResponse = {
  generatedAt: string;
  query: string;
  input: ScoutInput;
  opportunities: Opportunity[];
  excluded: Array<{ issue: string; url: string; reason: string }>;
  limits: { githubCalls: number; maxGithubCalls: number; cache: "hit" | "miss" };
  notice: string;
};

type EnvLike = { GITHUB_TOKEN?: string };
type RepoEvidence = {
  repo: Repo;
  community: Community | null;
  pulls: Pull[];
  contribution: string;
  readme: string;
  security: string;
  tree: Tree | null;
  maintainerResponses: number;
  links: Evidence[];
};

const cache = new Map<string, { expires: number; value: ScoutResponse }>();
const requests = new Map<string, number[]>();

export class ScoutError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const unique = <T,>(values: T[]) => [...new Set(values)];
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
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
  private deadline = Date.now() + 25_000;

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
        "User-Agent": "contrib-signals/0.2",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (this.token) headers.Authorization = "Bearer " + this.token;
      const remaining = this.deadline - Date.now();
      if (remaining <= 0) {
        throw new ScoutError(504, "The bounded GitHub evidence window expired.");
      }
      let response: Response;
      try {
        response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(Math.min(12_000, remaining)),
        });
      } catch {
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
      return (await response.json()) as T;
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
  const [community, pulls, rootSecurity, tree] = await Promise.all([
    github.get<Community>("/repos/" + encoded + "/community/profile", true),
    github.get<Pull[]>("/repos/" + encoded + "/pulls?state=all&sort=updated&direction=desc&per_page=20"),
    github.get<Content>("/repos/" + encoded + "/contents/SECURITY.md", true),
    github.get<Tree>(
      "/repos/" + encoded + "/git/trees/" + encodeURIComponent(repo.default_branch) + "?recursive=1",
      true,
    ),
  ]);
  let security = rootSecurity;
  if (!security) {
    const securityPath = (tree?.tree ?? [])
      .map((entry) => entry.path)
      .find((entry) => [".github/security.md", "docs/security.md"].includes(entry.toLowerCase()));
    if (securityPath) {
      security = await github.get<Content>(
        "/repos/" + encoded + "/contents/" + securityPath.split("/").map(encodeURIComponent).join("/"),
        true,
      );
    }
  }
  const profile = community ?? null;
  const contributionUrl = profile?.files?.contributing?.url ?? null;
  const readmeUrl = profile?.files?.readme?.url ?? null;
  const [contributionFile, readmeFile] = await Promise.all([
    contributionUrl ? github.get<Content>(contributionUrl, true) : Promise.resolve(null),
    readmeUrl ? github.get<Content>(readmeUrl, true) : Promise.resolve(null),
  ]);
  const pullList = pulls ?? [];
  const external = pullList.filter((pull) => isOutside(pull.author_association)).slice(0, 3);
  const commentSets = await mapLimit(external, 2, (pull) =>
    github.get<Array<{ author_association?: string }>>(
      "/repos/" + encoded + "/issues/" + pull.number + "/comments?per_page=30",
      true,
    ),
  );
  const maintainerResponses = commentSets.filter((comments) =>
    (comments ?? []).some((comment) =>
      ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association ?? ""),
    ),
  ).length;

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
  const timePenalty =
    input.time === "one-hour" && complexity > 220
      ? 14
      : input.time === "few-hours" && complexity > 500
        ? 8
        : 0;
  const fitScore = clamp(
    42 +
      (languageMatch ? 28 : 0) +
      Math.min(15, skillMatches.length * 5) +
      Math.min(15, interestMatches.length * 5) -
      timePenalty,
  );

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
  let readinessScore = 34;
  readinessScore += issueAge <= 14 ? 16 : issueAge <= 45 ? 8 : -15;
  readinessScore += repoAge <= 14 ? 14 : repoAge <= 45 ? 7 : -20;
  readinessScore += contributionPresent ? 12 : -10;
  readinessScore += templatesPresent ? 5 : 0;
  readinessScore += external.length
    ? Math.round((merged.length / external.length) * 16)
    : -4;
  readinessScore += evidence.maintainerResponses ? 8 : 0;
  readinessScore -= duplicates.some((item) => item.state === "open") ? 20 : 0;

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
    timePenalty
      ? "The written scope may exceed your selected time budget."
      : "The written scope is not obviously larger than your time budget.",
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
  if (duplicates.some((item) => item.state === "open")) {
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
  const foundCommands = commands(evidence.readme + "\n" + evidence.contribution);
  const foundRules = rules(evidence.contribution);
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
    fitScore,
    readinessScore: clamp(readinessScore),
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

function makeQuery(input: ScoutInput, now: Date) {
  const cutoff = new Date(now.getTime() - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const language = input.languages[0].replace(/["\\]/g, "");
  return (
    "is:issue is:open is:public archived:false no:assignee -linked:pr " +
    "updated:>=" +
    cutoff +
    ' label:"good first issue","help wanted" language:"' +
    language +
    '"'
  );
}

export async function runScout(
  input: ScoutInput,
  token?: string,
): Promise<ScoutResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const query = makeQuery(input, now);
  const github = new GitHub(token);
  const search = await github.get<{ items?: Issue[] }>(
    "/search/issues?q=" +
      encodeURIComponent(query) +
      "&sort=updated&order=desc&per_page=30",
  );
  const candidates = (search?.items ?? [])
    .filter((item) => !item.pull_request)
    .slice(0, 24);
  const excluded: ScoutResponse["excluded"] = [];
  const selected: Issue[] = [];
  const repos = new Set<string>();

  for (const issue of candidates) {
    const repo = repoFromUrl(issue.repository_url);
    if (!repo) continue;
    if (issue.assignee) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Already assigned.",
      });
      continue;
    }
    if (daysSince(issue.updated_at, now) > 60) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Not updated in the last 60 days.",
      });
      continue;
    }
    if (!repos.has(repo) && repos.size >= MAX_REPOS) continue;
    repos.add(repo);
    selected.push(issue);
    if (selected.length >= MAX_RESULTS) break;
  }

  const pairs = await mapLimit([...repos], 2, async (name) => {
    const evidence = await collectRepo(github, name, generatedAt);
    return [name, evidence] as const;
  });
  const byRepo = new Map(pairs);
  const opportunities: Opportunity[] = [];

  for (const issue of selected) {
    const repoName = repoFromUrl(issue.repository_url);
    const evidence = byRepo.get(repoName);
    if (!evidence) continue;
    if (evidence.repo.archived || evidence.repo.disabled || evidence.repo.fork) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Repository is archived, disabled, or a fork.",
      });
      continue;
    }
    if (daysSince(evidence.repo.pushed_at, now) > 90) {
      excluded.push({
        issue: issue.title,
        url: issue.html_url,
        reason: "Repository has not been pushed in 90 days.",
      });
      continue;
    }
    opportunities.push(buildOpportunity(issue, evidence, input, now, candidates));
  }

  opportunities.sort(
    (left, right) =>
      right.fitScore +
      right.readinessScore -
      (left.fitScore + left.readinessScore),
  );
  return {
    generatedAt,
    query,
    input,
    opportunities,
    excluded: excluded.slice(0, 12),
    limits: {
      githubCalls: github.calls,
      maxGithubCalls: MAX_CALLS,
      cache: "miss",
    },
    notice:
      "Contrib Signals recommends investigation, not contribution. Verify scope and ask before coding when maintainers request it.",
  };
}

export type RefreshItem = {
  repository: string;
  issueNumber: number;
};

function validateRefresh(raw: unknown): { profile: ScoutInput; items: RefreshItem[] } {
  if (!raw || typeof raw !== "object") {
    throw new ScoutError(400, "Send a JSON worklist refresh request.");
  }
  const body = raw as Record<string, unknown>;
  const profile = validateInput(body.profile);
  if (!Array.isArray(body.items)) {
    throw new ScoutError(400, "Send worklist items to refresh.");
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
    throw new ScoutError(400, "Refresh at most six issues across four repositories.");
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
    input: profile,
    opportunities,
    excluded,
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
    return json({ error: "Use POST to refresh a worklist." }, 405, { Allow: "POST" });
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
    const cached = cache.get(key);
    if (cached && cached.expires > now) {
      return json({ ...cached.value, limits: { ...cached.value.limits, cache: "hit" } });
    }
    const wait = retryAfter(clientKey(request), now);
    if (wait) {
      return json(
        { error: "Refresh limit reached. Keep the current evidence and retry shortly." },
        429,
        { "retry-after": String(wait) },
      );
    }
    if (!env?.GITHUB_TOKEN) {
      return json(
        { error: "Live GitHub discovery is not configured on this deployment." },
        503,
      );
    }
    const value = await runRefresh(profile, items, env.GITHUB_TOKEN);
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

function retryAfter(key: string, now: number) {
  const current = (requests.get(key) ?? []).filter(
    (stamp) => now - stamp < RATE_MS,
  );
  if (current.length >= RATE_MAX) {
    return Math.ceil((RATE_MS - (now - current[0])) / 1000);
  }
  current.push(now);
  requests.set(key, current);
  return 0;
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
    const cached = cache.get(key);
    if (cached && cached.expires > now) {
      return json({
        ...cached.value,
        limits: { ...cached.value.limits, cache: "hit" },
      });
    }
    const wait = retryAfter(clientKey(request), now);
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
    if (!env?.GITHUB_TOKEN) {
      return json(
        { error: "Live GitHub discovery is not configured on this deployment." },
        503,
      );
    }
    const value = await runScout(input, env.GITHUB_TOKEN);
    cache.set(key, { value, expires: now + CACHE_MS });
    return json(value);
  } catch (error) {
    if (error instanceof ScoutError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "The scout could not complete this run." }, 500);
  }
}
