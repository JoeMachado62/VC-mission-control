/**
 * Gateway environment bridging for CLI spawns.
 *
 * Mission Control runs `openclaw` subcommands (doctor, status, devices, ...)
 * from its own service, whose environment comes from mission-control.env only.
 * The gateway service additionally receives EnvironmentFile= drop-ins (agent
 * tokens, MCP server keys). Config values that reference those variables
 * therefore look "missing" to any CLI spawned by MC even though the running
 * gateway resolves them fine — yielding false "Missing env var" doctor
 * findings and phantom MCP-server errors.
 *
 * This module loads the gateway's EnvironmentFiles so spawned CLIs evaluate
 * the same config the gateway does. Precedence is deliberate: MC's own process
 * env always wins (some keys, e.g. GRAPHITI_API_URL, legitimately differ
 * between the two services) and gateway files only fill gaps. Nothing here
 * mutates process.env.
 *
 * Configuration (all optional):
 *   OPENCLAW_GATEWAY_ENV_MERGE=0              disable entirely
 *   OPENCLAW_GATEWAY_ENV_FILES=a.env:b.env    explicit file list (skips systemctl)
 *   OPENCLAW_GATEWAY_SERVICE=<unit>           unit to query (default openclaw-gateway.service)
 *   OPENCLAW_GATEWAY_ENV_EXCLUDE_PREFIXES     comma list; default "OTEL_" so one-shot
 *                                             CLI runs don't start the gateway's
 *                                             telemetry exporter on every poll
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'

const DEFAULT_SERVICE = 'openclaw-gateway.service'
const DEFAULT_EXCLUDE_PREFIXES = ['OTEL_']
const CACHE_TTL_MS = 30_000
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Loose env shape: process.env satisfies it, and so do partial objects in tests. */
export type EnvLike = Record<string, string | undefined>

/** Parse a systemd-style EnvironmentFile. Values run to end of line; matching surrounding quotes are stripped. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!KEY_RE.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (value.length >= 2) {
      const q = value[0]
      if ((q === '"' || q === "'") && value.endsWith(q)) value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** Parse `systemctl show <unit> -p EnvironmentFiles --value` output into absolute paths. */
export function parseSystemdEnvironmentFiles(output: string): string[] {
  const files: string[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    // "/etc/foo.env (ignore_errors=no)"  or  "-/etc/foo.env (ignore_errors=yes)"
    const token = line.split(/\s+/)[0]
    const path = token.startsWith('-') ? token.slice(1) : token
    if (path.startsWith('/')) files.push(path)
  }
  return files
}

export function resolveGatewayEnvFiles(env: EnvLike = process.env): string[] {
  const explicit = (env.OPENCLAW_GATEWAY_ENV_FILES || '').trim()
  if (explicit) {
    return explicit.split(/[:,]/).map(s => s.trim()).filter(Boolean)
  }
  const service = (env.OPENCLAW_GATEWAY_SERVICE || DEFAULT_SERVICE).trim()
  try {
    const out = execFileSync('systemctl', ['show', service, '-p', 'EnvironmentFiles', '--value'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseSystemdEnvironmentFiles(out)
  } catch {
    return []
  }
}

export function excludePrefixes(env: EnvLike = process.env): string[] {
  const raw = env.OPENCLAW_GATEWAY_ENV_EXCLUDE_PREFIXES
  if (raw === undefined) return DEFAULT_EXCLUDE_PREFIXES
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function filterExcludedKeys(vars: Record<string, string>, prefixes: string[]): Record<string, string> {
  if (prefixes.length === 0) return vars
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (!prefixes.some(p => k.startsWith(p))) out[k] = v
  }
  return out
}

/**
 * Gateway values fill gaps only; the caller's own environment always wins.
 * Generic so the caller's env type (e.g. NodeJS.ProcessEnv with its required
 * NODE_ENV) is preserved through the merge.
 */
export function mergeGatewayEnv<T extends EnvLike>(gateway: Record<string, string>, own: T): Record<string, string> & T {
  return { ...gateway, ...own }
}

type Cache = { at: number; files: string[]; mtimes: number[]; vars: Record<string, string> }
let cache: Cache | null = null

function mtimeOf(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return -1
  }
}

/** Cached, never throws. Returns {} when disabled or when nothing can be resolved. */
export function loadGatewayEnv(env: EnvLike = process.env): Record<string, string> {
  if ((env.OPENCLAW_GATEWAY_ENV_MERGE || '').trim() === '0') return {}
  try {
    const now = Date.now()
    const c = cache
    if (c && now - c.at < CACHE_TTL_MS) {
      const unchanged = c.files.every((f, i) => mtimeOf(f) === c.mtimes[i])
      if (unchanged) return c.vars
    }
    const files = resolveGatewayEnvFiles(env)
    let merged: Record<string, string> = {}
    for (const f of files) {
      if (!existsSync(f)) continue
      // Later files override earlier ones, mirroring systemd's EnvironmentFile= order.
      merged = { ...merged, ...parseEnvFile(readFileSync(f, 'utf8')) }
    }
    const vars = filterExcludedKeys(merged, excludePrefixes(env))
    cache = { at: now, files, mtimes: files.map(mtimeOf), vars }
    return vars
  } catch {
    return {}
  }
}

/** Test hook. */
export function _resetGatewayEnvCache(): void {
  cache = null
}
