const elements = {
  stats: document.querySelector('#snapshot-stats'),
  list: document.querySelector('#repo-list'),
  opportunities: document.querySelector('#opportunity-list'),
  resultCount: document.querySelector('#result-count'),
  search: document.querySelector('#search'),
  language: document.querySelector('#language'),
  coverage: document.querySelector('#coverage'),
  sort: document.querySelector('#sort'),
  opportunitiesOnly: document.querySelector('#opportunities-only'),
  reset: document.querySelector('#reset'),
  footerDate: document.querySelector('#footer-date')
}

let snapshot = null

try {
  const response = await fetch('./data/snapshot.json')
  if (!response.ok) throw new Error('Snapshot could not be loaded')
  snapshot = await response.json()
  hydrate(snapshot)
} catch (error) {
  elements.resultCount.textContent = 'Snapshot unavailable'
  elements.list.innerHTML = '<div class="empty-state">The published evidence snapshot could not be loaded. The collection code remains available on GitHub.</div>'
  elements.opportunities.innerHTML = '<div class="empty-state">No issue evidence is available.</div>'
  console.error(error)
}

function hydrate(data) {
  const languages = [...new Set(data.repositories.map((repo) => repo.language).filter(Boolean))].sort()
  elements.language.insertAdjacentHTML('beforeend', languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join(''))
  const newest = data.evidenceWindow.newestCollectedAt
  const collectedLabel = newest ? formatDate(newest) : 'not recorded'
  elements.stats.innerHTML = [
    stat(data.repositories.length, 'repositories sampled'),
    stat(languages.length, 'languages represented'),
    stat(data.opportunities.length, 'labelled issues'),
    stat(collectedLabel, 'evidence collected')
  ].join('')
  elements.footerDate.textContent = `Evidence collected ${collectedLabel}`
  render()
}

function evidenceLevel(repo) {
  const sample = repo.signals.externalPrsSampled
  if (sample >= 10 && repo.pushedAt && repo.collectedAt) return 'strong'
  if (sample >= 3 && repo.collectedAt) return 'partial'
  return 'thin'
}

function render() {
  if (!snapshot) return
  const query = elements.search.value.trim().toLowerCase()
  const language = elements.language.value
  const coverage = elements.coverage.value
  const opportunitiesOnly = elements.opportunitiesOnly.checked

  const repositories = snapshot.repositories
    .filter((repo) => {
      const haystack = `${repo.fullName} ${repo.description ?? ''}`.toLowerCase()
      return (!query || haystack.includes(query)) &&
        (!language || repo.language === language) &&
        (!coverage || evidenceLevel(repo) === coverage) &&
        (!opportunitiesOnly || repo.signals.labeledIssues > 0)
    })
    .sort(sorter(elements.sort.value))

  elements.resultCount.textContent = `${repositories.length} of ${snapshot.repositories.length} sampled repositories`
  elements.list.innerHTML = repositories.length
    ? repositories.map(repositoryCard).join('')
    : '<div class="empty-state">No sampled repository matches these filters. Clear a filter or inspect the coverage limits.</div>'

  const visibleNames = new Set(repositories.map((repo) => repo.fullName))
  const opportunities = snapshot.opportunities.filter((issue) => visibleNames.has(issue.repository))
  elements.opportunities.innerHTML = opportunities.length
    ? opportunities.map(opportunityCard).join('')
    : '<div class="empty-state">No labelled issue candidate is present for the current repository filter.</div>'
}

