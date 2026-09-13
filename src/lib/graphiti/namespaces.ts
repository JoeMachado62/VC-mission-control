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

// ── Read policy ───────────────────────────────────────────────────────
//
// Namespaces above govern WRITES: every agent writes only into its own namespace,
// which is what keeps provenance intact. Reads are a separate question, and a
// blanket shared pool is not acceptable — buyer-mode is customer-facing, so a
// caller on the phone must never be able to pull admin or ops context out of it.
//
// This policy is therefore per-mode rather than global. The one deliberate
// cross-boundary hop is wholesale → vch_buyer: the Negotiator needs to know what
// the buyer actually asked for, and both are deal context. Admin reads everything
// because it is operator-facing and already trusted.
//
// Nothing here grants buyer-mode sight of vch_admin. That boundary stays absolute.

export type VchReadMode = 'buyer' | 'wholesale' | 'admin'

export const VCH_READ_MODES: readonly VchReadMode[] = ['buyer', 'wholesale', 'admin']

const READ_POLICY: Record<VchReadMode, readonly VchNamespace[]> = {
  buyer: ['vch_buyer'],
  wholesale: ['vch_wholesale', 'vch_buyer'],
  admin: ['vch_buyer', 'vch_admin', 'vch_wholesale'],
}

export function isVchReadMode(value: unknown): value is VchReadMode {
  return typeof value === 'string' && (VCH_READ_MODES as readonly string[]).includes(value)
}

export function assertVchReadMode(value: unknown): VchReadMode {
  if (!isVchReadMode(value)) {
    throw new Error(`Invalid Graphiti read mode: ${String(value)}. Must be one of ${VCH_READ_MODES.join(', ')}`)
  }
  return value
}

/** Namespaces this mode may read. Never returns an empty list. */
export function readableNamespaces(mode: VchReadMode): readonly VchNamespace[] {
  return READ_POLICY[mode]
}

/** True when `mode` is permitted to read `namespace`. */
export function canRead(mode: VchReadMode, namespace: VchNamespace): boolean {
  return READ_POLICY[mode].includes(namespace)
}

/**
 * Resolve an API request's read scope from its `namespace` / `mode` query params.
 * Exactly one is required — neither defaults, because the mode boundary is a
 * security property. Returns a discriminated union so callers narrow cleanly.
 */
export type GraphitiReadScope =
  | { kind: 'mode'; mode: VchReadMode; namespaces: readonly VchNamespace[] }
  | { kind: 'namespace'; namespace: VchNamespace; namespaces: readonly VchNamespace[] }

export function resolveReadScope(
  namespaceParam: string | null,
  modeParam: string | null,
): GraphitiReadScope | { error: string } {
  if (modeParam !== null) {
    if (!isVchReadMode(modeParam)) {
      return { error: `mode must be one of ${VCH_READ_MODES.join(', ')}` }
    }
    return { kind: 'mode', mode: modeParam, namespaces: readableNamespaces(modeParam) }
  }
  if (!isVchNamespace(namespaceParam)) {
    return {
      error: `namespace or mode query parameter required; namespace must be one of ${VCH_NAMESPACES.join(', ')}`,
    }
  }
  return { kind: 'namespace', namespace: namespaceParam, namespaces: [namespaceParam] }
}
