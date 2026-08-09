import assert from "node:assert/strict";
import test from "node:test";
import { createQuotaDatabase } from "./fake-d1.mjs";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", String(Date.now()));
const { default: worker } = await import(workerUrl.href);

const quotaDb = createQuotaDatabase();
const env = (token, database = quotaDb) => ({
  GITHUB_TOKEN: token,
  DB: database,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});
const ctx = { waitUntil() {}, passThroughOnException() {} };

function api(body, options = {}) {
  return worker.fetch(
    new Request("https://scout.example/api/scout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": options.ip ?? "test-default",
        ...(options.headers ?? {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env(options.token, options.db === undefined ? quotaDb : options.db),
    ctx,
  );
}
function refreshApi(body, options = {}) {
  return worker.fetch(
    new Request("https://scout.example/api/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": options.ip ?? "refresh-default",
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(body),
    }),
    env(options.token, options.db === undefined ? quotaDb : options.db),
    ctx,
  );
}


const profile = {
  languages: ["TypeScript", "Rust"],
  skills: ["testing", "documentation"],
  interests: ["developer tools"],
  experience: "beginner",
  time: "few-hours",
};

test("server-renders the product rather than the starter or a baked result", async () => {
  const response = await worker.fetch(new Request("https://scout.example/"), env(), ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Find one OSS issue worth your evening/);
  assert.match(html, /No drive-by PR generator/);
  assert.match(html, /Find live quests/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|strongest signal/);
});

test("validates origin, body, profile, and missing server credential", async () => {
  const wrongOrigin = await api(profile, {
    ip: "security-origin",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(wrongOrigin.status, 403);

  const invalid = await api("not-json", { ip: "security-json" });
  assert.equal(invalid.status, 400);

  const missingLanguage = await api(
    { ...profile, languages: [] },
    { ip: "security-profile" },
  );
  assert.equal(missingLanguage.status, 400);

  const noKey = await api(profile, { ip: "security-key" });
  assert.equal(noKey.status, 503);
  assert.match((await noKey.json()).error, /not configured/i);

  const noQuota = await api(
    { ...profile, skills: ["security-quota"] },
    { token: "server-secret", ip: "security-quota", db: null },
  );
  assert.equal(noQuota.status, 503);
  assert.match((await noQuota.json()).error, /durable quota/i);

  const huge = await api("x".repeat(5000), {
    ip: "security-size",
    headers: { "content-length": "5000" },
  });
  assert.equal(huge.status, 413);
});

test("uses live GitHub responses, cites evidence, checks duplicates, and caches", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const contribution = Buffer.from(
    "Before opening a pull request, run npm test.\nAI-generated code must be disclosed.",
  ).toString("base64");
  const readme = Buffer.from("Setup\nnpm install\nTesting\nnpm test\n").toString("base64");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, authorization: init?.headers?.Authorization });
    if (url.includes("/search/issues?")) {
      return Response.json({
        items: [{
          number: 42,
          title: "Improve parser error messages",
          body: "Update the parser diagnostics in \x60src/parser.ts\x60 and add focused tests.",
          html_url: "https://github.com/acme/tool/issues/42",
          repository_url: "https://api.github.com/repos/acme/tool",
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          comments: 2,
          assignee: null,
          labels: [{ name: "good first issue" }],
          user: { login: "maintainer" },
          author_association: "MEMBER",
        }],
      });
    }
    if (url.endsWith("/community/profile")) {
      return Response.json({
        health_percentage: 90,
        files: {
          contributing: {
            html_url: "https://github.com/acme/tool/blob/main/CONTRIBUTING.md",
            url: "https://api.github.com/repos/acme/tool/contents/CONTRIBUTING.md",
          },
          code_of_conduct: {
            html_url: "https://github.com/acme/tool/blob/main/CODE_OF_CONDUCT.md",
          },
          issue_template: {
            html_url: "https://github.com/acme/tool/tree/main/.github/ISSUE_TEMPLATE",
          },
          pull_request_template: {
            html_url: "https://github.com/acme/tool/blob/main/.github/PULL_REQUEST_TEMPLATE.md",
          },
          readme: {
            html_url: "https://github.com/acme/tool/blob/main/README.md",
            url: "https://api.github.com/repos/acme/tool/contents/README.md",
          },
        },
      });
    }
    if (url.includes("/pulls?state=all")) {
      return Response.json([
        {
          number: 51,
          title: "Improve parser diagnostic messages",
          html_url: "https://github.com/acme/tool/pull/51",
          state: "open",
          merged_at: null,
          author_association: "FIRST_TIME_CONTRIBUTOR",
        },
        {
          number: 40,
          title: "Document parser setup",
          html_url: "https://github.com/acme/tool/pull/40",
          state: "closed",
          merged_at: new Date().toISOString(),
          author_association: "NONE",
        },
      ]);
    }
    if (url.endsWith("/contents/SECURITY.md")) {
      return new Response("missing", { status: 404 });
    }
    if (url.includes("/git/trees/")) {
      return Response.json({
        truncated: false,
        tree: [
          { path: "src/parser.ts", type: "blob" },
          { path: "tests/parser.test.ts", type: "blob" },
        ],
      });
    }
    if (url.endsWith("/contents/CONTRIBUTING.md")) {
      return Response.json({ content: contribution, encoding: "base64" });
    }
    if (url.endsWith("/contents/README.md")) {
      return Response.json({ content: readme, encoding: "base64" });
    }
    if (url.includes("/issues/51/comments")) {
      return Response.json([{ author_association: "MEMBER" }]);
    }
    if (url.includes("/issues/40/comments")) {
      return Response.json([]);
    }
    if (url.endsWith("/repos/acme/tool/issues/42")) {
      return Response.json({
        number: 42,
        title: "Improve parser error messages",
        body: "Update the parser diagnostics in \x60src/parser.ts\x60 and add focused tests.",
        html_url: "https://github.com/acme/tool/issues/42",
        repository_url: "https://api.github.com/repos/acme/tool",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        state: "open",
        comments: 2,
        assignee: null,
        labels: [{ name: "good first issue" }],
        user: { login: "maintainer" },
        author_association: "MEMBER",
      });
    }
    if (url === "https://api.github.com/repos/acme/tool") {
      return Response.json({
        full_name: "acme/tool",
        html_url: "https://github.com/acme/tool",
        description: "A TypeScript parser tool",
        archived: false,
        disabled: false,
        fork: false,
        pushed_at: new Date().toISOString(),
        default_branch: "main",
        language: "TypeScript",
        stargazers_count: 1200,
        owner: { login: "acme" },
      });
    }
    return new Response("unexpected " + url, { status: 500 });
  };

  try {
    const first = await api(profile, {
      token: "server-secret",
      ip: "live-cache",
      headers: { origin: "https://scout.example" },
    });
    assert.equal(first.status, 200);
    const payload = await first.json();
    assert.equal(payload.opportunities.length, 1);
    const item = payload.opportunities[0];
    assert.equal(item.id, "acme/tool#42");
    assert.equal(item.duplicateRisk[0].state, "open");
    assert.match(item.brief.aiPolicy, /AI-generated code must be disclosed/);
    assert.ok(item.brief.setupCommands.includes("npm install"));
    assert.ok(item.brief.testCommands.includes("npm test"));
    assert.ok(item.evidence.some((entry) => entry.label === "Contribution guide"));
    assert.equal(item.repositorySignals.sampledMaintainerResponses, 1);
    assert.equal(item.brief.policyChecks.find((check) => check.name === "Contribution guide").status, "found");
    assert.equal(item.brief.policyChecks.find((check) => check.name === "Security policy").status, "not-found");
    assert.match(item.brief.discussion[0], /2 issue comment/);
    assert.match(item.fit.level, /strong|possible|weak/);
    assert.match(item.readiness.state, /promising|investigate|pause/);
    assert.match(item.evidenceCoverage.level, /strong|partial|thin/);
    assert.equal(payload.coverage.languagesSearched[0], "TypeScript");
    assert.equal(payload.coverage.languagesSearched[1], "Rust");
    assert.equal(payload.coverage.repositoriesInspected, 1);
    assert.equal(payload.limits.cache, "miss");
    assert.doesNotMatch(JSON.stringify(payload), /server-secret/);
    assert.ok(calls.every((call) => call.authorization === "Bearer server-secret"));

    const count = calls.length;
    const second = await api(profile, {
      token: "server-secret",
      ip: "live-cache",
      headers: { origin: "https://scout.example" },
    });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).limits.cache, "hit");
    assert.equal(calls.length, count);
    const refreshed = await refreshApi(
      {
        profile,
        items: [{ repository: "acme/tool", issueNumber: 42 }],
      },
      {
        token: "server-secret",
        ip: "live-cache",
        headers: { origin: "https://scout.example" },
      },
    );
    assert.equal(refreshed.status, 200);
    const refreshedPayload = await refreshed.json();
    assert.equal(refreshedPayload.opportunities[0].id, "acme/tool#42");
    assert.match(refreshedPayload.query, /Targeted refresh/);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("durably rate-limits uncached GitHub work across Worker environments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("bounded test failure");
  };
  try {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await api(
        { ...profile, skills: ["rate-" + index] },
        { token: "server-secret", ip: "rate-client" },
      );
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [504, 504, 504, 429]);
    assert.equal(quotaDb.rows.size >= 1, true);
    assert.equal(
      [...quotaDb.rows.keys()].some((key) => key.includes("rate-client")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redacts credentials when GitHub fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network failed with secret-timeout");
  };
  try {
    const response = await api(
      { ...profile, skills: ["timeout-case"] },
      { token: "secret-timeout", ip: "timeout-client" },
    );
    assert.equal(response.status, 504);
    const text = await response.text();
    assert.match(text, /evidence timeout/i);
    assert.doesNotMatch(text, /secret-timeout|network failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
