"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Opportunity, ScoutInput, ScoutResponse } from "../worker/scout";

const LANGUAGES = ["Python", "TypeScript", "JavaScript", "SQL", "Go", "Rust"];
const STORAGE_KEY = "contrib-signals-worklist-v1";

const DEFAULT_PROFILE: ScoutInput = {
  languages: ["Python", "TypeScript"],
  skills: ["testing", "documentation", "data"],
  interests: ["developer tools", "AI", "analytics"],
  experience: "beginner",
  time: "few-hours",
};

function commaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Score({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "fit" | "ready";
}) {
  return (
    <div className={"score score-" + tone} aria-label={label + " " + value + " out of 100"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <div className="score-track" aria-hidden="true">
        <i style={{ width: value + "%" }} />
      </div>
    </div>
  );
}

function EvidenceList({ opportunity }: { opportunity: Opportunity }) {
  return (
    <div className="evidence-list">
      {opportunity.evidence.map((item) => (
        <a key={item.label + item.url} href={item.url} target="_blank" rel="noreferrer">
          <span>{item.label}</span>
          <small>{item.detail}</small>
          <b aria-hidden="true">↗</b>
        </a>
      ))}
    </div>
  );
}

function BriefSection({
  title,
  items,
  code,
}: {
  title: string;
  items: string[];
  code?: boolean;
}) {
  return (
    <section className="brief-block">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={title + index}>{code ? <code>{item}</code> : item}</li>
        ))}
      </ul>
    </section>
  );
}

function OpportunityCard({
  opportunity,
  rank,
  saved,
  onSave,
}: {
  opportunity: Opportunity;
  rank: number;
  saved: boolean;
  onSave: (opportunity: Opportunity) => void;
}) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <article className={"opportunity-card " + (rank === 1 ? "top-pick" : "")}>
      <div className="card-index" aria-hidden="true">
        {String(rank).padStart(2, "0")}
      </div>
      <div className="card-main">
        <div className="card-kicker">
          <a href={opportunity.repositoryUrl} target="_blank" rel="noreferrer">
            {opportunity.repository}
          </a>
          <span>{opportunity.language}</span>
          {rank === 1 ? <b>strongest signal</b> : null}
        </div>
        <h3>
          <a href={opportunity.issueUrl} target="_blank" rel="noreferrer">
            {opportunity.title}
          </a>
        </h3>
        <p className="scope">{opportunity.summary}</p>
        <div className="score-row">
          <Score label="Your fit" value={opportunity.fitScore} tone="fit" />
          <Score label="Ready now" value={opportunity.readinessScore} tone="ready" />
        </div>
        {opportunity.reasonsNotToContribute.length ? (
          <div className="warning">
            <strong>Pause before coding</strong>
            <span>{opportunity.reasonsNotToContribute[0]}</span>
          </div>
        ) : (
          <div className="clear-signal">
            No blocking signal found. Still verify the maintainer rules first.
          </div>
        )}
        <div className="card-actions">
          <button type="button" className="inspect-button" onClick={() => setOpen(!open)}>
            {open ? "Hide investigation" : "Investigate issue"}
            <span aria-hidden="true">{open ? "↑" : "↓"}</span>
          </button>
          <button
            type="button"
            className={"save-button " + (saved ? "is-saved" : "")}
            onClick={() => onSave(opportunity)}
          >
            {saved ? "Saved to worklist" : "Save for later"}
          </button>
          <a href={opportunity.issueUrl} target="_blank" rel="noreferrer" className="github-button">
            Open on GitHub ↗
          </a>
        </div>
      </div>
      {open ? (
        <div className="investigation">
          <div className="investigation-head">
            <div>
              <span>Evidence brief</span>
              <h4>What to verify before you touch code</h4>
            </div>
            <p>Every factual signal below has a source. Hints are labeled when they are inferred.</p>
          </div>
          <div className="brief-grid">
            <BriefSection title="Likely code areas" items={opportunity.brief.likelyCodeAreas} code />
            <BriefSection title="Setup commands found" items={opportunity.brief.setupCommands} code />
            <BriefSection title="Test commands found" items={opportunity.brief.testCommands} code />
            <BriefSection title="Contribution rules sampled" items={opportunity.brief.contributionRules} />
            <BriefSection title="Discussion to read" items={opportunity.brief.discussion} />
          </div>
          <div className="policy-checks">
            {opportunity.brief.policyChecks.map((check) => {
              const content = (
                <>
                  <b>{check.status === "found" ? "FOUND" : "NOT FOUND"}</b>
                  <span>{check.name}</span>
                  <small>{check.detail}</small>
                </>
              );
              return check.url ? (
                <a key={check.name} href={check.url} target="_blank" rel="noreferrer">
                  {content}
                </a>
              ) : (
                <div key={check.name}>{content}</div>
              );
            })}
          </div>
          <section className="policy-strip">
            <span>AI-assistance policy check</span>
            <p>{opportunity.brief.aiPolicy}</p>
          </section>
          <div className="signal-columns">
            <section>
              <h4>Why it fits you</h4>
              <ul>{opportunity.fitReasons.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h4>Why it may be ready</h4>
              <ul>{opportunity.readinessReasons.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h4>Uncertainty</h4>
              <ul>{opportunity.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          </div>
          <section className="duplicate-panel">
            <h4>Related issues and recent pull requests</h4>
            {opportunity.duplicateRisk.length ? (
              opportunity.duplicateRisk.map((item) => (
                <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                  <span>{item.title}</span>
                  <b>{item.state}</b>
                </a>
              ))
            ) : (
              <p>No title-level overlap appeared in the recent pull-request sample.</p>
            )}
          </section>
          <EvidenceList opportunity={opportunity} />
        </div>
      ) : null}
    </article>
  );
}

function Empty({ saved }: { saved?: boolean }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">{saved ? "◇" : "⌁"}</span>
      <h3>{saved ? "Your worklist is empty" : "No live match passed the filters"}</h3>
      <p>
        {saved
          ? "Save an investigated issue. Nothing is claimed or posted on GitHub."
          : "Try another primary language or a broader interest. A blank result is better than a fake recommendation."}
      </p>
    </div>
  );
}

