// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { runCommand, isCommandTimeout } from '../command'

describe('runCommand timeout attribution', () => {
  it('rejects with a timedOut marker and a clear message when timeoutMs elapses', async () => {
    let caught: unknown
    await runCommand('sleep', ['5'], { timeoutMs: 300 }).catch(err => {
      caught = err
    })
    expect(caught).toBeTruthy()
    expect(isCommandTimeout(caught)).toBe(true)
    expect(String((caught as Error).message)).toMatch(/timed out after 300ms/)
  })

  it('resolves normally when the command finishes within the budget', async () => {
    const result = await runCommand('sh', ['-c', 'echo ok'], { timeoutMs: 5000 })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('does not flag ordinary non-zero exits as timeouts', async () => {
    let caught: unknown
    await runCommand('sh', ['-c', 'exit 3']).catch(err => {
      caught = err
    })
    expect(isCommandTimeout(caught)).toBe(false)
    expect((caught as { code?: number }).code).toBe(3)
  })
})
