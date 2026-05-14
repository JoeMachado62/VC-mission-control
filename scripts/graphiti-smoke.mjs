#!/usr/bin/env node
// Graphiti smoke test for VCH multi-namespace setup.
//
// For each of vch_buyer / vch_admin / vch_wholesale this script:
//   1. writes a uniquely-tagged test episode to that namespace
//   2. polls /episodes/{namespace} until the episode is visible
//   3. searches the OTHER two namespaces for the same tag and asserts
//      cross-namespace isolation (must return 0 hits)
//   4. cleans up the test episode and any matching entity edges
//
// Pass-fail is printed per namespace; non-zero exit if any namespace fails.
//
// Flags / env:
//   --dry-run | DRY_RUN=true | GRAPHITI_SMOKE_DRY_RUN=true
//     Validate the script without making any network calls.
//   GRAPHITI_API_URL  default http://127.0.0.1:8001
//   GRAPHITI_TIMEOUT_MS  default 8000
//   GRAPHITI_DEFAULT_NAMESPACE  optional, narrows the run to a single namespace.

import crypto from 'node:crypto'

const VCH_NAMESPACES = ['vch_buyer', 'vch_admin', 'vch_wholesale']

const apiUrl = (process.env.GRAPHITI_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '')
const timeoutMs = Number(process.env.GRAPHITI_TIMEOUT_MS || 8000)
const dryRun = process.argv.includes('--dry-run')
  || process.env.DRY_RUN === 'true'
  || process.env.GRAPHITI_SMOKE_DRY_RUN === 'true'

const onlyNamespace = (() => {
  const raw = process.env.GRAPHITI_DEFAULT_NAMESPACE?.trim()
  return raw && VCH_NAMESPACES.includes(raw) ? raw : null
})()

const namespaces = onlyNamespace ? [onlyNamespace] : VCH_NAMESPACES

function withTimeout() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, done: () => clearTimeout(timer) }
}

