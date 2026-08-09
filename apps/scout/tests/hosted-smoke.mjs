import assert from "node:assert/strict";

const configured = process.env.SCOUT_BASE_URL;
if (!configured) {
  throw new Error("Set SCOUT_BASE_URL to the deployed site URL.");
}

const base = new URL(configured);
const startedAt = Date.now();
const profile = {
  languages: ["Python"],
  skills: ["testing", "SQL", "documentation"],
  interests: ["developer tools", "data tooling"],
  experience: "intermediate",
  time: "few-hours",
};

async function post(path, body) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base.origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  assert.doesNotMatch(text, /github_pat_|ghp_[A-Za-z0-9]+/i);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    assert.fail(`${path} returned non-JSON status ${response.status}.`);
  }
  assert.equal(response.status, 200, `${path}: ${payload.error ?? text}`);
  return payload;
}

const page = await fetch(base, { signal: AbortSignal.timeout(15_000) });
assert.equal(page.status, 200);
const html = await page.text();
assert.match(html, /Find one OSS issue worth your evening/);
assert.match(html, /No drive-by PR generator/);
assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);

const scout = await post("/api/scout", profile);
assert.equal(scout.input.languages[0], "Python");
assert.ok(Array.isArray(scout.opportunities));
assert.ok(scout.opportunities.length >= 1 && scout.opportunities.length <= 6);
assert.ok(Date.parse(scout.generatedAt) >= startedAt - 60_000);

const first = scout.opportunities[0];
assert.match(first.id, /^[^/]+\/[^#]+#\d+$/);
assert.match(first.issueUrl, /^https:\/\/github\.com\//);
assert.match(first.repositoryUrl, /^https:\/\/github\.com\//);
assert.ok(Number.isFinite(first.fitScore));
assert.ok(Number.isFinite(first.readinessScore));
assert.ok(first.fitReasons.length + first.reasonsNotToContribute.length > 0);
assert.ok(first.evidence.length >= 2);
for (const evidence of first.evidence) {
  assert.match(evidence.url, /^https:\/\/(api\.)?github\.com\//);
  assert.ok(Date.parse(evidence.observedAt) >= startedAt - 60_000);
}

const refreshed = await post("/api/refresh", {
  profile,
  items: [{ repository: first.repository, issueNumber: first.issueNumber }],
});
assert.equal(refreshed.opportunities[0]?.id, first.id);
assert.match(refreshed.query, /Targeted refresh/);
assert.ok(Date.parse(refreshed.generatedAt) >= Date.parse(scout.generatedAt));

console.log(JSON.stringify({
  generatedAt: scout.generatedAt,
  opportunityCount: scout.opportunities.length,
  firstOpportunity: first.id,
  fitScore: first.fitScore,
  readinessScore: first.readinessScore,
  evidenceLinks: first.evidence.length,
  refreshVerified: true,
}, null, 2));
