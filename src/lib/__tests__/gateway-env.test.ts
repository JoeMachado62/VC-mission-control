import { describe, it, expect } from 'vitest'
import {
  parseEnvFile,
  parseSystemdEnvironmentFiles,
  mergeGatewayEnv,
  filterExcludedKeys,
  resolveGatewayEnvFiles,
} from '../gateway-env'

describe('parseEnvFile', () => {
  it('parses plain, exported, quoted and space-containing values; skips comments and bad keys', () => {
    const vars = parseEnvFile(
      [
        '# comment',
        '',
        'A=1',
        'export B=two',
        'C="three four"',
        "D='five'",
        'E=Virtual CarHub',
        '; also a comment',
        'NOT A KEY=x',
        '=novalue',
      ].join('\n')
    )
    expect(vars).toEqual({ A: '1', B: 'two', C: 'three four', D: 'five', E: 'Virtual CarHub' })
  })
})

describe('parseSystemdEnvironmentFiles', () => {
  it('strips the ignore-errors prefix and suffix', () => {
    const out = '/etc/a.env (ignore_errors=no)\n-/etc/b.env (ignore_errors=yes)\n\n'
    expect(parseSystemdEnvironmentFiles(out)).toEqual(['/etc/a.env', '/etc/b.env'])
  })
})

describe('mergeGatewayEnv', () => {
  it('lets the caller environment win over gateway values', () => {
    expect(mergeGatewayEnv({ X: 'gateway', ONLY_GW: 'g' }, { X: 'own' })).toEqual({ X: 'own', ONLY_GW: 'g' })
  })
})

describe('filterExcludedKeys', () => {
  it('drops keys by prefix and is a no-op with no prefixes', () => {
    expect(filterExcludedKeys({ OTEL_A: '1', KEEP: '2' }, ['OTEL_'])).toEqual({ KEEP: '2' })
    expect(filterExcludedKeys({ OTEL_A: '1' }, [])).toEqual({ OTEL_A: '1' })
  })
})

describe('resolveGatewayEnvFiles', () => {
  it('honours an explicit list without consulting systemctl', () => {
    const env = { OPENCLAW_GATEWAY_ENV_FILES: '/a.env:/b.env, /c.env' }
    expect(resolveGatewayEnvFiles(env)).toEqual(['/a.env', '/b.env', '/c.env'])
  })
})
