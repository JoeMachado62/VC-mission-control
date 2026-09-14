import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw, isCommandTimeout } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { archiveOrphanTranscriptsForStateDir } from '@/lib/openclaw-doctor-fix'
import { parseOpenClawDoctorOutput } from '@/lib/openclaw-doctor'

// `openclaw doctor` routinely takes 13-17s here (it probes MCP servers); the
// previous 15s budget made this endpoint flap between findings and a false
// "not installed" error. Matches the POST fix path's generous budget in spirit.
const DOCTOR_TIMEOUT_MS = 60_000

function getCommandDetail(error: unknown): { detail: string; code: number | null } {
  const err = error as {
    stdout?: string
    stderr?: string
    message?: string
    code?: number | null
  }

  return {
    detail: [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n').trim(),
    code: typeof err?.code === 'number' ? err.code : null,
  }
}

/**
 * Only treat the CLI as missing when it produced no output at all. Doctor's own
 * findings legitimately contain phrases like "not installed" (e.g. the Codex
 * plugin hint) and must never be mistaken for a missing binary.
 */
function isMissingOpenClaw(error: unknown, detail: string): boolean {
  const err = error as { stdout?: string; code?: unknown } | null
  if (err?.code === 'ENOENT') return true
  if (err?.stdout && err.stdout.trim()) return false
  return /enoent|not installed|not reachable|command not found/i.test(detail)
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const result = await runOpenClaw(['doctor'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    return NextResponse.json(parseOpenClawDoctorOutput(`${result.stdout}\n${result.stderr}`, result.code ?? 0, {
      stateDir: config.openclawStateDir,
    }), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (isCommandTimeout(error)) {
      return NextResponse.json(
        { error: `OpenClaw doctor timed out after ${DOCTOR_TIMEOUT_MS / 1000}s` },
        { status: 504 }
      )
    }
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(error, detail)) {
      return NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 })
    }

    return NextResponse.json(parseOpenClawDoctorOutput(detail, code ?? 1, {
      stateDir: config.openclawStateDir,
    }), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const progress: Array<{ step: string; detail: string }> = []

    const preFix = await runOpenClaw(['doctor'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    const preStatus = parseOpenClawDoctorOutput(`${preFix.stdout}\n${preFix.stderr}`, preFix.code ?? 0, {
      stateDir: config.openclawStateDir,
    })

    if (!preStatus.canFix) {
      return NextResponse.json({
        success: true,
        progress: [
          {
            step: 'doctor',
            detail: 'No actionable DoctorFix items were detected. Remaining notes require optional runtime setup or are informational only.',
          },
        ],
        status: preStatus,
      })
    }

    const fixResult = await runOpenClaw(['doctor', '--fix'], { timeoutMs: 120000 })
    progress.push({ step: 'doctor', detail: 'Applied OpenClaw doctor config fixes.' })

    try {
      await runOpenClaw(['sessions', 'cleanup', '--all-agents', '--enforce', '--fix-missing'], { timeoutMs: 120000 })
      progress.push({ step: 'sessions', detail: 'Pruned missing transcript entries from session stores.' })
    } catch (error) {
      const { detail } = getCommandDetail(error)
      progress.push({ step: 'sessions', detail: detail || 'Session cleanup skipped.' })
    }

    const orphanFix = archiveOrphanTranscriptsForStateDir(config.openclawStateDir)
    progress.push({
      step: 'orphans',
      detail:
        orphanFix.archivedOrphans > 0
          ? `Archived ${orphanFix.archivedOrphans} orphan transcript file(s) across ${orphanFix.storesScanned} session store(s).`
          : `No orphan transcript files found across ${orphanFix.storesScanned} session store(s).`,
    })

    const postFix = await runOpenClaw(['doctor'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    const status = parseOpenClawDoctorOutput(`${postFix.stdout}\n${postFix.stderr}`, postFix.code ?? 0, {
      stateDir: config.openclawStateDir,
    })

    try {
      const db = getDatabase()
      db.prepare(
        'INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)'
      ).run(
        'openclaw.doctor.fix',
        auth.user.username,
        JSON.stringify({ level: status.level, healthy: status.healthy, issues: status.issues })
      )
    } catch {
      // Non-critical.
    }

    return NextResponse.json({
      success: true,
      output: `${fixResult.stdout}\n${fixResult.stderr}`.trim(),
      progress,
      status,
    })
  } catch (error) {
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(error, detail)) {
      return NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 })
    }

    logger.error({ err: error }, 'OpenClaw doctor fix failed')

    return NextResponse.json(
      {
        error: 'OpenClaw doctor fix failed',
        detail,
        status: parseOpenClawDoctorOutput(detail, code ?? 1, {
          stateDir: config.openclawStateDir,
        }),
      },
      { status: 500 }
    )
  }
}
