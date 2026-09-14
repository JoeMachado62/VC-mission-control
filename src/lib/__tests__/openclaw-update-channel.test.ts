import { describe, it, expect } from 'vitest'
import {
  normalizeChannel,
  distTagForChannel,
  compareSemver,
  readConfiguredUpdateChannel,
} from '../openclaw-update-channel'

describe('normalizeChannel', () => {
  it('accepts known channels case-insensitively and defaults to stable', () => {
    expect(normalizeChannel('extended-stable')).toBe('extended-stable')
    expect(normalizeChannel(' BETA ')).toBe('beta')
    expect(normalizeChannel('nightly')).toBe('stable')
    expect(normalizeChannel(undefined)).toBe('stable')
  })
})

describe('distTagForChannel', () => {
  it('maps the stable channel to the npm latest tag', () => {
    expect(distTagForChannel('stable')).toBe('latest')
    expect(distTagForChannel('extended-stable')).toBe('extended-stable')
  })
})

describe('compareSemver', () => {
  it('orders calendar versions numerically and tolerates a v prefix', () => {
    expect(compareSemver('2026.9.2', '2026.6.34')).toBe(1)
    expect(compareSemver('2026.6.34', '2026.6.34')).toBe(0)
    expect(compareSemver('v2026.6.6', '2026.6.34')).toBe(-1)
  })
})

describe('readConfiguredUpdateChannel', () => {
  it('falls back to stable when the state dir is missing', () => {
    expect(readConfiguredUpdateChannel('/nonexistent/openclaw-state-dir')).toBe('stable')
  })
})
