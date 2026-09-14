/**
 * OpenClaw update-channel awareness.
 *
 * OpenClaw persists an update channel in <stateDir>/openclaw.json under
 * `update.channel`. Each channel corresponds to an npm dist-tag. Mission
 * Control's update banner and "Update Now" action must track the channel this
 * install is configured for — not GitHub's "latest" release, which follows the
 * fast-moving line regardless of what the operator has committed to.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { config } from './config'

export const UPDATE_CHANNELS = ['stable', 'extended-stable', 'beta', 'dev'] as const
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

/** npm dist-tag published for each OpenClaw update channel. */
export const CHANNEL_DIST_TAG: Record<UpdateChannel, string> = {
  stable: 'latest',
  'extended-stable': 'extended-stable',
  beta: 'beta',
  dev: 'dev',
}

export function normalizeChannel(value: unknown, fallback: UpdateChannel = 'stable'): UpdateChannel {
  if (typeof value !== 'string') return fallback
  const v = value.trim().toLowerCase()
  return (UPDATE_CHANNELS as readonly string[]).includes(v) ? (v as UpdateChannel) : fallback
}

export function distTagForChannel(channel: UpdateChannel): string {
  return CHANNEL_DIST_TAG[channel]
}

/**
 * Reads `update.channel` from <stateDir>/openclaw.json.
 * Falls back to 'stable' (OpenClaw's own default) when unset or unreadable.
 */
export function readConfiguredUpdateChannel(
  stateDir: string | undefined = config.openclawStateDir
): UpdateChannel {
  if (!stateDir) return 'stable'
  try {
    const raw = readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8')
    const parsed = JSON.parse(raw) as { update?: { channel?: unknown } }
    return normalizeChannel(parsed?.update?.channel)
  } catch {
    return 'stable'
  }
}

/** Compare dotted numeric versions (OpenClaw uses calendar versions like 2026.6.34). */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}
