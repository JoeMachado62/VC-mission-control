import { NextResponse } from 'next/server'
import { runOpenClaw } from '@/lib/command'
import {
  compareSemver,
  distTagForChannel,
  readConfiguredUpdateChannel,
} from '@/lib/openclaw-update-channel'

const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/openclaw/dist-tags'
const githubReleaseByTag = (version: string) =>
  `https://api.github.com/repos/openclaw/openclaw/releases/tags/v${version}`
const npmVersionPage = (version: string) => `https://www.npmjs.com/package/openclaw/v/${version}`

const headers = { 'Cache-Control': 'public, max-age=3600' }

export async function GET() {
  let installed: string | null = null

  try {
    const result = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    const match = result.stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) installed = match[1]
  } catch {
    // OpenClaw not installed or not reachable
    return NextResponse.json({ installed: null, latest: null, updateAvailable: false }, { headers })
  }

  if (!installed) {
    return NextResponse.json({ installed: null, latest: null, updateAvailable: false }, { headers })
  }

  // Track the channel this install is configured for. GitHub's "latest"
  // release follows the fast-moving line regardless of channel, so it would
  // advertise (and the Update Now action would install) versions the operator
  // has deliberately opted out of.
  const channel = readConfiguredUpdateChannel()
  const distTag = distTagForChannel(channel)
  const updateCommand = `openclaw update --channel ${channel}`
  const base = { installed, channel, distTag, updateCommand }

  try {
    const res = await fetch(NPM_DIST_TAGS_URL, { next: { revalidate: 3600 } })
    if (!res.ok) {
      return NextResponse.json({ ...base, latest: null, updateAvailable: false }, { headers })
    }

    const tags = (await res.json()) as Record<string, unknown>
    const latest = typeof tags[distTag] === 'string' ? (tags[distTag] as string) : null
    if (!latest) {
      return NextResponse.json(
        {
          ...base,
          latest: null,
          updateAvailable: false,
          warning: `npm publishes no "${distTag}" dist-tag for openclaw`,
        },
        { headers }
      )
    }

    const updateAvailable = compareSemver(latest, installed) > 0

    // Release notes: prefer the GitHub release for this exact version; fall
    // back to the npm version page when no GitHub release exists for it.
    let releaseUrl = npmVersionPage(latest)
    let releaseNotes = ''
    try {
      const gh = await fetch(githubReleaseByTag(latest), {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 3600 },
      })
      if (gh.ok) {
        const release = await gh.json()
        if (typeof release?.html_url === 'string') releaseUrl = release.html_url
        if (typeof release?.body === 'string') releaseNotes = release.body
      }
    } catch {
      // npm fallback already set
    }

    return NextResponse.json({ ...base, latest, updateAvailable, releaseUrl, releaseNotes }, { headers })
  } catch {
    return NextResponse.json({ ...base, latest: null, updateAvailable: false }, { headers })
  }
}
