const elements={
  stats:document.querySelector('#snapshot-stats'),
  list:document.querySelector('#repo-list'),
  opportunities:document.querySelector('#opportunity-list'),
  resultCount:document.querySelector('#result-count'),
  search:document.querySelector('#search'),
  language:document.querySelector('#language'),
  minScore:document.querySelector('#min-score'),
  scoreOutput:document.querySelector('#score-output'),
  sort:document.querySelector('#sort'),
  readyOnly:document.querySelector('#ready-only'),
  reset:document.querySelector('#reset'),
  footerDate:document.querySelector('#footer-date')
}

let snapshot=null

try{
  const response=await fetch('./data/snapshot.json')
  if(!response.ok)throw new Error('Snapshot could not be loaded')
  snapshot=await response.json()
  hydrate(snapshot)
}catch(error){
  elements.resultCount.textContent='Snapshot unavailable'
  elements.list.innerHTML='<div class="empty-state">The published data snapshot could not be loaded. The collection code and SQL remain available on GitHub.</div>'
  elements.opportunities.innerHTML='<div class="empty-state">No issue evidence is available.</div>'
  console.error(error)
}

function hydrate(data){
  const languages=[...new Set(data.repositories.map(repo=>repo.language).filter(Boolean))].sort()
  elements.language.insertAdjacentHTML('beforeend',languages.map(language=>`<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join(''))
  const readyIssues=data.opportunities.filter(issue=>issue.score>=data.methodology.readyIssueThreshold).length
  const newest=data.evidenceWindow.newestCollectedAt
  const collectedLabel=newest?formatDate(newest):'not recorded'
  elements.stats.innerHTML=[
    stat(data.repositories.length,'repositories'),
    stat(languages.length,'languages'),
    stat(readyIssues,'ready issues'),
    stat(collectedLabel,'evidence collected')
  ].join('')
  elements.footerDate.textContent=`Evidence collected ${collectedLabel}`
  render()
}

function render(){
  if(!snapshot)return
  const query=elements.search.value.trim().toLowerCase()
  const language=elements.language.value
  const minimum=Number(elements.minScore.value)
  const readyOnly=elements.readyOnly.checked
  elements.scoreOutput.textContent=String(minimum)

  const repositories=snapshot.repositories
    .filter(repo=>{
      const haystack=`${repo.fullName} ${repo.description??''}`.toLowerCase()
      return (!query||haystack.includes(query))
        &&(!language||repo.language===language)
        &&repo.score>=minimum
        &&(!readyOnly||repo.signals.readyIssues>0)
    })
    .sort(sorter(elements.sort.value))

  elements.resultCount.textContent=`${repositories.length} of ${snapshot.repositories.length} repositories`
  elements.list.innerHTML=repositories.length
    ?repositories.map(repositoryCard).join('')
    :'<div class="empty-state">No repositories match these filters. Lower the score threshold or reset the explorer.</div>'

  const visibleNames=new Set(repositories.map(repo=>repo.fullName))
  const opportunities=snapshot.opportunities.filter(issue=>visibleNames.has(issue.repository))
  elements.opportunities.innerHTML=opportunities.length
    ?opportunities.map(opportunityCard).join('')
    :'<div class="empty-state">No labelled opportunities are present for the current repository filter.</div>'
}

function repositoryCard(repo){
  const color=scoreColor(repo.score)
  const breakdown=[
    ['Activity',repo.scoreBreakdown.activity],
    ['Outside PRs',repo.scoreBreakdown.externalMerge],
    ['Documentation',repo.scoreBreakdown.documentation],
    ['Opportunities',repo.scoreBreakdown.opportunities],
    ['Archive penalty',repo.scoreBreakdown.archivePenalty]
  ]
  const tags=[
    repo.language||'Unknown language',
    repo.license||'No SPDX licence',
    repo.signals.hasContributing?'Contributing guide':'No contributing guide',
    `${formatNumber(repo.stars)} stars`
  ]

  return `<article class="repo-card" style="--score:${Math.max(0,repo.score)};--score-color:${color}">
    <div class="repo-main">
      <div class="score-ring" title="Contribution evidence score ${repo.score} out of 100"><b>${repo.score}</b></div>
      <div class="repo-title">
        <h3><a href="${safeUrl(repo.htmlUrl)}">${escapeHtml(repo.fullName)} &nearr;</a></h3>
        <p>${escapeHtml(repo.description||'No repository description was available at collection time.')}</p>
        <div class="repo-tags">${tags.map(tag=>`<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      </div>
      <div class="signal-summary">
        <div><span>Outside PR merge rate</span><b>${percent(repo.signals.externalMergeRate)}</b></div>
        <div><span>Evidence sample</span><b>${repo.signals.externalPrsMerged}/${repo.signals.externalPrsSampled} merged</b></div>
        <div><span>Last push at collection</span><b>${repo.signals.daysSincePush}d ago</b></div>
        <div><span>Best issue score</span><b>${repo.signals.bestIssueScore||'--'}</b></div>
      </div>
      <div class="ready-count"><strong>${repo.signals.readyIssues}</strong><span>ready issues</span></div>
    </div>
    <details>
      <summary>Explain this score</summary>
      <div class="breakdown">${breakdown.map(([label,value])=>`<div><span>${escapeHtml(label)}</span><b>${signed(value)}</b></div>`).join('')}</div>
    </details>
  </article>`
}

function opportunityCard(issue){
  return `<article class="opportunity-card">
    <div class="opp-score">${issue.score}</div>
    <div>
      <h3><a href="${safeUrl(issue.htmlUrl)}">${escapeHtml(issue.repository)} #${issue.number} &nearr;</a></h3>
      <p>${escapeHtml(issue.title)}</p>
    </div>
    <div class="opp-meta">${issue.assigneeCount===0?'unassigned':`${issue.assigneeCount} assigned`}<br>${issue.daysSinceUpdate}d since update<br>${issue.maintainerOpened?'maintainer opened':'community opened'}</div>
  </article>`
}

function sorter(mode){
  if(mode==='merge')return (a,b)=>b.signals.externalMergeRate-a.signals.externalMergeRate||b.score-a.score
  if(mode==='activity')return (a,b)=>a.signals.daysSincePush-b.signals.daysSincePush||b.score-a.score
  if(mode==='stars')return (a,b)=>b.stars-a.stars||b.score-a.score
  return (a,b)=>b.score-a.score||a.fullName.localeCompare(b.fullName)
}

function scoreColor(score){
  if(score>=75)return '#c9ff38'
  if(score>=55)return '#f1c87b'
  return '#ff806f'
}

function stat(value,label){return `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`}
function signed(value){return `${value>=0?'+':''}${value}`}
function percent(value){return `${Math.round(value*100)}%`}
function formatNumber(value){return new Intl.NumberFormat('en-US',{notation:value>=10000?'compact':'standard',maximumFractionDigits:1}).format(value)}
function formatDate(value){return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric'}).format(new Date(value))}
function safeUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'?url.href:'#'}catch{return '#'}}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

elements.search.addEventListener('input',render)
elements.language.addEventListener('change',render)
elements.minScore.addEventListener('input',render)
elements.sort.addEventListener('change',render)
elements.readyOnly.addEventListener('change',render)
elements.reset.addEventListener('click',()=>{
  elements.search.value=''
  elements.language.value=''
  elements.minScore.value='0'
  elements.sort.value='score'
  elements.readyOnly.checked=false
  render()
})
