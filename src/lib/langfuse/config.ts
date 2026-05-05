export type LangfuseConfig = {
  enabled: boolean
  baseUrl: string | null
  traceDeeplinkBase: string | null
  publicKey: string | null
  secretKey: string | null
  projectId: string | null
  embedEnabled: boolean
  fetchSummaryEnabled: boolean
  timeoutMs: number
  defaultEnvironment: string
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function parseTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw ?? 8000)
  if (!Number.isFinite(parsed) || parsed < 1000) return 8000
  return Math.min(Math.floor(parsed), 30000)
}

export function getLangfuseConfig(): LangfuseConfig {
  const baseUrl = optionalEnv('LANGFUSE_BASE_URL')
  return {
    enabled: process.env.LANGFUSE_ENABLED === 'true',
    baseUrl,
    traceDeeplinkBase: optionalEnv('LANGFUSE_TRACE_DEEPLINK_BASE') || baseUrl,
    publicKey: optionalEnv('LANGFUSE_PUBLIC_KEY'),
    secretKey: optionalEnv('LANGFUSE_SECRET_KEY'),
    projectId: optionalEnv('LANGFUSE_PROJECT_ID'),
    embedEnabled: process.env.LANGFUSE_EMBED_ENABLED === 'true',
    fetchSummaryEnabled: process.env.LANGFUSE_FETCH_SUMMARY_ENABLED !== 'false',
    timeoutMs: parseTimeoutMs(process.env.LANGFUSE_TIMEOUT_MS),
    defaultEnvironment: optionalEnv('LANGFUSE_DEFAULT_ENVIRONMENT') || 'production',
  }
}

export function isLangfuseConfigured(config = getLangfuseConfig()): boolean {
  return Boolean(
    config.enabled &&
    config.baseUrl &&
    config.publicKey &&
    config.secretKey
  )
}

export function buildLangfuseTraceUrl(
  baseUrl: string,
  projectId: string | null | undefined,
  traceId: string
): string {
  const cleanBase = baseUrl.replace(/\/$/, '')
  if (!projectId) return `${cleanBase}/traces/${encodeURIComponent(traceId)}`
  return `${cleanBase}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`
}