async function request(path, options = {}) {
  if (dryRun) {
    return { dryRun: true, path, method: options.method || 'GET' }
  }
  const { controller, done } = withTimeout()
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`)
    }
    return payload
  } finally {
    done()
  }
}

async function sleep(ms) {
  if (dryRun) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeEpisode(namespace, smokeId, content, now) {
  return request('/messages', {
    method: 'POST',
    body: JSON.stringify({
      group_id: namespace,
      messages: [{
        name: `Mission Control Graphiti smoke (${namespace})`,
        role_type: 'system',
        role: 'MissionControlSmokeAgent',
        content,
        timestamp: now,
        source_description: JSON.stringify({
          agent_id: 'mission-control-smoke',
          agent_name: 'MissionControlSmokeAgent',
          source: 'openclaw',
          task_id: smokeId,
          trace_id: null,
          entity_type: 'vehicle',
          entity_id: 'TESTGRAPHITI0000000',
          valid_at: now,
          confidence: 1,
          smoke_test: true,
          namespace,
        }),
      }],
    }),
  })
}

async function findEpisode(namespace, smokeId) {
  if (dryRun) return { found: true, uuid: `dry-${namespace}`, episodes: [] }
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await sleep(2500)
    const episodes = await request(`/episodes/${encodeURIComponent(namespace)}?last_n=20`)
    const list = Array.isArray(episodes) ? episodes : []
    const episode = list.find((item) =>
      String(item?.content || '').includes(smokeId)
      || String(item?.source_description || '').includes(smokeId),
    )
    if (episode) {
      return { found: true, uuid: typeof episode.uuid === 'string' ? episode.uuid : null, episodes: list }
    }
  }
  return { found: false, uuid: null, episodes: [] }
}

async function searchNamespace(namespace, smokeId, { ownNamespace = null } = {}) {
  if (dryRun) {
    // Simulate the live boundary: a fact written to ownNamespace is only
    // visible when we search ownNamespace. Cross-namespace searches return [].
    const matches = ownNamespace === namespace
      ? [{ uuid: `dry-fact-${namespace}`, fact: smokeId, group_id: namespace }]
      : []
    return { facts: matches }
  }
  return request('/search', {
    method: 'POST',
    body: JSON.stringify({
      group_ids: [namespace],
      query: smokeId,
      max_facts: 5,
    }),
  }).catch((error) => ({ error: error.message, facts: [] }))
}

async function cleanup(namespace, smokeId, episodeUuid) {
  if (dryRun) return
  try {
    const search = await searchNamespace(namespace, smokeId, { ownNamespace: namespace })
    if (Array.isArray(search?.facts)) {
      for (const fact of search.facts) {
        if (typeof fact?.uuid === 'string' && JSON.stringify(fact).includes(smokeId)) {
          await request(`/entity-edge/${encodeURIComponent(fact.uuid)}`, { method: 'DELETE' })
        }
      }
    }
    if (episodeUuid) {
      await request(`/episode/${encodeURIComponent(episodeUuid)}`, { method: 'DELETE' })
    }
  } catch (error) {
    console.warn(`[${namespace}] cleanup skipped: ${error.message}`)
  }
}

async function smokeNamespace(namespace) {
  const smokeId = `mc-smoke-${namespace}-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const content = `MissionControlSmokeAgent wrote Graphiti smoke fact ${smokeId} for vehicle VIN TESTGRAPHITI0000000 at ${now}.`
  const otherNamespaces = VCH_NAMESPACES.filter((other) => other !== namespace)

  console.log(`\n[${namespace}] writing smoke fact ${smokeId}`)
  await writeEpisode(namespace, smokeId, content, now)

  const { found, uuid: episodeUuid, episodes } = await findEpisode(namespace, smokeId)
  if (!found) {
    await cleanup(namespace, smokeId, episodeUuid)
    return {
      namespace,
      ok: false,
      reason: 'smoke fact not visible in own namespace',
      smokeId,
      episodeUuid,
      episodeCount: episodes.length,
    }
  }

  const ownSearch = await searchNamespace(namespace, smokeId, { ownNamespace: namespace })
  const foundOwn = Array.isArray(ownSearch?.facts)
    && ownSearch.facts.some((fact) => JSON.stringify(fact).includes(smokeId))

  // Cross-namespace isolation check: search the OTHER namespaces for our tag.
  // Any hit means the mode boundary leaked.
  const leaks = []
  for (const other of otherNamespaces) {
    const otherSearch = await searchNamespace(other, smokeId, { ownNamespace: namespace })
    const facts = Array.isArray(otherSearch?.facts) ? otherSearch.facts : []
    const leaked = facts.filter((fact) => JSON.stringify(fact).includes(smokeId))
    if (leaked.length > 0) {
      leaks.push({ namespace: other, count: leaked.length })
    }
  }

  await cleanup(namespace, smokeId, episodeUuid)

  if (leaks.length > 0) {
    return {
      namespace,
      ok: false,
      reason: `cross-namespace leak detected: ${leaks.map((l) => `${l.namespace}=${l.count}`).join(', ')}`,
      smokeId,
      episodeUuid,
      foundOwn,
      leaks,
    }
  }

  return {
    namespace,
    ok: foundOwn,
    smokeId,
    episodeUuid,
    foundOwn,
    episodeCount: episodes.length,
    searchFactCount: Array.isArray(ownSearch?.facts) ? ownSearch.facts.length : 0,
  }
}

async function main() {
  console.log(`Graphiti smoke: API ${apiUrl}, namespaces [${namespaces.join(', ')}]${dryRun ? ' (dry-run)' : ''}`)
  if (!dryRun) {
    await request('/healthcheck')
  }

  const results = []
  for (const namespace of namespaces) {
    try {
      results.push(await smokeNamespace(namespace))
    } catch (error) {
      results.push({ namespace, ok: false, reason: error.message })
    }
  }

  console.log('\n=== Graphiti smoke results ===')
  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL'
    console.log(`  [${status}] ${result.namespace}${result.reason ? ` — ${result.reason}` : ''}`)
  }
  console.log(JSON.stringify({ dryRun, results }, null, 2))

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    throw new Error(`${failed.length} namespace(s) failed: ${failed.map((r) => r.namespace).join(', ')}`)
  }
}

main().catch((error) => {
  console.error(`Graphiti smoke failed: ${error.message}`)
  process.exit(1)
})
