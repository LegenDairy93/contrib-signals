const API_URL = 'https://api.github.com/search/issues'
const MAX_RESULTS = 6
const MAX_REPOSITORIES = 4
const SEARCH_LABELS = ['good first issue', 'help wanted']

export function sanitizeTerm(value, maxLength = 50) {
  return String(value ?? '')
    .replace(/[^\p{L}\p{N}+#.\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function makeSearchUrl({ language, keywords = '', label }) {
  const safeLanguage = sanitizeTerm(language, 30)
  const safeKeywords = sanitizeTerm(keywords)
  if (!safeLanguage) throw new Error('Choose a language before searching.')
  const qualifiers = ['is:issue', 'is:open', 'no:assignee', `label:"${label}"`, `language:"${safeLanguage}"`]
  if (safeKeywords) qualifiers.push(safeKeywords)
  const params = new URLSearchParams({ q: qualifiers.join(' '), sort: 'updated', order: 'desc', per_page: '12' })
  return `${API_URL}?${params}`
}

export function inferWorkType(issue) {
  const text = `${issue.title ?? ''} ${(issue.labels ?? []).map((label) => label.name ?? label).join(' ')}`.toLowerCase()
  if (/\b(doc|docs|documentation|readme|guide|typo|example)\b/.test(text)) return 'documentation'
  if (/\b(test|tests|testing|coverage|spec)\b/.test(text)) return 'tests'
  if (/\b(design|ux|ui|accessibility|a11y)\b/.test(text)) return 'design'
  return 'code'
}

export function normalizeIssue(issue, now = Date.now()) {
  const repository = String(issue.repository_url ?? '').split('/repos/')[1] || 'unknown repository'
  const updatedAt = new Date(issue.updated_at)
  const daysSinceUpdate = Number.isNaN(updatedAt.getTime()) ? null : Math.max(0, Math.floor((now - updatedAt.getTime()) / 86_400_000))
  return {
    id: issue.id,
    repository,
    number: issue.number,
    title: String(issue.title ?? 'Untitled issue'),
    url: String(issue.html_url ?? ''),
    labels: (issue.labels ?? []).map((label) => String(label.name ?? label)).filter(Boolean).slice(0, 5),
    comments: Number(issue.comments ?? 0),
    authorAssociation: String(issue.author_association ?? 'NONE').toLowerCase(),
    daysSinceUpdate,
    workType: inferWorkType(issue)
  }
}

export function selectDiverseIssues(issues, workType = '') {
  const seen = new Set()
  const normalized = []
  for (const issue of issues) {
    if (seen.has(issue.id)) continue
    seen.add(issue.id)
    const candidate = normalizeIssue(issue)
    if (workType && candidate.workType !== workType) continue
    normalized.push(candidate)
  }

  const byRepository = new Map()
  for (const issue of normalized) {
    if (!byRepository.has(issue.repository) && byRepository.size >= MAX_REPOSITORIES) continue
    const group = byRepository.get(issue.repository) ?? []
    group.push(issue)
    byRepository.set(issue.repository, group)
  }

  const selected = []
  let depth = 0
  while (selected.length < MAX_RESULTS) {
    let added = false
    for (const group of byRepository.values()) {
      if (group[depth]) {
        selected.push(group[depth])
        added = true
        if (selected.length === MAX_RESULTS) break
      }
    }
    if (!added) break
    depth += 1
  }
  return selected
}

export async function discoverIssues(profile, { fetchImpl = fetch, signal } = {}) {
  const raw = []
  let requests = 0
  let remaining = null
  for (const label of SEARCH_LABELS) {
    const response = await fetchImpl(makeSearchUrl({ ...profile, label }), { signal })
    requests += 1
    remaining = response.headers?.get?.('x-ratelimit-remaining') ?? remaining
    if (response.status === 403 || response.status === 429) {
      const error = new Error('GitHub temporarily rate-limited this network. The dated evidence archive is still available below.')
      error.code = 'RATE_LIMITED'
      throw error
    }
    if (!response.ok) throw new Error(`GitHub discovery stopped with HTTP ${response.status}.`)
    const body = await response.json()
    raw.push(...(Array.isArray(body.items) ? body.items : []))
    if (selectDiverseIssues(raw, profile.workType).length >= MAX_RESULTS) break
  }
  return { issues: selectDiverseIssues(raw, profile.workType), requests, remaining }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function safeGitHubUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : '#'
  } catch { return '#' }
}

function freshness(days) {
  if (days === null) return 'unknown activity'
  if (days <= 30) return `${days}d · recent`
  if (days <= 90) return `${days}d · aging`
  return `${days}d · old`
}

function liveCard(issue) {
  return `<article class="live-card">
    <div class="live-state"><span>Work</span><b>${escapeHtml(issue.workType)}</b></div>
    <div class="live-copy">
      <p class="live-repo">${escapeHtml(issue.repository)} · #${issue.number}</p>
      <h3><a href="${safeGitHubUrl(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)} &nearr;</a></h3>
      <div class="repo-tags">${issue.labels.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join('')}</div>
    </div>
    <div class="live-facts">
      <span>${freshness(issue.daysSinceUpdate)}</span>
      <span>${issue.comments} comments</span>
      <span>opened by ${escapeHtml(issue.authorAssociation)}</span>
    </div>
    <details>
      <summary>Evidence boundary</summary>
      <p>Observed live: open, unassigned, labelled issue and recent activity. Unknown: actual difficulty, maintainer intent, competing work and outside-PR acceptance.</p>
    </details>
  </article>`
}

function setupLiveScout() {
  const form = document.querySelector('#live-scout-form')
  if (!form) return
  const button = form.querySelector('button[type="submit"]')
  const status = document.querySelector('#live-scout-status')
  const results = document.querySelector('#live-scout-results')
  let controller = null

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    controller?.abort()
    controller = new AbortController()
    button.disabled = true
    button.textContent = 'SCOUTING…'
    status.textContent = 'Searching current public GitHub issues. One or two anonymous requests; no token is sent.'
    results.replaceChildren()
    const formData = new FormData(form)
    try {
      const result = await discoverIssues({
        language: formData.get('language'),
        keywords: formData.get('keywords'),
        workType: formData.get('workType')
      }, { signal: controller.signal })
      status.textContent = result.issues.length
        ? `${result.issues.length} live candidates across ${new Set(result.issues.map((issue) => issue.repository)).size} repositories · ${result.requests} GitHub request${result.requests === 1 ? '' : 's'}${result.remaining === null ? '' : ` · ${result.remaining} anonymous requests remaining`}`
        : 'No matching candidates were found in this bounded search. Try fewer keywords or another work type.'
      results.innerHTML = result.issues.length
        ? result.issues.map(liveCard).join('')
        : '<div class="live-empty">Nothing matched this bounded live search. The dated archive below is unchanged.</div>'
    } catch (error) {
      if (error.name === 'AbortError') return
      status.textContent = error.message || 'Live discovery stopped.'
      results.innerHTML = '<div class="live-empty">No cached result was substituted. You can still inspect the dated evidence archive below.</div>'
    } finally {
      button.disabled = false
      button.textContent = 'SCOUT GITHUB'
    }
  })
}

if (typeof document !== 'undefined') setupLiveScout()
