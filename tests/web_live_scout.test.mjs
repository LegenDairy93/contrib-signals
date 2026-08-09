import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverIssues, inferWorkType, makeSearchUrl, sanitizeTerm, selectDiverseIssues } from '../web/live-scout.js'

function issue(id, repo, title = `Issue ${id}`, labels = ['good first issue']) {
  return {
    id,
    number: id,
    title,
    html_url: `https://github.com/${repo}/issues/${id}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    labels: labels.map((name) => ({ name })),
    comments: 0,
    author_association: 'MEMBER',
    updated_at: new Date().toISOString()
  }
}

test('search terms cannot inject GitHub qualifiers', () => {
  assert.equal(sanitizeTerm('rust repo:private/x "oops"'), 'rust repo private x oops')
  const url = new URL(makeSearchUrl({ language: 'Rust', keywords: 'parser', label: 'good first issue' }))
  assert.match(url.searchParams.get('q'), /language:"Rust"/)
  assert.match(url.searchParams.get('q'), /parser/)
})

test('work type is inferred without claiming issue difficulty', () => {
  assert.equal(inferWorkType({ title: 'Improve README examples', labels: [] }), 'documentation')
  assert.equal(inferWorkType({ title: 'Increase parser test coverage', labels: [] }), 'tests')
  assert.equal(inferWorkType({ title: 'Fix parser panic', labels: [] }), 'code')
})

test('selection is capped and diversified across repositories', () => {
  const input = Array.from({ length: 10 }, (_, index) => issue(index + 1, index < 7 ? 'a/one' : `b/repo-${index}`))
  const selected = selectDiverseIssues(input)
  assert.equal(selected.length, 6)
  assert.ok(new Set(selected.map((item) => item.repository)).size > 1)
  assert.ok(new Set(selected.map((item) => item.repository)).size <= 4)
})

test('discovery performs at most two anonymous requests', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { ok: true, status: 200, headers: { get: () => '8' }, json: async () => ({ items: [issue(calls, `repo/${calls}`)] }) }
  }
  const result = await discoverIssues({ language: 'Rust', workType: '' }, { fetchImpl })
  assert.equal(calls, 2)
  assert.equal(result.requests, 2)
  assert.equal(result.issues.length, 2)
})

test('discovery fails explicitly when GitHub rate-limits the visitor', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, headers: { get: () => '0' } })
  await assert.rejects(() => discoverIssues({ language: 'Rust' }, { fetchImpl }), { code: 'RATE_LIMITED' })
})