function repositoryCard(repo) {
  const level = evidenceLevel(repo)
  const sample = repo.signals.externalPrsSampled
  const merged = repo.signals.externalPrsMerged
  const outside = sample
    ? `${merged}/${sample} merged${sample < 5 ? ' · small sample' : ''}`
    : 'Unknown · no outside PR sample'
  const docs = [
    repo.signals.hasContributing ? 'contributing guide' : null,
    repo.signals.hasCodeOfConduct ? 'code of conduct' : null
  ].filter(Boolean)
  const tags = [
    repo.language || 'Unknown language',
    repo.license || 'No SPDX licence',
    `${formatNumber(repo.stars)} stars`,
    `${level} evidence coverage`
  ]

  return `<article class="repo-card evidence-${level}">
    <div class="repo-main">
      <div class="evidence-state"><span>Coverage</span><b>${escapeHtml(level)}</b></div>
      <div class="repo-title">
        <h3><a href="${safeUrl(repo.htmlUrl)}">${escapeHtml(repo.fullName)} &nearr;</a></h3>
        <p>${escapeHtml(repo.description || 'No repository description was available at collection time.')}</p>
        <div class="repo-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      </div>
      <div class="signal-summary">
        <div><span>Activity at collection</span><b>${repo.signals.daysSincePush}d since push</b></div>
        <div><span>Outside contribution evidence</span><b>${escapeHtml(outside)}</b></div>
        <div><span>Documentation observed</span><b>${escapeHtml(docs.length ? docs.join(', ') : 'None found in sampled locations')}</b></div>
        <div><span>Labelled issue candidates</span><b>${repo.signals.labeledIssues}</b></div>
      </div>
      <div class="ready-count"><strong>${repo.signals.labeledIssues}</strong><span>candidate issues</span></div>
    </div>
    <details>
      <summary>Evidence limits</summary>
      <div class="breakdown">
        <div><span>PR sample</span><b>${sample || 'none'}</b></div>
        <div><span>Collected</span><b>${formatDate(repo.collectedAt)}</b></div>
        <div><span>Interpretation</span><b>${sample < 5 ? 'Do not generalize this merge rate' : 'Recent sample, not full history'}</b></div>
        <div><span>Unknowns</span><b>Maintainer intent and issue difficulty remain unverified</b></div>
      </div>
    </details>
  </article>`
}

function opportunityCard(issue) {
  const labels = issue.labels.length ? issue.labels.join(', ') : 'No labels recorded'
  return `<article class="opportunity-card">
    <div class="opp-state">CHECK</div>
    <div>
      <h3><a href="${safeUrl(issue.htmlUrl)}">${escapeHtml(issue.repository)} #${issue.number} &nearr;</a></h3>
      <p>${escapeHtml(issue.title)}</p>
      <p>${escapeHtml(labels)}</p>
    </div>
    <div class="opp-meta">${issue.assigneeCount === 0 ? 'unassigned' : `${issue.assigneeCount} assigned`}<br>${issue.daysSinceUpdate}d since update<br>${issue.maintainerOpened ? 'maintainer opened' : 'community opened'}</div>
  </article>`
}

function sorter(mode) {
  if (mode === 'merge') return (a, b) => b.signals.externalMergeRate - a.signals.externalMergeRate || b.signals.externalPrsSampled - a.signals.externalPrsSampled
  if (mode === 'sample') return (a, b) => b.signals.externalPrsSampled - a.signals.externalPrsSampled
  if (mode === 'stars') return (a, b) => b.stars - a.stars
  if (mode === 'name') return (a, b) => a.fullName.localeCompare(b.fullName)
  return (a, b) => a.signals.daysSincePush - b.signals.daysSincePush || a.fullName.localeCompare(b.fullName)
}

function stat(value, label) { return `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>` }
function formatNumber(value) { return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value) }
function formatDate(value) { return value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : 'not recorded' }
function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : '#' } catch { return '#' } }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }

elements.search.addEventListener('input', render)
elements.language.addEventListener('change', render)
elements.coverage.addEventListener('change', render)
elements.sort.addEventListener('change', render)
elements.opportunitiesOnly.addEventListener('change', render)
elements.reset.addEventListener('click', () => {
  elements.search.value = ''
  elements.language.value = ''
  elements.coverage.value = ''
  elements.sort.value = 'activity'
  elements.opportunitiesOnly.checked = false
  render()
})
