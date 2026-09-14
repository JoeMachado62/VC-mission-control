import { loadGatewayEnv, mergeGatewayEnv } from '@/lib/gateway-env'
import { spawn } from 'node:child_process'
import { config } from './config'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  input?: string
  onData?: (chunk: string) => void
}

interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined
    let timedOut = false

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs)
    }

    child.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      options.onData?.(chunk)
    })

    child.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      options.onData?.(chunk)
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }
      const label = `${command} ${args.join(' ')}`
      const error = new Error(
        timedOut
          ? `Command timed out after ${options.timeoutMs}ms (${label})`
          : `Command failed (${label}): ${stderr || stdout}`
      )
      ;(error as any).stdout = stdout
      ;(error as any).stderr = stderr
      ;(error as any).code = code
      ;(error as any).timedOut = timedOut
      reject(error)
    })

    if (options.input) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

/** True when a runCommand rejection was caused by its timeoutMs elapsing. */
export function isCommandTimeout(error: unknown): boolean {
  return Boolean((error as { timedOut?: boolean } | null)?.timedOut)
}

export function runOpenClaw(args: string[], options: CommandOptions = {}) {
  // Explicitly pass OPENCLAW_STATE_DIR so the CLI uses the exact resolved path.
  // Without this, the CLI may interpret OPENCLAW_HOME as a parent directory and
  // append ".openclaw" to it — causing double-nesting when OPENCLAW_HOME is
  // already set to the state directory (e.g. /root/.openclaw → /root/.openclaw/.openclaw).
  // Gateway EnvironmentFiles fill gaps so spawned CLIs evaluate the same
  // config the running gateway does (otherwise doctor reports every
  // env-referenced MCP secret as "Missing env var"). MC's own environment
  // takes precedence — some keys legitimately differ between the services.
  const env: NodeJS.ProcessEnv = {
    ...mergeGatewayEnv(loadGatewayEnv(), process.env),
    OPENCLAW_STATE_DIR: config.openclawStateDir,
    ...options.env,
  }
  return runCommand(config.openclawBin, args, {
    ...options,
    env,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

export function runClawdbot(args: string[], options: CommandOptions = {}) {
  return runCommand(config.clawdbotBin, args, {
    ...options,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}
