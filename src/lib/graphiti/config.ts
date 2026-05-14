export type GraphitiConfig = {
  enabled: boolean
  apiUrl: string
  mcpUrl: string
  readOnly: boolean
  timeoutMs: number
  pollIntervalMs: number
  conflictWindowMinutes: number
  apiKey: string | null
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(optionalEnv(name) ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

export function getGraphitiConfig(): GraphitiConfig {
  return {
    enabled: process.env.GRAPHITI_ENABLED === 'true',
    apiUrl: optionalEnv('GRAPHITI_API_URL') || 'http://127.0.0.1:8001',
    mcpUrl: optionalEnv('GRAPHITI_MCP_URL') || 'http://127.0.0.1:8002',
    readOnly: process.env.GRAPHITI_READ_ONLY !== 'false',
    timeoutMs: parseIntEnv('GRAPHITI_TIMEOUT_MS', 8000, 1000, 30000),
    pollIntervalMs: parseIntEnv('GRAPHITI_POLL_INTERVAL_MS', 5000, 1000, 60000),
    conflictWindowMinutes: parseIntEnv('GRAPHITI_CONFLICT_WINDOW_MINUTES', 60, 1, 1440),
    apiKey: optionalEnv('GRAPHITI_API_KEY'),
  }
}

export function isGraphitiConfigured(config = getGraphitiConfig()): boolean {
  return Boolean(config.enabled && config.apiUrl)
}