export default function ScoutClient() {
  const [languages, setLanguages] = useState(DEFAULT_PROFILE.languages);
  const [skills, setSkills] = useState(DEFAULT_PROFILE.skills.join(", "));
  const [interests, setInterests] = useState(DEFAULT_PROFILE.interests.join(", "));
  const [experience, setExperience] = useState<ScoutInput["experience"]>("beginner");
  const [time, setTime] = useState<ScoutInput["time"]>("few-hours");
  const [result, setResult] = useState<ScoutResponse | null>(null);
  const [saved, setSaved] = useState<Opportunity[]>([]);
  const [view, setView] = useState<"results" | "saved">("results");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [refreshNote, setRefreshNote] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Opportunity[];
        queueMicrotask(() => setSaved(parsed));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);

  function toggleLanguage(language: string) {
    setLanguages((current) => {
      if (current.includes(language)) {
        return current.length === 1 ? current : current.filter((item) => item !== language);
      }
      return current.length >= 3 ? current : [...current, language];
    });
  }

  function toggleSaved(opportunity: Opportunity) {
    const next = savedIds.has(opportunity.id)
      ? saved.filter((item) => item.id !== opportunity.id)
      : [opportunity, ...saved];
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    setRefreshNote("");
    setView("results");
    try {
      const response = await fetch("/api/scout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          languages,
          skills: commaList(skills),
          interests: commaList(interests),
          experience,
          time,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The scout run failed.");
      setResult(payload);
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "The scout run failed.");
    }
  }

  async function refreshSaved() {
    if (!saved.length) return;
    setStatus("loading");
    setError("");
    setRefreshNote("");
    setView("saved");
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            languages,
            skills: commaList(skills),
            interests: commaList(interests),
            experience,
            time,
          },
          items: saved.map((item) => ({
            repository: item.repository,
            issueNumber: item.issueNumber,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The worklist refresh failed.");
      const current = payload.opportunities as Opportunity[];
      setSaved(current);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      setResult(payload);
      const removed = saved.length - current.length;
      setRefreshNote(
        "Refreshed " +
          current.length +
          " saved issue(s)." +
          (removed > 0 ? " " + removed + " no longer passed the live checks." : ""),
      );
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error ? caught.message : "The worklist refresh failed.",
      );
    }
  }

  function exportWorklist() {
    const rows = [
      ["repository", "issue", "title", "fit_score", "readiness_score", "url"],
      ...saved.map((item) => [
        item.repository,
        String(item.issueNumber),
        item.title,
        String(item.fitScore),
        String(item.readinessScore),
        item.issueUrl,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(","))
      .join("\n");
    download("contrib-signals-worklist.csv", csv, "text/csv");
  }

  const visible = view === "saved" ? saved : result?.opportunities ?? [];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Contrib Signals home">
          <i aria-hidden="true" />
          <span>CONTRIB SIGNALS</span>
          <small>LIVE SCOUT / R1</small>
        </a>
        <nav aria-label="Primary">
          <a href="#how-it-works">Method</a>
          <a href="https://github.com/LegenDairy93/contrib-signals" target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </nav>
        <button className="worklist-button" type="button" onClick={() => setView("saved")}>
          Worklist <b>{saved.length}</b>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">EVIDENCE-FIRST OPEN SOURCE DISCOVERY</span>
          <h1>Find one OSS issue worth your evening.</h1>
          <p>
            Live GitHub evidence, duplicate-work checks, maintainer signals, and an
            investigation brief. No drive-by PR generator.
          </p>
        </div>
        <div className="hero-proof" aria-label="Product boundaries">
          <div><strong>01</strong><span>Search current issues</span></div>
          <div><strong>02</strong><span>Check contribution reality</span></div>
          <div><strong>03</strong><span>Save, then investigate</span></div>
        </div>
      </section>

      <form className="scout-form" onSubmit={run}>
        <div className="form-heading">
          <span>YOUR CONTRIBUTION WINDOW</span>
          <p>Defaults are ready. Change only what matters.</p>
        </div>
        <fieldset className="language-field">
          <legend>Primary stack <small>up to 3</small></legend>
          <div className="chip-row">
            {LANGUAGES.map((language) => (
              <button
                key={language}
                type="button"
                className={languages.includes(language) ? "selected" : ""}
                aria-pressed={languages.includes(language)}
                onClick={() => toggleLanguage(language)}
              >
                {language}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Skills <small>comma separated</small></span>
          <input value={skills} onChange={(event) => setSkills(event.target.value)} maxLength={180} />
        </label>
        <label>
          <span>Interests <small>comma separated</small></span>
          <input value={interests} onChange={(event) => setInterests(event.target.value)} maxLength={220} />
        </label>
        <label>
          <span>Experience</span>
          <select value={experience} onChange={(event) => setExperience(event.target.value as ScoutInput["experience"])}>
            <option value="beginner">New contributor</option>
            <option value="intermediate">Shipped a few PRs</option>
            <option value="advanced">Comfortable in large repos</option>
          </select>
        </label>
        <label>
          <span>Time available</span>
          <select value={time} onChange={(event) => setTime(event.target.value as ScoutInput["time"])}>
            <option value="one-hour">About 1 hour</option>
            <option value="few-hours">2–4 hours</option>
            <option value="weekend">A weekend</option>
          </select>
        </label>
        <button className="run-button" disabled={status === "loading"}>
          {status === "loading" ? "Checking GitHub evidence…" : "Scout live opportunities"}
          <span aria-hidden="true">→</span>
        </button>
      </form>

      <section className="results-shell" aria-live="polite" aria-busy={status === "loading"}>
        <div className="results-head">
          <div>
            <span>FIELD REPORT</span>
            <h2>{view === "saved" ? "Your investigation worklist" : "Current opportunities"}</h2>
          </div>
          <div className="view-tabs" role="tablist" aria-label="Result views">
            <button type="button" role="tab" aria-selected={view === "results"} onClick={() => setView("results")}>
              Results {result ? result.opportunities.length : 0}
            </button>
            <button type="button" role="tab" aria-selected={view === "saved"} onClick={() => setView("saved")}>
              Saved {saved.length}
            </button>
          </div>
          {view === "saved" && saved.length ? (
            <div className="saved-tools">
              <button
                className="export-button"
                type="button"
                onClick={refreshSaved}
                disabled={status === "loading"}
              >
                Refresh evidence
              </button>
              <button className="export-button" type="button" onClick={exportWorklist}>
                Export CSV
              </button>
            </div>
          ) : null}
        </div>
        {refreshNote ? <p className="refresh-note" role="status">{refreshNote}</p> : null}

        {status === "loading" ? (
          <div className="loading-state" role="status">
            <i />
            <div>
              <strong>Tracing current GitHub evidence</strong>
              <span>Issues → repository health → outside PRs → policies → duplicate work</span>
            </div>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="error-state" role="alert">
            <strong>Scout run stopped</strong>
            <p>{error}</p>
            <span>No fallback or baked result was substituted.</span>
          </div>
        ) : null}
        {status !== "loading" && status !== "error" && !visible.length ? <Empty saved={view === "saved"} /> : null}
        {status !== "loading" && visible.length ? (
          <div className="opportunity-list">
            {visible.map((item, index) => (
              <OpportunityCard
                key={item.id}
                opportunity={item}
                rank={index + 1}
                saved={savedIds.has(item.id)}
                onSave={toggleSaved}
              />
            ))}
          </div>
        ) : null}

        {view === "results" && result ? (
          <footer className="result-meta">
            <div>
              <span>Collected</span>
              <strong>{new Date(result.generatedAt).toLocaleString()}</strong>
            </div>
            <div>
              <span>GitHub requests</span>
              <strong>{result.limits.githubCalls} / {result.limits.maxGithubCalls}</strong>
            </div>
            <div>
              <span>Evidence cache</span>
              <strong>{result.limits.cache}</strong>
            </div>
            <details>
              <summary>Excluded signals {result.excluded.length}</summary>
              {result.excluded.length ? (
                <ul>{result.excluded.map((item) => <li key={item.url}>{item.issue}: {item.reason}</li>)}</ul>
              ) : (
                <p>No additional candidate reached an exclusion rule in this bounded sample.</p>
              )}
            </details>
          </footer>
        ) : null}
      </section>

      <section className="method" id="how-it-works">
        <span>WHY THIS IS NOT A PR BOT</span>
        <h2>Discovery is cheap. Earning maintainer trust is not.</h2>
        <div>
          <article>
            <b>01 / Observable</b>
            <h3>Every important claim opens its source.</h3>
            <p>Scores expose their components, collection time, and uncertainty.</p>
          </article>
          <article>
            <b>02 / Bounded</b>
            <h3>Six issues, not an infinite feed.</h3>
            <p>The goal is to pick work you can finish—not browse another leaderboard.</p>
          </article>
          <article>
            <b>03 / Respectful</b>
            <h3>Nothing is claimed, posted, or generated.</h3>
            <p>You investigate, ask when needed, write the code, and own the contribution.</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <strong>CONTRIB SIGNALS</strong>
        <p>Built for careful contributors, not contribution volume.</p>
        <a href="https://github.com/LegenDairy93/contrib-signals" target="_blank" rel="noreferrer">
          Read the scoring code ↗
        </a>
      </footer>
    </main>
  );
}
