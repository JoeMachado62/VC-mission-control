// VCH agent fleet maps three mode-scoped Graphiti namespaces. Mode boundary is a
// security property: buyer-mode reads must never see admin-mode data and vice
// versa. See docs/01_DannyAgent_PRD_v4.md §2.4 and docs/02_NegotiatorAgent_PRD_v4.md §2.4.

export const VCH_NAMESPACES = ['vch_buyer', 'vch_admin', 'vch_wholesale'] as const

export type VchNamespace = typeof VCH_NAMESPACES[number]

export function isVchNamespace(value: unknown): value is VchNamespace {
  return typeof value === 'string' && (VCH_NAMESPACES as readonly string[]).includes(value)
}

export function assertVchNamespace(value: unknown): VchNamespace {
  if (!isVchNamespace(value)) {
    throw new Error(`Invalid Graphiti namespace: ${String(value)}. Must be one of ${VCH_NAMESPACES.join(', ')}`)
  }
  return value
}

// Tool-style scripts (smoke tests, ad-hoc CLIs) may fall back to a default
// namespace via env var. The agent path must always pass a namespace explicitly.
export function getDefaultNamespaceFromEnv(): VchNamespace | null {
  const raw = process.env.GRAPHITI_DEFAULT_NAMESPACE?.trim()
  return isVchNamespace(raw) ? raw : null
}
