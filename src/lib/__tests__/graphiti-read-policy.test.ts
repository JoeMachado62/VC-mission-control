import { describe, it, expect } from 'vitest'
import {
  VCH_NAMESPACES,
  VCH_READ_MODES,
  canRead,
  isVchReadMode,
  readableNamespaces,
  resolveReadScope,
} from '../graphiti/namespaces'

describe('Graphiti read policy', () => {
  it('never lets buyer-mode see admin data', () => {
    // The mode boundary is a security property: a caller on the phone must not be
    // able to pull ops context out of buyer-mode. This is the test that matters.
    expect(canRead('buyer', 'vch_admin')).toBe(false)
    expect(readableNamespaces('buyer')).toEqual(['vch_buyer'])
  })

  it('lets wholesale read buyer context but not admin', () => {
    expect(canRead('wholesale', 'vch_buyer')).toBe(true)
    expect(canRead('wholesale', 'vch_wholesale')).toBe(true)
    expect(canRead('wholesale', 'vch_admin')).toBe(false)
  })

  it('lets admin read everything', () => {
    for (const ns of VCH_NAMESPACES) expect(canRead('admin', ns)).toBe(true)
  })

  it('gives every mode a non-empty, in-vocabulary namespace list', () => {
    for (const mode of VCH_READ_MODES) {
      const namespaces = readableNamespaces(mode)
      expect(namespaces.length).toBeGreaterThan(0)
      for (const ns of namespaces) expect(VCH_NAMESPACES).toContain(ns)
    }
  })

  it('rejects unknown modes', () => {
    expect(isVchReadMode('root')).toBe(false)
    expect(isVchReadMode('')).toBe(false)
    expect(isVchReadMode(null)).toBe(false)
  })
})

describe('resolveReadScope', () => {
  it('resolves a mode to its policy namespaces', () => {
    const scope = resolveReadScope(null, 'wholesale')
    expect('error' in scope).toBe(false)
    if ('error' in scope) return
    expect(scope.kind).toBe('mode')
    expect(scope.namespaces).toEqual(['vch_wholesale', 'vch_buyer'])
  })

  it('resolves a single namespace unchanged', () => {
    const scope = resolveReadScope('vch_admin', null)
    expect('error' in scope).toBe(false)
    if ('error' in scope) return
    expect(scope.kind).toBe('namespace')
    expect(scope.namespaces).toEqual(['vch_admin'])
  })

  it('prefers mode when both are supplied, so a namespace cannot widen a mode', () => {
    const scope = resolveReadScope('vch_admin', 'buyer')
    expect('error' in scope).toBe(false)
    if ('error' in scope) return
    expect(scope.kind).toBe('mode')
    expect(scope.namespaces).toEqual(['vch_buyer'])
  })

  it('errors when neither is supplied, rather than defaulting', () => {
    expect(resolveReadScope(null, null)).toHaveProperty('error')
  })

  it('errors on an invalid mode instead of falling back to a namespace', () => {
    expect(resolveReadScope('vch_admin', 'nonsense')).toHaveProperty('error')
  })
})
