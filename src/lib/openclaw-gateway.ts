import { runOpenClaw } from './command'
import { config } from './config'
import { getDetectedGatewayToken } from './gateway-runtime'

export function parseGatewayJsonOutput(raw: string): unknown | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const objectStart = trimmed.indexOf('{')
  const arrayStart = trimmed.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0

  let start = -1
  let end = -1

  if (hasObject && hasArray) {
    if (objectStart < arrayStart) {
      start = objectStart
      end = trimmed.lastIndexOf('}')
    } else {
      start = arrayStart
      end = trimmed.lastIndexOf(']')
    }
  } else if (hasObject) {
    start = objectStart
    end = trimmed.lastIndexOf('}')
  } else if (hasArray) {
    start = arrayStart
    end = trimmed.lastIndexOf(']')
  }

  if (start < 0 || end < start) return null

  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
): Promise<T> {
  const isLoopbackHost = /^(127\.0\.0\.1|localhost|::1)$/i.test(config.gatewayHost)
  const gatewayUrl = isLoopbackHost
    ? undefined
    : `ws://${config.gatewayHost}:${config.gatewayPort}`
  const gatewayToken = getDetectedGatewayToken()

  const args = [
    'gateway',
    'call',
    method,
    '--timeout',
    String(Math.max(1000, Math.floor(timeoutMs))),
    '--params',
    JSON.stringify(params ?? {}),
    '--json',
  ]

  if (gatewayUrl) {
    args.push('--url', gatewayUrl)
  }
  if (gatewayToken) {
    args.push('--token', gatewayToken)
  }

  const result = await runOpenClaw(
    args,
    {
      timeoutMs: timeoutMs + 2000,
      env: gatewayUrl
        ? { ...process.env, OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: '1' }
        : undefined,
    },
  )

  const payload = parseGatewayJsonOutput(result.stdout)
  if (payload == null) {
    throw new Error(`Invalid JSON response from gateway method ${method}`)
  }

  return payload as T
}
